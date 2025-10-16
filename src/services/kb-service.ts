import { 
  BedrockAgentRuntimeClient,
  RetrieveCommand,
  RetrieveCommandInput,
  RetrieveCommandOutput
} from "@aws-sdk/client-bedrock-agent-runtime";
import { KnowledgeBaseConfig } from "../config/consts";
import { fromEnv, fromIni } from "@aws-sdk/credential-providers";
import dotenv from "dotenv";

// Load environment variables quietly (before server.ts loads them)
dotenv.config({ quiet: true });

/**
 * Knowledge Base Service
 * Manages interactions with the Amazon Bedrock Knowledge Base
 */
export class KnowledgeBaseService {
  private bedrockAgentRuntimeClient: BedrockAgentRuntimeClient;

  constructor() {
    // Get credentials
    let credentials;
    try {
      // Use explicit credentials if provided in environment
      if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
        credentials = {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          sessionToken: process.env.AWS_SESSION_TOKEN // Optional
        };
        // Credentials loaded from environment variables
      } else if (process.env.USE_AWS_PROFILE === "true") {
        // Using profile from credentials file
        credentials = fromIni({
          profile: process.env.AWS_PROFILE || "default"
        });
        console.log(`Using AWS profile ${process.env.AWS_PROFILE || "default"} for KB service`);
      } 
      //   else {
      //   // Fallback to hardcoded credentials (from ../../.aws/credentials file)
      //   credentials = {
      //     accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      //     secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      //   };
      //   console.log("Using fallback hardcoded credentials for KB service");
      // }
    } catch (error) {
      console.error("Error loading credentials:", error);
      throw new Error("Failed to initialize credentials for knowledge base service");
    }

    this.bedrockAgentRuntimeClient = new BedrockAgentRuntimeClient({
      region: process.env.AWS_REGION || "us-east-1",
      credentials: credentials
    });
  }

  /**
   * Query the knowledge base
   * @param query User query text
   * @param knowledgeBaseId Optional KB ID to override the default
   * @returns Retrieved information or null (if not found)
   */
  async queryKnowledgeBase(query: string, knowledgeBaseId?: string): Promise<string | null> {
    try {
      const kbId = knowledgeBaseId || KnowledgeBaseConfig.kbId;
      console.log(`====== KNOWLEDGE BASE QUERY ======`);
      console.log(`Querying knowledge base ${kbId} with query: "${query}"`);
      console.log(`AWS Region: ${process.env.AWS_REGION || "us-east-1"}`);
      
      const params: RetrieveCommandInput = {
        knowledgeBaseId: kbId,
        retrievalQuery: {
          text: query
        }
      };
      
      console.log(`Request params: ${JSON.stringify(params, null, 2)}`);
      
      const command = new RetrieveCommand(params);
      console.log("Sending request to AWS Bedrock API...");
      const response: RetrieveCommandOutput = await this.bedrockAgentRuntimeClient.send(command);
      console.log("Received response from AWS Bedrock API");
      console.log(`Response metadata: ${JSON.stringify(response.$metadata, null, 2)}`);
      
      if (response.retrievalResults && response.retrievalResults.length > 0) {
        console.log(`Retrieved ${response.retrievalResults.length} results from knowledge base`);
        
        // Log the first result for debugging
        if (response.retrievalResults[0]) {
          console.log(`First result: ${JSON.stringify(response.retrievalResults[0], null, 2)}`);
        }
        
        // Extract and format results
        const formattedResults = response.retrievalResults
          .map((result: any, index: number) => {
            const content = result.content?.text || '';
            const source = result.location?.s3Location?.uri || 'Unknown source';
            return `[Source ${index + 1}]: ${content}\n(from: ${source})`;
          })
          .filter((text: string) => text.length > 0)
          .join('\n\n');
          
        console.log(`Knowledge base query succeeded with ${response.retrievalResults.length} result(s)`);
        console.log(`====== KNOWLEDGE BASE QUERY COMPLETE ======`);
        return formattedResults;
      }
      
      console.log(`No results found for knowledge base query`);
      console.log(`Full response: ${JSON.stringify(response, null, 2)}`);
      console.log(`====== KNOWLEDGE BASE QUERY COMPLETE - NO RESULTS ======`);
      return null;
    } catch (error: any) {
      console.error(`====== KNOWLEDGE BASE QUERY ERROR ======`);
      try {
        console.error(`Error details: ${JSON.stringify(error, null, 2)}`);
      } catch (jsonError) {
        console.error(`Error could not be stringified: ${String(error)}`);
      }
      console.error(`Error type: ${error?.constructor?.name || 'Unknown'}`);
      console.error(`Error message: ${error instanceof Error ? error.message : String(error)}`);
      if (error && error.$metadata) {
        console.error(`AWS error metadata: ${JSON.stringify(error.$metadata, null, 2)}`);
      }
      console.error(`====== END OF ERROR DETAILS ======`);
      return null;
    }
  }

  /**
   * Embed knowledge base query results into the system prompt
   * @param systemPrompt Original system prompt
   * @param query User query
   * @param knowledgeBaseId Optional KB ID to override the default
   * @returns Enhanced system prompt
   */
  async enhanceSystemPromptWithKB(systemPrompt: string, query: string, knowledgeBaseId?: string): Promise<string> {
    try {
      const kbId = knowledgeBaseId || KnowledgeBaseConfig.kbId;
      const kbResults = await this.queryKnowledgeBase(query, kbId);
      
      if (!kbResults) {
        // No KB results found - provide clear instruction to tell the user no information was found
        return `${systemPrompt}\n\nIMPORTANT INSTRUCTION: No information about this query was found in the knowledge base (${kbId}). Inform the user that you don't have information about their question and cannot provide an answer. Do NOT use any general knowledge to answer.`;
      }
      
      // KB results found - emphasize using ONLY this information to answer
      const enhancedPrompt = `${systemPrompt}\n\nIMPORTANT INSTRUCTION: ONLY use the following information from knowledge base ${kbId} to answer the query. Do NOT provide any information beyond what is explicitly stated here:\n\n${kbResults}\n\nIf the information above doesn't fully answer the user's question, acknowledge the limitations and only share what is available in the knowledge base.`;
      
      return enhancedPrompt;
    } catch (error) {
      console.error("Error enhancing system prompt with knowledge base:", error);
      return systemPrompt;
    }
  }

  /**
   * Check whether the knowledge base configuration is valid
   * @returns Boolean indicating whether the KB is configured
   */
  isKnowledgeBaseConfigured(): boolean {
    return Boolean(KnowledgeBaseConfig.kbId && KnowledgeBaseConfig.kbId !== "default-kb-id");
  }
}

// Create a singleton instance
export const knowledgeBaseService = new KnowledgeBaseService();
