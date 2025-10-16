import fs from 'fs';
import path from 'path';
import { DomainConfigManager, DomainEntry, DomainSettings, AuthorizedDomainsConfig } from './domain-config-manager';

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

export interface DomainValidationRequest {
  domain: string;
  origin: string;
  referer?: string;
}

export interface DomainValidationResponse {
  authorized: boolean;
  domain: string;
  reason?: string;
  timestamp: string;
}

export class DomainValidator {
  private scriptConfig!: ScriptConfig;
  private scriptConfigPath: string;
  private requestCounts: Map<string, { count: number; resetTime: number }> = new Map();
  private cachedConfig: AuthorizedDomainsConfig | null = null;
  private configCacheTime: number = 0;
  private readonly CACHE_TTL = 60000; // 1 minute cache TTL

  constructor() {
    // Allow configuration via environment variable for production deployment
    const configDir = process.env.CONFIG_DIR || path.join(process.cwd(), 'config');
    this.scriptConfigPath = path.join(configDir, 'script-templates.json');
    this.loadScriptConfig();
  }

  /**
   * Load script templates configuration
   */
  private loadScriptConfig(): void {
    try {
      const scriptConfigContent = fs.readFileSync(this.scriptConfigPath, 'utf8');
      this.scriptConfig = JSON.parse(scriptConfigContent);
    } catch (error) {
      console.error('Failed to load script config:', error);
      // Fallback to default script config
      this.scriptConfig = {
        scripts: {
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
        },
        metadata: {
          last_updated: new Date().toISOString(),
          version: "1.0.0",
          description: "Script templates for different widget types"
        }
      };
      this.saveScriptConfig();
    }
  }

  /**
   * Save script configuration to file
   */
  private saveScriptConfig(): void {
    try {
      fs.writeFileSync(this.scriptConfigPath, JSON.stringify(this.scriptConfig, null, 2));
    } catch (error) {
      console.error('Failed to save script config:', error);
    }
  }

  /**
   * Get configuration from DynamoDB with caching
   */
  private async getConfig(): Promise<AuthorizedDomainsConfig> {
    const now = Date.now();
    
    // Return cached config if still valid
    if (this.cachedConfig && (now - this.configCacheTime) < this.CACHE_TTL) {
      return this.cachedConfig;
    }

    try {
      // Get fresh config from DynamoDB
      this.cachedConfig = await DomainConfigManager.getConfig();
      this.configCacheTime = now;
      return this.cachedConfig;
    } catch (error) {
      console.error('Failed to load domain configuration from DynamoDB:', error);
      
      // Return cached config if available, otherwise return default
      if (this.cachedConfig) {
        console.log('Using cached configuration due to DynamoDB error');
        return this.cachedConfig;
      }

      // Fallback to default config
      const defaultConfig: AuthorizedDomainsConfig = {
        authorized_domains: [
          {
            domain: 'localhost',
            enabled: true,
            added_date: new Date().toISOString(),
            script_type: 'default'
          },
          {
            domain: '127.0.0.1',
            enabled: true,
            added_date: new Date().toISOString(),
            script_type: 'default'
          }
        ],
        settings: {
          strict_mode: false,
          allow_subdomains: false,
          require_https: false,
          max_requests_per_minute: 60
        },
        metadata: {
          last_updated: new Date().toISOString(),
          version: '2.0.0',
          description: 'Default fallback configuration'
        }
      };
      
      this.cachedConfig = defaultConfig;
      this.configCacheTime = now;
      return defaultConfig;
    }
  }

  /**
   * Clear configuration cache to force reload from DynamoDB
   */
  public reloadConfig(): void {
    this.cachedConfig = null;
    this.configCacheTime = 0;
  }

  /**
   * Get list of enabled domain strings
   */
  private async getEnabledDomains(): Promise<string[]> {
    const config = await this.getConfig();
    return config.authorized_domains
      .filter(domain => domain.enabled)
      .map(domain => domain.domain);
  }

  /**
   * Check if a domain is authorized
   */
  public async validateDomain(request: DomainValidationRequest): Promise<DomainValidationResponse> {
    const response: DomainValidationResponse = {
      authorized: false,
      domain: request.domain,
      timestamp: new Date().toISOString()
    };

    try {
      // Get current configuration
      const config = await this.getConfig();

      // Rate limiting check
      if (!this.checkRateLimit(request.domain, config.settings.max_requests_per_minute)) {
        response.reason = 'Rate limit exceeded';
        return response;
      }

      // HTTPS requirement check
      if (config.settings.require_https && !request.origin.startsWith('https://')) {
        response.reason = 'HTTPS required';
        return response;
      }

      // Clean domain for comparison
      const cleanDomain = this.cleanDomain(request.domain);
      
      // Get enabled domains only
      const enabledDomains = await this.getEnabledDomains();
      
      // Check exact domain match
      if (enabledDomains.includes(cleanDomain)) {
        response.authorized = true;
        return response;
      }

      // Check subdomain match if allowed
      if (config.settings.allow_subdomains) {
        const isSubdomainAuthorized = enabledDomains.some(authorizedDomain => {
          return cleanDomain.endsWith('.' + authorizedDomain);
        });

        if (isSubdomainAuthorized) {
          response.authorized = true;
          return response;
        }
      }

      // Additional validation in strict mode
      if (config.settings.strict_mode) {
        // Validate origin matches domain
        const originDomain = this.extractDomainFromOrigin(request.origin);
        if (originDomain !== cleanDomain) {
          response.reason = 'Origin domain mismatch';
          return response;
        }

        // Validate referer if provided
        if (request.referer) {
          const refererDomain = this.extractDomainFromOrigin(request.referer);
          if (refererDomain !== cleanDomain) {
            response.reason = 'Referer domain mismatch';
            return response;
          }
        }
      }

      response.reason = 'Domain not authorized';
      return response;

    } catch (error) {
      console.error('Domain validation error:', error);
      response.reason = 'Validation error';
      return response;
    }
  }

