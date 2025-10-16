import * as fs from 'fs';
import * as path from 'path';
import { ToolConfigDynamoManager } from './tool-config-dynamo';

export interface UserDefinedTool {
  id: string;
  name: string;
  description: string;
  type: 'webhook' | 'script';
  enabled: boolean;
  config: WebhookConfig | ScriptConfig;
  createdAt: string;
}

export interface WebhookConfig {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  inputSchema: any;
  outputTransform?: string | null; // Optional JS code to transform response
}

export interface ScriptConfig {
  code: string; // JavaScript function code
  inputSchema: any;
  timeout: number; // Execution timeout in ms
}

export interface ToolConfiguration {
  user_tools: UserDefinedTool[];
}

export class ToolConfigManager {
  private configPath: string;

  constructor() {
    // Allow configuration via environment variable for production deployment
    const toolConfigDir = process.env.TOOL_CONFIG_DIR || process.cwd();
    this.configPath = path.join(toolConfigDir, 'tool-configurations.json');
  }

  /**
   * Load all user-defined tools - now redirects to DynamoDB
   * @deprecated Use ToolConfigDynamoManager.loadUserTools() directly for new code
   */
  public loadUserTools(): UserDefinedTool[] {
    console.warn('[TOOL CONFIG] loadUserTools() is deprecated - tools are now in DynamoDB. Use async methods instead.');
    // Return empty array and log warning - calling code should be updated to use DynamoDB directly
    return [];
  }

  /**
   * Async version - preferred method for new code
   */
  public async loadUserToolsAsync(): Promise<UserDefinedTool[]> {
    return ToolConfigDynamoManager.loadUserTools();
  }

  /**
   * Save a new user-defined tool - now redirects to DynamoDB
   * @deprecated Use ToolConfigDynamoManager.saveUserTool() directly
   */
  public saveUserTool(tool: UserDefinedTool): boolean {
    console.warn('[TOOL CONFIG] saveUserTool() is deprecated - use async ToolConfigDynamoManager.saveUserTool() instead');
    return false;
  }

  /**
   * Async version using DynamoDB
   */
  public async saveUserToolAsync(tool: UserDefinedTool): Promise<boolean> {
    return ToolConfigDynamoManager.saveUserTool(tool);
  }

  /**
   * Update an existing tool - now redirects to DynamoDB
   * @deprecated Use ToolConfigDynamoManager.updateUserTool() directly
   */
  public updateUserTool(tool: UserDefinedTool): boolean {
    console.warn('[TOOL CONFIG] updateUserTool() is deprecated - use async ToolConfigDynamoManager.updateUserTool() instead');
    return false;
  }

  /**
   * Async version using DynamoDB
   */
  public async updateUserToolAsync(tool: UserDefinedTool): Promise<boolean> {
    return ToolConfigDynamoManager.updateUserTool(tool);
  }

  /**
   * Remove a user-defined tool - now redirects to DynamoDB
   * @deprecated Use ToolConfigDynamoManager.removeUserTool() directly
   */
  public removeUserTool(toolId: string): boolean {
    console.warn('[TOOL CONFIG] removeUserTool() is deprecated - use async ToolConfigDynamoManager.removeUserTool() instead');
    return false;
  }

  /**
   * Async version using DynamoDB
   */
  public async removeUserToolAsync(toolId: string): Promise<boolean> {
    return ToolConfigDynamoManager.removeUserTool(toolId);
  }

  /**
   * Update tool enabled status - now redirects to DynamoDB
   * @deprecated Use ToolConfigDynamoManager.updateToolStatus() directly
   */
  public updateToolStatus(toolId: string, enabled: boolean): boolean {
    console.warn('[TOOL CONFIG] updateToolStatus() is deprecated - use async ToolConfigDynamoManager.updateToolStatus() instead');
    return false;
  }

  /**
   * Async version using DynamoDB
   */
  public async updateToolStatusAsync(toolId: string, enabled: boolean): Promise<boolean> {
    return ToolConfigDynamoManager.updateToolStatus(toolId, enabled);
  }

  /**
   * Get a specific tool by ID - now redirects to DynamoDB
   * @deprecated Use ToolConfigDynamoManager.getUserTool() directly
   */
  public getUserTool(toolId: string): UserDefinedTool | null {
    console.warn('[TOOL CONFIG] getUserTool() is deprecated - use async ToolConfigDynamoManager.getUserTool() instead');
    return null;
  }

  /**
   * Async version using DynamoDB
   */
  public async getUserToolAsync(toolId: string): Promise<UserDefinedTool | null> {
    return ToolConfigDynamoManager.getUserTool(toolId);
  }

  /**
   * Validate tool configuration
   */
  public validateTool(tool: Partial<UserDefinedTool>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Basic validation
    if (!tool.name || typeof tool.name !== 'string') {
      errors.push('Tool name is required and must be a string');
    }

    if (!tool.description || typeof tool.description !== 'string') {
      errors.push('Tool description is required and must be a string');
    }

    if (!tool.type || !['webhook', 'script'].includes(tool.type)) {
      errors.push('Tool type must be either "webhook" or "script"');
    }

    if (!tool.config) {
      errors.push('Tool configuration is required');
    } else {
      // Type-specific validation
      if (tool.type === 'webhook') {
        const webhookConfig = tool.config as WebhookConfig;
        
        if (!webhookConfig.url || typeof webhookConfig.url !== 'string') {
          errors.push('Webhook URL is required and must be a string');
        } else {
          try {
            new URL(webhookConfig.url);
          } catch {
            errors.push('Webhook URL must be a valid URL');
          }
        }

        if (!webhookConfig.method || !['GET', 'POST', 'PUT', 'DELETE'].includes(webhookConfig.method)) {
          errors.push('Webhook method must be GET, POST, PUT, or DELETE');
        }

        if (!webhookConfig.inputSchema) {
          errors.push('Webhook input schema is required');
        }
      } else if (tool.type === 'script') {
        const scriptConfig = tool.config as ScriptConfig;
        
        if (!scriptConfig.code || typeof scriptConfig.code !== 'string') {
          errors.push('Script code is required and must be a string');
        }

        if (!scriptConfig.inputSchema) {
          errors.push('Script input schema is required');
        }

        if (!scriptConfig.timeout || typeof scriptConfig.timeout !== 'number' || scriptConfig.timeout <= 0) {
          errors.push('Script timeout must be a positive number');
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Generate a unique ID for a new tool
   */
  public generateToolId(): string {
    return `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Write configuration to file with atomic operation
   */
  private writeConfig(config: ToolConfiguration): void {
    const tempPath = `${this.configPath}.tmp`;
    
    try {
      // Write to temp file first
      fs.writeFileSync(tempPath, JSON.stringify(config, null, 2), 'utf8');
      
      // Atomically rename to final file
      fs.renameSync(tempPath, this.configPath);
    } catch (error) {
      // Clean up temp file if it exists
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      throw error;
    }
  }

  /**
   * Create default configuration file
   */
  private createDefaultConfig(): void {
    const defaultConfig: ToolConfiguration = {
      user_tools: []
    };

    this.writeConfig(defaultConfig);
    console.log('[TOOL CONFIG] Created default tool configuration file');
  }
}
