// import { randomUUID } from "node:crypto";
// import { McpTool, SessionData } from "../types/types";
// import { DefaultToolSchema, WeatherToolSchema } from "../config/consts";
// import { availableTools } from "../services/tools";
// import fs from "fs";
// import path from "path";

// /**
//  * Event manager class
//  * Responsible for generating and managing session-related events
//  */
// export class EventManager {
//   /**
//    * Create session start event
//    * @param session Session data
//    */
//   public createSessionStartEvent(session: SessionData): object {
//     return {
//       event: {
//         sessionStart: {
//           inferenceConfiguration: session.inferenceConfig,
//         },
//       },
//     };
//   }

//   /**
//    * Create prompt start event
//    * @param session Session data
//    * @param audioOutputConfig Audio output configuration
//    */
//   public createPromptStartEvent(
//     session: SessionData,
//     audioOutputConfig: any
//   ): object {
//     // Get enabled tools from configuration
//     const enabledTools = this.getEnabledTools();
    
//     // Retrieve registered MCP tools
//     const toolHandler = session.toolHandler;
//     const mcpTools: Array<{ name: string; description: string; schema: any }> =
//       [];

//     if (toolHandler) {
//       const mcpToolsMap = toolHandler.getRegisteredMcpTools();
//       mcpToolsMap.forEach((info, name) => {
//         // Only include MCP tools that are enabled
//         if (enabledTools.includes(name)) {
//           mcpTools.push({
//             name,
//             description: info.description || `MCP tool: ${name}`,
//             schema: DefaultToolSchema, // Could be changed to fetch actual schema from toolHandler
//           });
//         }
//       });
//     }

//     // Filter available tools based on configuration
//     const enabledBuiltInTools = availableTools.filter(tool => 
//       enabledTools.includes(tool.toolSpec.name)
//     );

//     // Map enabled built-in tools to the correct format
//     const toolSpecs = enabledBuiltInTools.map(tool => ({
//       toolSpec: {
//         name: tool.toolSpec.name,
//         description: tool.toolSpec.description,
//         inputSchema: {
//           json: JSON.stringify(tool.toolSpec.inputSchema),
//         },
//       },
//     }));

//     // Add MCP tools
//     const mcpToolSpecs = mcpTools.map((tool) => {
//       return {
//         toolSpec: {
//           name: tool.name,
//           description: tool.description,
//           inputSchema: {
//             json: tool.schema,
//           },
//         },
//       };
//     });

//     // Add user-defined tools (if toolHandler is available)
//     const userToolSpecs: any[] = [];
//     if (toolHandler) {
//       const userDefinedTools = toolHandler.getUserTools();
//       userDefinedTools.forEach((tool) => {
//         // Get the full tool specification from the tool handler
//         const toolSpec = toolHandler.getAllAvailableToolSpecs().find(spec => spec.name === tool.name);
//         if (toolSpec) {
//           userToolSpecs.push({
//             toolSpec: {
//               name: toolSpec.name,
//               description: toolSpec.description,
//               inputSchema: {
//                 json: JSON.stringify(toolSpec.inputSchema),
//               },
//             },
//           });
//         }
//       });
//     }

//     const allTools = [...toolSpecs, ...mcpToolSpecs, ...userToolSpecs];
    
//     console.log(`Enabled tools for session: ${allTools.map(t => t.toolSpec.name).join(', ')}`);
//     console.log(`Total tools loaded: Built-in: ${toolSpecs.length}, MCP: ${mcpToolSpecs.length}, User-defined: ${userToolSpecs.length}`);    return {
//       event: {
//         promptStart: {
//           promptName: session.promptName,
//           textOutputConfiguration: {
//             mediaType: "text/plain",
//           },
//           audioOutputConfiguration: {
//             ...audioOutputConfig,
//           },
//           toolUseOutputConfiguration: {
//             mediaType: "application/json",
//           },
//           toolConfiguration: {
//             tools: allTools,
//           },
//         },
//       },
//     };
//   }

//   /**
//    * Get enabled tools from configuration
//    */
//   private getEnabledTools(): string[] {
//     try {
//       const configPath = path.resolve(__dirname, "../../config.json");
//       const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
//       console.log("Enabled tools from config:", config.enabledTools);
//       return config.enabledTools || ["retrieveFromKnowledgeBase"];
//     } catch (error) {
//       console.log("No tool configuration found, using default tools");
//       return ["retrieveFromKnowledgeBase"];
//     }
//   }

