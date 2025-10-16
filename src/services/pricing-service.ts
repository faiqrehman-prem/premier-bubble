// Pricing calculations for Nova Sonic usage

// Pricing constants (per 1,000 tokens)
const SPEECH_INPUT_PER_1K = 0.0034;   // Nova Sonic, speech input
const SPEECH_OUTPUT_PER_1K = 0.0136;  // Nova Sonic, speech output  
const TEXT_INPUT_PER_1K = 0.00006;    // Nova Sonic, text input
const TEXT_OUTPUT_PER_1K = 0.00024;   // Nova Sonic, text output

export interface TokenUsage {
  inputSpeech: number;
  outputSpeech: number;
  inputText: number;
  outputText: number;
}

export interface CostBreakdown {
  costInputSpeechUsd: number;
  costInputTextUsd: number;
  costOutputSpeechUsd: number;
  costOutputTextUsd: number;
  totalCostUsd: number;
}

export interface SessionCostSummary {
  sessionId: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  tokenUsage: TokenUsage;
  costBreakdown: CostBreakdown;
  turnCount: number;
  completionIds: string[];
}

export class PricingService {
  private speechInputPer1k: number;
  private speechOutputPer1k: number;
  private textInputPer1k: number;
  private textOutputPer1k: number;

  constructor(
    speechInputPer1k: number = SPEECH_INPUT_PER_1K,
    speechOutputPer1k: number = SPEECH_OUTPUT_PER_1K,
    textInputPer1k: number = TEXT_INPUT_PER_1K,
    textOutputPer1k: number = TEXT_OUTPUT_PER_1K
  ) {
    this.speechInputPer1k = speechInputPer1k;
    this.speechOutputPer1k = speechOutputPer1k;
    this.textInputPer1k = textInputPer1k;
    this.textOutputPer1k = textOutputPer1k;
  }

  private static cost(tokens: number, per1k: number): number {
    return (tokens / 1000.0) * per1k;
  }

  // Per-direction costs
  costInputSpeech(tokens: number): number {
    return PricingService.cost(tokens, this.speechInputPer1k);
  }

  costOutputSpeech(tokens: number): number {
    return PricingService.cost(tokens, this.speechOutputPer1k);
  }

  costInputText(tokens: number): number {
    return PricingService.cost(tokens, this.textInputPer1k);
  }

  costOutputText(tokens: number): number {
    return PricingService.cost(tokens, this.textOutputPer1k);
  }

  // Calculate running costs from token totals
  calculateCosts(usage: TokenUsage): CostBreakdown {
    const costInputSpeechUsd = this.costInputSpeech(usage.inputSpeech);
    const costInputTextUsd = this.costInputText(usage.inputText);
    const costOutputSpeechUsd = this.costOutputSpeech(usage.outputSpeech);
    const costOutputTextUsd = this.costOutputText(usage.outputText);

    return {
      costInputSpeechUsd,
      costInputTextUsd,
      costOutputSpeechUsd,
      costOutputTextUsd,
      totalCostUsd: costInputSpeechUsd + costInputTextUsd + costOutputSpeechUsd + costOutputTextUsd
    };
  }

  // Mode totals for turn calculations
  costSpeechMode(inputSpeech: number, outputSpeech: number): number {
    return this.costInputSpeech(inputSpeech) + this.costOutputSpeech(outputSpeech);
  }

  costTextMode(inputText: number, outputText: number): number {
    return this.costInputText(inputText) + this.costOutputText(outputText);
  }

  costDualReport(inputSpeech: number, inputText: number, outputSpeech: number, outputText: number): { speechModeUsd: number; textModeUsd: number } {
    return {
      speechModeUsd: this.costSpeechMode(inputSpeech, outputSpeech),
      textModeUsd: this.costTextMode(inputText, outputText)
    };
  }

  // Format cost for display
  formatCost(cost: number): string {
    return `$${cost.toFixed(6)}`;
  }

  // Format cost breakdown for display
  formatCostBreakdown(costs: CostBreakdown): string {
    return `Input Speech: ${this.formatCost(costs.costInputSpeechUsd)} | ` +
           `Input Text: ${this.formatCost(costs.costInputTextUsd)} | ` +
           `Output Speech: ${this.formatCost(costs.costOutputSpeechUsd)} | ` +
           `Output Text: ${this.formatCost(costs.costOutputTextUsd)} | ` +
           `Total: ${this.formatCost(costs.totalCostUsd)}`;
  }
}
