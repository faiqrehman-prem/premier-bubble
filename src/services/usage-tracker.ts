import { PricingService, TokenUsage, CostBreakdown, SessionCostSummary } from './pricing-service';
import fs from 'fs';
import path from 'path';

export interface CompletionDelta {
  inputSpeech: number;
  inputText: number;
  outputSpeech: number;
  outputText: number;
}

export interface CompletionTracking {
  completionId: string;
  startUsage: TokenUsage;
  timestamp: string;
}

export class UsageTracker {
  private sessionId: string;
  private sessionTotals: TokenUsage;
  private completions: Map<string, CompletionTracking>;
  private completionIds: string[];
  private pricingService: PricingService;
  private startTime: string;
  private costTrackingEnabled: boolean;

  constructor(sessionId: string, costTrackingEnabled: boolean = false) {
    this.sessionId = sessionId;
    this.sessionTotals = {
      inputSpeech: 0,
      outputSpeech: 0,
      inputText: 0,
      outputText: 0
    };
    this.completions = new Map();
    this.completionIds = [];
    this.pricingService = new PricingService();
    this.startTime = new Date().toISOString();
    this.costTrackingEnabled = costTrackingEnabled;
  }

  // Handle usage event from Nova Sonic
  onUsageEvent(details: any): void {
    if (!this.costTrackingEnabled) return;

    // Extract token counts from Nova Sonic usage event structure
    let inputSpeechTokens = 0;
    let inputTextTokens = 0;
    let outputSpeechTokens = 0;
    let outputTextTokens = 0;

    // Nova Sonic has a specific structure with 'delta' and 'total' fields
    // We use 'total' for cumulative tracking
    if (details.total) {
      // Extract from total counts
      if (details.total.input) {
        inputSpeechTokens = details.total.input.speechTokens || 0;
        inputTextTokens = details.total.input.textTokens || 0;
      }
      if (details.total.output) {
        outputSpeechTokens = details.total.output.speechTokens || 0;
        outputTextTokens = details.total.output.textTokens || 0;
      }
    }
    
    // Fallback: try delta for incremental updates if total is not available
    if (!details.total && details.delta) {
      if (details.delta.input) {
        inputSpeechTokens = this.sessionTotals.inputSpeech + (details.delta.input.speechTokens || 0);
        inputTextTokens = this.sessionTotals.inputText + (details.delta.input.textTokens || 0);
      }
      if (details.delta.output) {
        outputSpeechTokens = this.sessionTotals.outputSpeech + (details.delta.output.speechTokens || 0);
        outputTextTokens = this.sessionTotals.outputText + (details.delta.output.textTokens || 0);
      }
    }

    // Legacy fallback attempts for other possible structures
    if (inputSpeechTokens === 0 && inputTextTokens === 0 && outputSpeechTokens === 0 && outputTextTokens === 0) {
      // Try direct field access
      if (details.inputTokens) {
        if (details.inputModality === 'audio' || details.inputType === 'speech') {
          inputSpeechTokens = details.inputTokens;
        } else {
          inputTextTokens = details.inputTokens;
        }
      }

      if (details.outputTokens) {
        if (details.outputModality === 'audio' || details.outputType === 'speech') {
          outputSpeechTokens = details.outputTokens;
        } else {
          outputTextTokens = details.outputTokens;
        }
      }

      // Try alternative field names
      inputSpeechTokens += details.inputSpeechTokens || 0;
      inputTextTokens += details.inputTextTokens || 0;
      outputSpeechTokens += details.outputSpeechTokens || 0;
      outputTextTokens += details.outputTextTokens || 0;
      
      // Try another common format
      if (details.usage) {
        inputSpeechTokens += details.usage.inputSpeechTokens || 0;
        inputTextTokens += details.usage.inputTextTokens || 0;
        outputSpeechTokens += details.usage.outputSpeechTokens || 0;
        outputTextTokens += details.usage.outputTextTokens || 0;
      }
    }

    // Update session totals
    this.sessionTotals.inputSpeech = inputSpeechTokens;
    this.sessionTotals.inputText = inputTextTokens;
    this.sessionTotals.outputSpeech = outputSpeechTokens;
    this.sessionTotals.outputText = outputTextTokens;
  }