  /**
   * Check rate limiting for a domain
   */
  private checkRateLimit(domain: string, maxRequestsPerMinute: number): boolean {
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute window
    
    const key = domain;
    const current = this.requestCounts.get(key);

    if (!current || now > current.resetTime) {
      // New window or expired window
      this.requestCounts.set(key, {
        count: 1,
        resetTime: now + windowMs
      });
      return true;
    }

    if (current.count >= maxRequestsPerMinute) {
      return false;
    }

    current.count++;
    return true;
  }

  /**
   * Clean and normalize domain
   */
  private cleanDomain(domain: string): string {
    return domain.toLowerCase()
      .replace(/^www\./, '')  // Remove www prefix
      .replace(/:\d+$/, '');  // Remove port numbers
  }

  /**
   * Extract domain from origin URL
   */
  private extractDomainFromOrigin(origin: string): string {
    try {
      const url = new URL(origin);
      return this.cleanDomain(url.hostname);
    } catch {
      return '';
    }
  }

  /**
   * Get current configuration (for admin purposes)
   */
  public async getConfigForAdmin(): Promise<AuthorizedDomainsConfig> {
    return await this.getConfig();
  }

  /**
   * Add a domain to the authorized list (for admin purposes)
   */
  public async addAuthorizedDomain(domain: string, scriptType: string = "default"): Promise<boolean> {
    try {
      const cleanDomain = this.cleanDomain(domain);
      const success = await DomainConfigManager.addDomain(cleanDomain, scriptType);
      
      // Clear cache to force reload
      if (success) {
        this.reloadConfig();
      }
      
      return success;
    } catch (error) {
      console.error('Failed to add authorized domain:', error);
      return false;
    }
  }

  /**
   * Remove a domain from the authorized list (for admin purposes)
   */
  public async removeAuthorizedDomain(domain: string): Promise<boolean> {
    try {
      const cleanDomain = this.cleanDomain(domain);
      const success = await DomainConfigManager.removeDomain(cleanDomain);
      
      // Clear cache to force reload
      if (success) {
        this.reloadConfig();
      }
      
      return success;
    } catch (error) {
      console.error('Failed to remove authorized domain:', error);
      return false;
    }
  }

  /**
   * Toggle domain enabled/disabled status
   */
  public async toggleDomainStatus(domain: string): Promise<{ success: boolean; enabled?: boolean; error?: string }> {
    try {
      const cleanDomain = this.cleanDomain(domain);
      const result = await DomainConfigManager.toggleDomainStatus(cleanDomain);
      
      // Clear cache to force reload
      if (result.success) {
        this.reloadConfig();
      }
      
      return result;
    } catch (error) {
      console.error('Failed to toggle domain status:', error);
      return { success: false, error: 'Internal error' };
    }
  }

  /**
   * Update domain script type
   */
  public async updateDomainScriptType(domain: string, scriptType: string): Promise<{ success: boolean; error?: string }> {
    try {
      const cleanDomain = this.cleanDomain(domain);
      
      // Validate script type exists
      if (!this.scriptConfig.scripts[scriptType]) {
        return { success: false, error: 'Invalid script type' };
      }
      
      const result = await DomainConfigManager.updateDomainScriptType(cleanDomain, scriptType);
      
      // Clear cache to force reload
      if (result.success) {
        this.reloadConfig();
      }
      
      return result;
    } catch (error) {
      console.error('Failed to update domain script type:', error);
      return { success: false, error: 'Internal error' };
    }
  }

  /**
   * Get script template for a domain
   */
  public async getDomainScript(domain: string, serverUrl: string): Promise<{ script: string; scriptType: string } | null> {
    try {
      const cleanDomain = this.cleanDomain(domain);
      
      // Get domain entry from DynamoDB
      const domainEntry = await DomainConfigManager.getDomain(cleanDomain);
      
      if (!domainEntry) {
        return null;
      }
      
      const scriptType = domainEntry.script_type || 'default';
      const scriptTemplate = this.scriptConfig.scripts[scriptType];
      
      if (!scriptTemplate) {
        // Fallback to default
        const defaultTemplate = this.scriptConfig.scripts.default;
        if (!defaultTemplate) {
          return null;
        }
        return {
          script: defaultTemplate.template.replace('{{serverUrl}}', serverUrl),
          scriptType: 'default'
        };
      }
      
      return {
        script: scriptTemplate.template.replace('{{serverUrl}}', serverUrl),
        scriptType
      };
    } catch (error) {
      console.error('Failed to get domain script:', error);
      return null;
    }
  }

  /**
   * Get available script types
   */
  public getAvailableScriptTypes(): Record<string, ScriptTemplate> {
    return { ...this.scriptConfig.scripts };
  }

  /**
   * Get validation statistics
   */
  public async getStats(): Promise<any> {
    try {
      const config = await this.getConfig();
      return {
        total_authorized_domains: config.authorized_domains.length,
        settings: config.settings,
        current_rate_limits: Array.from(this.requestCounts.entries()).map(([domain, data]) => ({
          domain,
          requests: data.count,
          reset_time: new Date(data.resetTime).toISOString()
        }))
      };
    } catch (error) {
      console.error('Failed to get stats:', error);
      return {
        total_authorized_domains: 0,
        settings: {},
        current_rate_limits: []
      };
    }
  }
}
