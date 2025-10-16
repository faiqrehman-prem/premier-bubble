import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { 
  DynamoDBDocumentClient, 
  GetCommand, 
  PutCommand, 
  UpdateCommand, 
  ScanCommand,
  DeleteCommand 
} from "@aws-sdk/lib-dynamodb";

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const TABLE_NAME = process.env.APP_CONFIGURATIONS_TABLE || "app_configurations";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

export interface ScriptTemplate {
  name: string;
  description: string;
  template: string;
  type: string;
  external?: boolean;
}

export interface ScriptConfig {
  scripts: Record<string, ScriptTemplate>;
  metadata: {
    last_updated: string;
    version: string;
    description: string;
  };
}

// Default script templates
const DEFAULT_SCRIPT_TEMPLATES: Record<string, ScriptTemplate> = {
  default: {
    name: "Nova Sonic",
    description: "Nova Sonic PremierNx Bubble",
    template: "<script src=\"{{serverUrl}}/embed-widget.js\" async defer></script>",
    type: "default"
  },
  elevenlabs: {
    name: "ElevenLabs ConvAI",
    description: "ElevenLabs conversational AI widget",
    template: "<elevenlabs-convai agent-id=\"agent_8501k5f45ttcfzfrzzgsf56tynfa\"></elevenlabs-convai><script src=\"https://unpkg.com/@elevenlabs/convai-widget-embed\" async type=\"text/javascript\"></script>",
    type: "elevenlabs",
    external: true
  }
};

export class ScriptTemplateManager {
  private static readonly CONFIG_TYPE = "script_template";

  /**
   * Get all script templates from DynamoDB
   */
  static async getAllScriptTemplates(): Promise<Record<string, ScriptTemplate>> {
    try {
      const response = await ddb.send(new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "config_type = :config_type",
        ExpressionAttributeValues: {
          ":config_type": this.CONFIG_TYPE
        }
      }));

      if (!response.Items || response.Items.length === 0) {
        // Return default templates if none exist
        return DEFAULT_SCRIPT_TEMPLATES;
      }

      const scripts: Record<string, ScriptTemplate> = {};
      response.Items.forEach(item => {
        if (item.config_data && item.config_id) {
          scripts[item.config_id] = {
            name: item.config_data.name,
            description: item.config_data.description,
            template: item.config_data.template,
            type: item.config_data.type,
            external: item.config_data.external
          };
        }
      });