//   /**
//    * Create system prompt events
//    * @param session Session data
//    * @param textConfig Text configuration
//    * @param content Prompt content
//    */
//   public createSystemPromptEvents(
//     session: SessionData,
//     textConfig: any,
//     content: string
//   ): object[] {
//     const textPromptID = randomUUID();
//     return [
//       {
//         event: {
//           contentStart: {
//             promptName: session.promptName,
//             contentName: textPromptID,
//             type: "TEXT",
//             interactive: true,
//             role: "SYSTEM",
//             textInputConfiguration: textConfig,
//           },
//         },
//       },
//       {
//         event: {
//           textInput: {
//             promptName: session.promptName,
//             contentName: textPromptID,
//             content: content,
//           },
//         },
//       },
//       {
//         event: {
//           contentEnd: {
//             promptName: session.promptName,
//             contentName: textPromptID,
//           },
//         },
//       },
//     ];
//   }

//   /**
//    * Create start-audio event
//    * @param session Session data
//    * @param audioConfig Audio configuration
//    */
//   public createStartAudioEvent(session: SessionData, audioConfig: any): object {
//     return {
//       event: {
//         contentStart: {
//           promptName: session.promptName,
//           contentName: session.audioContentId,
//           type: "AUDIO",
//           interactive: true,
//           role: "USER",
//           audioInputConfiguration: audioConfig,
//         },
//       },
//     };
//   }

//   /**
//    * Create audio input event
//    * @param session Session data
//    * @param base64AudioData Audio data encoded in Base64
//    */
//   public createAudioInputEvent(
//     session: SessionData,
//     base64AudioData: string
//   ): object {
//     return {
//       event: {
//         audioInput: {
//           promptName: session.promptName,
//           contentName: session.audioContentId,
//           content: base64AudioData,
//         },
//       },
//     };
//   }

//   /**
//    * Create content end event
//    * @param session Session data
//    */
//   public createContentEndEvent(session: SessionData): object {
//     return {
//       event: {
//         contentEnd: {
//           promptName: session.promptName,
//           contentName: session.audioContentId,
//         },
//       },
//     };
//   }

//   /**
//    * Create prompt end event
//    * @param session Session data
//    */
//   public createPromptEndEvent(session: SessionData): object {
//     return {
//       event: {
//         promptEnd: {
//           promptName: session.promptName,
//         },
//       },
//     };
//   }

//   /**
//    * Create session end event
//    */
//   public createSessionEndEvent(): object {
//     return {
//       event: {
//         sessionEnd: {},
//       },
//     };
//   }

//   /**
//    * Create tool result events
//    * @param session Session data
//    * @param toolUseId Tool use ID
//    * @param result Tool result
//    */
//   public createToolResultEvents(
//     session: SessionData,
//     toolUseId: string,
//     result: any
//   ): object[] {
//     const contentId = randomUUID();
//     console.log("**********", result);
//     // Ensure the result matches the format expected by the Nova-Sonic API
//     // Extract text content to avoid nested JSON serialization issues
//     // let textContent = "";
//     // if (typeof result === "string") {
//     //   textContent = result;
//     // } else if (Array.isArray(result)) {
//     //   // If it's an array, try to find the first item of type 'text'
//     //   const textItem = result.find((item) => item.type === "text");
//     //   if (textItem && textItem.text) {
//     //     textContent = textItem.text;
//     //   } else {
//     //     textContent = JSON.stringify(result);
//     //   }
//     // } else if (result && typeof result === "object") {
//     //   // If it's an object, try to extract a 'text' field
//     //   if (result.text) {
//     //     textContent = result.text;
//     //   } else {
//     //     textContent = JSON.stringify(result);
//     //   }
//     // } else {
//     //   textContent = JSON.stringify(result);
//     // }
//     const textContent =
//       Array.isArray(result) && result.length > 0
//         ? JSON.stringify(result[0])
//         : typeof result === "string"
//         ? result
//         : JSON.stringify(result);
//     console.log("------Tool result received:------", textContent);
//     return [
//       {
//         event: {
//           contentStart: {
//             promptName: session.promptName,
//             contentName: contentId,
//             interactive: false,
//             type: "TOOL",
//             role: "TOOL",
//             toolResultInputConfiguration: {
//               toolUseId: toolUseId,
//               type: "TEXT",
//               textInputConfiguration: {
//                 mediaType: "text/plain",
//               },
//             },
//           },
//         },
//       },
//       {
//         event: {
//           toolResult: {
//             promptName: session.promptName,
//             contentName: contentId,
//             content: textContent,
//           },
//         },
//       },
//       {
//         event: {
//           contentEnd: {
//             promptName: session.promptName,
//             contentName: contentId,
//           },
//         },
//       },
//     ];
//   }
// }