  // Track completion start
  onCompletionStart(completionId: string): void {
    if (!this.costTrackingEnabled) return;

    this.completions.set(completionId, {
      completionId,
      startUsage: { ...this.sessionTotals },
      timestamp: new Date().toISOString()
    });
    
    if (!this.completionIds.includes(completionId)) {
      this.completionIds.push(completionId);
    }
  }

  // Compute turn delta for completion end
  computeTurnDelta(completionId: string): CompletionDelta {
    if (!this.costTrackingEnabled) {
      return { inputSpeech: 0, inputText: 0, outputSpeech: 0, outputText: 0 };
    }

    const completion = this.completions.get(completionId);
    if (!completion) {
      return { inputSpeech: 0, inputText: 0, outputSpeech: 0, outputText: 0 };
    }

    return {
      inputSpeech: this.sessionTotals.inputSpeech - completion.startUsage.inputSpeech,
      inputText: this.sessionTotals.inputText - completion.startUsage.inputText,
      outputSpeech: this.sessionTotals.outputSpeech - completion.startUsage.outputSpeech,
      outputText: this.sessionTotals.outputText - completion.startUsage.outputText
    };
  }

  // Get session totals
  getSessionTotals(): TokenUsage {
    return { ...this.sessionTotals };
  }

  // Get running costs
  getRunningCosts(): CostBreakdown {
    return this.pricingService.calculateCosts(this.sessionTotals);
  }

  // Calculate turn costs
  calculateTurnCosts(delta: CompletionDelta): { speechModeUsd: number; textModeUsd: number } {
    return this.pricingService.costDualReport(
      delta.inputSpeech, 
      delta.inputText, 
      delta.outputSpeech, 
      delta.outputText
    );
  }

  // Format live usage display
  formatLiveUsage(): string {
    if (!this.costTrackingEnabled) return '';

    const totals = this.getSessionTotals();
    const costs = this.getRunningCosts();
    
    return `LIVE USAGE | ` +
           `in_speech=${totals.inputSpeech} ` +
           `in_text=${totals.inputText} ` +
           `out_speech=${totals.outputSpeech} ` +
           `out_text=${totals.outputText} | ` +
           `$in_speech=${costs.costInputSpeechUsd.toFixed(6)} ` +
           `$in_text=${costs.costInputTextUsd.toFixed(6)} ` +
           `$out_speech=${costs.costOutputSpeechUsd.toFixed(6)} ` +
           `$out_text=${costs.costOutputTextUsd.toFixed(6)}`;
  }

  // Create session cost summary
  createSessionSummary(endTime?: string): SessionCostSummary {
    const end = endTime || new Date().toISOString();
    const startMs = new Date(this.startTime).getTime();
    const endMs = new Date(end).getTime();

    return {
      sessionId: this.sessionId,
      startTime: this.startTime,
      endTime: end,
      durationMs: endMs - startMs,
      tokenUsage: this.getSessionTotals(),
      costBreakdown: this.getRunningCosts(),
      turnCount: this.completionIds.length,
      completionIds: [...this.completionIds]
    };
  }

  // Save session cost summary to JSON file
  async saveSessionCostSummary(endTime?: string): Promise<void> {
    if (!this.costTrackingEnabled) return;

    try {
      // Ensure Costs directory exists
      const costsDir = path.join(process.cwd(), 'Costs');
      if (!fs.existsSync(costsDir)) {
        fs.mkdirSync(costsDir, { recursive: true });
      }

      const summary = this.createSessionSummary(endTime);
      const filename = `${this.sessionId}_cost.json`;
      const filepath = path.join(costsDir, filename);

      fs.writeFileSync(filepath, JSON.stringify(summary, null, 2));
      
      console.log(`\n=== Session Cost Summary Saved ===`);
      console.log(`File: ${filepath}`);
      console.log(`Session ID: ${this.sessionId}`);
      console.log(`Duration: ${(summary.durationMs / 1000).toFixed(2)}s`);
      console.log(`Total Cost: ${this.pricingService.formatCost(summary.costBreakdown.totalCostUsd)}`);
      console.log(`Turns: ${summary.turnCount}`);
      console.log(`==================================\n`);
    } catch (error) {
      console.error('Error saving session cost summary:', error);
    }
  }

  // Check if cost tracking is enabled
  isCostTrackingEnabled(): boolean {
    return this.costTrackingEnabled;
  }
}
