import { WebhookConfig } from './tool-config';

export interface WebhookExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  statusCode?: number;
  executionTime?: number;
}

export class WebhookExecutor {
  private readonly DEFAULT_TIMEOUT = 30000; // 30 seconds
  private readonly MAX_RESPONSE_SIZE = 10 * 1024 * 1024; // 10MB

  /**
   * Execute a webhook tool with the given arguments
   */
  public async executeWebhook(config: WebhookConfig, args: any): Promise<WebhookExecutionResult> {
    const startTime = Date.now();
    
    try {
      // Validate configuration
      this.validateConfig(config);

      // Prepare request
      const requestConfig = this.prepareRequest(config, args);
      
      // Execute HTTP request
      const response = await this.makeHttpRequest(requestConfig);
      
      // Process response
      const result = await this.processResponse(response, config);
      
      return {
        success: true,
        data: result,
        statusCode: response.status,
        executionTime: Date.now() - startTime
      };

    } catch (error) {
      console.error('[WEBHOOK EXECUTOR] Error:', error);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Test webhook configuration without executing
   */
  public async testWebhook(config: WebhookConfig, testInput: any = {}): Promise<WebhookExecutionResult> {
    try {
      // Validate configuration
      this.validateConfig(config);

      // Test with minimal request
      const testConfig = {
        ...config,
        method: 'GET' as const // Use GET for testing to avoid side effects
      };

      // For testing, we'll just validate the URL is reachable
      const url = this.interpolateUrl(config.url, testInput);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout for test

      try {
        const response = await fetch(url, {
          method: 'HEAD', // Use HEAD to avoid downloading content
          headers: this.prepareHeaders(config.headers || {}),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        return {
          success: response.ok,
          statusCode: response.status,
          data: response.ok ? 'Connection successful' : `HTTP ${response.status}: ${response.statusText}`
        };

      } catch (fetchError) {
        clearTimeout(timeoutId);
        throw fetchError;
      }

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Test failed'
      };
    }
  }

  /**
   * Validate webhook configuration
   */
  private validateConfig(config: WebhookConfig): void {
    if (!config.url) {
      throw new Error('Webhook URL is required');
    }

    try {
      new URL(config.url);
    } catch {
      throw new Error('Invalid webhook URL format');
    }

    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(config.method)) {
      throw new Error('Invalid HTTP method');
    }

    // Validate input schema exists
    if (!config.inputSchema) {
      throw new Error('Input schema is required');
    }
  }

  /**
   * Prepare HTTP request configuration
   */
  private prepareRequest(config: WebhookConfig, args: any): RequestInit & { url: string } {
    const url = this.interpolateUrl(config.url, args);
    const headers = this.prepareHeaders(config.headers || {});

    let body: string | undefined = undefined;
    
    // For methods that support body, send args as JSON
    if (['POST', 'PUT'].includes(config.method)) {
      body = JSON.stringify(args);
      headers['Content-Type'] = 'application/json';
    }

    return {
      url,
      method: config.method,
      headers,
      body
    };
  }

  /**
   * Interpolate URL with arguments (for query parameters in GET requests)
   */
  private interpolateUrl(url: string, args: any): string {
    const urlObj = new URL(url);
    
    // For GET requests, add args as query parameters
    if (args && typeof args === 'object') {
      Object.entries(args).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          urlObj.searchParams.set(key, String(value));
        }
      });
    }

    return urlObj.toString();
  }

  /**
   * Prepare headers for the request
   */
  private prepareHeaders(headers: Record<string, string>): Record<string, string> {
    const defaultHeaders = {
      'User-Agent': 'NovaKB-ToolExecutor/1.0',
      'Accept': 'application/json'
    };

    return {
      ...defaultHeaders,
      ...headers
    };
  }

  /**
   * Make HTTP request with timeout and size limits
   */
  private async makeHttpRequest(config: RequestInit & { url: string }): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.DEFAULT_TIMEOUT);

    try {
      const response = await fetch(config.url, {
        ...config,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // Check response size
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > this.MAX_RESPONSE_SIZE) {
        throw new Error(`Response too large: ${contentLength} bytes (max: ${this.MAX_RESPONSE_SIZE})`);
      }

      return response;

    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      
      throw error;
    }
  }

  /**
   * Process HTTP response and apply transformations
   */
  private async processResponse(response: Response, config: WebhookConfig): Promise<any> {
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
    }

    // Get response content type
    const contentType = response.headers.get('content-type') || '';
    
    let data: any;

    try {
      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }
    } catch (error) {
      throw new Error('Failed to parse response: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }

    // Apply output transformation if provided
    if (config.outputTransform) {
      try {
        data = this.executeTransformation(config.outputTransform, data);
      } catch (error) {
        console.warn('[WEBHOOK EXECUTOR] Output transformation failed:', error);
        // Continue with original data if transformation fails
      }
    }

    return data;
  }

  /**
   * Execute output transformation code safely
   */
  private executeTransformation(transformCode: string, data: any): any {
    try {
      // Create a safe evaluation context
      const transformFunction = new Function('data', `
        "use strict";
        return (function() {
          ${transformCode}
        }).call(null);
      `);

      return transformFunction(data);
    } catch (error) {
      throw new Error('Transformation execution failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }

  /**
   * Validate arguments against input schema
   */
  public validateArgs(inputSchema: any, args: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Basic validation based on schema type
    if (inputSchema.type === 'object' && inputSchema.properties) {
      // Check required properties
      if (inputSchema.required && Array.isArray(inputSchema.required)) {
        for (const requiredProp of inputSchema.required) {
          if (!(requiredProp in args)) {
            errors.push(`Missing required property: ${requiredProp}`);
          }
        }
      }

      // Check property types
      for (const [propName, propSchema] of Object.entries(inputSchema.properties)) {
        if (propName in args) {
          const value = args[propName];
          const schema = propSchema as any;
          
          if (schema.type && typeof value !== schema.type) {
            errors.push(`Property ${propName} must be of type ${schema.type}, got ${typeof value}`);
          }

          if (schema.enum && !schema.enum.includes(value)) {
            errors.push(`Property ${propName} must be one of: ${schema.enum.join(', ')}`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