// src/core/events.ts
import { randomUUID } from "node:crypto";
import { McpTool, SessionData } from "../types/types";
import { DefaultToolSchema } from "../config/consts";
import { availableTools } from "../services/tools";
import { ConfigManager } from "../services/config-manager";

/**
 * Event manager class
 * Responsible for generating and managing session-related events
 */
export class EventManager {
  /**
   * Create session start event
   * @param session Session data
   */
  public createSessionStartEvent(session: SessionData): object {
    return {
      event: {
        sessionStart: {
          inferenceConfiguration: session.inferenceConfig,
        },
      },
    };
  }

  /**
   * Create prompt start event
   * NOTE: async because we fetch enabled tools from DynamoDB
   * @param session Session data
   * @param audioOutputConfig Audio output configuration
   */
  public async createPromptStartEvent(
    session: SessionData,
    audioOutputConfig: any
  ): Promise<object> {
    // Get enabled tools from DynamoDB configuration
    const enabledTools = await this.getEnabledTools();

    // Retrieve registered MCP tools
    const toolHandler = session.toolHandler;
    const mcpTools: Array<{ name: string; description: string; schema: any }> = [];

    if (toolHandler) {
      const mcpToolsMap = toolHandler.getRegisteredMcpTools();
      mcpToolsMap.forEach((info, name) => {
        // Only include MCP tools that are enabled
        if (enabledTools.includes(name)) {
          mcpTools.push({
            name,
            description: info.description || `MCP tool: ${name}`,
            schema: DefaultToolSchema, // Can be swapped for a per-tool schema if exposed
          });
        }
      });
    }

    // Filter available built-in tools based on configuration
    const enabledBuiltInTools = availableTools.filter((tool) =>
      enabledTools.includes(tool.toolSpec.name)
    );

    // Map enabled built-in tools to the correct format
    const toolSpecs = enabledBuiltInTools.map((tool) => ({
      toolSpec: {
        name: tool.toolSpec.name,
        description: tool.toolSpec.description,
        inputSchema: {
          json: JSON.stringify(tool.toolSpec.inputSchema),
        },
      },
    }));

    // Add MCP tools (already filtered above)
    const mcpToolSpecs = mcpTools.map((tool) => ({
      toolSpec: {
        name: tool.name,
        description: tool.description,
        inputSchema: {
          json: tool.schema,
        },
      },
    }));

    // Add user-defined tools (only if enabled)
    const userToolSpecs: any[] = [];
    if (toolHandler) {
  // only include enabled user-defined tools
  const enabledUserTools = (await toolHandler.getUserToolsAsync()).filter(t => t.enabled);
  console.log("Enabled user-defined tools:", enabledUserTools.map(t => t.name));
  for (const tool of enabledUserTools) {
    // try to get a normalized spec (if ToolHandler builds one), else build from tool config
    const spec =
      toolHandler.getAllAvailableToolSpecs().find(s => s.name === tool.name) ??
      {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.config?.inputSchema ?? { type: "object", properties: {} },
      };

    userToolSpecs.push({
      toolSpec: {
        name: spec.name,
        description: spec.description,
        inputSchema: { json: JSON.stringify(spec.inputSchema) },
      },
    });
  }
}

    const allTools = [...toolSpecs, ...mcpToolSpecs, ...userToolSpecs];

    console.log(
      `Enabled tools for session: ${allTools.map((t) => t.toolSpec.name).join(", ")}`
    );
    console.log(
      `Total tools loaded: Built-in: ${toolSpecs.length}, MCP: ${mcpToolSpecs.length}, User-defined: ${userToolSpecs.length}`
    );

    return {
      event: {
        promptStart: {
          promptName: session.promptName,
          textOutputConfiguration: {
            mediaType: "text/plain",
          },
          audioOutputConfiguration: {
            ...audioOutputConfig,
          },
          toolUseOutputConfiguration: {
            mediaType: "application/json",
          },
          toolConfiguration: {
            tools: allTools,
          },
        },
      },
    };
  }

