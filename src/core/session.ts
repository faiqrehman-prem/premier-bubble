// import { Buffer } from "node:buffer";
// import { NovaSonicBidirectionalStreamClient } from "./client";
// import {
//   DefaultAudioInputConfiguration,
//   DefaultTextConfiguration,
//   DefaultSystemPrompt,
//   DefaultAudioOutputConfiguration,
// } from "../config/consts";
// import { UsageTracker, CompletionDelta } from "../services/usage-tracker";
// import { TokenUsage, CostBreakdown } from "../services/pricing-service";

// interface UserLocation {
//   latitude: number;
//   longitude: number;
//   accuracy?: number;
//   timestamp: number;
// }

// /**
//  * StreamSession class
//  * Manages a single audio streaming session, including audio buffering and event handling
//  */
// export class StreamSession {
//   private audioBufferQueue: Buffer[] = [];
//   private maxQueueSize = 200; // Maximum audio queue size
//   private isProcessingAudio = false;
//   private isActive = true;
//   private voiceId: string = "tiffany"; // Default voice ID
//   private usageTracker: UsageTracker;
//   private currentCompletionId: string | null = null;
//   public userLocation: UserLocation | null = null; // Location data for this session

//   constructor(
//     private sessionId: string,
//     private client: NovaSonicBidirectionalStreamClient,
//     private costTrackingEnabled: boolean = false
//   ) {
//     this.usageTracker = new UsageTracker(sessionId, costTrackingEnabled);
//   }

//   /**
//    * Set the voice ID
//    * @param voiceId Voice ID
//    */
//   public setVoiceId(voiceId: string): void {
//     this.voiceId = voiceId;
//     console.log(`Voice ID for session ${this.sessionId} set to ${voiceId}`);
//   }

//   /**
//    * Get the current voice ID
//    */
//   public getVoiceId(): string {
//     return this.voiceId;
//   }

//   /**
//    * Register an event handler
//    * @param eventType Event type
//    * @param handler Handler function
//    */
//   public onEvent(
//     eventType: string,
//     handler: (data: any) => void
//   ): StreamSession {
//     this.client.registerEventHandler(this.sessionId, eventType, handler);
//     return this;
//   }

//   /**
//    * Set up the prompt start event
//    */
//   public async setupPromptStart(
//     audioOutputConfig?: typeof DefaultAudioOutputConfiguration
//   ): Promise<void> {
//     // Create a custom audio output config that uses the current voiceId
//     const customAudioConfig = {
//       ...DefaultAudioOutputConfiguration,
//       voiceId: this.voiceId,
//       ...audioOutputConfig, // Merge optional overrides
//     };

//     console.log(`Initializing session with voice ID: ${customAudioConfig.voiceId}`);
//     this.client.setupPromptStartEvent(this.sessionId, customAudioConfig);
//   }

//   /**
//    * Set up the system prompt
//    * @param textConfig Text configuration
//    * @param systemPromptContent System prompt content
//    */
//   public async setupSystemPrompt(
//     textConfig: typeof DefaultTextConfiguration = DefaultTextConfiguration,
//     systemPromptContent: string = DefaultSystemPrompt
//   ): Promise<void> {
//     this.client.setupSystemPromptEvent(
//       this.sessionId,
//       textConfig,
//       systemPromptContent
//     );
//   }

//   /**
//    * Set up the start-audio event
//    * @param audioConfig Audio configuration
//    */
//   public async setupStartAudio(
//     audioConfig: typeof DefaultAudioInputConfiguration = DefaultAudioInputConfiguration
//   ): Promise<void> {
//     this.client.setupStartAudioEvent(this.sessionId, audioConfig);
//   }

//   /**
//    * Stream audio data
//    * @param audioData Audio data
//    */
//   public async streamAudio(audioData: Buffer): Promise<void> {
//     if (this.audioBufferQueue.length >= this.maxQueueSize) {
//       this.audioBufferQueue.shift();
//       // console.log("Audio queue is full; dropping the oldest chunk");
//     }

//     this.audioBufferQueue.push(audioData);
//     this.processAudioQueue();
//   }

//   /**
//    * Process the audio queue
//    */
//   private async processAudioQueue() {
//     if (
//       this.isProcessingAudio ||
//       this.audioBufferQueue.length === 0 ||
//       !this.isActive
//     )
//       return;

