import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { UserDefinedTool, WebhookConfig, ScriptConfig } from './tool-config';

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const TABLE_NAME = process.env.APP_CONFIGURATIONS_TABLE || "app_configurations";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

// Re-export types for external usage
export { UserDefinedTool, WebhookConfig, ScriptConfig };

/**
 * DynamoDB-based tool configuration manager
 * Stores user-defined tools with config_type='tool_config' and config_id=tool.id
 * Note: Using existing migration structure where tools are stored with config_type='tool_config'
 */
export class ToolConfigDynamoManager {
  private static readonly CONFIG_TYPE = "tool_config";

  /**
   * Load all user-defined tools from DynamoDB
   */
  static async loadUserTools(): Promise<UserDefinedTool[]> {
    try {
      console.log("[TOOL CONFIG DYNAMO] Loading user tools from DynamoDB");
      
      const command = new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "config_type = :config_type",
        ExpressionAttributeValues: {
          ":config_type": this.CONFIG_TYPE
        }
      });

      const response = await ddb.send(command);
      const tools: UserDefinedTool[] = [];

      if (response.Items) {
        for (const item of response.Items) {
          try {
            // Tools are stored in the 'config_data' field with individual properties
            const configData = item.config_data;
            if (configData) {
              // Reconstruct tool object from DynamoDB structure
              const toolData: UserDefinedTool = {
                id: item.config_id,
                name: configData.name,
                description: configData.description,
                type: configData.type,
                enabled: item.enabled || false, // enabled is at root level
                config: configData.config,
                createdAt: configData.createdAt
              };
              tools.push(toolData);
            }
          } catch (error) {
            console.warn(`[TOOL CONFIG DYNAMO] Failed to parse tool ${item.config_id}:`, error);
          }
        }
      }