  /**
   * Get enabled tools from DynamoDB (no file fallback)
   * Returns empty array if not configured yet.
   */
  private async getEnabledTools(): Promise<string[]> {
    try {
      const enabled = await ConfigManager.getEnabledTools();
      if (!Array.isArray(enabled)) {
        console.log("Enabled tools not an array in config; using empty list");
        return [];
      }
      console.log("Enabled tools from DynamoDB:", enabled);
      return enabled;
    } catch (error) {
      console.error("Failed to fetch enabled tools from DynamoDB:", error);
      // No fallback to file; return empty to continue without tools
      return [];
    }
  }

  /**
   * Create system prompt events
   * @param session Session data
   * @param textConfig Text configuration
   * @param content Prompt content
   */
  public createSystemPromptEvents(
    session: SessionData,
    textConfig: any,
    content: string
  ): object[] {
    const textPromptID = randomUUID();
    return [
      {
        event: {
          contentStart: {
            promptName: session.promptName,
            contentName: textPromptID,
            type: "TEXT",
            interactive: true,
            role: "SYSTEM",
            textInputConfiguration: textConfig,
          },
        },
      },
      {
        event: {
          textInput: {
            promptName: session.promptName,
            contentName: textPromptID,
            content: content,
          },
        },
      },
      {
        event: {
          contentEnd: {
            promptName: session.promptName,
            contentName: textPromptID,
          },
        },
      },
    ];
  }

  /**
   * Create start-audio event
   * @param session Session data
   * @param audioConfig Audio configuration
   */
  public createStartAudioEvent(session: SessionData, audioConfig: any): object {
    return {
      event: {
        contentStart: {
          promptName: session.promptName,
          contentName: session.audioContentId,
          type: "AUDIO",
          interactive: true,
          role: "USER",
          audioInputConfiguration: audioConfig,
        },
      },
    };
  }

  /**
   * Create audio input event
   * @param session Session data
   * @param base64AudioData Audio data encoded in Base64
   */
  public createAudioInputEvent(
    session: SessionData,
    base64AudioData: string
  ): object {
    return {
      event: {
        audioInput: {
          promptName: session.promptName,
          contentName: session.audioContentId,
          content: base64AudioData,
        },
      },
    };
  }

  /**
   * Create content end event
   * @param session Session data
   */
  public createContentEndEvent(session: SessionData): object {
    return {
      event: {
        contentEnd: {
          promptName: session.promptName,
          contentName: session.audioContentId,
        },
      },
    };
  }

  /**
   * Create prompt end event
   * @param session Session data
   */
  public createPromptEndEvent(session: SessionData): object {
    return {
      event: {
        promptEnd: {
          promptName: session.promptName,
        },
      },
    };
  }

  /**
   * Create session end event
   */
  public createSessionEndEvent(): object {
    return {
      event: {
        sessionEnd: {},
      },
    };
  }

  /**
   * Create tool result events
   * @param session Session data
   * @param toolUseId Tool use ID
   * @param result Tool result
   */
  public createToolResultEvents(
    session: SessionData,
    toolUseId: string,
    result: any
  ): object[] {
    const contentId = randomUUID();
    console.log("**********", result);

    const textContent =
      Array.isArray(result) && result.length > 0
        ? JSON.stringify(result[0])
        : typeof result === "string"
        ? result
        : JSON.stringify(result);

    console.log("------Tool result received:------", textContent);

    return [
      {
        event: {
          contentStart: {
            promptName: session.promptName,
            contentName: contentId,
            interactive: false,
            type: "TOOL",
            role: "TOOL",
            toolResultInputConfiguration: {
              toolUseId: toolUseId,
              type: "TEXT",
              textInputConfiguration: {
                mediaType: "text/plain",
              },
            },
          },
        },
      },
      {
        event: {
          toolResult: {
            promptName: session.promptName,
            contentName: contentId,
            content: textContent,
          },
        },
      },
      {
        event: {
          contentEnd: {
            promptName: session.promptName,
            contentName: contentId,
          },
        },
      },
    ];
  }
}