      return scripts;
    } catch (error) {
      console.error("Error getting script templates:", error);
      return DEFAULT_SCRIPT_TEMPLATES;
    }
  }

  /**
   * Get all script templates as an array for API responses
   */
  static async getAllScriptTemplatesArray(): Promise<Array<{
    script_id: string;
    name: string;
    description: string;
    template_content: string;
    is_external: boolean;
  }>> {
    try {
      const response = await ddb.send(new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "config_type = :config_type",
        ExpressionAttributeValues: {
          ":config_type": this.CONFIG_TYPE
        }
      }));

      const scripts: Array<{
        script_id: string;
        name: string;
        description: string;
        template_content: string;
        is_external: boolean;
      }> = [];

      response.Items?.forEach(item => {
        if (item.config_data && item.config_id) {
          scripts.push({
            script_id: item.config_id,
            name: item.config_data.name || '',
            description: item.config_data.description || '',
            template_content: item.config_data.template || '',
            is_external: item.config_data.external || false
          });
        }
      });

      return scripts;
    } catch (error) {
      console.error("Error getting script templates array:", error);
      return [];
    }
  }

  /**
   * Get complete script configuration (scripts + metadata)
   */
  static async getScriptConfig(): Promise<ScriptConfig> {
    const scripts = await this.getAllScriptTemplates();

    return {
      scripts,
      metadata: {
        last_updated: new Date().toISOString(),
        version: "2.0.0",
        description: "Script templates from DynamoDB"
      }
    };
  }

  /**
   * Get a specific script template
   */
  static async getScriptTemplate(scriptId: string): Promise<ScriptTemplate | null> {
    try {
      const response = await ddb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          config_type: this.CONFIG_TYPE,
          config_id: scriptId
        }
      }));

      if (response.Item && response.Item.config_data) {
        return {
          name: response.Item.config_data.name,
          description: response.Item.config_data.description,
          template: response.Item.config_data.template,
          type: response.Item.config_data.type,
          external: response.Item.config_data.external
        };
      }

      return null;
    } catch (error) {
      console.error("Error getting script template:", error);
      return null;
    }
  }

  /**
   * Add a new script template to DynamoDB
   */
  static async addScriptTemplate(scriptId: string, template: ScriptTemplate): Promise<boolean> {
    try {
      // Check if script already exists
      const existing = await this.getScriptTemplate(scriptId);
      if (existing) {
        return false; // Script already exists
      }

      await ddb.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          config_type: this.CONFIG_TYPE,
          config_id: scriptId,
          config_data: {
            name: template.name,
            description: template.description,
            template: template.template,
            type: template.type,
            external: template.external || false
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      }));

      return true;
    } catch (error) {
      console.error("Error adding script template:", error);
      return false;
    }
  }

  /**
   * Update an existing script template
   */
  static async updateScriptTemplate(scriptId: string, template: Partial<ScriptTemplate>): Promise<boolean> {
    try {
      // Check if script exists
      const existing = await this.getScriptTemplate(scriptId);
      if (!existing) {
        return false; // Script doesn't exist
      }

      const updatedTemplate = {
        ...existing,
        ...template
      };

      await ddb.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          config_type: this.CONFIG_TYPE,
          config_id: scriptId
        },
        UpdateExpression: "SET config_data = :config_data, updated_at = :updated_at",
        ExpressionAttributeValues: {
          ":config_data": {
            name: updatedTemplate.name,
            description: updatedTemplate.description,
            template: updatedTemplate.template,
            type: updatedTemplate.type,
            external: updatedTemplate.external || false
          },
          ":updated_at": new Date().toISOString()
        }
      }));

      return true;
    } catch (error) {
      console.error("Error updating script template:", error);
      return false;
    }
  }

  /**
   * Remove a script template from DynamoDB
   */
  static async removeScriptTemplate(scriptId: string): Promise<boolean> {
    try {
      // Don't allow deletion of default script
      if (scriptId === 'default') {
        return false;
      }

      await ddb.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          config_type: this.CONFIG_TYPE,
          config_id: scriptId
        }
      }));

      return true;
    } catch (error) {
      console.error("Error removing script template:", error);
      return false;
    }
  }

  /**
   * Migrate data from script-templates.json file format to DynamoDB
   */
  static async migrateFromConfig(config: ScriptConfig): Promise<{ success: boolean; migrated: number; errors: string[] }> {
    const errors: string[] = [];
    let migrated = 0;

    try {
      // Migrate each script template
      for (const [scriptId, template] of Object.entries(config.scripts)) {
        try {
          // Check if script already exists
          const existing = await this.getScriptTemplate(scriptId);
          if (existing) {
            // Update existing script template
            const success = await this.updateScriptTemplate(scriptId, template);
            if (success) {
              migrated++;
            } else {
              errors.push(`Failed to update script template: ${scriptId}`);
            }
          } else {
            // Add new script template
            const success = await this.addScriptTemplate(scriptId, template);
            if (success) {
              migrated++;
            } else {
              errors.push(`Failed to add script template: ${scriptId}`);
            }
          }
        } catch (error) {
          errors.push(`Error migrating script template ${scriptId}: ${error}`);
        }
      }

      return {
        success: errors.length === 0,
        migrated,
        errors
      };
    } catch (error) {
      console.error("Error during script template migration:", error);
      return {
        success: false,
        migrated,
        errors: [...errors, `Migration failed: ${error}`]
      };
    }
  }

  /**
   * Get script template names for dropdown/selection purposes
   */
  static async getScriptTemplateNames(): Promise<Array<{ id: string; name: string; description: string }>> {
    try {
      const scripts = await this.getAllScriptTemplates();
      return Object.entries(scripts).map(([id, template]) => ({
        id,
        name: template.name,
        description: template.description
      }));
    } catch (error) {
      console.error("Error getting script template names:", error);
      return [
        { id: 'default', name: 'Nova Sonic', description: 'Nova Sonic PremierNx Bubble' }
      ];
    }
  }

  /**
   * Validate script template structure
   */
  static validateScriptTemplate(template: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!template.name || typeof template.name !== 'string') {
      errors.push('Script name is required and must be a string');
    }

    // Description is optional - allow empty or missing
    if (template.description !== undefined && typeof template.description !== 'string') {
      errors.push('Script description must be a string if provided');
    }

    if (!template.template || typeof template.template !== 'string') {
      errors.push('Script template is required and must be a string');
    }

    if (!template.type || typeof template.type !== 'string') {
      errors.push('Script type is required and must be a string');
    }

    // Removed serverUrl placeholder validation - no restrictions

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
