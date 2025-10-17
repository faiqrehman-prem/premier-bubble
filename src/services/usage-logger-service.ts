
import dotenv from 'dotenv';
dotenv.config();

import { UsageTracker } from './usage-tracker';

const USAGE_LOGGER_API_KEY = process.env.USAGE_LOGGER_API_KEY;
const USAGE_LOGGER_URL = 'http://ec2-3-90-209-60.compute-1.amazonaws.com:8000/usage-logs';

export interface LLMCall {
  provider: string;
  model: string;
  purpose: string;
  tokens_input: number;
  tokens_output: number;
  cost: number;
}

export interface UsageLogPayload {
  api_key: string;
  llm_calls: LLMCall[];
  hours_consumed: number;
  session_id: string;
  notes: string;
}

export class UsageLoggerService {
  /**
   * Process session end and log usage data
   * This method is called automatically at the end of each session
   * @param sessionId Session ID  
   * @param session Session object containing usage tracker
   */
  public async processSessionEnd(sessionId: string, session: any): Promise<void> {
    try {
      console.log(`[USAGE LOGGER] Processing session end for: ${sessionId}`);
      
      // Get usage tracker from session
      const tracker = session?.usageTracker;
      if (!tracker) {
        console.warn(`[USAGE LOGGER] No usage tracker found for session ${sessionId}`);
        return;
      }

      await this.logUsageFromTracker(tracker, sessionId);
    } catch (error) {
      console.error(`[USAGE LOGGER] ❌ Failed to process session end for ${sessionId}:`, error);
    }
  }

  /**
   * Log usage for a session using UsageTracker instance
   * @param tracker UsageTracker instance for the session
   * @param sessionId Session ID
   */
  public async logUsageFromTracker(tracker: UsageTracker, sessionId: string): Promise<void> {
    console.log(`[USAGE LOGGER] 🚀 Starting usage logging for session: ${sessionId}`);
    
    if (!USAGE_LOGGER_API_KEY) {
      console.error('[USAGE LOGGER] ❌ API key missing in .env - cannot send usage data');
      return;
    }

    if (!USAGE_LOGGER_URL) {
      console.error('[USAGE LOGGER] ❌ API URL missing - cannot send usage data');
      return;
    }

    console.log(`[USAGE LOGGER] 📊 Calculating usage data for session: ${sessionId}`);

    // Calculate hours consumed from tracker startTime to now
    let hoursConsumed = 0;
    if (tracker && typeof tracker.getStartTime === 'function') {
      const startStr = tracker.getStartTime();
      if (startStr) {
        const start = new Date(startStr).getTime();
        const end = Date.now();
        hoursConsumed = (end - start) / (1000 * 60 * 60);
        console.log(`[USAGE LOGGER] ⏱️ Session duration: ${hoursConsumed.toFixed(4)} hours (${Math.round((end - start) / 1000)} seconds)`);
      } else {
        console.warn('[USAGE LOGGER] ⚠️ No start time available from tracker');
      }
    } else {
      console.warn('[USAGE LOGGER] ⚠️ Invalid tracker or missing getStartTime method');
    }

    // Get token usage and cost breakdown
    const tokens = tracker.getSessionTotals();
    const costs = tracker.getRunningCosts();

    // console.log(`[USAGE LOGGER] 🔍 RAW TRACKER DATA DEBUG:`);
    // console.log(`[USAGE LOGGER] 📊 Tracker object type: ${typeof tracker}, has getSessionTotals: ${typeof tracker.getSessionTotals}`);
    // console.log(`[USAGE LOGGER] 📊 Raw tokens object:`, JSON.stringify(tokens, null, 2));
    // console.log(`[USAGE LOGGER] 💰 Raw costs object:`, JSON.stringify(costs, null, 2));
    
    // // Additional debug - check if tracker has methods we expect
    // console.log(`[USAGE LOGGER] 🔍 Available methods: getSessionTotals=${typeof tracker.getSessionTotals}, getRunningCosts=${typeof tracker.getRunningCosts}, getStartTime=${typeof tracker.getStartTime}`);
    
    // Try to get additional debug info safely
    try {
      const allMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(tracker)).filter(name => 
        typeof (tracker as any)[name] === 'function' && !name.startsWith('_')
      );
      console.log(`[USAGE LOGGER] 🔍 Public tracker methods:`, allMethods);
    } catch (e) {
      console.log(`[USAGE LOGGER] 🔍 Could not enumerate tracker methods`);
    }

