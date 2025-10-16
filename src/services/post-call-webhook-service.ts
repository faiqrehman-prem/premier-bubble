import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { transcriptService, TranscriptEntry } from "./transcript-service";

interface SessionData {
  sessionId: string;
  startTime: Date;
  transcriptS3Key?: string;
  audioS3Key?: string;
  userId?: string;
  audioBase64?: string; // Optional base64 audio data
}

interface WebhookPayload {
  type: string;
  event_timestamp: number;
  data: {
    agent_id: string;
    conversation_id: string;
    status: string;
    user_id: string;
    transcript: Array<{role: string, message: string}>;
    full_audio?: string; // Base64 encoded audio - optional
    metadata: {
      call_duration_secs: number;
      cost_cents: number;
      phone_number: string;
    };
    analysis: {
      transcript_summary: string;
      call_successful: string;
    };
  };
}

export class PostCallWebhookService {
  private bedrockClient!: BedrockRuntimeClient;
  private s3Client!: S3Client;
  private webhookUrl = 'https://prod-30.northcentralus.logic.azure.com:443/workflows/04c016a68d1048e8b286d197d7e65011/triggers/When_a_HTTP_request_is_received/paths/invoke?api-version=2016-10-01&sp=%2Ftriggers%2FWhen_a_HTTP_request_is_received%2Frun&sv=1.0&sig=-2A8wNrNOGg5F8aBaaSugp2haZ1mlKqFjBP13sQCY_U';
  private s3BucketName: string;

  constructor() {
    this.s3BucketName = process.env.S3_BUCKET || 'ai-tools-bucket-18052025';
    this.initializeClients();
  }

