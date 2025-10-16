import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const TABLE_NAME = process.env.APP_CONFIGURATIONS_TABLE || "app_configurations";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

// Configuration interface matching current config.json structure
export interface AppConfig {
  systemPrompt: string;
  voice: string;
  chunkSize: number;
  enabledTools: string[];
}

// Default configuration values
const DEFAULT_CONFIG: AppConfig = {
  systemPrompt: "",
  voice: "matthew",
  chunkSize: 512,
  enabledTools: ["retrieveFromKnowledgeBase"]
};

export class ConfigManager {
  private static readonly CONFIG_TYPE = "system_config";
  private static readonly CONFIG_ID = "main";

  /**
   * Get the current application configuration from DynamoDB
   */
  static async getConfig(): Promise<AppConfig> {
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
          ...DEFAULT_CONFIG,
          ...response.Item.config_data
        };
      } else {
        // Return default config if no stored config exists
        console.log("No app configuration found in DynamoDB, using defaults");
        return DEFAULT_CONFIG;
      }
    } catch (error) {
      console.error("Error loading app configuration from DynamoDB:", error);
      // Return default config on error (no file fallback)
      return DEFAULT_CONFIG;
    }
  }

  /**
   * Save the entire configuration to DynamoDB
   */
  static async saveConfig(config: Partial<AppConfig>): Promise<AppConfig> {
    try {
      // Get current config and merge with new values
      const currentConfig = await this.getConfig();
      const updatedConfig: AppConfig = {
        ...currentConfig,
        ...config
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

      console.log("App configuration saved to DynamoDB successfully");
      return updatedConfig;
    } catch (error) {
      console.error("Error saving app configuration to DynamoDB:", error);
      throw new Error("Failed to save configuration");
    }
  }

  /**
   * Update only specific configuration fields
   */
  static async updateConfig(updates: Partial<AppConfig>): Promise<AppConfig> {
  try {
    const names: Record<string, string> = {
      "#cd": "config_data",
      "#lu": "last_updated",
    };
    const vals: Record<string, any> = {
      ":lu": new Date().toISOString(),
    };
    const sets: string[] = ["#lu = :lu"];

    if (updates.systemPrompt !== undefined) {
      names["#sp"] = "systemPrompt";
      vals[":sp"] = updates.systemPrompt;
      sets.push("#cd.#sp = :sp");
    }
    if (updates.voice !== undefined) {
      names["#v"] = "voice";
      vals[":v"] = updates.voice;
      sets.push("#cd.#v = :v");
    }
    if (updates.chunkSize !== undefined) {
      names["#cs"] = "chunkSize";
      vals[":cs"] = updates.chunkSize;
      sets.push("#cd.#cs = :cs");
    }
    if (updates.enabledTools !== undefined) {
      names["#et"] = "enabledTools";
      vals[":et"] = updates.enabledTools;
      sets.push("#cd.#et = :et");
    }

    await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { config_type: this.CONFIG_TYPE, config_id: this.CONFIG_ID },
      UpdateExpression: `SET ${sets.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: vals,
    }));

    return await this.getConfig();
  } catch (error) {
    console.error("Error updating app configuration in DynamoDB:", error);
    throw new Error("Failed to update configuration");
  }
}

  /**
   * Get only the enabled tools list
   */
  static async getEnabledTools(): Promise<string[]> {
    const config = await this.getConfig();
    return config.enabledTools || DEFAULT_CONFIG.enabledTools;
  }

  /**
   * Update only the enabled tools list
   */
  static async updateEnabledTools(enabledTools: string[]): Promise<string[]> {
    await this.updateConfig({ enabledTools });
    return enabledTools;
  }

  /**
   * Get only the voice setting
   */
  static async getVoice(): Promise<string> {
    const config = await this.getConfig();
    return config.voice || DEFAULT_CONFIG.voice;
  }

  /**
   * Update only the voice setting
   */
  static async updateVoice(voice: string): Promise<string> {
    await this.updateConfig({ voice });
    return voice;
  }

  /**
   * Get only the system prompt
   */
  static async getSystemPrompt(): Promise<string> {
    const config = await this.getConfig();
    return config.systemPrompt || DEFAULT_CONFIG.systemPrompt;
  }

  /**
   * Update only the system prompt
   */
  static async updateSystemPrompt(systemPrompt: string): Promise<string> {
    await this.updateConfig({ systemPrompt });
    return systemPrompt;
  }

  /**
   * Initialize the configuration table with data from existing config.json file
   * This is used for one-time migration only - NOT NEEDED as data already exists
   */
  static async migrateFromFile(configData: AppConfig): Promise<void> {
    console.log("⚠️  Migration not needed - configuration already exists in DynamoDB");
    console.log("Current config_type: system_config, config_id: main");
    
    // Just verify the current config structure
    const existingConfig = await this.getConfig();
    console.log("Existing configuration:", JSON.stringify(existingConfig, null, 2));
  }
}
