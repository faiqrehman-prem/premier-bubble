import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "crypto";

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const BUCKET_NAME = process.env.TRANSCRIPTS_S3_BUCKET || "ai-tools-bucket-18052025";

console.log(`[TRANSCRIPT SERVICE] Using S3 bucket: ${BUCKET_NAME} (from env: ${process.env.TRANSCRIPTS_S3_BUCKET || 'not set'})`);

const s3Client = new S3Client({ region });

export interface TranscriptEntry {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export class TranscriptService {
  private sessionTranscripts: Map<string, TranscriptEntry[]> = new Map();
  private recentResponseHashes: Map<string, Set<string>> = new Map(); // sessionId -> Set of content hashes
  
  private readonly MAX_RECENT_HASHES = 10; // Keep track of last 10 response hashes per session

  /**
   * Initialize transcript tracking for a session
   */
  public initializeSession(sessionId: string): void {
    console.log(`[TRANSCRIPT] Initializing transcript for session: ${sessionId}`);
    this.sessionTranscripts.set(sessionId, []);
    this.recentResponseHashes.set(sessionId, new Set());
  }

  /**
   * Add a user input to the transcript
   */
  public addUserInput(sessionId: string, content: string): void {
    const transcript = this.sessionTranscripts.get(sessionId);
    if (!transcript) {
      console.warn(`[TRANSCRIPT] Session ${sessionId} not initialized`);
      return;
    }

    transcript.push({
      role: 'user',
      content: content.trim(),
      timestamp: new Date()
    });

    console.log(`[TRANSCRIPT] Added user input to session ${sessionId}: ${content.substring(0, 50)}...`);
  }

  /**
   * Add an assistant response to the transcript
   */
  public addAssistantResponse(sessionId: string, content: string): void {
    const transcript = this.sessionTranscripts.get(sessionId);
    const hashes = this.recentResponseHashes.get(sessionId);
    
    if (!transcript || !hashes) {
      console.warn(`[TRANSCRIPT] Session ${sessionId} not initialized`);
      return;
    }

    const trimmedContent = content.trim();
    if (!trimmedContent) {
      return; // Skip empty content
    }

    // Create a hash of the content to detect duplicates
    const contentHash = createHash('md5').update(trimmedContent).digest('hex');
    
    // Check if we've seen this exact content recently
    if (hashes.has(contentHash)) {
      console.log(`[TRANSCRIPT] Skipping duplicate assistant response for session ${sessionId}: ${trimmedContent.substring(0, 50)}...`);
      return;
    }

    // Add to transcript
    transcript.push({
      role: 'assistant',
      content: trimmedContent,
      timestamp: new Date()
    });

    // Track this content hash
    hashes.add(contentHash);
    
    // Limit the number of hashes we keep to prevent memory leaks
    if (hashes.size > this.MAX_RECENT_HASHES) {
      // Remove the oldest hash (convert to array, remove first, convert back)
      const hashArray = Array.from(hashes);
      hashes.delete(hashArray[0]);
    }

    console.log(`[TRANSCRIPT] Added assistant response to session ${sessionId}: ${trimmedContent.substring(0, 50)}...`);
  }

  /**
   * Get the current transcript for a session
   */
  public getTranscript(sessionId: string): TranscriptEntry[] {
    return this.sessionTranscripts.get(sessionId) || [];
  }

  /**
   * Format transcript as readable text
   */
  public formatTranscript(sessionId: string, startTime?: Date): string {
    const transcript = this.sessionTranscripts.get(sessionId);
    if (!transcript || transcript.length === 0) {
      return "No conversation data available.";
    }

    const sessionStart = startTime || transcript[0]?.timestamp || new Date();
    let formattedText = "";
    
    // Add header
    formattedText += `Nova Sonic Conversation Transcript\n`;
    formattedText += `Session ID: ${sessionId}\n`;
    formattedText += `Date: ${sessionStart.toLocaleDateString()}\n`;
    formattedText += `Time: ${sessionStart.toLocaleTimeString()}\n`;
    formattedText += `=====================================\n\n`;

    // Add conversation entries
    for (const entry of transcript) {
      const roleLabel = entry.role === 'user' ? 'User' : 'Assistant';
      const timestamp = entry.timestamp.toLocaleTimeString();
      
      formattedText += `[${timestamp}] ${roleLabel}: ${entry.content}\n\n`;
    }

    // Add footer
    formattedText += `=====================================\n`;
    formattedText += `Session ended: ${new Date().toLocaleString()}\n`;
    formattedText += `Total exchanges: ${transcript.length}\n`;

    return formattedText;
  }

  /**
   * Save transcript to S3 and clean up local storage
   */
  public async saveAndUploadTranscript(sessionId: string, startTime?: Date): Promise<{ success: boolean; s3Key?: string; error?: string }> {
    try {
      const transcript = this.sessionTranscripts.get(sessionId);
      if (!transcript || transcript.length === 0) {
        console.log(`[TRANSCRIPT] No transcript data for session ${sessionId}, skipping upload`);
        this.cleanupSession(sessionId);
        return { success: true, s3Key: undefined };
      }

      // Format the transcript
      const formattedTranscript = this.formatTranscript(sessionId, startTime);

      // Generate S3 key with session ID and timestamp
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
      const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
      const s3Key = `premiernx-bubble-transcripts/${dateStr}/${sessionId}_${dateStr}_${timeStr}.txt`;

      // Upload to S3
      const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: formattedTranscript,
        ContentType: 'text/plain',
        Metadata: {
          sessionId: sessionId,
          conversationLength: transcript.length.toString(),
          generatedAt: now.toISOString()
        }
      });

      await s3Client.send(command);

      console.log(`[TRANSCRIPT] Successfully uploaded transcript for session ${sessionId} to S3: ${s3Key}`);
      
      // Clean up local storage
      this.cleanupSession(sessionId);

      return { 
        success: true, 
        s3Key: s3Key 
      };

    } catch (error) {
      console.error(`[TRANSCRIPT] Failed to upload transcript for session ${sessionId}:`, error);
      
      // Still clean up local storage even if upload failed
      this.cleanupSession(sessionId);
      
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Clean up transcript data for a session
   */
  public cleanupSession(sessionId: string): void {
    this.sessionTranscripts.delete(sessionId);
    this.recentResponseHashes.delete(sessionId);
    console.log(`[TRANSCRIPT] Cleaned up transcript data for session: ${sessionId}`);
  }

  /**
   * Get active session count (for monitoring)
   */
  public getActiveSessionCount(): number {
    return this.sessionTranscripts.size;
  }

  /**
   * Get session summary (for debugging)
   */
  public getSessionSummary(sessionId: string): { entryCount: number; lastActivity: Date | null } {
    const transcript = this.sessionTranscripts.get(sessionId);
    if (!transcript) {
      return { entryCount: 0, lastActivity: null };
    }

    const lastEntry = transcript[transcript.length - 1];
    return {
      entryCount: transcript.length,
      lastActivity: lastEntry?.timestamp || null
    };
  }
}

// Singleton instance
export const transcriptService = new TranscriptService();