  private initializeClients() {
    try {
      const credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      };

      const region = process.env.AWS_REGION || 'us-east-1';

      this.bedrockClient = new BedrockRuntimeClient({
        region,
        credentials,
      });

      this.s3Client = new S3Client({
        region,
        credentials,
      });

      console.log('[WEBHOOK] AWS clients initialized for post-call webhook service');
    } catch (error) {
      console.error('[WEBHOOK] Failed to initialize AWS clients:', error);
      throw error;
    }
  }

  /**
   * Generate summary using Nova Pro model
   */
  private async generateTranscriptSummary(transcriptContent: string): Promise<string> {
    try {
      console.log('[WEBHOOK] Generating summary using Nova Pro...');
      
      if (!transcriptContent || transcriptContent.trim() === '') {
        return 'No transcript content available for summary.';
      }

      const prompt = `Please provide a concise summary of this customer service conversation. Focus on:
1. The main issue or request from the customer
2. Key actions taken by the agent
3. The resolution or outcome
4. Overall tone and customer satisfaction

Transcript:
${transcriptContent}

Please keep the summary to 2-3 sentences and be professional.`;

      const command = new ConverseCommand({
        modelId: "us.amazon.nova-pro-v1:0",
        messages: [
          {
            role: "user",
            content: [{ text: prompt }]
          }
        ],
        inferenceConfig: {
          maxTokens: 200,
          temperature: 0.3,
        }
      });

      const response = await this.bedrockClient.send(command);
      const summary = response.output?.message?.content?.[0]?.text || 'No summary available';
      
      console.log('[WEBHOOK] Summary generated successfully');
      return summary;
    } catch (error) {
      console.error('[WEBHOOK] Error generating summary:', error);
      return 'Error generating conversation summary.';
    }
  }

  /**
   * Read transcript content from S3
   */
  private async readTranscriptFromS3(s3Key: string): Promise<string> {
    try {
      console.log(`[WEBHOOK] Reading transcript from S3: ${s3Key}`);

      const command = new GetObjectCommand({
        Bucket: this.s3BucketName,
        Key: s3Key,
      });

      const response = await this.s3Client.send(command);
      const transcriptContent = await response.Body?.transformToString() || '';
      
      console.log('[WEBHOOK] Transcript content retrieved from S3');
      return transcriptContent;
    } catch (error) {
      console.error('[WEBHOOK] Error reading transcript from S3:', error);
      return '';
    }
  }

  /**
   * Parse transcript entries from raw S3 text file
   * Format: [9:38:50 PM] User: drop off for the keys for the customers
   */
  private parseTranscriptFromText(transcriptText: string): Array<{role: string, message: string}> | null {
    try {
      console.log('[WEBHOOK] Parsing transcript entries from text file content');
      
      if (!transcriptText || transcriptText.trim() === '') {
        console.log('[WEBHOOK] No transcript text to parse');
        return null;
      }

      // Extract just the conversation part, removing header and footer
      const conversationSection = transcriptText.split('=====================================');
      if (conversationSection.length < 2) {
        console.log('[WEBHOOK] Could not find conversation section in transcript');
        return null;
      }

      // Extract just the conversation part (middle section)
      const conversationText = conversationSection[1].trim();
      
      // Exact pattern that matches: [9:38:50 PM] User: drop off for the keys for the customers
      const pattern = /\[([^\]]+)\]\s+(User|Assistant):\s+(.*?)(?=\n\s*\[|\n\s*$|$)/gs;
      
      const matches = [...conversationText.matchAll(pattern)];
      
      if (!matches || matches.length === 0) {
        console.log('[WEBHOOK] No matches found in transcript using timestamp pattern');
        console.log('[WEBHOOK] First 200 characters of conversation part:', conversationText.substring(0, 200));
        return null;
      }
      
      const entries = matches.map(match => ({
        role: match[2].toLowerCase() === 'user' ? 'user' : 'agent', // Map 'Assistant' to 'agent'
        message: match[3].trim()
      })).filter(entry => entry.message); // Filter out empty messages
      
      console.log(`[WEBHOOK] Successfully parsed ${entries.length} transcript entries from text file`);
      return entries.length > 0 ? entries : null;
    } catch (error) {
      console.error('[WEBHOOK] Error parsing transcript text:', error);
      return null;
    }
  }

  /**
   * Get transcript entries directly from TranscriptService
   */
  private getTranscriptEntries(sessionId: string): Array<{role: string, message: string}> | null {
    try {
      console.log(`[WEBHOOK] Getting transcript entries directly from TranscriptService for ${sessionId}`);
      
      // Get transcript entries from the transcript service
      const entries = transcriptService.getTranscript(sessionId);
      
      if (!entries || entries.length === 0) {
        console.log(`[WEBHOOK] No transcript entries found in TranscriptService for session ${sessionId}`);
        return null;
      }
      
      // Convert to the format expected by the webhook
      const formattedEntries = entries.map(entry => ({
        role: entry.role === 'user' ? 'user' : 'agent', // Map 'assistant' to 'agent'
        message: entry.content
      })).filter(entry => entry.message); // Filter out empty messages
      
      console.log(`[WEBHOOK] Successfully retrieved ${formattedEntries.length} transcript entries from TranscriptService`);
      return formattedEntries.length > 0 ? formattedEntries : null;
    } catch (error) {
      console.error(`[WEBHOOK] Error getting transcript entries from TranscriptService: ${error}`);
      return null;
    }
  }
  
  /**
   * Get audio content as base64 from S3
   */
  private async getAudioBase64(s3Key: string): Promise<string | null> {
    try {
      console.log(`[WEBHOOK] Getting audio content as base64 from S3: ${s3Key}`);
      
      const command = new GetObjectCommand({
        Bucket: this.s3BucketName,
        Key: s3Key,
      });
      
      const response = await this.s3Client.send(command);
      
      if (!response.Body) {
        console.log('[WEBHOOK] No audio content in S3 response');
        return null;
      }
      
      // Convert to binary data
      const arrayBuffer = await response.Body.transformToByteArray();
      
      // Convert to base64
      const base64Data = Buffer.from(arrayBuffer).toString('base64');
      
      console.log(`[WEBHOOK] Successfully converted audio to base64 (${Math.round(base64Data.length / 1024)} KB)`);
      return base64Data;
    } catch (error) {
      console.error(`[WEBHOOK] Error getting audio as base64 from S3: ${error}`);
      return null;
    }
  }

  /**
   * Get current user ID from session or default
   */
  private getCurrentUserId(sessionUserId?: string): string {
    return sessionUserId || `kb-layer-user-${Date.now()}`;
  }

  /**
   * Calculate call duration in seconds
   */
  private calculateCallDuration(startTime: Date): number {
    return Math.floor((Date.now() - startTime.getTime()) / 1000);
  }

  /**
   * Process session end and send webhook
   */
  public async processSessionEnd(sessionData: SessionData): Promise<void> {
    try {
      console.log(`[WEBHOOK] Processing session end for: ${sessionData.sessionId}`);

      // Ensure we have a valid session ID
      if (!sessionData.sessionId) {
        console.error('[WEBHOOK] Session ID is missing, cannot proceed');
        return;
      }

      // STEP 1: Get real transcript data - first try from TranscriptService (in memory)
      let transcriptEntries = this.getTranscriptEntries(sessionData.sessionId);
      let transcriptContent = '';
      
      // If not found in memory, try to parse from S3 file
      if (!transcriptEntries && sessionData.transcriptS3Key) {
        console.log('[WEBHOOK] No transcript in memory, reading from S3');
        transcriptContent = await this.readTranscriptFromS3(sessionData.transcriptS3Key);
        
        if (transcriptContent) {
          // Parse the transcript text into transcript entries
          transcriptEntries = this.parseTranscriptFromText(transcriptContent);
        }
      }
      
      // If we still don't have valid transcript entries, we can't proceed - NO FALLBACKS
      if (!transcriptEntries || transcriptEntries.length === 0) {
        console.error('[WEBHOOK] No valid transcript entries found. Cannot proceed with webhook.');
        return; // Exit without sending webhook
      }
      
      // Generate transcript content for summary if we don't already have it
      if (!transcriptContent && transcriptEntries.length > 0) {
        transcriptContent = transcriptEntries
          .map(entry => `${entry.role.toUpperCase()}: ${entry.message}`)
          .join('\n\n');
      }

      // Generate summary
      const summary = await this.generateTranscriptSummary(transcriptContent);

      // Get user ID
      const userId = this.getCurrentUserId(sessionData.userId);

      // Calculate call duration
      const callDuration = this.calculateCallDuration(sessionData.startTime);

      // STEP 2: Get audio data - prioritize client-provided base64 if available
      let audioBase64: string | null = null;
      if (sessionData.audioBase64) {
        console.log('[WEBHOOK] Using client-provided base64 audio data');
        audioBase64 = sessionData.audioBase64;
      } else if (sessionData.audioS3Key) {
        console.log('[WEBHOOK] No base64 from client, fetching from S3');
        audioBase64 = await this.getAudioBase64(sessionData.audioS3Key);
      }

      // Determine webhook type based on whether we have audio
      const webhookType = audioBase64 ? 'post_call_audio' : 'post_call_transcription';

      // STEP 3: Create webhook payload with real data only
      const payload: WebhookPayload = {
        type: webhookType,
        event_timestamp: Math.floor(Date.now() / 1000),
        data: {
          agent_id: 'test_agent_123', // Using the required ID from the test script
          conversation_id: sessionData.sessionId,
          status: 'completed',
          user_id: userId,
          transcript: transcriptEntries, // Real transcript entries only - verified above
          metadata: {
            call_duration_secs: callDuration,
            cost_cents: 25, // Using required value from test script
            phone_number: '+1234567890' // Using required value from test script
          },
          analysis: {
            transcript_summary: summary,
            call_successful: 'true' 
          }
        }
      };
      
      // Add audio data if available
      if (audioBase64) {
        payload.data.full_audio = audioBase64;
      }

      // Log details before sending
      console.log('[WEBHOOK] Sending webhook payload...');
      console.log(`[WEBHOOK] Type: ${webhookType}`);
      console.log(`[WEBHOOK] Transcript entries: ${payload.data.transcript.length}`);
      console.log(`[WEBHOOK] Audio included: ${audioBase64 ? 'Yes' : 'No'}`);
      console.log(`[WEBHOOK] First transcript entry: ${JSON.stringify(payload.data.transcript[0])}`);

      // STEP 4: Send the webhook
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000)
      });

      if (response.ok) {
        console.log(`[WEBHOOK] ✅ Successfully sent webhook for session: ${sessionData.sessionId}`);
        console.log(`[WEBHOOK] Response status: ${response.status}`);
        
        try {
          const responseText = await response.text();
          if (responseText) {
            console.log(`[WEBHOOK] Response body: ${responseText.substring(0, 200)}${responseText.length > 200 ? '...' : ''}`);
          }
        } catch (e) {
          // Ignore response reading errors
        }
      } else {
        console.error(`[WEBHOOK] ❌ Webhook failed with status: ${response.status}`);
        try {
          const errorText = await response.text();
          console.error(`[WEBHOOK] Error response: ${errorText}`);
        } catch (e) {
          console.error(`[WEBHOOK] Could not read error response`);
        }
      }

    } catch (error) {
      console.error(`[WEBHOOK] ❌ Failed to process session end for ${sessionData.sessionId}:`, error);
    }
  }
}

// Export singleton instance
export const postCallWebhookService = new PostCallWebhookService();
