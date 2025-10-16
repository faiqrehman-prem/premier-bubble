import { Router } from "express";
import { extractVisibleText } from "../services/extractor";
import { putTextToS3, getTextFromS3 } from "../services/storage";
import { upsertIngestion, setIngestionStatus } from "../services/db";
import { listDataSourceDocuments, deleteDocuments, startKbIngestion, getIngestionJobStatus, listKnowledgeBases, listDataSources } from '../services/bedrock';
import crypto from "crypto";

const router = Router();

/**
 * Monitor ingestion job status and emit completion event
 */
async function monitorIngestionJob(
  ingestionJobId: string, 
  knowledgeBaseId: string, 
  dataSourceId: string, 
  emitProgress: (message: string, type?: 'info' | 'success' | 'error' | 'progress', data?: any) => void
) {
  const pollInterval = 10000; // 10 seconds
  const maxWaitTime = 600000; // 10 minutes max wait
  const startTime = Date.now();
  
  const checkStatus = async () => {
    try {
      const status = await getIngestionJobStatus(knowledgeBaseId, dataSourceId, ingestionJobId);
      
      if (status.status === 'COMPLETE') {
        emitProgress('✅ Knowledge Base sync completed! The documents are now searchable.', 'success');
        emitProgress('SYNC_COMPLETED', 'success', { event: 'sync-completed' }); // Special event for frontend
        return true;
      } else if (status.status === 'FAILED') {
        const reasons = status.failureReasons?.join(', ') || 'Unknown error';
        emitProgress(`❌ Knowledge Base sync failed: ${reasons}`, 'error');
        return true;
      } else if (Date.now() - startTime > maxWaitTime) {
        emitProgress('⏰ Knowledge Base sync timeout - job is still running in background', 'info');
        return true;
      } else {
        // Still in progress
        emitProgress(`🔄 Knowledge Base sync in progress... (Status: ${status.status})`, 'info');
        setTimeout(checkStatus, pollInterval);
        return false;
      }
    } catch (error) {
      console.error('Error checking ingestion job status:', error);
      emitProgress('❌ Error monitoring Knowledge Base sync status', 'error');
      return true;
    }
  };
  
  setTimeout(checkStatus, pollInterval);
}

/**
 * GET /api/ingest/knowledge-bases
 * Returns list of available Knowledge Bases
 */
