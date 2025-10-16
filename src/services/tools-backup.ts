// import axios from "axios";
// import https from "https";
// // We'll use a simpler approach that doesn't require complex AWS SDK types
// import { WeatherParseResult } from "../types/types";
// import { KnowledgeBaseConfig } from "../config/consts";
// import { knowledgeBaseService } from "./kb-service";

// // 定义 MCP 工具处理函数类型
// export type McpToolHandler = (toolUseContent: any) => Promise<any>;

// // MCP 工具信息
// export interface McpToolInfo {
//   handler: McpToolHandler;
//   serverName: string;
//   description: string;
//   isAutoApproved: boolean;
// }

// /**
//  * 工具处理类
//  * 负责处理各种工具的调用和响应
//  */
// export class ToolHandler {
//   // 存储 MCP 工具信息
//   private mcpTools: Map<string, McpToolInfo> = new Map();

//   /**
//    * 处理工具调用
//    * @param toolName 工具名称
//    * @param toolUseContent 工具使用内容
//    */
//   public async processToolUse(
//     toolName: string,
//     toolUseContent: object
//   ): Promise<Object> {
//     // 检查是否是 MCP 工具
//     if (this.mcpTools.has(toolName)) {
//       console.log(`处理 MCP 工具调用: ${toolName}`);
//       const toolInfo = this.mcpTools.get(toolName);
//       if (toolInfo) {
//         try {
//           return await toolInfo.handler(toolUseContent);
//         } catch (error) {
//           console.error(`MCP 工具 ${toolName} 调用失败:`, String(error));
//           throw new Error(
//             `MCP 工具 ${toolName} 调用失败: ${
//               error instanceof Error ? error.message : String(error)
//             }`
//           );
//         }
//       }
//     }

//     // 处理内置工具
//     const tool = toolName.toLowerCase();
//     switch (tool) {
//       case "getdateandtimetool":
//         return this.getDateAndTime();
//       case "getknowledgebasetool":
//         console.log("=============================================");
//         console.log("KNOWLEDGE BASE TOOL TRIGGERED");
//         console.log("=============================================");
//         console.log(`ToolUseContent: ${JSON.stringify(toolUseContent, null, 2)}`);
//         try {
//           let query = '';
          
//           // Try multiple ways to parse the input to improve chances of success
//           if (toolUseContent && typeof (toolUseContent as any).content === 'string') {
//             console.log("Parsing content as JSON string...");
//             try {
//               const parsedContent = JSON.parse((toolUseContent as any).content);
//               query = parsedContent?.query || '';
//               console.log(`Found query from JSON parsing: "${query}"`);
//             } catch (parseError) {
//               // If parsing fails, try to extract query directly
//               console.log("JSON parsing failed, trying direct extraction...");
//               const contentStr = (toolUseContent as any).content;
//               const queryMatch = contentStr.match(/"query"\s*:\s*"([^"]+)"/);
//               if (queryMatch && queryMatch[1]) {
//                 query = queryMatch[1];
//                 console.log(`Extracted query using regex: "${query}"`);
//               }
//             }
//           } else if (toolUseContent && (toolUseContent as any).query) {
//             // Direct access to query property if available
//             query = (toolUseContent as any).query;
//             console.log(`Found query as direct property: "${query}"`);
//           }
            
//           if (!query) {
//             console.error("QUERY IS EMPTY - Tool use content format might be incorrect");
//             throw new Error("查询内容为空");
//           }
          
//           console.log(`Starting knowledge base query with: "${query}"`);
//           const result = await this.queryKnowledgeBase(query);
//           console.log(`Knowledge base query completed, result available: ${result !== null}`);
//           return result;
//         } catch (error) {
//           console.error("处理知识库查询失败:", error);
//           console.error(`Error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`);
//           return {
//             error: "知识库查询失败",
//             message: error instanceof Error ? error.message : String(error),
//             // Return a fallback response so the conversation can continue
//             fallback_response: "I tried to search the knowledge base about this topic but encountered an error. " +
//                              "Please try asking in a different way or contact support if this issue persists."
//           };
//         }
//       case "getweathertool":
//         console.log("天气工具已禁用，请使用知识库工具");
//         return {
//           error: "天气工具已禁用",
//           message: "此工具已被禁用，请使用知识库工具(getKnowledgeBaseTool)获取信息"
//         };
//         // Legacy weather tool code kept for reference
//         /*
//         console.log("处理天气工具调用");
//         const parsedContent = await this.parseToolUseContentForWeather(
//           toolUseContent
//         );
//         if (!parsedContent) {
//           throw new Error("解析内容为空");
//         }
//         return this.fetchWeatherData(
//           parsedContent.latitude,
//           parsedContent.longitude
//         );
//         */
//       default:
//         console.log(`不支持的工具 ${tool}`);
//         throw new Error(`不支持的工具 ${tool}`);
//     }
//   }