//     this.isProcessingAudio = true;
//     try {
//       let processedChunks = 0;
//       const maxChunksPerBatch = 5;

//       while (
//         this.audioBufferQueue.length > 0 &&
//         processedChunks < maxChunksPerBatch &&
//         this.isActive
//       ) {
//         const audioChunk = this.audioBufferQueue.shift();
//         if (audioChunk) {
//           await this.client.streamAudioChunk(this.sessionId, audioChunk);
//           processedChunks++;
//         }
//       }
//     } finally {
//       this.isProcessingAudio = false;

//       if (this.audioBufferQueue.length > 0 && this.isActive) {
//         setTimeout(() => this.processAudioQueue(), 0);
//       }
//     }
//   }

//   /**
//    * Get the session ID
//    */
//   public getSessionId(): string {
//     return this.sessionId;
//   }

//   /**
//    * End the current audio content
//    */
//   public async endAudioContent(): Promise<void> {
//     if (!this.isActive) return;
//     await this.client.sendContentEnd(this.sessionId);
//   }

//   /**
//    * End the current prompt
//    */
//   public async endPrompt(): Promise<void> {
//     if (!this.isActive) return;
//     await this.client.sendPromptEnd(this.sessionId);
//   }

//   /**
//    * Close the session
//    */
//   public async close(): Promise<void> {
//     if (!this.isActive) return;

//     this.isActive = false;
//     this.audioBufferQueue = [];
//     this.isProcessingAudio = false;

//     await new Promise((resolve) => setTimeout(resolve, 100));

//     // Save session cost summary if cost tracking is enabled
//     if (this.usageTracker.isCostTrackingEnabled()) {
//       await this.usageTracker.saveSessionCostSummary();
//     }

//     await this.client.sendSessionEnd(this.sessionId);
//     console.log(`Session ${this.sessionId} closed`);
//   }

//   // ---- Cost Tracking Methods ----

//   /**
//    * Handle usage events from Nova Sonic
//    */
//   public handleUsageEvent(usageEvent: any): void {
//     const details = usageEvent.details || usageEvent;
//     this.usageTracker.onUsageEvent(details);
//   }

//   /**
//    * Handle completion start
//    */
//   public handleCompletionStart(completionId: string): void {
//     this.currentCompletionId = completionId;
//     this.usageTracker.onCompletionStart(completionId);
//   }

//   /**
//    * Handle completion end
//    */
//   public handleCompletionEnd(completionId: string): CompletionDelta {
//     const delta = this.usageTracker.computeTurnDelta(completionId);
//     const turnCosts = this.usageTracker.calculateTurnCosts(delta);

//     // Log turn usage (matching the Python format) only if cost tracking is enabled
//     if (this.usageTracker.isCostTrackingEnabled()) {
//       console.log("\n=== Turn Usage ===");
//       console.log(`completionId: ${completionId}`);
//       console.log(`input_speech_tokens:  ${delta.inputSpeech}`);
//       console.log(`input_text_tokens:    ${delta.inputText}`);
//       console.log(`output_speech_tokens: ${delta.outputSpeech}`);
//       console.log(`output_text_tokens:   ${delta.outputText}`);
//       console.log(`cost_speech_mode_usd: ${turnCosts.speechModeUsd.toFixed(6)}`);
//       console.log(`cost_text_mode_usd:   ${turnCosts.textModeUsd.toFixed(6)}`);
//       console.log("==================\n");
//     }

//     return delta;
//   }

//   /**
//    * Get current token usage
//    */
//   public getTokenUsage(): TokenUsage {
//     return this.usageTracker.getSessionTotals();
//   }

//   /**
//    * Get current cost breakdown
//    */
//   public getCostBreakdown(): CostBreakdown {
//     return this.usageTracker.getRunningCosts();
//   }

//   /**
//    * Get formatted cost
//    */
//   public getFormattedCost(): string {
//     const costs = this.getCostBreakdown();
//     return `$${costs.totalCostUsd.toFixed(6)}`;
//   }

//   /**
//    * Get live usage string
//    */
//   public getLiveUsageString(): string {
//     return this.usageTracker.formatLiveUsage();
//   }

//   /**
//    * Check if cost tracking is enabled
//    */
//   public isCostTrackingEnabled(): boolean {
//     return this.usageTracker.isCostTrackingEnabled();
//   }

//   /**
//    * Get session ID
//    */
//   public getId(): string {
//     return this.sessionId;
//   }
// }

