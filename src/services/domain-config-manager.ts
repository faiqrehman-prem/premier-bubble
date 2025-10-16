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

export interface DomainEntry {
  domain: string;
  enabled: boolean;
  added_date: string;
  last_used?: string;
  script_type?: string;
}

export interface DomainSettings {
  strict_mode: boolean;
  allow_subdomains: boolean;
  require_https: boolean;
  max_requests_per_minute: number;
}

export interface AuthorizedDomainsConfig {
  authorized_domains: DomainEntry[];
  settings: DomainSettings;
  metadata: {
    last_updated: string;
    version: string;
    description: string;
  };
}

// Default settings values
const DEFAULT_DOMAIN_SETTINGS: DomainSettings = {
  strict_mode: false,
  allow_subdomains: false,
  require_https: false,
  max_requests_per_minute: 60
};

export class DomainConfigManager {
  private static readonly CONFIG_TYPE = "domain_config";
  private static readonly SETTINGS_CONFIG_ID = "domain_settings";

  /**
   * Get all domain configurations from DynamoDB
   */
  static async getAllDomains(): Promise<DomainEntry[]> {
    try {
      const response = await ddb.send(new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "config_type = :config_type AND config_id <> :settings_id",
        ExpressionAttributeValues: {
          ":config_type": this.CONFIG_TYPE,
          ":settings_id": this.SETTINGS_CONFIG_ID
        }
      }));

      if (!response.Items) {
        return [];
      }