//   /**
//    * 注册 MCP 工具
//    * @param toolName 工具名称
//    * @param handler 处理函数
//    * @param serverName 服务器名称
//    * @param description 工具描述
//    * @param isAutoApproved 是否自动批准
//    */
//   public registerMcpTool(
//     toolName: string,
//     handler: McpToolHandler,
//     serverName: string,
//     description: string = "",
//     isAutoApproved: boolean = false
//   ): void {
//     console.log(
//       `注册 MCP 工具: ${serverName}/${toolName} (自动批准: ${isAutoApproved})`
//     );
//     this.mcpTools.set(toolName, {
//       handler,
//       serverName,
//       description,
//       isAutoApproved,
//     });
//   }

//   /**
//    * 获取所有已注册的 MCP 工具信息
//    */
//   public getRegisteredMcpTools(): Map<string, McpToolInfo> {
//     return this.mcpTools;
//   }

//   /**
//    * 获取所有已注册的 MCP 工具名称
//    */
//   public getRegisteredMcpToolNames(): string[] {
//     return Array.from(this.mcpTools.keys());
//   }

//   /**
//    * 获取工具的服务器名称
//    */
//   public getToolServerName(toolName: string): string | null {
//     const toolInfo = this.mcpTools.get(toolName);
//     return toolInfo ? toolInfo.serverName : null;
//   }

//   /**
//    * 检查工具是否自动批准
//    */
//   public isToolAutoApproved(toolName: string): boolean {
//     const toolInfo = this.mcpTools.get(toolName);
//     return toolInfo ? toolInfo.isAutoApproved : false;
//   }

//   /**
//    * 获取日期和时间信息
//    */
//   private getDateAndTime(): Object {
//     const date = new Date().toLocaleString("en-US", {
//       timeZone: "America/Los_Angeles",
//     });
//     const pstDate = new Date(date);

//     return {
//       date: pstDate.toISOString().split("T")[0],
//       year: pstDate.getFullYear(),
//       month: pstDate.getMonth() + 1,
//       day: pstDate.getDate(),
//       dayOfWeek: pstDate
//         .toLocaleString("en-US", { weekday: "long" })
//         .toUpperCase(),
//       timezone: "PST",
//       formattedTime: pstDate.toLocaleTimeString("en-US", {
//         hour12: true,
//         hour: "2-digit",
//         minute: "2-digit",
//       }),
//     };
//   }

//   /**
//    * 解析天气工具的使用内容
//    * @param toolUseContent 工具使用内容
//    */
//   private async parseToolUseContentForWeather(
//     toolUseContent: any
//   ): Promise<WeatherParseResult | null> {
//     try {
//       if (toolUseContent && typeof toolUseContent.content === "string") {
//         const parsedContent = JSON.parse(toolUseContent.content);
//         console.log(`解析的内容: ${parsedContent}`);

//         return {
//           latitude: parsedContent.latitude,
//           longitude: parsedContent.longitude,
//         };
//       }
//       return null;
//     } catch (error) {
//       console.error("解析工具使用内容失败:", error);
//       return null;
//     }
//   }

//   /**
//    * 查询知识库
//    * @param query 查询内容
//    */
//   private async queryKnowledgeBase(query: string): Promise<Record<string, any>> {
//     try {
//       const kbId = KnowledgeBaseConfig.kbId;
//       console.log(`正在查询知识库 ${kbId}，查询: "${query}"`);
      
//       // Use the actual knowledge base service instead of mock data
//       const kbResults = await knowledgeBaseService.queryKnowledgeBase(query);
      
//       if (!kbResults) {
//         return {
//           query: query,
//           knowledgeBaseId: kbId,
//           model_response: `未能在知识库中找到关于 "${query}" 的信息。`,
//           results: [],
//           timestamp: new Date().toISOString()
//         };
//       }
      
