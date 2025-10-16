import { ScriptConfig } from './tool-config';
import * as vm from 'vm';

export interface ScriptExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  executionTime?: number;
  consoleOutput?: string[];
}

export interface ScriptExecutionContext {
  session?: any;
  requestHeaders?: { [key: string]: string };
  userAgent?: string;
}

export class ScriptExecutor {
  private readonly DEFAULT_TIMEOUT = 10000; // 10 seconds
  private readonly MAX_TIMEOUT = 30000; // 30 seconds max

  /**
   * Execute a script tool with the given arguments and execution context
   */
  public async executeScript(
    config: ScriptConfig, 
    args: any, 
    context?: ScriptExecutionContext
  ): Promise<ScriptExecutionResult> {
    const startTime = Date.now();
    const consoleOutput: string[] = [];

    try {
      // Validate configuration
      this.validateConfig(config);

      // Validate timeout
      const timeout = Math.min(config.timeout || this.DEFAULT_TIMEOUT, this.MAX_TIMEOUT);

      // Execute script
      const result = await this.runScriptInSandbox(config.code, args, timeout, consoleOutput, context);

      return {
        success: true,
        data: result,
        executionTime: Date.now() - startTime,
        consoleOutput
      };

    } catch (error) {
      console.error('[SCRIPT EXECUTOR] Error:', error);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        executionTime: Date.now() - startTime,
        consoleOutput
      };
    }
  }

  /**
   * Test script configuration without full execution
   */
  public async testScript(config: ScriptConfig, testInput: any = {}): Promise<ScriptExecutionResult> {
    try {
      // Validate configuration
      this.validateConfig(config);

      // Test with minimal execution (syntax check)
      const syntaxCheckResult = this.validateScriptSyntax(config.code);
      
      if (!syntaxCheckResult.valid) {
        return {
          success: false,
          error: syntaxCheckResult.error
        };
      }

      // Quick execution test with small timeout
      const result = await this.executeScript({
        ...config,
        timeout: 5000 // 5 second timeout for testing
      }, testInput);

      return result;

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Test failed'
      };
    }
  }

  /**
   * Validate script configuration
   */
  private validateConfig(config: ScriptConfig): void {
    if (!config.code || typeof config.code !== 'string') {
      throw new Error('Script code is required and must be a string');
    }

    if (!config.inputSchema) {
      throw new Error('Input schema is required');
    }

    if (config.timeout && (typeof config.timeout !== 'number' || config.timeout <= 0)) {
      throw new Error('Timeout must be a positive number');
    }

    if (config.timeout && config.timeout > this.MAX_TIMEOUT) {
      throw new Error(`Timeout cannot exceed ${this.MAX_TIMEOUT}ms`);
    }
  }

  /**
   * Validate script syntax
   */
  private validateScriptSyntax(code: string): { valid: boolean; error?: string } {
    try {
      // Wrap the code in a function to check syntax
      const wrappedCode = `
        (async function userScript(args) {
          ${code}
        })
      `;

      // Try to create the script to check syntax
      new vm.Script(wrappedCode);

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: `Syntax error: ${error instanceof Error ? error.message : 'Invalid syntax'}`
      };
    }
  }

  /**
   * Run script in a secure sandbox environment
   */
  private async runScriptInSandbox(
    code: string, 
    args: any, 
    timeout: number, 
    consoleOutput: string[],
    context?: ScriptExecutionContext
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      // Set up timeout
      const timer = setTimeout(() => {
        reject(new Error(`Script execution timeout (${timeout}ms)`));
      }, timeout);

      try {
        // Create sandbox environment
        const sandbox = this.createSandbox(args, consoleOutput, context);

        // Wrap user code in async function
        const wrappedCode = `
          (async function() {
            try {
              const userFunction = async function(args) {
                ${code}
              };
              
              const result = await userFunction(args);
              return result;
            } catch (error) {
              throw new Error('Script execution error: ' + (error.message || error));
            }
          })()
        `;

        // Create and run script
        const script = new vm.Script(wrappedCode);
        const vmContext = vm.createContext(sandbox);

        // Execute script
        const promise = script.runInContext(vmContext);

        // Handle result
        if (promise && typeof promise.then === 'function') {
          promise
            .then((result: any) => {
              clearTimeout(timer);
              resolve(result);
            })
            .catch((error: any) => {
              clearTimeout(timer);
              reject(error);
            });
        } else {
          clearTimeout(timer);
          resolve(promise);
        }

      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  /**
   * Create secure sandbox environment
   */
  private createSandbox(args: any, consoleOutput: string[], context?: ScriptExecutionContext): any {
    // Safe console implementation that captures output
    const safeConsole = {
      log: (...args: any[]) => {
        const message = args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');
        consoleOutput.push(`[LOG] ${message}`);
      },
      error: (...args: any[]) => {
        const message = args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');
        consoleOutput.push(`[ERROR] ${message}`);
      },
      warn: (...args: any[]) => {
        const message = args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');
        consoleOutput.push(`[WARN] ${message}`);
      },
      info: (...args: any[]) => {
        const message = args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');
        consoleOutput.push(`[INFO] ${message}`);
      }
    };

    // Safe utilities
    const safeUtils = {
      // Safe JSON operations
      JSON: {
        parse: (str: string) => {
          try {
            return JSON.parse(str);
          } catch (error) {
            throw new Error('Invalid JSON: ' + (error instanceof Error ? error.message : 'Parse error'));
          }
        },
        stringify: (obj: any) => {
          try {
            return JSON.stringify(obj);
          } catch (error) {
            throw new Error('JSON stringify error: ' + (error instanceof Error ? error.message : 'Stringify error'));
          }
        }
      },

      // Safe Math operations
      Math: Math, // Provide full Math object instead of spreading

      // Safe Date operations
      Date: Date,

      // Safe string operations
      String: String,
      Number: Number,
      Boolean: Boolean,
      Array: Array,
      Object: Object,

      // Safe regex
      RegExp: RegExp
    };

    return {
      // User arguments
      args: this.deepClone(args),

      // Session data (if available)
      session: context?.session ? this.deepClone(context.session) : undefined,
      
      // Request headers (if available)
      requestHeaders: context?.requestHeaders ? this.deepClone(context.requestHeaders) : undefined,
      
      // User agent string (if available)
      userAgent: context?.userAgent || context?.requestHeaders?.['user-agent'] || undefined,

      // Safe built-ins
      console: safeConsole,
      ...safeUtils,

      // Explicitly disable dangerous globals
      process: undefined,
      global: undefined,
      globalThis: undefined,
      require: undefined,
      module: undefined,
      exports: undefined,
      __dirname: undefined,
      __filename: undefined,
      Buffer: undefined,
      setTimeout: undefined,
      setInterval: undefined,
      setImmediate: undefined,
      clearTimeout: undefined,
      clearInterval: undefined,
      clearImmediate: undefined,

      // Allow Promise for async operations
      Promise: Promise,

      // Helper functions
      fetch: undefined, // Explicitly disable fetch for security
      XMLHttpRequest: undefined,
      
      // Custom helper functions
      createId: () => `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      formatDate: (date: Date) => date.toISOString(),
      sleep: async (ms: number) => new Promise(resolve => setTimeout(resolve, Math.min(ms, 5000))) // Max 5 second sleep
    };
  }

  /**
   * Deep clone object to prevent sandbox escape
   */
  private deepClone(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (obj instanceof Date) {
      return new Date(obj.getTime());
    }

    if (obj instanceof Array) {
      return obj.map(item => this.deepClone(item));
    }

    if (typeof obj === 'object') {
      const cloned: any = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          cloned[key] = this.deepClone(obj[key]);
        }
      }
      return cloned;
    }

    return obj;
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
