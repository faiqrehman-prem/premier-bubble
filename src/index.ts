// /**
//  * Nova Sonic API主入口文件
//  * 导出所有公共模块和组件
//  */

// // 核心组件导出
// export { NovaSonicBidirectionalStreamClient } from "./core/client";
// export { StreamSession } from "./core/session";
// export { EventManager } from "./core/events";

// // 服务组件导出
// export { ToolHandler } from "./services/tools";

// // 类型定义导出
// export {
//   AudioType,
//   AudioMediaType,
//   TextMediaType,
//   NovaSonicBidirectionalStreamClientConfig,
//   InferenceConfig,
//   SessionData,
//   WeatherParseResult,
// } from "./types/types";

// // 配置常量导出
// export {
//   DefaultInferenceConfiguration,
//   DefaultAudioInputConfiguration,
//   DefaultToolSchema,
//   WeatherToolSchema,
//   DefaultTextConfiguration,
//   DefaultSystemPrompt,
//   DefaultAudioOutputConfiguration,
// } from "./config/consts";


/**
 * Nova Sonic API main entry file
 * Exports all public modules and components
 */

// Core components export
export { NovaSonicBidirectionalStreamClient } from "./core/client";
export { StreamSession } from "./core/session";
export { EventManager } from "./core/events";

// Service components export
export { ToolHandler } from "./services/tools";

// Type definitions export
export {
  AudioType,
  AudioMediaType,
  TextMediaType,
  NovaSonicBidirectionalStreamClientConfig,
  InferenceConfig,
  SessionData,
  WeatherParseResult,
} from "./types/types";

// Configuration constants export
export {
  DefaultInferenceConfiguration,
  DefaultAudioInputConfiguration,
  DefaultToolSchema,
  WeatherToolSchema,
  DefaultTextConfiguration,
  DefaultSystemPrompt,
  DefaultAudioOutputConfiguration,
} from "./config/consts";