//       // Parse the results to match expected format
//       // The knowledgeBaseService.queryKnowledgeBase returns a formatted string
//       // We need to convert it to the expected object format
//       const formattedResponse = {
//         query: query,
//         knowledgeBaseId: kbId,
//         model_response: kbResults,
//         results: [{ content: kbResults, source: kbId }],
//         timestamp: new Date().toISOString()
//       };
      
//       console.log(`知识库查询成功，返回真实数据`);
//       return formattedResponse;
//     } catch (error) {
//       console.error("查询知识库时出错:", error);
//       return {
//         error: "查询知识库失败",
//         message: error instanceof Error ? error.message : String(error)
//       };
//     }
//   }

//   /**
//    * 获取天气数据
//    * @param latitude 纬度
//    * @param longitude 经度
//    */
//   private async fetchWeatherData(
//     latitude: number,
//     longitude: number
//   ): Promise<Record<string, any>> {
//     const ipv4Agent = new https.Agent({ family: 4 });
//     const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`;

//     try {
//       const response = await axios.get(url, {
//         httpsAgent: ipv4Agent,
//         timeout: 5000,
//         headers: {
//           "User-Agent": "MyApp/1.0",
//           Accept: "application/json",
//         },
//       });
//       const weatherData = response.data;
//       console.log("天气数据:", weatherData);

//       return {
//         weather_data: weatherData,
//       };
//     } catch (error) {
//       if (axios.isAxiosError(error)) {
//         console.error(`获取天气数据失败: ${error.message}`, String(error));
//       } else {
//         console.error(
//           `意外错误: ${error instanceof Error ? error.message : String(error)}`,
//           String(error)
//         );
//       }
//       throw error;
//     }
//   }
// }


import axios from "axios";
import https from "https";
// We'll use a simpler approach that doesn't require complex AWS SDK types
import { WeatherParseResult } from "../types/types";
import { KnowledgeBaseConfig } from "../config/consts";
import { knowledgeBaseService } from "./kb-service";
import { ToolConfigManager, UserDefinedTool, WebhookConfig, ScriptConfig } from "./tool-config";
import { WebhookExecutor } from "./webhook-executor";
import { ScriptExecutor } from "./script-executor";

// Define MCP tool handler type
export type McpToolHandler = (toolUseContent: any) => Promise<any>;

// MCP tool info
export interface McpToolInfo {
  handler: McpToolHandler;
  serverName: string;
  description: string;
  isAutoApproved: boolean;
}

// Define available tools with their specifications
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };
}

// Define all available tools
export const availableTools: { toolSpec: ToolSpec; handler: (content: any) => Promise<any> }[] = [
  {
    toolSpec: {
      name: "retrieveFromKnowledgeBase",
      description: "Search and retrieve information from the configured knowledge base using a query string",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query to find relevant information in the knowledge base"
          }
        },
        required: ["query"]
      }
    },
    handler: async (content: any) => {
      // This will be handled by the main tool handler
      return {};
    }
  },
  {
    toolSpec: {
      name: "getCurrentWeather",
      description: "Get current weather information. If user's location is available from browser geolocation, coordinates are optional. Otherwise, requires latitude and longitude coordinates.",
      inputSchema: {
        type: "object",
        properties: {
          latitude: {
            type: "number",
            description: "Geographical WGS84 latitude of the location (-90 to 90). Optional if user location is available."
          },
          longitude: {
            type: "number", 
            description: "Geographical WGS84 longitude of the location (-180 to 180). Optional if user location is available."
          }
        },
        required: []
      }
    },
    handler: async (content: any) => {
      // This will be handled by the main tool handler
      return {};
    }
  },
  {
    toolSpec: {
      name: "getCurrentTime",
      description: "Get the current date and time information in PST timezone",
      inputSchema: {
        type: "object",
        properties: {},
        required: []
      }
    },
    handler: async (content: any) => {
      // This will be handled by the main tool handler
      return {};
    }
  }
];

/**
 * Tool handler
 * Responsible for handling various tool invocations and responses
 */
