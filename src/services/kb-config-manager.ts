import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const TABLE_NAME = process.env.APP_CONFIGURATIONS_TABLE || "app_configurations";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

// Knowledge Base configuration interface
export interface KBConfig {
  kbId: string;
  kbName?: string;
  lastUpdated?: string;
}

// Default configuration values
const DEFAULT_KB_CONFIG: KBConfig = {
  kbId: "O9GPOSWN9B", // Fallback KB ID
  kbName: "Default Knowledge Base",
  lastUpdated: new Date().toISOString()
};

export class KBConfigManager {
  private static readonly CONFIG_TYPE = "kb_config";
  private static readonly CONFIG_ID = "main";

  /**
   * Get the current knowledge base configuration from DynamoDB
   */
  static async getKBConfig(): Promise<KBConfig> {
    try {
      const response = await ddb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          config_type: this.CONFIG_TYPE,
          config_id: this.CONFIG_ID
        }
      }));

      if (response.Item && response.Item.config_data) {
        // Return the stored configuration
        return {
          ...DEFAULT_KB_CONFIG,
          ...response.Item.config_data
        };
      } else {
        // Return default config if no stored config exists
        console.log("No KB configuration found in DynamoDB, using defaults");
        return DEFAULT_KB_CONFIG;
      }
    } catch (error) {
      console.error("Error loading KB configuration from DynamoDB:", error);
      // Return default config on error (no file fallback)
      return DEFAULT_KB_CONFIG;
    }
  }

  /**
   * Save the knowledge base configuration to DynamoDB
   */
  static async saveKBConfig(config: Partial<KBConfig>): Promise<KBConfig> {
    try {
      // Get current config and merge with new values
      const currentConfig = await this.getKBConfig();
      const updatedConfig: KBConfig = {
        ...currentConfig,
        ...config,
        lastUpdated: new Date().toISOString()
      };

      // Save to DynamoDB
      await ddb.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          config_type: this.CONFIG_TYPE,
          config_id: this.CONFIG_ID,
          config_data: updatedConfig,
          last_updated: new Date().toISOString(),
          version: "1.0"
        }
      }));

      console.log("KB configuration saved to DynamoDB successfully");
      return updatedConfig;
    } catch (error) {
      console.error("Error saving KB configuration to DynamoDB:", error);
      throw new Error("Failed to save KB configuration");
    }
  }

  /**
   * Update the knowledge base ID and name
   */
  static async updateKnowledgeBaseId(kbId: string, kbName?: string): Promise<KBConfig> {
    return await this.saveKBConfig({ 
      kbId, 
      ...(kbName && { kbName })
    });
  }

  /**
   * Get only the knowledge base ID
   */
  static async getKnowledgeBaseId(): Promise<string> {
    const config = await this.getKBConfig();
    return config.kbId || DEFAULT_KB_CONFIG.kbId;
  }

  /**
   * Get only the knowledge base name
   */
  static async getKnowledgeBaseName(): Promise<string | null> {
    const config = await this.getKBConfig();
    return config.kbName || null;
  }

  /**
   * Initialize the KB configuration table with data from existing kb-config.json file
   * This is used for one-time migration only - NOT NEEDED as data already exists
   */
  static async migrateFromFile(configData: KBConfig): Promise<void> {
    console.log("⚠️  KB migration not needed - configuration already exists in DynamoDB");
    console.log("Current config_type: kb_config, config_id: main");
    
    // Just verify the current config structure
    const existingConfig = await this.getKBConfig();
    console.log("Existing KB configuration:", JSON.stringify(existingConfig, null, 2));
  }

  /**
   * Legacy compatibility: Get config in the old format for backwards compatibility
   */
  static async getLegacyFormat(): Promise<{ kbId: string }> {
    const config = await this.getKBConfig();
    return { kbId: config.kbId };
  }
}