    console.log(`[USAGE LOGGER] 🔢 Token usage - Speech Input: ${tokens.inputSpeech}, Speech Output: ${tokens.outputSpeech}, Text Input: ${tokens.inputText}, Text Output: ${tokens.outputText}`);
    console.log(`[USAGE LOGGER] 💰 Total costs - Speech: $${(costs.costInputSpeechUsd + costs.costOutputSpeechUsd).toFixed(6)}, Text: $${(costs.costInputTextUsd + costs.costOutputTextUsd).toFixed(6)}`);

    // Prepare LLM calls for both speech and text
    const llm_calls: LLMCall[] = [
      {
        provider: 'Amazon Bedrock',
        model: 'Nova Sonic',
        purpose: 'Speech Tokens',
        tokens_input: tokens.inputSpeech,
        tokens_output: tokens.outputSpeech,
        cost: parseFloat(costs.costInputSpeechUsd.toFixed(6)) + parseFloat(costs.costOutputSpeechUsd.toFixed(6))
      },
      {
        provider: 'Amazon Bedrock',
        model: 'Nova Sonic',
        purpose: 'Text Tokens',
        tokens_input: tokens.inputText,
        tokens_output: tokens.outputText,
        cost: parseFloat(costs.costInputTextUsd.toFixed(6)) + parseFloat(costs.costOutputTextUsd.toFixed(6))
      }
    ];

    // console.log(`[USAGE LOGGER] 📋 Final LLM calls array:`, JSON.stringify(llm_calls, null, 2));

    const payload: UsageLogPayload = {
      api_key: USAGE_LOGGER_API_KEY,
      llm_calls,
      hours_consumed: hoursConsumed,
      session_id: sessionId,
      notes: 'Nova Sonic Bubble'
    };

    // console.log(`[USAGE LOGGER] 📤 Sending usage data to: ${USAGE_LOGGER_URL}`);
    // console.log(`[USAGE LOGGER] 📋 Payload summary - Session: ${sessionId}, LLM calls: ${llm_calls.length}, Hours: ${hoursConsumed.toFixed(4)}`);

    try {
      const startTime = Date.now();
      const response = await fetch(USAGE_LOGGER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000)
      });
      const responseTime = Date.now() - startTime;

      console.log(`[USAGE LOGGER] 📨 API Response received in ${responseTime}ms - Status: ${response.status} ${response.statusText}`);

      if (response.ok) {
        console.log(`[USAGE LOGGER] ✅ Usage log sent successfully for session: ${sessionId}`);
        
        // Try to read response body for additional info
        try {
          const responseText = await response.text();
          if (responseText && responseText.trim()) {
            console.log(`[USAGE LOGGER] 📄 API Response body: ${responseText.substring(0, 200)}${responseText.length > 200 ? '...' : ''}`);
          }
        } catch (bodyError) {
          console.log('[USAGE LOGGER] 📄 No response body or failed to read response body');
        }
      } else {
        console.error(`[USAGE LOGGER] ❌ Failed to log usage for session ${sessionId} - HTTP ${response.status}: ${response.statusText}`);
        
        // Try to get error details from response
        try {
          const errorText = await response.text();
          if (errorText && errorText.trim()) {
            console.error(`[USAGE LOGGER] 📄 Error response body: ${errorText}`);
          }
        } catch (bodyError) {
          console.error('[USAGE LOGGER] Could not read error response body');
        }
      }
    } catch (error) {
      console.error(`[USAGE LOGGER] ❌ Network/Request error for session ${sessionId}:`, error);
      
      if (error instanceof TypeError && error.message.includes('fetch')) {
        console.error('[USAGE LOGGER] 🌐 This appears to be a network connectivity issue');
      } else if (error instanceof DOMException && error.name === 'AbortError') {
        console.error('[USAGE LOGGER] ⏰ Request timed out (30 seconds)');
      } else {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        console.error(`[USAGE LOGGER] 🔍 Error type: ${errorObj.constructor.name}, Message: ${errorObj.message}`);
      }
    }

    console.log(`[USAGE LOGGER] 🏁 Completed usage logging process for session: ${sessionId}`);
  }
}

export const usageLoggerService = new UsageLoggerService();
