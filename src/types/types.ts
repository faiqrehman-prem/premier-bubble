// import { BedrockRuntimeClientConfig } from "@aws-sdk/client-bedrock-runtime";
// import { NodeHttp2HandlerOptions } from "@smithy/node-http-handler";
// import { Provider } from "@smithy/types";
// import { Subject } from "rxjs";
// import { ToolHandler } from "../services/tools";

// // 音频和文本媒体类型
// export type AudioType = "wav" | "mp3" | "pcm";
// export type AudioMediaType = "audio/wav" | "audio/mp3" | "audio/pcm";
// export type TextMediaType = "text/plain" | "application/json";

// // MCP 服务器配置接口
// export interface McpServerConfig {
//   command: string;
//   args: string[];
//   env?: Record<string, string>;
//   autoApprove?: string[];
//   disabled?: boolean;
//   transportType?: "stdio" | "sse" | "streamable_http";
//   sseUrl?: string; // 用于SSE传输类型
//   baseUrl?: string; // streamable http 传输类型
//   headers?: Record<string, string>; // streamable http 传输类型
//   token?: string; // API token for authentication with the MCP server
// }

// // MCP 配置文件接口
// export interface McpConfig {
//   mcpServers: Record<string, McpServerConfig>;
// }

// // MCP 工具接口
// export interface McpTool {
//   name: string;
//   description?: string;
//   inputSchema: any;
//   serverName: string; // 添加服务器名称，用于调用时识别
// }

// // 客户端配置接口
// export interface NovaSonicBidirectionalStreamClientConfig {
//   requestHandlerConfig?:
//     | NodeHttp2HandlerOptions
//     | Provider<NodeHttp2HandlerOptions | void>;
//   clientConfig: Partial<BedrockRuntimeClientConfig>;
//   inferenceConfig?: InferenceConfig;
//   mcpConfig?: McpConfig;
// }

// // 推理配置接口
// export interface InferenceConfig {
//   maxTokens: number;
//   topP: number;
//   temperature: number;
// }

// // 会话数据接口
// export interface SessionData {
//   queue: Array<any>;
//   queueSignal: Subject<void>;
//   closeSignal: Subject<void>;
//   responseSubject: Subject<any>;
//   toolUseContent: any;
//   toolUseId: string;
//   toolName: string;
//   responseHandlers: Map<string, (data: any) => void>;
//   promptName: string;
//   inferenceConfig: InferenceConfig;
//   isActive: boolean;
//   isPromptStartSent: boolean;
//   isAudioContentStartSent: boolean;
//   audioContentId: string;
//   toolHandler?: ToolHandler;
// }

// // 天气数据解析结果接口
// export interface WeatherParseResult {
//   latitude: number;
//   longitude: number;
// }


import { BedrockRuntimeClientConfig } from "@aws-sdk/client-bedrock-runtime";
import { NodeHttp2HandlerOptions } from "@smithy/node-http-handler";
import { Provider } from "@smithy/types";
import { Subject } from "rxjs";
import { ToolHandler } from "../services/tools";

/** Audio and text media types */
export type AudioType = "wav" | "mp3" | "pcm";
export type AudioMediaType = "audio/wav" | "audio/mp3" | "audio/pcm";
export type TextMediaType = "text/plain" | "application/json";

/** MCP server config interface */
export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  autoApprove?: string[];
  disabled?: boolean;
  transportType?: "stdio" | "sse" | "streamable_http";
  sseUrl?: string; // For SSE transport type
  baseUrl?: string; // For streamable HTTP transport type
  headers?: Record<string, string>; // For streamable HTTP transport type
  token?: string; // API token for authentication with the MCP server
}

/** MCP config file interface */
export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

/** MCP tool interface */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema: any;
  serverName: string; // Server name to identify during invocation
}

/** Client config interface */
export interface NovaSonicBidirectionalStreamClientConfig {
  requestHandlerConfig?:
    | NodeHttp2HandlerOptions
    | Provider<NodeHttp2HandlerOptions | void>;
  clientConfig: Partial<BedrockRuntimeClientConfig>;
  inferenceConfig?: InferenceConfig;
  mcpConfig?: McpConfig;
}

/** Inference config interface */
export interface InferenceConfig {
  maxTokens: number;
  topP: number;
  temperature: number;
}

/** Session data interface */
export interface SessionData {
  queue: Array<any>;
  queueSignal: Subject<void>;
  closeSignal: Subject<void>;
  responseSubject: Subject<any>;
  toolUseContent: any;
  toolUseId: string;
  toolName: string;
  responseHandlers: Map<string, (data: any) => void>;
  promptName: string;
  inferenceConfig: InferenceConfig;
  isActive: boolean;
  isPromptStartSent: boolean;
  isAudioContentStartSent: boolean;
  audioContentId: string;
  toolHandler?: ToolHandler;
  streamSession?: any; // StreamSession reference for usage tracking
}

/** Weather data parse result interface */
export interface WeatherParseResult {
  latitude: number;
  longitude: number;
}
