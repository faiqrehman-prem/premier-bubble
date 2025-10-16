import {
  BedrockRuntimeClient,
  InvokeModelWithBidirectionalStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { NodeHttp2Handler } from "@smithy/node-http-handler";
import { randomUUID } from "node:crypto";
import { firstValueFrom } from "rxjs";
import { take } from "rxjs/operators";
import { Subject } from "rxjs";
import { Buffer } from "node:buffer";

import {
  NovaSonicBidirectionalStreamClientConfig,
  SessionData,
} from "../types/types";
import { StreamSession } from "./session";
import { ToolHandler } from "../services/tools";
import { EventManager } from "./events";

/**
 * Nova Sonic bidirectional stream client
 * Manages audio stream sessions, tool invocations, and event handling
 */
export class NovaSonicBidirectionalStreamClient {
  private bedrockRuntimeClient: BedrockRuntimeClient;
  private inferenceConfig: any;
  private activeSessions: Map<string, SessionData> = new Map();
  private sessionLastActivity: Map<string, number> = new Map();
  private sessionCleanupInProgress = new Set<string>();
  private toolHandler: ToolHandler;
  private eventManager: EventManager;

  constructor(
    config: NovaSonicBidirectionalStreamClientConfig,
    toolHandler?: ToolHandler
  ) {
    // Initialize HTTP/2 handler
    const nodeHttp2Handler = new NodeHttp2Handler({
      requestTimeout: 300000,
      sessionTimeout: 600000,
      disableConcurrentStreams: false,
      maxConcurrentStreams: 20,
      ...config.requestHandlerConfig,
    });

    if (!config.clientConfig.credentials) {
      throw new Error("Credentials not provided");
    }

    // Initialize Bedrock runtime client
    this.bedrockRuntimeClient = new BedrockRuntimeClient({
      ...config.clientConfig,
      credentials: config.clientConfig.credentials,
      region: config.clientConfig.region || "us-east-1",
      requestHandler: nodeHttp2Handler,
    });

    this.inferenceConfig = config.inferenceConfig ?? {
      maxTokens: 1024,
      topP: 0.9,
      temperature: 1,
    };

    this.toolHandler = toolHandler || new ToolHandler();
    this.eventManager = new EventManager();
  }

  /**
   * Check if a session is active
   */
  public isSessionActive(sessionId: string): boolean {
    const session = this.activeSessions.get(sessionId);
    return !!session && session.isActive;
  }

  /**
   * Get all active session IDs
   */
  public getActiveSessions(): string[] {
    return Array.from(this.activeSessions.keys());
  }

  /**
   * Get the last activity time for a session
   */
  public getLastActivityTime(sessionId: string): number {
    return this.sessionLastActivity.get(sessionId) || 0;
  }

  /**
   * Update session activity time
   */
  private updateSessionActivity(sessionId: string): void {
    this.sessionLastActivity.set(sessionId, Date.now());
  }

  /**
   * Check if cleanup is in progress for a session
   */
  public isCleanupInProgress(sessionId: string): boolean {
    return this.sessionCleanupInProgress.has(sessionId);
  }

  /**
   * Create a new stream session
   */
  public createStreamSession(
    sessionId: string = randomUUID(),
    config?: NovaSonicBidirectionalStreamClientConfig,
    costTrackingEnabled: boolean = false
  ): StreamSession {
    if (this.activeSessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} already exists`);
    }

    const session: SessionData = {
      queue: [],
      queueSignal: new Subject<void>(),
      closeSignal: new Subject<void>(),
      responseSubject: new Subject<any>(),
      toolUseContent: null,
      toolUseId: "",
      toolName: "",
      responseHandlers: new Map(),
      promptName: randomUUID(),
      inferenceConfig: config?.inferenceConfig ?? this.inferenceConfig,
      isActive: true,
      isPromptStartSent: false,
      isAudioContentStartSent: false,
      audioContentId: randomUUID(),
      toolHandler: this.toolHandler, // add tool handler to session
    };

    this.activeSessions.set(sessionId, session);
    
    // Create StreamSession with cost tracking enabled
    const streamSession = new StreamSession(sessionId, this, costTrackingEnabled);
    
    // Link the StreamSession back to SessionData for usage tracking
    session.streamSession = streamSession;
    
    return streamSession;
  }

  /**
   * Initialize a session
   */
  public async initiateSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} does not exist`);
    }

    try {
      this.setupSessionStartEvent(sessionId);
      const asyncIterable = this.createSessionAsyncIterable(sessionId);
      console.log(`Starting bidirectional stream for session ${sessionId}...`);

      const response = await this.bedrockRuntimeClient.send(
        new InvokeModelWithBidirectionalStreamCommand({
          modelId: "amazon.nova-sonic-v1:0",
          body: asyncIterable,
        })
      );

      console.log(
        `Stream established for session ${sessionId}, beginning to process responses...`
      );
      await this.processResponseStream(sessionId, response);
    } catch (error) {
      console.error(`Session ${sessionId} error:`, error);
      this.dispatchEventForSession(sessionId, "error", {
        source: "bidirectionalStream",
        error,
      });

      if (session.isActive) {
        this.closeSession(sessionId);
      }
    }
  }

  /**
   * Dispatch an event for a session
   */
  private dispatchEventForSession(
    sessionId: string,
    eventType: string,
    data: any
  ): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const handler = session.responseHandlers.get(eventType);
    if (handler) {
      try {
        handler(data);
      } catch (e) {
        console.error(
          `Error in ${eventType} handler for session ${sessionId}: `,
          e
        );
      }
    }

    const anyHandler = session.responseHandlers.get("any");
    if (anyHandler) {
      try {
        anyHandler({ type: eventType, data });
      } catch (e) {
        console.error(`Error in 'any' handler for session ${sessionId}: `, e);
      }
    }
  }

  /**
   * Create an async iterable for a session
   */
  private createSessionAsyncIterable(sessionId: string): AsyncIterable<any> {
    if (!this.isSessionActive(sessionId)) {
      console.log(`Cannot create async iterator: session ${sessionId} inactive`);
      return {
        [Symbol.asyncIterator]: () => ({
          next: async () => ({ value: undefined, done: true }),
        }),
      };
    }

    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(
        `Cannot create async iterator: session ${sessionId} does not exist`
      );
    }

    let eventCount = 0;

    return {
      [Symbol.asyncIterator]: () => {
        console.log(`Requesting async iterator for session ${sessionId}`);

        return {
          next: async () => {
            try {
              if (!session.isActive || !this.activeSessions.has(sessionId)) {
                console.log(`Iterator closed for session ${sessionId}`);
                return { value: undefined, done: true };
              }

              if (session.queue.length === 0) {
                try {
                  await Promise.race([
                    firstValueFrom(session.queueSignal.pipe(take(1))),
                    firstValueFrom(session.closeSignal.pipe(take(1))).then(
                      () => {
                        throw new Error("Stream closed");
                      }
                    ),
                  ]);
                } catch (error) {
                  if (error instanceof Error) {
                    if (
                      error.message === "Stream closed" ||
                      !session.isActive
                    ) {
                      if (this.activeSessions.has(sessionId)) {
                        console.log(
                          `Session ${sessionId} closed while waiting`
                        );
                      }
                      return { value: undefined, done: true };
                    }
                  } else {
                    console.error(`Error on close event`, error);
                  }
                }
              }

              if (session.queue.length === 0 || !session.isActive) {
                console.log(
                  `Queue empty or session inactive: ${sessionId}`
                );
                return { value: undefined, done: true };
              }

              const nextEvent = session.queue.shift();
              
              // Validate that nextEvent is not null or undefined
              if (!nextEvent) {
                console.log(`Skipping null/undefined event for session ${sessionId}`);
                return { value: undefined, done: true };
              }
              
              eventCount++;

              // Ensure we're creating a valid event structure
              const eventPayload = {
                chunk: {
                  bytes: new TextEncoder().encode(JSON.stringify(nextEvent)),
                },
              };

              return {
                value: eventPayload,
                done: false,
              };
            } catch (error) {
              console.error(`Iterator error for session ${sessionId}: `, error);
              session.isActive = false;
              return { value: undefined, done: true };
            }
          },

          return: async () => {
            console.log(`return() called on iterator for session ${sessionId}`);
            session.isActive = false;
            return { value: undefined, done: true };
          },

          throw: async (error: any) => {
            console.log(
              `throw() called on iterator for session ${sessionId} error: `,
              error
            );
            session.isActive = false;
            throw error;
          },
        };
      },
    };
  }

  /**
   * Process the response stream
   */
  private async processResponseStream(
    sessionId: string,
    response: any
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    try {
      for await (const event of response.body) {
        // Skip null or undefined events
        if (!event) {
          continue;
        }

        if (!session.isActive) {
          console.log(
            `Session ${sessionId} no longer active, stopping response processing`
          );
          break;
        }

        if (event.chunk?.bytes) {
          try {
            this.updateSessionActivity(sessionId);
            const textResponse = new TextDecoder().decode(event.chunk.bytes);

            try {
              const jsonResponse = JSON.parse(textResponse);
              await this.handleResponseEvent(sessionId, jsonResponse, session);
            } catch (e) {
              console.log(
                `Raw text response for session ${sessionId} (parse error): ${textResponse}`
              );
            }
          } catch (e) {
            console.error(
              `Error processing response chunk for session ${sessionId}:`,
              e
            );
          }
        } else if (event.modelStreamErrorException) {
          this.handleModelError(sessionId, event.modelStreamErrorException);
        } else if (event.internalServerException) {
          this.handleServerError(sessionId, event.internalServerException);
        } else {
          // Log unexpected event structure for debugging
          console.log(`Skipping unexpected event structure for session ${sessionId}:`, Object.keys(event || {}));
        }
      }

      console.log(`Response stream processing complete for session ${sessionId}`);
      this.dispatchEvent(sessionId, "streamComplete", {
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      this.handleStreamError(sessionId, error);
    }
  }

  /**
   * Handle a response event
   */
  private async handleResponseEvent(
    sessionId: string,
    jsonResponse: any,
    session: SessionData
  ): Promise<void> {
    // Handle usage events for cost tracking
    if (jsonResponse.event?.usageEvent) {
      this.handleUsageEvent(sessionId, jsonResponse.event.usageEvent, session);
    } else if (jsonResponse.event?.completionStart) {
      this.handleCompletionStart(sessionId, jsonResponse.event.completionStart, session);
    } else if (jsonResponse.event?.completionEnd) {
      this.handleCompletionEnd(sessionId, jsonResponse.event.completionEnd, session);
    } else if (jsonResponse.event?.contentStart) {
      this.dispatchEvent(
        sessionId,
        "contentStart",
        jsonResponse.event.contentStart
      );
    } else if (jsonResponse.event?.textOutput) {
      this.dispatchEvent(
        sessionId,
        "textOutput",
        jsonResponse.event.textOutput
      );
    } else if (jsonResponse.event?.audioOutput) {
      this.dispatchEvent(
        sessionId,
        "audioOutput",
        jsonResponse.event.audioOutput
      );
    } else if (jsonResponse.event?.toolUse) {
      await this.handleToolUse(sessionId, jsonResponse.event.toolUse, session);
    } else if (
      jsonResponse.event?.contentEnd &&
      jsonResponse.event?.contentEnd?.type === "TOOL"
    ) {
      await this.handleToolEnd(sessionId, session);
    } else if (jsonResponse.event?.contentEnd) {
      this.dispatchEvent(
        sessionId,
        "contentEnd",
        jsonResponse.event.contentEnd
      );
    } else {
      this.handleOtherEvents(sessionId, jsonResponse);
    }
  }

  /**
   * Handle tool use
   */
  private async handleToolUse(
    sessionId: string,
    toolUse: any,
    session: SessionData
  ): Promise<void> {
    this.dispatchEvent(sessionId, "toolUse", toolUse);
    session.toolUseContent = toolUse;
    session.toolUseId = toolUse.toolUseId;
    session.toolName = toolUse.toolName;
  }

  /**
   * Handle tool end
   */
  private async handleToolEnd(
    sessionId: string,
    session: SessionData
  ): Promise<void> {
    console.log(`Handling tool use for session ${sessionId}`);
    this.dispatchEvent(sessionId, "toolEnd", {
      toolUseContent: session.toolUseContent,
      toolUseId: session.toolUseId,
      toolName: session.toolName,
    });

    const toolResult = await this.toolHandler.processToolUse(
      session.toolName,
      session.toolUseContent
    );

    this.sendToolResult(sessionId, session.toolUseId, toolResult);
    this.dispatchEvent(sessionId, "toolResult", {
      toolUseId: session.toolUseId,
      result: toolResult,
    });
  }

  /**
   * Handle other events
   */
  private handleOtherEvents(sessionId: string, jsonResponse: any): void {
    const eventKeys = Object.keys(jsonResponse.event || {});
    if (eventKeys.length > 0) {
      this.dispatchEvent(sessionId, eventKeys[0], jsonResponse.event);
    } else if (Object.keys(jsonResponse).length > 0) {
      this.dispatchEvent(sessionId, "unknown", jsonResponse);
    }
  }

  /**
   * Handle model error
   */
  private handleModelError(sessionId: string, error: any): void {
    console.error(`Model stream error for session ${sessionId}:`, error);
    this.dispatchEvent(sessionId, "error", {
      type: "modelStreamErrorException",
      details: error,
    });
  }

  /**
   * Handle server error
   */
  private handleServerError(sessionId: string, error: any): void {
    console.error(`Internal server error for session ${sessionId}:`, error);
    this.dispatchEvent(sessionId, "error", {
      type: "internalServerException",
      details: error,
    });
  }

  /**
   * Handle stream error
   */
  private handleStreamError(sessionId: string, error: any): void {
    console.error(`Error processing response stream for session ${sessionId}:`, error);
    this.dispatchEvent(sessionId, "error", {
      source: "responseStream",
      message: "Error processing response stream",
      details: error instanceof Error ? error.message : String(error),
    });
  }

  /**
   * Handle usage event for cost tracking
   */
  private handleUsageEvent(sessionId: string, usageEvent: any, session: SessionData): void {
    if (session.streamSession && session.streamSession.isCostTrackingEnabled()) {
      session.streamSession.handleUsageEvent(usageEvent);
      
      // Emit live usage update
      const liveUsage = session.streamSession.getLiveUsageString();
      if (liveUsage) {
        console.log(liveUsage);
      }

      // Get cost data for the event
      const tokenUsage = session.streamSession.getTokenUsage();
      const costBreakdown = session.streamSession.getCostBreakdown();
      const formattedCost = session.streamSession.getFormattedCost();
      
      // Dispatch usage update event
      this.dispatchEvent(sessionId, "liveUsageUpdate", {
        sessionId: sessionId,
        tokenUsage: tokenUsage,
        costBreakdown: costBreakdown,
        formattedCost: formattedCost,
        liveUsageString: liveUsage
      });
    }
  }

  /**
   * Handle completion start event
   */
  private handleCompletionStart(sessionId: string, completionStart: any, session: SessionData): void {
    const completionId = completionStart.completionId;
    if (completionId && session.streamSession && session.streamSession.isCostTrackingEnabled()) {
      session.streamSession.handleCompletionStart(completionId);
    }
  }

  /**
   * Handle completion end event
   */
  private handleCompletionEnd(sessionId: string, completionEnd: any, session: SessionData): void {
    const completionId = completionEnd.completionId;
    if (completionId && session.streamSession && session.streamSession.isCostTrackingEnabled()) {
      const delta = session.streamSession.handleCompletionEnd(completionId);
      
      // Dispatch turn completion event
      this.dispatchEvent(sessionId, "turnCompleted", {
        sessionId: sessionId,
        completionId: completionId,
        turnDelta: delta,
        sessionTotals: session.streamSession.getTokenUsage(),
        sessionCosts: session.streamSession.getCostBreakdown()
      });
    }
  }

  /**
   * Add an event to the session queue
   */
  private addEventToSessionQueue(sessionId: string, event: any): void {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isActive) return;

    // Validate that event is not null or undefined
    if (!event) {
      console.log(`Skipping null/undefined event for session ${sessionId}`);
      return;
    }

    this.updateSessionActivity(sessionId);
    session.queue.push(event);
    session.queueSignal.next();
  }

  /**
   * Set up session start event
   */
  private setupSessionStartEvent(sessionId: string): void {
    console.log(`Setting initial events for session ${sessionId}...`);
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    this.addEventToSessionQueue(
      sessionId,
      this.eventManager.createSessionStartEvent(session)
    );
  }

  /**
   * Set up prompt start event
   */
  public async setupPromptStartEvent(
    sessionId: string,
    audioOutputConfig: any
  ): Promise<void> {
    console.log(`Setting prompt start event for session ${sessionId}...`);
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const promptStartEvent = await this.eventManager.createPromptStartEvent(
    session,
    audioOutputConfig
    );

    this.addEventToSessionQueue(
      sessionId,
      promptStartEvent
    );
    session.isPromptStartSent = true;
  }

  /**
   * Set up system prompt events
   */
  public setupSystemPromptEvent(
    sessionId: string,
    textConfig: any,
    systemPromptContent: string
  ): void {
    console.log(`Setting system prompt events for session ${sessionId}...`);
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const events = this.eventManager.createSystemPromptEvents(
      session,
      textConfig,
      systemPromptContent
    );
    events.forEach((event) => this.addEventToSessionQueue(sessionId, event));
  }

  /**
   * Set up start audio event
   */
  public setupStartAudioEvent(sessionId: string, audioConfig: any): void {
    console.log(`Setting start audio event for session ${sessionId}...`);
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    this.addEventToSessionQueue(
      sessionId,
      this.eventManager.createStartAudioEvent(session, audioConfig)
    );
    session.isAudioContentStartSent = true;
  }

  /**
   * Stream an audio data chunk
   */
  public async streamAudioChunk(
    sessionId: string,
    audioData: Buffer
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isActive || !session.audioContentId) {
      throw new Error(`Invalid session ${sessionId}, cannot stream audio`);
    }

    const base64Data = audioData.toString("base64");
    this.addEventToSessionQueue(
      sessionId,
      this.eventManager.createAudioInputEvent(session, base64Data)
    );
  }

  /**
   * Send tool result
   */
  private async sendToolResult(
    sessionId: string,
    toolUseId: string,
    result: any
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isActive) return;

    console.log(
      `Sending tool result for session ${sessionId}, toolUseId: ${toolUseId}`
    );
    const events = this.eventManager.createToolResultEvents(
      session,
      toolUseId,
      result
    );
    events.forEach((event) => this.addEventToSessionQueue(sessionId, event));
  }

  /**
   * Send content end event
   */
  public async sendContentEnd(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isAudioContentStartSent) return;

    this.addEventToSessionQueue(
      sessionId,
      this.eventManager.createContentEndEvent(session)
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  /**
   * Send prompt end event
   */
  public async sendPromptEnd(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isPromptStartSent) return;

    this.addEventToSessionQueue(
      sessionId,
      this.eventManager.createPromptEndEvent(session)
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  /**
   * Send session end event
   */
  public async sendSessionEnd(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    this.addEventToSessionQueue(
      sessionId,
      this.eventManager.createSessionEndEvent()
    );
    await new Promise((resolve) => setTimeout(resolve, 300));

    session.isActive = false;
    session.closeSignal.next();
    session.closeSignal.complete();
    this.activeSessions.delete(sessionId);
    this.sessionLastActivity.delete(sessionId);
    console.log(`Session ${sessionId} closed and removed from active sessions`);
  }

  /**
   * Register an event handler
   */
  public registerEventHandler(
    sessionId: string,
    eventType: string,
    handler: (data: any) => void
  ): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} does not exist`);
    }
    session.responseHandlers.set(eventType, handler);
  }

  /**
   * Dispatch an event
   */
  private dispatchEvent(sessionId: string, eventType: string, data: any): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const handler = session.responseHandlers.get(eventType);
    if (handler) {
      try {
        handler(data);
      } catch (e) {
        console.error(
          `Error in ${eventType} handler for session ${sessionId}:`,
          e
        );
      }
    }

    const anyHandler = session.responseHandlers.get("any");
    if (anyHandler) {
      try {
        anyHandler({ type: eventType, data });
      } catch (e) {
        console.error(`Error in 'any' handler for session ${sessionId}:`, e);
      }
    }
  }

  /**
   * Close a session (graceful)
   */
  public async closeSession(sessionId: string): Promise<void> {
    if (this.sessionCleanupInProgress.has(sessionId)) {
      console.log(`Cleanup already in progress for session ${sessionId}, skipping`);
      return;
    }

    this.sessionCleanupInProgress.add(sessionId);
    try {
      console.log(`Starting graceful close for session ${sessionId}`);
      await this.sendContentEnd(sessionId);
      await this.sendPromptEnd(sessionId);
      await this.sendSessionEnd(sessionId);
      console.log(`Cleanup complete for session ${sessionId}`);
    } catch (error) {
      console.error(`Error during close sequence for session ${sessionId}:`, error);

      const session = this.activeSessions.get(sessionId);
      if (session) {
        session.isActive = false;
        this.activeSessions.delete(sessionId);
        this.sessionLastActivity.delete(sessionId);
      }
    } finally {
      this.sessionCleanupInProgress.delete(sessionId);
    }
  }

  /**
   * Force close a session (immediate)
   */
  public forceCloseSession(sessionId: string): void {
    if (
      this.sessionCleanupInProgress.has(sessionId) ||
      !this.activeSessions.has(sessionId)
    ) {
      console.log(`Session ${sessionId} already cleaning up or inactive`);
      return;
    }

    this.sessionCleanupInProgress.add(sessionId);
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) return;

      console.log(`Force closing session ${sessionId}`);

      session.isActive = false;
      session.closeSignal.next();
      session.closeSignal.complete();
      this.activeSessions.delete(sessionId);
      this.sessionLastActivity.delete(sessionId);

      console.log(`Session ${sessionId} force closed`);
    } finally {
      this.sessionCleanupInProgress.delete(sessionId);
    }
  }
}
