import { BedrockAgentClient, StartIngestionJobCommand, ListKnowledgeBasesCommand, ListDataSourcesCommand, GetDataSourceCommand, GetIngestionJobCommand } from "@aws-sdk/client-bedrock-agent";
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";

const bedrock = new BedrockAgentClient({ region });
const s3 = new S3Client({ region });

/**
 * List all available Knowledge Bases
 */
export async function listKnowledgeBases() {
  const command = new ListKnowledgeBasesCommand({});
  const response = await bedrock.send(command);
  return response.knowledgeBaseSummaries || [];
}

/**
 * List all data sources for a specific Knowledge Base
 */
export async function listDataSources(knowledgeBaseId: string) {
  const command = new ListDataSourcesCommand({ knowledgeBaseId });
  const response = await bedrock.send(command);
  return response.dataSourceSummaries || [];
}

/**
 * Start Knowledge Base ingestion job
 */
export async function startKbIngestion(knowledgeBaseId?: string, dataSourceId?: string) {
  // Use provided IDs or fall back to environment variables
  const KB_ID = knowledgeBaseId || process.env.KB_ID!;
  const DATA_SOURCE_ID = dataSourceId || process.env.DATA_SOURCE_ID!;
  
  if (!KB_ID || !DATA_SOURCE_ID) {
    throw new Error("KB_ID and DATA_SOURCE_ID required (either passed as parameters or in environment)");
  }
  
  const out = await bedrock.send(new StartIngestionJobCommand({
    knowledgeBaseId: KB_ID,
    dataSourceId: DATA_SOURCE_ID
  }));
  return { ingestionJobId: out.ingestionJob?.ingestionJobId };
}

/**
 * Get ingestion job status
 */
export async function getIngestionJobStatus(knowledgeBaseId: string, dataSourceId: string, ingestionJobId: string) {
  const command = new GetIngestionJobCommand({
    knowledgeBaseId,
    dataSourceId,
    ingestionJobId
  });
  
  const response = await bedrock.send(command);
  return {
    status: response.ingestionJob?.status,
    statistics: response.ingestionJob?.statistics,
    failureReasons: response.ingestionJob?.failureReasons
  };
}

/**
 * List documents in a specific Data Source
 */
export async function listDataSourceDocuments(kbId: string, dataSourceId: string) {
  if (!kbId || !dataSourceId) throw new Error("KB_ID and DATA_SOURCE_ID required");
  
  // Get data source details to find S3 configuration
  const dataSource = await bedrock.send(new GetDataSourceCommand({
    knowledgeBaseId: kbId,
    dataSourceId: dataSourceId
  }));
  
  const s3Config = dataSource.dataSource?.dataSourceConfiguration?.s3Configuration;
  if (!s3Config?.bucketArn) {
    throw new Error("Data source is not configured with S3");
  }
  
  // Extract bucket name from ARN (arn:aws:s3:::bucket-name)
  const bucketName = s3Config.bucketArn.split(':').pop();
  const prefix = s3Config.inclusionPrefixes?.[0] || '';
  
  // List objects in S3
  const listResponse = await s3.send(new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: prefix,
    MaxKeys: 1000
  }));
  
  const documents = (listResponse.Contents || []).map(obj => ({
    key: obj.Key!,
    name: obj.Key!.split('/').pop() || obj.Key!,
    size: obj.Size || 0,
    lastModified: obj.LastModified?.toISOString() || '',
    s3Uri: `s3://${bucketName}/${obj.Key}`
  }));
  
  return { documents, bucketName, prefix };
}

/**
 * Delete documents from S3
 */
export async function deleteDocuments(bucketName: string, documentKeys: string[]) {
  const deletePromises = documentKeys.map(key =>
    s3.send(new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key
    }))
  );
  
  await Promise.all(deletePromises);
  return { deletedCount: documentKeys.length };
}