import { Buffer } from "node:buffer";
import { NovaSonicBidirectionalStreamClient } from "./client";
import {
  DefaultAudioInputConfiguration,
  DefaultTextConfiguration,
  DefaultSystemPrompt,
  DefaultAudioOutputConfiguration,
} from "../config/consts";
import { UsageTracker, CompletionDelta } from "../services/usage-tracker";
import { TokenUsage, CostBreakdown } from "../services/pricing-service";

interface UserLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp: number;
}

/**
 * StreamSession class
 * Manages a single audio streaming session, including audio buffering and event handling
 */
export class StreamSession {
  private audioBufferQueue: Buffer[] = [];
  private maxQueueSize = 200; // Maximum audio queue size
  private isProcessingAudio = false;
  private isActive = true;
  private voiceId: string = "tiffany"; // Default voice ID
  private usageTracker: UsageTracker;
  private currentCompletionId: string | null = null;
  public userLocation: UserLocation | null = null; // Location data for this session

  // ordering guards
  private promptStarted = false;
  private audioStarted = false;

  constructor(
    private sessionId: string,
    private client: NovaSonicBidirectionalStreamClient,
    private costTrackingEnabled: boolean = false
  ) {
    this.usageTracker = new UsageTracker(sessionId, costTrackingEnabled);
  }

  /**
   * Set the voice ID
   * @param voiceId Voice ID
   */
  public setVoiceId(voiceId: string): void {
    this.voiceId = voiceId;
    console.log(`Voice ID for session ${this.sessionId} set to ${voiceId}`);
  }

  /**
   * Get the current voice ID
   */
  public getVoiceId(): string {
    return this.voiceId;
  }

  /**
   * Register an event handler
   * @param eventType Event type
   * @param handler Handler function
   */
  public onEvent(
    eventType: string,
    handler: (data: any) => void
  ): StreamSession {
    this.client.registerEventHandler(this.sessionId, eventType, handler);
    return this;
  }

  /**
   * Set up the prompt start event
   */
  public async setupPromptStart(
    audioOutputConfig?: Partial<typeof DefaultAudioOutputConfiguration>
  ): Promise<void> {
    // Create a custom audio output config that uses the current voiceId
    const customAudioConfig = {
      ...DefaultAudioOutputConfiguration,
      voiceId: this.voiceId,
      ...(audioOutputConfig || {}),
    };

    console.log(`Initializing session with voice ID: ${customAudioConfig.voiceId}`);
    await this.client.setupPromptStartEvent(this.sessionId, customAudioConfig);
    this.promptStarted = true;
  }

  /**
   * Set up the system prompt
   * @param textConfig Text configuration
   * @param systemPromptContent System prompt content
   */
  public async setupSystemPrompt(
    textConfig: typeof DefaultTextConfiguration = DefaultTextConfiguration,
    systemPromptContent: string = DefaultSystemPrompt
  ): Promise<void> {
    if (!this.promptStarted) {
      throw new Error("setupSystemPrompt called before setupPromptStart completed");
    }
    await this.client.setupSystemPromptEvent(
      this.sessionId,
      textConfig,
      systemPromptContent
    );
  }

  /**
   * Set up the start-audio event
   * @param audioConfig Audio configuration
   */
  public async setupStartAudio(
    audioConfig: typeof DefaultAudioInputConfiguration = DefaultAudioInputConfiguration
  ): Promise<void> {
    if (!this.promptStarted) {
      throw new Error("setupStartAudio called before setupPromptStart completed");
    }
    await this.client.setupStartAudioEvent(this.sessionId, audioConfig);
    this.audioStarted = true;

    // kick the queue if anything was buffered early
    if (this.audioBufferQueue.length > 0) {
      this.processAudioQueue();
    }
  }

  /**
   * Stream audio data
   * @param audioData Audio data
   */
  public async streamAudio(audioData: Buffer): Promise<void> {
    if (this.audioBufferQueue.length >= this.maxQueueSize) {
      this.audioBufferQueue.shift();
      // console.log("Audio queue is full; dropping the oldest chunk");
    }

    this.audioBufferQueue.push(audioData);
    this.processAudioQueue();
  }

