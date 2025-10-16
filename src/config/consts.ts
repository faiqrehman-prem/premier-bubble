import { AudioType, AudioMediaType, TextMediaType } from "../types/types";
import fs from 'fs';
import path from 'path';

// Environment-based configuration for easier deployments
export const DefaultInferenceConfiguration = {
  maxTokens: parseInt(process.env.MAX_TOKENS || "1024"),
  topP: parseFloat(process.env.TOP_P || "0.9"),
  temperature: parseFloat(process.env.TEMPERATURE || "1"),
};

export const DefaultAudioInputConfiguration = {
  audioType: "SPEECH" as AudioType,
  encoding: "base64",
  mediaType: "audio/lpcm" as AudioMediaType,
  sampleRateHertz: 16000,
  sampleSizeBits: 16,
  channelCount: 1,
};

export const DefaultToolSchema = JSON.stringify({
  type: "object",
  properties: {},
  required: [],
});

export const WeatherToolSchema = JSON.stringify({
  type: "object",
  properties: {
    latitude: {
      type: "string",
      description: "Geographical WGS84 latitude of the location.",
    },
    longitude: {
      type: "string",
      description: "Geographical WGS84 longitude of the location.",
    },
  },
  required: ["latitude", "longitude"],
});

export const DefaultTextConfiguration = {
  mediaType: "text/plain" as TextMediaType,
};

// Knowledge Base configuration - Updated to avoid file dependencies
let kbConfig = { 
  kbId: process.env.KB_ID || "O9GPOSWN9B" // Use environment variable or fallback
};

// Remove file-based loading to avoid JSON parsing errors
// The KB config will be dynamically loaded from DynamoDB by KBConfigManager when needed

export const KnowledgeBaseConfig = kbConfig;

// Log KB config on startup for debugging
console.log(`Knowledge Base ID loaded as: ${KnowledgeBaseConfig.kbId} (from environment or fallback)`);

// Async method to update KB config from DynamoDB
export async function updateKBConfigFromDynamoDB() {
  try {
    const { KBConfigManager } = await import('../services/kb-config-manager');
    const dynamoConfig = await KBConfigManager.getKBConfig();
    
    // Update the in-memory config
    KnowledgeBaseConfig.kbId = dynamoConfig.kbId;
    console.log(`Knowledge Base ID updated from DynamoDB: ${KnowledgeBaseConfig.kbId}`);
    
    return KnowledgeBaseConfig.kbId;
  } catch (error) {
    console.warn('Failed to update KB config from DynamoDB, keeping current value:', error);
    return KnowledgeBaseConfig.kbId;
  }
}

export const DefaultSystemPrompt = process.env.DEFAULT_SYSTEM_PROMPT ||
  "You are a helpful assistant with access to a knowledge base tool (getKnowledgeBaseTool). " +
  "IMPORTANT: When asked about ANY factual information or specific topics like 'bumblebee', you MUST use the getKnowledgeBaseTool first to look up answers. " +
  "The knowledge base has ID: " + KnowledgeBaseConfig.kbId + ". " +
  "Always use the getKnowledgeBaseTool with a JSON payload like this: {\"query\": \"your query here\"}. " +
  "When using the knowledge base tool, provide citations for your sources. " +
  "For conversational queries, respond naturally based on your general knowledge. " +
  "Keep your responses concise and informative. " +
  "The knowledge base contains information about 'bumblebee', so always query for that specifically.";

export const DefaultAudioOutputConfiguration = {
  ...DefaultAudioInputConfiguration,
  sampleRateHertz: parseInt(process.env.AUDIO_SAMPLE_RATE || "24000"),
  voiceId: process.env.DEFAULT_VOICE_ID || "tiffany",
};