router.get("/knowledge-bases", async (req, res) => {
  try {
    const knowledgeBases = await listKnowledgeBases();
    res.json({ knowledgeBases });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * GET /api/ingest/data-sources/:knowledgeBaseId
 * Returns list of data sources for a specific Knowledge Base
 */
router.get("/data-sources/:knowledgeBaseId", async (req, res) => {
  try {
    const { knowledgeBaseId } = req.params;
    const dataSources = await listDataSources(knowledgeBaseId);
    res.json({ dataSources });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * POST /api/ingest/submit
 * body: { urls: string[], knowledgeBaseId: string, dataSourceId: string, socketId?: string }
 * Returns per-URL result with s3_uri and status.
 */
router.post("/submit", async (req, res) => {
  const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
  const knowledgeBaseId = req.body?.knowledgeBaseId;
  const dataSourceId = req.body?.dataSourceId;
  const socketId = req.body?.socketId; // Socket ID for real-time updates
  
  if (!urls.length) return res.status(400).json({ error: "no urls" });
  if (!knowledgeBaseId) return res.status(400).json({ error: "knowledgeBaseId required" });
  if (!dataSourceId) return res.status(400).json({ error: "dataSourceId required" });

  const nowISO = () => new Date().toISOString();
  const results: any[] = [];
  const savedS3Keys: string[] = [];

  // Get Socket.IO instance for real-time updates
  const io = req.app.get('io');
  const emitProgress = (message: string, type: 'info' | 'success' | 'error' | 'progress' = 'info', data?: any) => {
    if (io && socketId) {
      io.to(socketId).emit('ingestionProgress', { message, type, data, timestamp: new Date().toISOString() });
    }
  };

  // Emit start event
  emitProgress(`🚀 Starting ingestion of ${urls.length} URL${urls.length === 1 ? '' : 's'}...`, 'progress', { 
    total: urls.length, 
    current: 0 
  });

  for (let i = 0; i < urls.length; i++) {
    const raw = urls[i];
    const url = String(raw || "").trim();
    const created_at = nowISO();
    const progress = { total: urls.length, current: i + 1 };

    emitProgress(`📥 Processing URL ${i + 1}/${urls.length}: ${url}`, 'progress', progress);

    try {
      emitProgress(`🔍 Fetching content from ${url}...`, 'info', progress);
      
      await upsertIngestion({
        url, created_at,
        status: "FETCHING",
        kb_id: knowledgeBaseId,
        data_source_id: dataSourceId
      });

      const text = await extractVisibleText(url);
      emitProgress(`Extracted ${text.length} characters of text`, 'info', progress);
      
      const sha256 = crypto.createHash("sha256").update(text).digest("hex");
      emitProgress(`💾 Saving to S3 storage...`, 'info', progress);
      
      const put = await putTextToS3(text, url); // Pass URL instead of sha256

      await upsertIngestion({
        url, created_at,
        s3_uri: put.s3_uri,
        text_sha256: sha256,
        status: "SAVED",
        kb_id: knowledgeBaseId,
        data_source_id: dataSourceId
      });

      emitProgress(`✅ Successfully saved: ${url}`, 'success', progress);
      results.push({ url, s3_uri: put.s3_uri, status: "SAVED" });
      savedS3Keys.push(put.key);
      
    } catch (e: any) {
      const errorMsg = String(e?.message || e);
      emitProgress(`❌ Failed to process ${url}: ${errorMsg}`, 'error', progress);
      
      await setIngestionStatus({ 
        url, created_at, 
        status: "ERROR", 
        error: errorMsg,
        kb_id: knowledgeBaseId,
        data_source_id: dataSourceId
      });
      results.push({ url, error: errorMsg, status: "ERROR" });
    }
  }

  // Trigger Bedrock KB ingestion once per batch if at least one file saved
  if (savedS3Keys.length) {
    try {
      emitProgress(`🔄 Starting Knowledge Base synchronization...`, 'info');
      const start = await startKbIngestion(knowledgeBaseId, dataSourceId);
      const jobId = start?.ingestionJobId;
      
      if (jobId) {
        emitProgress(`📊 Knowledge Base sync started: ${jobId}`, 'success');
        results.push({ kb_ingestion_job: jobId, status: "INGESTING" });
        
        // Start monitoring the job status in background
        monitorIngestionJob(jobId, knowledgeBaseId, dataSourceId, emitProgress);
      } else {
        emitProgress(`⚠️ Knowledge Base sync initiated but no job ID returned`, 'info');
        results.push({ kb_ingestion_job: null, status: "INGESTING" });
      }
    } catch (e: any) {
      const errorMsg = String(e?.message || e);
      emitProgress(`❌ Failed to start Knowledge Base sync: ${errorMsg}`, 'error');
      results.push({ kb_error: errorMsg });
    }
  } else {
    emitProgress(`⚠️ No files were successfully processed - skipping Knowledge Base sync`, 'info');
  }

  const successCount = results.filter(r => r.status === 'SAVED').length;
  const errorCount = results.filter(r => r.status === 'ERROR').length;
  
  emitProgress(`🎉 Ingestion complete! Success: ${successCount}, Errors: ${errorCount}`, 
    errorCount > 0 ? 'info' : 'success');

  res.json({ results });
});

/**
 * GET /api/ingest/documents/:knowledgeBaseId/:dataSourceId
 * Returns list of documents in a specific data source
 */
router.get("/documents/:knowledgeBaseId/:dataSourceId", async (req, res) => {
  try {
    const { knowledgeBaseId, dataSourceId } = req.params;
    const result = await listDataSourceDocuments(knowledgeBaseId, dataSourceId);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * DELETE /api/ingest/documents
 * body: { knowledgeBaseId: string, dataSourceId: string, documentKeys: string[] }
 * Deletes documents and triggers KB sync
 */
router.delete("/documents", async (req, res) => {
  try {
    const { knowledgeBaseId, dataSourceId, documentKeys } = req.body;
    
    if (!knowledgeBaseId || !dataSourceId || !Array.isArray(documentKeys) || !documentKeys.length) {
      return res.status(400).json({ error: "knowledgeBaseId, dataSourceId, and documentKeys required" });
    }

    // First get the bucket info
    const { bucketName } = await listDataSourceDocuments(knowledgeBaseId, dataSourceId);
    
    if (!bucketName) {
      return res.status(500).json({ error: "Could not determine S3 bucket for data source" });
    }
    
    // Delete documents from S3
    const deleteResult = await deleteDocuments(bucketName, documentKeys);
    
    // Start ingestion job to sync the changes
    const ingestionResult = await startKbIngestion(knowledgeBaseId, dataSourceId);
    
    res.json({
      deleted: deleteResult.deletedCount,
      documentKeys,
      ingestionJobId: ingestionResult.ingestionJobId,
      status: "DELETED_AND_SYNCING"
    });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * GET /api/ingest/document-content/:knowledgeBaseId/:dataSourceId/:documentKey
 * Get text content of a document from S3
 */
router.get("/document-content/:knowledgeBaseId/:dataSourceId/:documentKey", async (req, res) => {
  try {
    const { documentKey } = req.params;
    const decodedKey = decodeURIComponent(documentKey);
    
    // Only allow .txt files
    if (!decodedKey.toLowerCase().endsWith('.txt')) {
      return res.status(400).json({ error: "Only .txt files can be edited" });
    }
    
    const content = await getTextFromS3(decodedKey);
    res.json({ content, documentKey: decodedKey });
  } catch (e: any) {
    console.error("Error getting document content:", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * PUT /api/ingest/document-content
 * Update document content in S3 and trigger sync
 */
router.put("/document-content", async (req, res) => {
  try {
    const { knowledgeBaseId, dataSourceId, documentKey, content, socketId } = req.body;
    
    if (!knowledgeBaseId || !dataSourceId || !documentKey || content === undefined) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    
    // Only allow .txt files
    if (!documentKey.toLowerCase().endsWith('.txt')) {
      return res.status(400).json({ error: "Only .txt files can be edited" });
    }
    
    // Set up real-time progress updates
    const emitProgress = (message: string, type: 'info' | 'success' | 'error' | 'progress' = 'info', data?: any) => {
      if (socketId && req.app.get('io')) {
        const io = req.app.get('io');
        io.to(socketId).emit('ingestionProgress', {
          message,
          type,
          timestamp: new Date().toISOString(),
          data
        });
      }
    };
    
    emitProgress(`💾 Updating document: ${documentKey}`, 'info');
    
    // Save updated content to S3
    await putTextToS3(content, `s3-direct:${documentKey}`);
    emitProgress(`📁 Document saved to storage`, 'success');
    
    // Start ingestion job to sync the changes
    emitProgress(`🔄 Starting Knowledge Base sync...`, 'info');
    const start = await startKbIngestion(knowledgeBaseId, dataSourceId);
    const jobId = start?.ingestionJobId;
    
    if (jobId) {
      emitProgress(`📊 Knowledge Base sync started: ${jobId}`, 'success');
      
      // Start monitoring the job status
      monitorIngestionJob(jobId, knowledgeBaseId, dataSourceId, emitProgress);
    }
    
    res.json({ 
      success: true, 
      message: "Document updated and sync started",
      ingestionJobId: jobId 
    });
    
  } catch (e: any) {
    console.error("Error updating document:", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

export default router;