      console.log(`[TOOL CONFIG DYNAMO] Loaded ${tools.length} user tools from DynamoDB`);
      return tools;
    } catch (error) {
      console.error("[TOOL CONFIG DYNAMO] Error loading user tools:", error);
      return [];
    }
  }

  /**
   * Save a new user-defined tool to DynamoDB
   */
  static async saveUserTool(tool: UserDefinedTool): Promise<boolean> {
    try {
      console.log(`[TOOL CONFIG DYNAMO] Saving tool: ${tool.name} (${tool.id})`);

      // Check if tool with same name already exists
      const existingTools = await this.loadUserTools();
      const existingTool = existingTools.find(t => t.name === tool.name && t.id !== tool.id);
      if (existingTool) {
        throw new Error(`Tool with name "${tool.name}" already exists`);
      }

      const command = new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          config_type: this.CONFIG_TYPE,
          config_id: tool.id,
          enabled: tool.enabled,
          config_data: {
            name: tool.name,
            description: tool.description,
            type: tool.type,
            config: tool.config,
            createdAt: tool.createdAt
          },
          updated_at: new Date().toISOString(),
          version: 1,
          created_at: new Date().toISOString()
        }
      });

      await ddb.send(command);
      console.log(`[TOOL CONFIG DYNAMO] Successfully saved tool: ${tool.name}`);
      return true;
    } catch (error) {
      console.error(`[TOOL CONFIG DYNAMO] Error saving tool ${tool.name}:`, error);
      return false;
    }
  }

  /**
   * Update an existing tool in DynamoDB
   */
  static async updateUserTool(tool: UserDefinedTool): Promise<boolean> {
    try {
      console.log(`[TOOL CONFIG DYNAMO] Updating tool: ${tool.name} (${tool.id})`);

      // Verify tool exists
      const existingTool = await this.getUserTool(tool.id);
      if (!existingTool) {
        throw new Error(`Tool with ID "${tool.id}" not found`);
      }

      const command = new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          config_type: this.CONFIG_TYPE,
          config_id: tool.id,
          enabled: tool.enabled,
          config_data: {
            name: tool.name,
            description: tool.description,
            type: tool.type,
            config: tool.config,
            createdAt: tool.createdAt
          },
          updated_at: new Date().toISOString(),
          version: (existingTool as any).version ? (existingTool as any).version + 1 : 2, // Increment version
          created_at: (existingTool as any).created_at || new Date().toISOString()
        }
      });

      await ddb.send(command);
      console.log(`[TOOL CONFIG DYNAMO] Successfully updated tool: ${tool.name}`);
      return true;
    } catch (error) {
      console.error(`[TOOL CONFIG DYNAMO] Error updating tool ${tool.name}:`, error);
      return false;
    }
  }

  /**
   * Remove a user-defined tool from DynamoDB
   */
  static async removeUserTool(toolId: string): Promise<boolean> {
    try {
      console.log(`[TOOL CONFIG DYNAMO] Removing tool: ${toolId}`);

      // Verify tool exists first
      const existingTool = await this.getUserTool(toolId);
      if (!existingTool) {
        throw new Error(`Tool with ID "${toolId}" not found`);
      }

      const command = new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          config_type: this.CONFIG_TYPE,
          config_id: toolId
        }
      });

      await ddb.send(command);
      console.log(`[TOOL CONFIG DYNAMO] Successfully removed tool: ${toolId}`);
      return true;
    } catch (error) {
      console.error(`[TOOL CONFIG DYNAMO] Error removing tool ${toolId}:`, error);
      return false;
    }
  }

  /**
   * Update tool enabled status in DynamoDB
   */
  static async updateToolStatus(toolId: string, enabled: boolean): Promise<boolean> {
    try {
      console.log(`[TOOL CONFIG DYNAMO] ${enabled ? 'Enabling' : 'Disabling'} tool: ${toolId}`);

      const existingTool = await this.getUserTool(toolId);
      if (!existingTool) {
        throw new Error(`Tool with ID "${toolId}" not found`);
      }

      // Update the enabled status
      existingTool.enabled = enabled;

      const command = new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          config_type: this.CONFIG_TYPE,
          config_id: toolId,
          enabled: enabled,
          config_data: {
            name: existingTool.name,
            description: existingTool.description,
            type: existingTool.type,
            config: existingTool.config,
            createdAt: existingTool.createdAt
          },
          updated_at: new Date().toISOString(),
          version: (existingTool as any).version ? (existingTool as any).version + 1 : 2,
          created_at: (existingTool as any).created_at || new Date().toISOString()
        }
      });

      await ddb.send(command);
      console.log(`[TOOL CONFIG DYNAMO] Successfully ${enabled ? 'enabled' : 'disabled'} tool: ${existingTool.name}`);
      return true;
    } catch (error) {
      console.error(`[TOOL CONFIG DYNAMO] Error updating tool status ${toolId}:`, error);
      return false;
    }
  }

  /**
   * Get a specific tool by ID from DynamoDB
   */
  static async getUserTool(toolId: string): Promise<UserDefinedTool | null> {
    try {
      const command = new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          config_type: this.CONFIG_TYPE,
          config_id: toolId
        }
      });

      const response = await ddb.send(command);
      
      if (response.Item && response.Item.config_data) {
        // Reconstruct tool object from DynamoDB structure
        const configData = response.Item.config_data;
        const toolData: UserDefinedTool = {
          id: response.Item.config_id,
          name: configData.name,
          description: configData.description,
          type: configData.type,
          enabled: response.Item.enabled || false,
          config: configData.config,
          createdAt: configData.createdAt
        };
        // Add internal fields for versioning
        (toolData as any).version = response.Item.version;
        (toolData as any).created_at = response.Item.created_at;
        return toolData;
      }

      return null;
    } catch (error) {
      console.error(`[TOOL CONFIG DYNAMO] Error getting tool ${toolId}:`, error);
      return null;
    }
  }

  /**
   * Generate a unique ID for a new tool
   */
  static generateToolId(): string {
    return `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Validate tool configuration
   */
  static validateTool(tool: Partial<UserDefinedTool>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!tool.name || typeof tool.name !== 'string' || tool.name.trim().length === 0) {
      errors.push('Tool name is required and must be a non-empty string');
    }

    if (!tool.description || typeof tool.description !== 'string') {
      errors.push('Tool description is required and must be a string');
    }

    if (!tool.type || !['webhook', 'script'].includes(tool.type)) {
      errors.push('Tool type must be either "webhook" or "script"');
    }

    if (tool.enabled !== undefined && typeof tool.enabled !== 'boolean') {
      errors.push('Tool enabled status must be a boolean');
    }

    if (!tool.config || typeof tool.config !== 'object') {
      errors.push('Tool config is required and must be an object');
    } else {
      // Type-specific validation
      if (tool.type === 'webhook') {
        const config = tool.config as WebhookConfig;
        if (!config.url || typeof config.url !== 'string') {
          errors.push('Webhook URL is required and must be a string');
        }
        if (!config.method || !['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(config.method)) {
          errors.push('Webhook method must be one of: GET, POST, PUT, DELETE, PATCH');
        }
        if (!config.inputSchema || typeof config.inputSchema !== 'object') {
          errors.push('Webhook input schema is required and must be an object');
        }
      } else if (tool.type === 'script') {
        const config = tool.config as ScriptConfig;
        if (!config.code || typeof config.code !== 'string') {
          errors.push('Script code is required and must be a string');
        }
        if (!config.inputSchema || typeof config.inputSchema !== 'object') {
          errors.push('Script input schema is required and must be an object');
        }
        if (config.timeout !== undefined && (typeof config.timeout !== 'number' || config.timeout <= 0)) {
          errors.push('Script timeout must be a positive number if specified');
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Migrate data from file-based configuration to DynamoDB
   * This is a one-time migration function
   */
  static async migrateFromFile(toolsData: UserDefinedTool[]): Promise<{ success: boolean; migrated: number; errors: string[] }> {
    console.log(`[TOOL CONFIG DYNAMO] Starting migration of ${toolsData.length} tools to DynamoDB`);
    
    const results = {
      success: true,
      migrated: 0,
      errors: [] as string[]
    };

    for (const tool of toolsData) {
      try {
        // Check if tool already exists in DynamoDB
        const existingTool = await this.getUserTool(tool.id);
        if (existingTool) {
          console.log(`[TOOL CONFIG DYNAMO] Tool ${tool.name} already exists in DynamoDB, skipping`);
          continue;
        }

        // Save tool to DynamoDB
        const saved = await this.saveUserTool(tool);
        if (saved) {
          results.migrated++;
          console.log(`[TOOL CONFIG DYNAMO] Migrated tool: ${tool.name} (${tool.id})`);
        } else {
          results.errors.push(`Failed to migrate tool: ${tool.name}`);
        }
      } catch (error) {
        const errorMsg = `Error migrating tool ${tool.name}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[TOOL CONFIG DYNAMO] ${errorMsg}`);
        results.errors.push(errorMsg);
      }
    }

    if (results.errors.length > 0) {
      results.success = false;
    }

    console.log(`[TOOL CONFIG DYNAMO] Migration complete: ${results.migrated} tools migrated, ${results.errors.length} errors`);
    return results;
  }
}