  /**
   * Process the audio queue
   */
  private async processAudioQueue() {
    if (
      this.isProcessingAudio ||
      this.audioBufferQueue.length === 0 ||
      !this.isActive
    ) {
      return;
    }

    // do not flush audio until audio content has started
    if (!this.audioStarted) {
      // try again shortly; avoids throwing inside client.streamAudioChunk
      setTimeout(() => this.processAudioQueue(), 10);
      return;
    }

    this.isProcessingAudio = true;
    try {
      let processedChunks = 0;
      const maxChunksPerBatch = 5;

      while (
        this.audioBufferQueue.length > 0 &&
        processedChunks < maxChunksPerBatch &&
        this.isActive &&
        this.audioStarted
      ) {
        const audioChunk = this.audioBufferQueue.shift();
        if (audioChunk) {
          await this.client.streamAudioChunk(this.sessionId, audioChunk);
          processedChunks++;
        }
      }
    } finally {
      this.isProcessingAudio = false;

      if (this.audioBufferQueue.length > 0 && this.isActive) {
        setTimeout(() => this.processAudioQueue(), 0);
      }
    }
  }

  /**
   * Get the session ID
   */
  public getSessionId(): string {
    return this.sessionId;
  }

  /**
   * End the current audio content
   */
  public async endAudioContent(): Promise<void> {
    if (!this.isActive) return;
    await this.client.sendContentEnd(this.sessionId);
    this.audioStarted = false;
  }

  /**
   * End the current prompt
   */
  public async endPrompt(): Promise<void> {
    if (!this.isActive) return;
    await this.client.sendPromptEnd(this.sessionId);
    this.promptStarted = false;
  }

  /**
   * Close the session
   */
  public async close(): Promise<void> {
    if (!this.isActive) return;

    this.isActive = false;
    this.audioBufferQueue = [];
    this.isProcessingAudio = false;

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Save session cost summary if cost tracking is enabled
    if (this.usageTracker.isCostTrackingEnabled()) {
      await this.usageTracker.saveSessionCostSummary();
    }

    await this.client.sendSessionEnd(this.sessionId);
    console.log(`Session ${this.sessionId} closed`);
  }

  // ---- Cost Tracking Methods ----

  /**
   * Handle usage events from Nova Sonic
   */
  public handleUsageEvent(usageEvent: any): void {
    const details = usageEvent.details || usageEvent;
    this.usageTracker.onUsageEvent(details);
  }

  /**
   * Handle completion start
   */
  public handleCompletionStart(completionId: string): void {
    this.currentCompletionId = completionId;
    this.usageTracker.onCompletionStart(completionId);
  }

  /**
   * Handle completion end
   */
  public handleCompletionEnd(completionId: string): CompletionDelta {
    const delta = this.usageTracker.computeTurnDelta(completionId);
    const turnCosts = this.usageTracker.calculateTurnCosts(delta);

    // Log turn usage (matching the Python format) only if cost tracking is enabled
    if (this.usageTracker.isCostTrackingEnabled()) {
      console.log("\n=== Turn Usage ===");
      console.log(`completionId: ${completionId}`);
      console.log(`input_speech_tokens:  ${delta.inputSpeech}`);
      console.log(`input_text_tokens:    ${delta.inputText}`);
      console.log(`output_speech_tokens: ${delta.outputSpeech}`);
      console.log(`output_text_tokens:   ${delta.outputText}`);
      console.log(`cost_speech_mode_usd: ${turnCosts.speechModeUsd.toFixed(6)}`);
      console.log(`cost_text_mode_usd:   ${turnCosts.textModeUsd.toFixed(6)}`);
      console.log("==================\n");
    }

    return delta;
  }

  /**
   * Get current token usage
   */
  public getTokenUsage(): TokenUsage {
    return this.usageTracker.getSessionTotals();
  }

  /**
   * Get current cost breakdown
   */
  public getCostBreakdown(): CostBreakdown {
    return this.usageTracker.getRunningCosts();
  }

  /**
   * Get formatted cost
   */
  public getFormattedCost(): string {
    const costs = this.getCostBreakdown();
    return `$${costs.totalCostUsd.toFixed(6)}`;
  }

  /**
   * Get live usage string
   */
  public getLiveUsageString(): string {
    return this.usageTracker.formatLiveUsage();
  }

  /**
   * Check if cost tracking is enabled
   */
  public isCostTrackingEnabled(): boolean {
    return this.usageTracker.isCostTrackingEnabled();
  }

  /**
   * Get session ID
   */
  public getId(): string {
    return this.sessionId;
  }
}