export class ToolHandler {
  // Store MCP tool info
  private mcpTools: Map<string, McpToolInfo> = new Map();
  // Store user-defined tools
  private userTools: Map<string, UserDefinedTool> = new Map();
  // Tool executors
  private webhookExecutor: WebhookExecutor;
  private scriptExecutor: ScriptExecutor;
  private toolConfigManager: ToolConfigManager;
  // Store reference to active sessions for location context
  private activeSessions: Map<string, any> | null = null;
  private currentSessionId: string | null = null;

  constructor() {
    this.webhookExecutor = new WebhookExecutor();
    this.scriptExecutor = new ScriptExecutor();
    this.toolConfigManager = new ToolConfigManager();
  }

  /**
   * Load user-defined tools from configuration
   */
  public async loadUserDefinedTools(): Promise<void> {
    try {
      console.log('[TOOL HANDLER] Loading user-defined tools...');
      const userTools = this.toolConfigManager.loadUserTools();
      
      this.userTools.clear();
      
      for (const tool of userTools) {
        if (tool.enabled) {
          console.log(`[TOOL HANDLER] Loading enabled tool: ${tool.name} (${tool.type})`);
          this.userTools.set(tool.name, tool);
        } else {
          console.log(`[TOOL HANDLER] Skipping disabled tool: ${tool.name}`);
        }
      }
      
      console.log(`[TOOL HANDLER] Loaded ${this.userTools.size} user-defined tools`);
    } catch (error) {
      console.error('[TOOL HANDLER] Error loading user-defined tools:', error);
    }
  }

  /**
   * Add a new user-defined tool
   */
  public async addUserTool(tool: UserDefinedTool): Promise<boolean> {
    try {
      // Validate the tool
      const validation = this.toolConfigManager.validateTool(tool);
      if (!validation.valid) {
        console.error('[TOOL HANDLER] Tool validation failed:', validation.errors);
        return false;
      }

      // Check if tool name conflicts with existing tools
      if (this.userTools.has(tool.name) || this.mcpTools.has(tool.name) || this.isBuiltInTool(tool.name)) {
        console.error(`[TOOL HANDLER] Tool name "${tool.name}" already exists`);
        return false;
      }

      // Test the tool before saving (optional but recommended)
      if (tool.type === 'webhook') {
        const testResult = await this.webhookExecutor.testWebhook(tool.config as WebhookConfig);
        if (!testResult.success) {
          console.warn(`[TOOL HANDLER] Webhook test failed for ${tool.name}: ${testResult.error}`);
          // Don't fail the addition, just warn
        }
      }

      // Save to configuration
      const saved = this.toolConfigManager.saveUserTool(tool);
      if (!saved) {
        return false;
      }

      // Add to runtime if enabled
      if (tool.enabled) {
        this.userTools.set(tool.name, tool);
        console.log(`[TOOL HANDLER] Added and enabled tool: ${tool.name}`);
      } else {
        console.log(`[TOOL HANDLER] Added disabled tool: ${tool.name}`);
      }

      return true;
    } catch (error) {
      console.error('[TOOL HANDLER] Error adding user tool:', error);
      return false;
    }
  }

  /**
   * Remove a user-defined tool
   */
  public removeUserTool(toolId: string): boolean {
    try {
      const tool = this.toolConfigManager.getUserTool(toolId);
      if (!tool) {
        console.error(`[TOOL HANDLER] Tool with ID "${toolId}" not found`);
        return false;
      }

      // Remove from configuration
      const removed = this.toolConfigManager.removeUserTool(toolId);
      if (!removed) {
        return false;
      }

      // Remove from runtime
      this.userTools.delete(tool.name);
      
      console.log(`[TOOL HANDLER] Removed tool: ${tool.name}`);
      return true;
    } catch (error) {
      console.error('[TOOL HANDLER] Error removing user tool:', error);
      return false;
    }
  }

  /**
   * Update tool status (enable/disable)
   */
  public updateUserToolStatus(toolId: string, enabled: boolean): boolean {
    try {
      const updated = this.toolConfigManager.updateToolStatus(toolId, enabled);
      if (!updated) {
        return false;
      }

      const tool = this.toolConfigManager.getUserTool(toolId);
      if (!tool) {
        return false;
      }

      if (enabled) {
        this.userTools.set(tool.name, tool);
        console.log(`[TOOL HANDLER] Enabled tool: ${tool.name}`);
      } else {
        this.userTools.delete(tool.name);
        console.log(`[TOOL HANDLER] Disabled tool: ${tool.name}`);
      }

      return true;
    } catch (error) {
      console.error('[TOOL HANDLER] Error updating tool status:', error);
      return false;
    }
  }