      return response.Items.map(item => ({
        domain: item.config_data.domain,
        enabled: item.config_data.enabled ?? true,
        added_date: item.config_data.added_date,
        last_used: item.config_data.last_used,
        script_type: item.config_data.script_type ?? "default"
      }));
    } catch (error) {
      console.error("Error getting all domains:", error);
      return [];
    }
  }

  /**
   * Get domain settings from DynamoDB
   */
  static async getDomainSettings(): Promise<DomainSettings> {
    try {
      const response = await ddb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          config_type: this.CONFIG_TYPE,
          config_id: this.SETTINGS_CONFIG_ID
        }
      }));

      if (response.Item && response.Item.config_data) {
        return {
          ...DEFAULT_DOMAIN_SETTINGS,
          ...response.Item.config_data
        };
      } else {
        // Return default settings if no stored settings exist
        console.log("No domain settings found in DynamoDB, using defaults");
        return DEFAULT_DOMAIN_SETTINGS;
      }
    } catch (error) {
      console.error("Error getting domain settings:", error);
      return DEFAULT_DOMAIN_SETTINGS;
    }
  }

  /**
   * Get complete domain configuration (domains + settings)
   */
  static async getConfig(): Promise<AuthorizedDomainsConfig> {
    const [domains, settings] = await Promise.all([
      this.getAllDomains(),
      this.getDomainSettings()
    ]);

    return {
      authorized_domains: domains,
      settings: settings,
      metadata: {
        last_updated: new Date().toISOString(),
        version: "2.0.0",
        description: "Domain configuration from DynamoDB"
      }
    };
  }

  /**
   * Get a specific domain configuration
   */
  static async getDomain(domain: string): Promise<DomainEntry | null> {
    try {
      const cleanDomain = domain.toLowerCase().trim();
      const response = await ddb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          config_type: this.CONFIG_TYPE,
          config_id: cleanDomain
        }
      }));

      if (response.Item && response.Item.config_data) {
        return {
          domain: response.Item.config_data.domain,
          enabled: response.Item.config_data.enabled ?? true,
          added_date: response.Item.config_data.added_date,
          last_used: response.Item.config_data.last_used,
          script_type: response.Item.config_data.script_type ?? "default"
        };
      }

      return null;
    } catch (error) {
      console.error("Error getting domain:", error);
      return null;
    }
  }

  /**
   * Add a new domain to DynamoDB
   */
  static async addDomain(domain: string, scriptType: string = "default"): Promise<boolean> {
    try {
      const cleanDomain = domain.toLowerCase().trim();
      
      // Check if domain already exists
      const existing = await this.getDomain(cleanDomain);
      if (existing) {
        return false; // Domain already exists
      }

      const domainData: DomainEntry = {
        domain: cleanDomain,
        enabled: true,
        added_date: new Date().toISOString(),
        script_type: scriptType
      };

      await ddb.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          config_type: this.CONFIG_TYPE,
          config_id: cleanDomain,
          config_data: domainData,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      }));

      return true;
    } catch (error) {
      console.error("Error adding domain:", error);
      return false;
    }
  }

  /**
   * Remove a domain from DynamoDB
   */
  static async removeDomain(domain: string): Promise<boolean> {
    try {
      const cleanDomain = domain.toLowerCase().trim();

      await ddb.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          config_type: this.CONFIG_TYPE,
          config_id: cleanDomain
        }
      }));

      return true;
    } catch (error) {
      console.error("Error removing domain:", error);
      return false;
    }
  }

  /**
   * Toggle domain enabled/disabled status
   */
  static async toggleDomainStatus(domain: string): Promise<{ success: boolean; enabled?: boolean; error?: string }> {
    try {
      const cleanDomain = domain.toLowerCase().trim();
      const existingDomain = await this.getDomain(cleanDomain);
      
      if (!existingDomain) {
        return { success: false, error: "Domain not found" };
      }

      const newEnabled = !existingDomain.enabled;
      
      await ddb.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          config_type: this.CONFIG_TYPE,
          config_id: cleanDomain
        },
        UpdateExpression: "SET config_data.enabled = :enabled, config_data.last_used = :last_used, updated_at = :updated_at",
        ExpressionAttributeValues: {
          ":enabled": newEnabled,
          ":last_used": new Date().toISOString(),
          ":updated_at": new Date().toISOString()
        }
      }));

      return { success: true, enabled: newEnabled };
    } catch (error) {
      console.error("Error toggling domain status:", error);
      return { success: false, error: "Internal error" };
    }
  }

  /**
   * Update domain script type
   */
  static async updateDomainScriptType(domain: string, scriptType: string): Promise<{ success: boolean; error?: string }> {
    try {
      const cleanDomain = domain.toLowerCase().trim();
      const existingDomain = await this.getDomain(cleanDomain);
      
      if (!existingDomain) {
        return { success: false, error: "Domain not found" };
      }

      await ddb.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          config_type: this.CONFIG_TYPE,
          config_id: cleanDomain
        },
        UpdateExpression: "SET config_data.script_type = :script_type, config_data.last_used = :last_used, updated_at = :updated_at",
        ExpressionAttributeValues: {
          ":script_type": scriptType,
          ":last_used": new Date().toISOString(),
          ":updated_at": new Date().toISOString()
        }
      }));

      return { success: true };
    } catch (error) {
      console.error("Error updating domain script type:", error);
      return { success: false, error: "Internal error" };
    }
  }

  /**
   * Update domain settings
   */
  static async updateDomainSettings(settings: Partial<DomainSettings>): Promise<boolean> {
    try {
      // Get current settings first
      const currentSettings = await this.getDomainSettings();
      const updatedSettings = { ...currentSettings, ...settings };

      await ddb.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          config_type: this.CONFIG_TYPE,
          config_id: this.SETTINGS_CONFIG_ID,
          config_data: updatedSettings,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      }));

      return true;
    } catch (error) {
      console.error("Error updating domain settings:", error);
      return false;
    }
  }

  /**
   * Migrate data from authorized-domains.json file format to DynamoDB
   */
  static async migrateFromConfig(config: AuthorizedDomainsConfig): Promise<{ success: boolean; migrated: number; errors: string[] }> {
    const errors: string[] = [];
    let migrated = 0;

    try {
      // Migrate domain settings first
      const settingsSuccess = await this.updateDomainSettings(config.settings);
      if (!settingsSuccess) {
        errors.push("Failed to migrate domain settings");
      }

      // Migrate each domain
      for (const domainEntry of config.authorized_domains) {
        try {
          // Check if domain already exists
          const existing = await this.getDomain(domainEntry.domain);
          if (existing) {
            // Update existing domain to ensure all fields are present (including script_type)
            await ddb.send(new UpdateCommand({
              TableName: TABLE_NAME,
              Key: {
                config_type: this.CONFIG_TYPE,
                config_id: domainEntry.domain.toLowerCase().trim()
              },
              UpdateExpression: "SET config_data = :config_data, updated_at = :updated_at",
              ExpressionAttributeValues: {
                ":config_data": {
                  domain: domainEntry.domain,
                  enabled: domainEntry.enabled ?? true,
                  added_date: domainEntry.added_date,
                  last_used: domainEntry.last_used,
                  script_type: domainEntry.script_type ?? "default"
                },
                ":updated_at": new Date().toISOString()
              }
            }));
            migrated++;
          } else {
            // Add new domain
            const success = await this.addDomain(domainEntry.domain, domainEntry.script_type || "default");
            if (success) {
              migrated++;
            } else {
              errors.push(`Failed to add domain: ${domainEntry.domain}`);
            }
          }
        } catch (error) {
          errors.push(`Error migrating domain ${domainEntry.domain}: ${error}`);
        }
      }

      return {
        success: errors.length === 0,
        migrated,
        errors
      };
    } catch (error) {
      console.error("Error during migration:", error);
      return {
        success: false,
        migrated,
        errors: [...errors, `Migration failed: ${error}`]
      };
    }
  }

  /**
   * Get enabled domains only (for validation purposes)
   */
  static async getEnabledDomains(): Promise<string[]> {
    const allDomains = await this.getAllDomains();
    return allDomains
      .filter(domain => domain.enabled)
      .map(domain => domain.domain);
  }
}