  /**
   * Get all user-defined tools
   */
  public getUserTools(): UserDefinedTool[] {
    return this.toolConfigManager.loadUserTools();
  }

  /**
   * Get all available tool specifications (built-in + user-defined + MCP)
   */
  public getAllAvailableToolSpecs(): ToolSpec[] {
    const allTools: ToolSpec[] = [];

    // Add built-in tools
    allTools.push(...availableTools.map(tool => tool.toolSpec));

    // Add user-defined tools
    for (const [name, tool] of this.userTools) {
      allTools.push({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.config.inputSchema
      });
    }

    // Add MCP tools (if you want to include them in the spec list)
    for (const [name, toolInfo] of this.mcpTools) {
      allTools.push({
        name: name,
        description: toolInfo.description,
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        }
      });
    }

    return allTools;
  }

  /**
   * Check if a tool name is a built-in tool
   */
  private isBuiltInTool(toolName: string): boolean {
    const builtInTools = [
      'getcurrenttime', 'retrievefromknowledgebase', 'getcurrentweather',
      'getdateandtimetool', 'getknowledgebasetool', 'getweathertool'
    ];
    return builtInTools.includes(toolName.toLowerCase());
  }
  public setSessionContext(activeSessions: Map<string, any>, sessionId: string): void {
    console.log(`🔧 Setting session context for tools - Session ID: ${sessionId}`);
    this.activeSessions = activeSessions;
    this.currentSessionId = sessionId;
    
    // Debug: Check if the session has location data
    const sessionData = activeSessions.get(sessionId);
    console.log(`🔍 Session data structure:`, {
      hasSessionData: !!sessionData,
      sessionKeys: sessionData ? Object.keys(sessionData) : 'none',
      hasStreamSession: !!sessionData?.streamSession,
      streamSessionType: sessionData?.streamSession ? typeof sessionData.streamSession : 'none',
      hasUserLocation: !!sessionData?.streamSession?.userLocation,
      userLocation: sessionData?.streamSession?.userLocation || 'none'
    });
    
    if (sessionData?.streamSession?.userLocation) {
      console.log(`📍 Session ${sessionId} has location data:`, sessionData.streamSession.userLocation);
    } else {
      console.log(`❌ Session ${sessionId} has no location data`);
    }
  }

  /**
   * Handle tool invocation
   * @param toolName Tool name
   * @param toolUseContent Tool use content
   */
  public async processToolUse(
    toolName: string,
    toolUseContent: object
  ): Promise<Object> {
    // Check if it's a user-defined tool first
    if (this.userTools.has(toolName)) {
      console.log(`[TOOL HANDLER] Processing user-defined tool: ${toolName}`);
      const tool = this.userTools.get(toolName)!;
      
      try {
        return await this.executeUserTool(tool, toolUseContent);
      } catch (error) {
        console.error(`[TOOL HANDLER] User tool ${toolName} execution failed:`, error);
        return {
          error: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
          toolName: toolName,
          toolType: tool.type
        };
      }
    }

    // Check if it's an MCP tool
    if (this.mcpTools.has(toolName)) {
      console.log(`Handling MCP tool invocation: ${toolName}`);
      const toolInfo = this.mcpTools.get(toolName);
      if (toolInfo) {
        try {
          return await toolInfo.handler(toolUseContent);
        } catch (error) {
          console.error(`MCP tool ${toolName} invocation failed:`, String(error));
          throw new Error(
            `MCP tool ${toolName} invocation failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    }

    // Handle built-in tools
    const tool = toolName.toLowerCase();
    switch (tool) {
      case "getcurrenttime":
        return this.getDateAndTime();
      case "retrievefromknowledgebase":
        return this.handleKnowledgeBaseQuery(toolUseContent);
      case "getcurrentweather":
        return this.handleWeatherQuery(toolUseContent);
      // Legacy tool names for backward compatibility
      case "getdateandtimetool":
        return this.getDateAndTime();
      case "getknowledgebasetool":
        return this.handleKnowledgeBaseQuery(toolUseContent);
      case "getweathertool":
        return this.handleWeatherQuery(toolUseContent);
      default:
        console.log(`Unsupported tool ${tool}`);
        throw new Error(`Unsupported tool ${tool}`);
    }
  }

  /**
   * Execute a user-defined tool
   */
  private async executeUserTool(tool: UserDefinedTool, toolUseContent: any): Promise<any> {
    // Parse arguments from tool use content
    let args: any = {};
    
    if (toolUseContent && typeof (toolUseContent as any).content === 'string') {
      try {
        args = JSON.parse((toolUseContent as any).content);
      } catch (error) {
        console.warn(`[TOOL HANDLER] Failed to parse tool content as JSON for ${tool.name}`);
        args = toolUseContent;
      }
    } else if (toolUseContent) {
      args = toolUseContent;
    }

    console.log(`[TOOL HANDLER] Executing ${tool.type} tool "${tool.name}" with args:`, args);

    // Validate arguments against schema
    let validationResult;
    if (tool.type === 'webhook') {
      validationResult = this.webhookExecutor.validateArgs(tool.config.inputSchema, args);
    } else if (tool.type === 'script') {
      validationResult = this.scriptExecutor.validateArgs(tool.config.inputSchema, args);
    } else {
      throw new Error(`Unknown tool type: ${tool.type}`);
    }

    if (!validationResult.valid) {
      throw new Error(`Invalid arguments: ${validationResult.errors.join(', ')}`);
    }

    // Execute the tool
    if (tool.type === 'webhook') {
      const result = await this.webhookExecutor.executeWebhook(tool.config as WebhookConfig, args);
      
      if (!result.success) {
        throw new Error(result.error || 'Webhook execution failed');
      }
      
      return {
        success: true,
        data: result.data,
        executionTime: result.executionTime,
        toolName: tool.name,
        toolType: 'webhook'
      };
    } else if (tool.type === 'script') {
      const result = await this.scriptExecutor.executeScript(tool.config as ScriptConfig, args);
      
      if (!result.success) {
        throw new Error(result.error || 'Script execution failed');
      }
      
      return {
        success: true,
        data: result.data,
        executionTime: result.executionTime,
        consoleOutput: result.consoleOutput,
        toolName: tool.name,
        toolType: 'script'
      };
    } else {
      throw new Error(`Unsupported tool type: ${tool.type}`);
    }
  }

  /**
   * Register an MCP tool
   * @param toolName Tool name
   * @param handler Handler function
   * @param serverName Server name
   * @param description Tool description
   * @param isAutoApproved Whether auto-approved
   */
  public registerMcpTool(
    toolName: string,
    handler: McpToolHandler,
    serverName: string,
    description: string = "",
    isAutoApproved: boolean = false
  ): void {
    console.log(
      `Registering MCP tool: ${serverName}/${toolName} (auto-approve: ${isAutoApproved})`
    );
    this.mcpTools.set(toolName, {
      handler,
      serverName,
      description,
      isAutoApproved,
    });
  }

  /**
   * Get all registered MCP tool info
   */
  public getRegisteredMcpTools(): Map<string, McpToolInfo> {
    return this.mcpTools;
  }

  /**
   * Get all registered MCP tool names
   */
  public getRegisteredMcpToolNames(): string[] {
    return Array.from(this.mcpTools.keys());
  }

  /**
   * Get the server name for a tool
   */
  public getToolServerName(toolName: string): string | null {
    const toolInfo = this.mcpTools.get(toolName);
    return toolInfo ? toolInfo.serverName : null;
  }

  /**
   * Check if a tool is auto-approved
   */
  public isToolAutoApproved(toolName: string): boolean {
    const toolInfo = this.mcpTools.get(toolName);
    return toolInfo ? toolInfo.isAutoApproved : false;
  }

  /**
   * Handle knowledge base query
   */
  private async handleKnowledgeBaseQuery(toolUseContent: any): Promise<Record<string, any>> {
    console.log("=============================================");
    console.log("KNOWLEDGE BASE TOOL TRIGGERED");
    console.log("=============================================");
    console.log(`ToolUseContent: ${JSON.stringify(toolUseContent, null, 2)}`);
    
    try {
      let query = '';
      
      // Try multiple ways to parse the input to improve chances of success
      if (toolUseContent && typeof (toolUseContent as any).content === 'string') {
        console.log("Parsing content as JSON string...");
        try {
          const parsedContent = JSON.parse((toolUseContent as any).content);
          query = parsedContent?.query || '';
          console.log(`Found query from JSON parsing: "${query}"`);
        } catch (parseError) {
          // If parsing fails, try to extract query directly
          console.log("JSON parsing failed, trying direct extraction...");
          const contentStr = (toolUseContent as any).content;
          const queryMatch = contentStr.match(/"query"\s*:\s*"([^"]+)"/);
          if (queryMatch && queryMatch[1]) {
            query = queryMatch[1];
            console.log(`Extracted query using regex: "${query}"`);
          }
        }
      } else if (toolUseContent && (toolUseContent as any).query) {
        // Direct access to query property if available
        query = (toolUseContent as any).query;
        console.log(`Found query as direct property: "${query}"`);
      }
        
      if (!query) {
        console.error("QUERY IS EMPTY - Tool use content format might be incorrect");
        throw new Error("Query is empty");
      }
      
      console.log(`Starting knowledge base query with: "${query}"`);
      const result = await this.queryKnowledgeBase(query);
      console.log(`Knowledge base query completed, result available: ${result !== null}`);
      return result;
    } catch (error) {
      console.error("Failed to process knowledge base query:", error);
      console.error(`Error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`);
      return {
        error: "Knowledge base query failed",
        message: error instanceof Error ? error.message : String(error),
        // Return a fallback response so the conversation can continue
        fallback_response: "I tried to search the knowledge base about this topic but encountered an error. " +
                         "Please try asking in a different way or contact support if this issue persists."
      };
    }
  }

  /**
   * Handle weather query
   */
  private async handleWeatherQuery(toolUseContent: any): Promise<Record<string, any>> {
    try {
      console.log("=== WEATHER TOOL DEBUG ===");
      console.log("Tool content received:", JSON.stringify(toolUseContent, null, 2));
      console.log("Current session ID:", this.currentSessionId);
      console.log("Active sessions available:", !!this.activeSessions);
      
      let latitude: number | undefined;
      let longitude: number | undefined;
      let locationSource = "provided";
      
      // Try to parse coordinates from tool content first
      let coordsProvided = false;
      if (toolUseContent && typeof (toolUseContent as any).content === 'string') {
        try {
          const parsedContent = JSON.parse((toolUseContent as any).content);
          const lat = parseFloat(parsedContent.latitude);
          const lng = parseFloat(parsedContent.longitude);
          if (!isNaN(lat) && !isNaN(lng)) {
            latitude = lat;
            longitude = lng;
            coordsProvided = true;
          }
        } catch (e) {
          // Ignore parsing errors, will try session location
        }
      } else if (toolUseContent) {
        const lat = parseFloat((toolUseContent as any).latitude);
        const lng = parseFloat((toolUseContent as any).longitude);
        if (!isNaN(lat) && !isNaN(lng)) {
          latitude = lat;
          longitude = lng;
          coordsProvided = true;
        }
      }
      
      // If no coordinates provided, try to use session location
      if (!coordsProvided && this.activeSessions && this.currentSessionId) {
        console.log("No coordinates provided, checking session location...");
        const sessionData = this.activeSessions.get(this.currentSessionId);
        console.log("Session data found:", !!sessionData);
        console.log("Stream session found:", !!sessionData?.streamSession);
        console.log("User location in session:", sessionData?.streamSession?.userLocation);
        
        if (sessionData?.streamSession?.userLocation) {
          latitude = sessionData.streamSession.userLocation.latitude;
          longitude = sessionData.streamSession.userLocation.longitude;
          locationSource = "session";
          coordsProvided = true;
          console.log(`✅ Using session location for weather query: ${latitude}, ${longitude}`);
        } else {
          console.log("❌ No user location found in session");
        }
      } else {
        console.log("Skipping session location check:", {
          coordsProvided,
          hasActiveSessions: !!this.activeSessions,
          hasCurrentSessionId: !!this.currentSessionId
        });
      }
      
      if (!coordsProvided || latitude === undefined || longitude === undefined) {
        console.log("❌ No location data available for weather query");
        return {
          error: "No location data available",
          message: "Please provide location coordinates or enable location services to get weather information"
        };
      }
      
      console.log(`✅ Fetching weather data for coordinates: ${latitude}, ${longitude} (source: ${locationSource})`);
      const weatherData = await this.fetchWeatherData(latitude, longitude);
      console.log("=== WEATHER TOOL DEBUG END ===");
      
      // Add location source info to the response
      return {
        ...weatherData,
        location_source: locationSource,
        coordinates: { latitude, longitude }
      };
    } catch (error) {
      console.error("Weather query failed:", error);
      return {
        error: "Weather query failed",
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Get date and time info
   */
  private getDateAndTime(): Object {
    const date = new Date().toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
    });
    const pstDate = new Date(date);

    return {
      date: pstDate.toISOString().split("T")[0],
      year: pstDate.getFullYear(),
      month: pstDate.getMonth() + 1,
      day: pstDate.getDate(),
      dayOfWeek: pstDate
        .toLocaleString("en-US", { weekday: "long" })
        .toUpperCase(),
      timezone: "PST",
      formattedTime: pstDate.toLocaleTimeString("en-US", {
        hour12: true,
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
  }

  /**
   * Parse weather tool use content
   * @param toolUseContent Tool use content
   */
  private async parseToolUseContentForWeather(
    toolUseContent: any
  ): Promise<WeatherParseResult | null> {
    try {
      if (toolUseContent && typeof toolUseContent.content === "string") {
        const parsedContent = JSON.parse(toolUseContent.content);
        console.log(`Parsed content: ${parsedContent}`);

        return {
          latitude: parsedContent.latitude,
          longitude: parsedContent.longitude,
        };
      }
      return null;
    } catch (error) {
      console.error("Failed to parse tool use content:", error);
      return null;
    }
  }

  /**
   * Query knowledge base
   * @param query Query string
   */
  private async queryKnowledgeBase(query: string): Promise<Record<string, any>> {
    try {
      // Get the currently selected knowledge base from config
      const path = require('path');
      const fs = require('fs');
      const kbConfigPath = path.join(process.cwd(), 'kb-config.json');
      let knowledgeBaseId: string;
      
      try {
        const kbConfig = JSON.parse(fs.readFileSync(kbConfigPath, 'utf8'));
        knowledgeBaseId = kbConfig.selectedKnowledgeBaseId;
        
        if (!knowledgeBaseId) {
          throw new Error('No knowledge base selected. Please select a knowledge base in the control panel.');
        }
        
        console.log(`Using selected knowledge base: ${kbConfig.selectedKnowledgeBaseName} (${knowledgeBaseId})`);
      } catch (error) {
        console.log('No KB config found, falling back to default KB');
        knowledgeBaseId = KnowledgeBaseConfig.kbId;
      }
      
      console.log(`Querying knowledge base ${knowledgeBaseId}, query: "${query}"`);
      
      // Use the actual knowledge base service with the selected KB
      const kbResults = await knowledgeBaseService.queryKnowledgeBase(query, knowledgeBaseId);
      
      if (!kbResults) {
        return {
          query: query,
          knowledgeBaseId: knowledgeBaseId,
          model_response: `No information about "${query}" was found in the knowledge base.`,
          results: [],
          timestamp: new Date().toISOString()
        };
      }
      
      // Parse the results to match expected format
      const formattedResponse = {
        query: query,
        knowledgeBaseId: knowledgeBaseId,
        model_response: kbResults,
        results: [{ content: kbResults, source: knowledgeBaseId }],
        timestamp: new Date().toISOString()
      };
      
      console.log(`Knowledge base query succeeded, returning real data`);
      return formattedResponse;
    } catch (error) {
      console.error("Error querying knowledge base:", error);
      return {
        error: "Failed to query knowledge base",
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Fetch weather data
   * @param latitude Latitude
   * @param longitude Longitude
   */
  private async fetchWeatherData(
    latitude: number,
    longitude: number
  ): Promise<Record<string, any>> {
    const ipv4Agent = new https.Agent({ family: 4 });
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`;

    try {
      const response = await axios.get(url, {
        httpsAgent: ipv4Agent,
        timeout: 5000,
        headers: {
          "User-Agent": "MyApp/1.0",
          Accept: "application/json",
        },
      });
      const weatherData = response.data;
      console.log("Weather data:", weatherData);

      return {
        weather_data: weatherData,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(`Failed to fetch weather data: ${error.message}`, String(error));
      } else {
        console.error(
          `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
          String(error)
        );
      }
      throw error;
    }
  }
}
