import dotenv from "dotenv";
import express from "express";
import session from "express-session";
import http from "http";
import path from "path";
import fs from "fs";
import { Server } from "socket.io";
import { fromIni } from "@aws-sdk/credential-providers";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import cors from "cors";
import multer from "multer";
import { transcriptService } from "./services/transcript-service";
import { NovaSonicBidirectionalStreamClient } from "./core/client";
import { Buffer } from "node:buffer";
import { ToolHandler } from "./services/tools";
import { availableTools } from "./services/tools";
import { McpManager } from "./services/mcp-manager-v2";
import { McpTool } from "./types/types";
import { DomainValidator } from "./services/domain-validator";
import { ScriptTemplateManager } from "./services/script-template-manager";
import { ToolConfigManager, UserDefinedTool } from "./services/tool-config";
import { WebhookExecutor } from "./services/webhook-executor";
import { ScriptExecutor } from "./services/script-executor";
import { ConfigManager } from "./services/config-manager";
import { KBConfigManager } from "./services/kb-config-manager";
import { updateKBConfigFromDynamoDB } from "./config/consts";
import ingestRouter from "./routes/ingest";
import { requireAuth, requireAuthAPI, handleLogout, getCurrentUser } from "./middleware/auth";
import { postCallWebhookService } from "./services/post-call-webhook-service";
import { usageLoggerService } from "./services/usage-logger-service";

// ---- Initialize DynamoDB client ----
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const APP_CONFIG_TABLE = process.env.APP_CONFIGURATIONS_TABLE || "app_configurations";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

// --- ADD NEAR TOP (after other imports) ---
type SessionArtifacts = {
  transcriptS3Key?: string;
  audioS3Key?: string;
  startTime?: Date;
  session?: any; // Store the session object for usage logging
};
const artifactsBySession = new Map<string, SessionArtifacts>();
const processedSessions = new Set<string>(); // Track sessions that have been fully processed

async function processSessionEndServices(sessionId: string, session?: any) {
  // Check if this session has already been processed
  if (processedSessions.has(sessionId)) {
    console.log(`[SESSION END] Session ${sessionId} already processed, skipping`);
    return;
  }

  const art = artifactsBySession.get(sessionId);
  if (!art?.transcriptS3Key || !art?.audioS3Key || !art?.startTime) {
    console.log(`[SESSION END] Missing data for ${sessionId} - Transcript: ${!!art?.transcriptS3Key}, Audio: ${!!art?.audioS3Key}, StartTime: ${!!art?.startTime}`);
    return;
  }

  try {
    console.log(`[SESSION END] Processing session end services for: ${sessionId}`);
    
    // Debug session object
    console.log(`[SESSION END] 🔍 Session object debug for ${sessionId}:`, {
      sessionProvided: !!session,
      sessionType: session ? typeof session : 'undefined',
      hasUsageTracker: session?.usageTracker ? 'yes' : 'no',
      sessionKeys: session ? Object.keys(session).slice(0, 10) : 'no session'
    });

    // Try to get session from activeSessions if not provided
    if (!session) {
      session = activeSessions.get(sessionId);
      console.log(`[SESSION END] 🔄 Attempted to retrieve session from activeSessions: ${!!session}`);
    }

    // If still no session, try to get it from artifacts (stored during disconnect)
    if (!session && art.session) {
      session = art.session;
      console.log(`[SESSION END] 🔄 Retrieved session from artifacts cache: ${!!session}`);
    }
    
    // Mark as being processed to prevent duplicates
    processedSessions.add(sessionId);

    // 1. FIRST: Process usage logging (sequential, not parallel)
    if (session) {
      console.log(`[SESSION END] ✅ Session available, proceeding with usage logging for: ${sessionId}`);
      await usageLoggerService.processSessionEnd(sessionId, session);
    } else {
      console.warn(`[SESSION END] ⚠️ No session object available for usage logging: ${sessionId}`);
      console.warn(`[SESSION END] 🔍 ActiveSessions count: ${activeSessions.size}, ProcessedSessions count: ${processedSessions.size}`);
    }

    // 2. SECOND: Process webhook (after usage logging completes)
    console.log(`[SESSION END] 📡 Starting webhook processing for: ${sessionId}`);
    await postCallWebhookService.processSessionEnd({
      sessionId,
      startTime: art.startTime,
      transcriptS3Key: art.transcriptS3Key,
      audioS3Key: art.audioS3Key,
      userId: undefined,
    });

    console.log(`[SESSION END] ✅ Both usage logging and webhook completed for ${sessionId}`);

  } catch (e) {
    console.error(`[SESSION END] ❌ Failed processing for ${sessionId}:`, e);
    // Remove from processed set so it can be retried
    processedSessions.delete(sessionId);
    return; // keep artifacts so we can retry on next signal if you add retries later
  }

  // cleanup after successful send
  artifactsBySession.delete(sessionId);
}

// Legacy function for backward compatibility - now uses the new coordinated approach
async function maybeFirePostCallWebhook(sessionId: string) {
  // Don't try to get session from activeSessions here since it might have been removed
  // The processSessionEndServices function will handle missing session gracefully
  await processSessionEndServices(sessionId, undefined);
}


// ---- Geocoding Function ---------------------------------------------------
/**
 * Convert latitude/longitude coordinates to city name using reverse geocoding
 */
async function convertCoordinatesToCity(latitude: number, longitude: number): Promise<any> {
  try {
    // Using OpenStreetMap Nominatim (free, no API key required)
    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10&addressdetails=1`;

    const response = await fetch(nominatimUrl, {
      headers: {
        'User-Agent': 'KB-Layer-Widget/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data || data.error) {
      throw new Error(data?.error || 'No location found');
    }

    // Extract useful location information
    const address = data.address || {};
    const city = address.city || address.town || address.village || address.hamlet;
    const state = address.state || address.province || address.region;
    const country = address.country;
    const postcode = address.postcode;

    return {
      success: true,
      city: city || 'Unknown',
      state: state || 'Unknown',
      country: country || 'Unknown',
      postcode: postcode || 'Unknown',
      displayName: data.display_name,
      fullAddress: address
    };

  } catch (error) {
    console.error('[GEOCODING] Failed to convert coordinates to city:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Geocoding failed',
      city: 'Unknown',
      state: 'Unknown',
      country: 'Unknown'
    };
  }
}

// async function resolveAudioKey(sessionId: string): Promise<string | undefined> {
//   const live = activeSessions.get(sessionId);
//   if (live && (live as any).audioS3Key) return (live as any).audioS3Key;
//   const memo = audioKeyBySession.get(sessionId);
//   return memo?.key;
// }


// Load environment variables from .env file
dotenv.config({ override: false });

// ---- CLI Arguments -------------------------------------------------------
const args = process.argv.slice(2);
const COST_TRACKING_ENABLED = args.includes('--cost');

if (COST_TRACKING_ENABLED) {
  console.log('💰 Cost tracking enabled - session summaries will be saved to Costs/ folder');
} else {
  console.log('ℹ️  Cost tracking disabled - use --cost flag to enable pricing tracking');
}

// ---- AWS / App config -------------------------------------------------------
const AWS_PROFILE_NAME = process.env.AWS_PROFILE || "default";
const AWS_REGION = process.env.AWS_REGION || "us-east-1";

// ---- Express / HTTP / Socket.IO --------------------------------------------
const app = express();

// Trust proxy for proper HTTPS detection when behind reverse proxy
app.set('trust proxy', 1);

// Session configuration for authentication
app.use(session({
  secret: process.env.SESSION_SECRET || 'kb-layer-default-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: 'auto', // Auto-detect based on request protocol (works with trust proxy)
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax', // Allow cross-site requests
    path: '/', // Ensure cookie is available for all paths
  },
  name: 'kb-layer-session'
}));

// Initialize domain validator early for CORS
const domainValidator = new DomainValidator();

// Preload domain configuration cache for CORS validation
domainValidator.getConfigForAdmin().catch(err => {
  console.error('Failed to preload domain configuration:', err);
});

// Dynamic CORS configuration for embedding
const corsOptions = {
  origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    // Allow requests with no origin (like mobile apps or Postman)
    if (!origin) return callback(null, true);

    // Always allow localhost and control panel access
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return callback(null, true);
    }

    // For other origins, check if domain is authorized
    try {
      const url = new URL(origin);
      const validationResult = domainValidator.validateDomainSync({
        domain: url.hostname,
        origin: origin
      });

      callback(null, validationResult.authorized);
    } catch (error) {
      // If validation fails, default to allowing for backward compatibility
      // In production, you might want to be more strict
      callback(null, true);
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
    "Access-Control-Allow-Origin",
    "Access-Control-Allow-Headers",
    "Access-Control-Allow-Methods",
    "Access-Control-Allow-Credentials",
  ],
  exposedHeaders: ["Access-Control-Allow-Origin"],
  preflightContinue: false,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());

// Configure multer for audio file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit for high-quality audio
  }
});

// S3 client for audio uploads
const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: process.env.USE_AWS_PROFILE === 'true'
    ? fromIni({ profile: AWS_PROFILE_NAME })
    : {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
    }
});

// Log ALL requests to debug the routing issue
app.use((req, res, next) => {
  console.log(`🌐 [ALL REQUESTS] ${req.method} ${req.path} - Query:`, req.query);
  next();
});

// Static files with exclusion for control-panel.html and API routes
app.use((req, res, next) => {
  console.log(`[STATIC] Request for: ${req.path}`);

  // Skip static serving for:
  // 1. control-panel.html - needs authentication
  // 2. API routes - should go to API handlers
  // 3. Auth routes - should go to auth handlers
  if (req.path === '/control-panel.html' ||
    req.path.startsWith('/api/') ||
    req.path.startsWith('/auth/')) {
    console.log(`[STATIC] Skipping static for: ${req.path} - passing to specific route handler`);
    return next();
  }

  // Serve other static files
  express.static(path.join(__dirname, "../public"))(req, res, next);
});

// PUBLIC API ROUTES (NO AUTH REQUIRED) - DEFINE EARLY TO AVOID MIDDLEWARE INTERFERENCE
app.get("/api/config", async (_req, res) => {
  console.log("📋 [PUBLIC API] /api/config accessed");
  try {
    // Load configuration from DynamoDB
    const [appConfig, kbConfig] = await Promise.all([
      ConfigManager.getConfig(),
      KBConfigManager.getKBConfig()
    ]);

    res.json({
      systemPrompt: appConfig.systemPrompt || "",
      voice: appConfig.voice || "matthew",
      chunkSize: appConfig.chunkSize || 512,
      enabledTools: appConfig.enabledTools || ["retrieveFromKnowledgeBase"],
      knowledgeBaseId: kbConfig.kbId || null,
      enableBrowserConsole: process.env.ENABLE_BROWSER_CONSOLE === 'true',
    });
  } catch (error) {
    console.error("Error loading configuration from DynamoDB:", error);
    // Return default values if DynamoDB is not available (no file fallback)
    res.json({
      systemPrompt: "",
      voice: "matthew",
      chunkSize: 512,
      enabledTools: ["retrieveFromKnowledgeBase"],
      knowledgeBaseId: null,
      enableBrowserConsole: process.env.ENABLE_BROWSER_CONSOLE === 'true',
    });
  }
});

// Session Audio Upload Endpoint
// app.post("/api/upload-session-audio", upload.single('audio'), async (req, res) => {
//   try {
//     console.log('[AUDIO] Session audio upload request received');

//     if (!req.file) {
//       console.log('[AUDIO] No audio file provided in request');
//       return res.status(400).json({ error: "No audio file provided" });
//     }

//     const { sessionId, startTime, fileSize } = req.body;
//     if (!sessionId) {
//       console.log('[AUDIO] Session ID is required but not provided');
//       return res.status(400).json({ error: "Session ID is required" });
//     }

//     console.log(`[AUDIO] Processing upload for session: ${sessionId}`);
//     console.log(`[AUDIO] File info: ${req.file.originalname}, ${req.file.size} bytes, ${req.file.mimetype}`);

//     // Create S3 key matching transcript location format
//     const uploadDate = startTime ? new Date(startTime) : new Date();
//     const dateStr = uploadDate.toISOString().split('T')[0]; // YYYY-MM-DD
//     const s3Key = `premiernx-bubble-transcripts/${dateStr}/${req.file.originalname}`;

//     console.log(`[AUDIO] S3 destination: s3://${process.env.S3_BUCKET || 'ai-tools-bucket-18052025'}/${s3Key}`);

//     // Upload to S3
//     const uploadCommand = new PutObjectCommand({
//       Bucket: process.env.S3_BUCKET || 'ai-tools-bucket-18052025',
//       Key: s3Key,
//       Body: req.file.buffer,
//       ContentType: req.file.mimetype,
//       Metadata: {
//         sessionId: sessionId,
//         uploadedAt: new Date().toISOString(),
//         fileSize: req.file.size.toString(),
//         originalName: req.file.originalname,
//         startTime: startTime || '',
//         audioFormat: req.file.mimetype
//       }
//     });

//     await s3Client.send(uploadCommand);

//     // Record the audio S3 key for this session in memory and on the live session (if present)
//     const nowIso = new Date().toISOString();
//     audioKeyBySession.set(sessionId, { key: s3Key, uploadedAt: nowIso });

//     const liveSession = activeSessions.get(sessionId);
//     if (liveSession) {
//       (liveSession as any).audioS3Key = s3Key;

//       // If client provided a startTime and we don't already have one, persist it for duration calc
//       if (startTime && !(liveSession as any).startTime) {
//         (liveSession as any).startTime = new Date(startTime);
//       }
//     }

//     const uploadSizeKB = Math.round(req.file.size / 1024);
//     const uploadSizeMB = (req.file.size / 1024 / 1024).toFixed(2);

//     console.log(`[AUDIO] ✅ Successfully uploaded session audio: ${s3Key}`);
//     console.log(`[AUDIO] File size: ${uploadSizeMB} MB (${uploadSizeKB} KB)`);
//     console.log(`[AUDIO] Recorded audio key for session ${sessionId} at ${nowIso}`);

//     res.json({
//       success: true,
//       s3Key: s3Key,
//       sessionId: sessionId,
//       fileSize: req.file.size,
//       fileSizeMB: uploadSizeMB,
//       bucket: process.env.S3_BUCKET || 'ai-tools-bucket-18052025',
//       uploadedAt: nowIso
//     });

//   } catch (error) {
//     console.error("[AUDIO] ❌ Failed to upload session audio:", error);
//     res.status(500).json({
//       error: "Failed to upload audio file",
//       details: error instanceof Error ? error.message : 'Unknown error'
//     });
//   }
// });

// Session Audio Upload Endpoint
app.post("/api/upload-session-audio", upload.single("audio"), async (req, res) => {
  try {
    console.log("[AUDIO] Session audio upload request received");

    if (!req.file) {
      console.log("[AUDIO] No audio file provided in request");
      return res.status(400).json({ error: "No audio file provided" });
    }

    const { sessionId, startTime } = req.body;
    if (!sessionId) {
      console.log("[AUDIO] Session ID is required but not provided");
      return res.status(400).json({ error: "Session ID is required" });
    }

    console.log(`[AUDIO] Processing upload for session: ${sessionId}`);
    console.log(
      `[AUDIO] File info: ${req.file.originalname}, ${req.file.size} bytes, ${req.file.mimetype}`
    );

    // Extra logging for debugging audio corruption
    console.log(`[AUDIO] Buffer type: ${typeof req.file.buffer}, Buffer instanceof Buffer: ${req.file.buffer instanceof Buffer}`);
    console.log(`[AUDIO] Buffer length: ${req.file.buffer.length}`);
    console.log(`[AUDIO] Buffer first 16 bytes:`, req.file.buffer.slice(0, 16));
    console.log(`[AUDIO] ContentType: ${req.file.mimetype}`);

    // Build S3 key aligned with transcript layout
    const uploadDate = startTime ? new Date(startTime) : new Date();
    const dateStr = uploadDate.toISOString().split("T")[0]; // YYYY-MM-DD
    const s3Key = `premiernx-bubble-transcripts/${dateStr}/${req.file.originalname}`;

    console.log(
      `[AUDIO] S3 destination: s3://${process.env.S3_BUCKET || "ai-tools-bucket-18052025"}/${s3Key}`
    );

    // Upload to S3
    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET || "ai-tools-bucket-18052025",
      Key: s3Key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      Metadata: {
        sessionId,
        uploadedAt: new Date().toISOString(),
        fileSize: String(req.file.size),
        originalName: req.file.originalname,
        startTime: startTime || "",
        audioFormat: req.file.mimetype,
      },
    });

    await s3Client.send(uploadCommand);

    // Record artifact independent of live session
    const art = artifactsBySession.get(sessionId) || {};
    art.audioS3Key = s3Key;
    if (startTime && !art.startTime) art.startTime = new Date(startTime);
    artifactsBySession.set(sessionId, art);

    // Best-effort trigger (fires only when both audio + transcript exist)
    maybeFirePostCallWebhook(sessionId).catch(() => {});

    // Also reflect on live session if it still exists (optional compatibility)
    const liveSession = activeSessions.get(sessionId);
    if (liveSession) {
      (liveSession as any).audioS3Key = s3Key;
      if (startTime && !(liveSession as any).startTime) {
        (liveSession as any).startTime = new Date(startTime);
      }
    }

    const uploadSizeKB = Math.round(req.file.size / 1024);
    const uploadSizeMB = (req.file.size / 1024 / 1024).toFixed(2);

    console.log(`[AUDIO] ✅ Successfully uploaded session audio: ${s3Key}`);
    console.log(`[AUDIO] File size: ${uploadSizeMB} MB (${uploadSizeKB} KB)`);

    const nowIso = new Date().toISOString();
    res.json({
      success: true,
      s3Key,
      sessionId,
      fileSize: req.file.size,
      fileSizeMB: uploadSizeMB,
      bucket: process.env.S3_BUCKET || "ai-tools-bucket-18052025",
      uploadedAt: nowIso,
    });
  } catch (error) {
    console.error("[AUDIO] ❌ Failed to upload session audio:", error);
    res.status(500).json({
      error: "Failed to upload audio file",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});


const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:3001",
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
    ],
  },
  allowEIO3: true,
  transports: ["websocket", "polling"],
});

// ---- MCP / Tools ------------------------------------------------------------
const toolHandler = new ToolHandler();
const mcpManager = new McpManager(toolHandler);

(async () => {
  try {
    await mcpManager.initializeServers();
  } catch (error) {
    console.error("MCP server init failed:", error);
  }
})();

// Initialize user-defined tools
(async () => {
  try {
    console.log('[SERVER] Loading user-defined tools...');
    await toolHandler.loadUserDefinedTools();
    console.log('[SERVER] User-defined tools loaded successfully');
  } catch (error) {
    console.error("[SERVER] User-defined tools init failed:", error);
  }
})();

// ---- Bedrock client ---------------------------------------------------------
let bedrockClient: NovaSonicBidirectionalStreamClient;

(async () => {
  try {
    let credentials;

    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      };
    } else if (process.env.USE_AWS_PROFILE === "true") {
      const credProvider = fromIni({ profile: AWS_PROFILE_NAME });
      credentials = await credProvider();
    } 
    //   else {
    //   // Hardcode credentials from AWS credentials file for testing
    //   credentials = {
    //     accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    //     secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    //   };
    // }

    bedrockClient = new NovaSonicBidirectionalStreamClient(
      {
        requestHandlerConfig: {
          maxConcurrentStreams: parseInt(
            process.env.MAX_CONCURRENT_STREAMS || "10",
            10
          ),
        },
        clientConfig: {
          region: AWS_REGION,
          credentials,
        },
      },
      toolHandler
    );
  } catch (error) {
    console.error("Bedrock client init error:", error);
    process.exit(1);
  }
})();

// ---- Session GC -------------------------------------------------------------
const SESSION_CLEANUP_INTERVAL = parseInt(
  process.env.SESSION_CLEANUP_INTERVAL || "60000",
  10
);
const SESSION_TIMEOUT = parseInt(process.env.SESSION_TIMEOUT || "300000", 10);

setInterval(() => {
  const now = Date.now();
  bedrockClient.getActiveSessions().forEach((sessionId) => {
    const lastActivity = bedrockClient.getLastActivityTime(sessionId);
    if (now - lastActivity > SESSION_TIMEOUT) {
      try {
        bedrockClient.forceCloseSession(sessionId);
      } catch (error) {
        console.error(
          `Force-close failed for inactive session ${sessionId}:`,
          error
        );
      }
    }
  });
}, SESSION_CLEANUP_INTERVAL);

// Create a map to store session objects for voice updates
const activeSessions = new Map<string, any>();
// Persist audio key per session even if the Socket.IO session object is gone
// const audioKeyBySession = new Map<string, { key: string; uploadedAt: string }>();

// Track cumulative totals across all sessions
let cumulativeTotals = {
  tokens: {
    inputSpeech: 0,
    outputSpeech: 0,
    inputText: 0,
    outputText: 0
  },
  totalCost: 0,
  sessionCount: 0
};

// ---- Socket.IO --------------------------------------------------------------
io.on("connection", async (socket) => {
  const sessionId = socket.id;
  const referer = socket.handshake.headers.referer || '';
  const isControlPanel = referer.includes('control-panel.html');

  console.log(`[DEBUG] New Socket.IO connection: ${sessionId} from ${socket.handshake.address}`);
  console.log(`[DEBUG] Referer header: "${referer}"`);
  console.log(`[DEBUG] Is control panel: ${isControlPanel}`);

  if (isControlPanel) {
    console.log(`[DEBUG] Control panel connection - no Nova Sonic session created for ${sessionId}`);

    // Send initial cumulative totals to new control panel
    socket.emit("cumulativeUpdate", {
      cumulative: cumulativeTotals,
      sessionEnded: null
    });

    // Control panel connections only get cost updates, no session creation
    socket.on("disconnect", () => {
      console.log(`[DEBUG] Control panel ${sessionId} disconnected`);
    });

    return; // Exit early for control panel connections
  }

  try {
    const session = bedrockClient.createStreamSession(sessionId, undefined, COST_TRACKING_ENABLED);
    (session as any)._promptStartPromise = null as null | Promise<void>;

    // Capture IP address from connection with enhanced detection
    const forwardedFor = socket.handshake.headers['x-forwarded-for'];
    const realIP = socket.handshake.headers['x-real-ip'];
    const socketAddress = socket.handshake.address;
    const remoteAddress = socket.conn.remoteAddress;

    console.log(`[DEBUG] IP Detection for session ${sessionId}:`, {
      'x-forwarded-for': forwardedFor,
      'x-real-ip': realIP,
      'handshake.address': socketAddress,
      'conn.remoteAddress': remoteAddress
    });

    let clientIP = 'unknown';
    if (forwardedFor) {
      clientIP = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor.split(',')[0].trim();
    } else if (realIP) {
      clientIP = Array.isArray(realIP) ? realIP[0] : realIP;
    } else if (socketAddress) {
      clientIP = socketAddress;
    } else if (remoteAddress) {
      clientIP = remoteAddress;
    }

    // Store connection metadata in session (similar to userLocation)
    (session as any).connectionInfo = {
      ip: clientIP,
      userAgent: socket.handshake.headers['user-agent'] || 'unknown',
      connectedAt: new Date().toISOString(),
      referer: socket.handshake.headers.referer || 'direct',
      // Store all detected IPs for debugging
      detectedIPs: {
        forwardedFor,
        realIP,
        socketAddress,
        remoteAddress
      }
    };

    console.log(`[DEBUG] Connection info stored for session ${sessionId}:`, {
      ip: (session as any).connectionInfo.ip,
      userAgent: (session as any).connectionInfo.userAgent?.substring(0, 50) + '...',
      referer: (session as any).connectionInfo.referer
    });

    // Store the session for potential voice updates
    activeSessions.set(sessionId, session);

    // Store session start time for transcript
    (session as any).startTime = new Date();

    // Initialize transcript tracking for the session
    transcriptService.initializeSession(sessionId);

    // Set session context for tools to access session data (after connectionInfo is added)
    toolHandler.setSessionContext(activeSessions, sessionId);
    console.log(`[DEBUG] Created Nova Sonic session for ${sessionId}, total active sessions: ${activeSessions.size}`);

    // Load voice configuration from DynamoDB and apply it to the session
    try {
      const voiceFromConfig = await ConfigManager.getVoice();
      session.setVoiceId(voiceFromConfig);
      console.log(`Session ${sessionId} initialized with voice: ${voiceFromConfig}`);
    } catch (error) {
      console.error(`Failed to load voice config for session ${sessionId}:`, error);
      session.setVoiceId("matthew"); // fallback voice
      console.log(`Session ${sessionId} using fallback voice: matthew`);
    }

    bedrockClient.initiateSession(sessionId);

    // Periodic connection count logging
    setInterval(() => {
      const count = Object.keys(io.sockets.sockets).length;
      console.log(`Active sockets: ${count}`);
    }, 60000);

    session.onEvent("contentStart", (data) => socket.emit("contentStart", data));
    session.onEvent("textOutput", (data) => {
      socket.emit("textOutput", data);
      // Capture both user input and assistant responses for transcript
      if (data.content) {
        if (data.role === 'user' || data.role === 'USER') {
          transcriptService.addUserInput(sessionId, data.content);
        } else if (data.role === 'assistant' || data.role === 'ASSISTANT') {
          transcriptService.addAssistantResponse(sessionId, data.content);
        } else {
          // Default to assistant if role is unclear
          transcriptService.addAssistantResponse(sessionId, data.content);
        }
      }
    });
    session.onEvent("audioOutput", (data) => socket.emit("audioOutput", data));
    session.onEvent("error", (data) => socket.emit("error", data));
    session.onEvent("toolUse", (data) => socket.emit("toolUse", data));
    session.onEvent("toolResult", (data) => socket.emit("toolResult", data));
    session.onEvent("contentEnd", (data) => socket.emit("contentEnd", data));
    session.onEvent("streamComplete", () => socket.emit("streamComplete"));
    session.onEvent("liveUsageUpdate", (data) => {
      // Transform the data to match the frontend expectation
      const costData = {
        tokens: data.tokenUsage,
        totalCost: data.costBreakdown?.totalCostUsd || 0,
        sessionActive: true,
        sessionId: sessionId
      };

      // Broadcast to all connected sockets (including control panels)
      io.emit("costUpdate", costData);
    });

    socket.on("audioInput", async (audioData) => {
      try {
        const audioBuffer =
          typeof audioData === "string"
            ? Buffer.from(audioData, "base64")
            : Buffer.from(audioData);
        await session.streamAudio(audioBuffer);
      } catch (error) {
        console.error("audioInput error:", error);
        socket.emit("error", {
          message: "Error processing audio",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // promptStart
    socket.on("promptStart", async () => {
      try {
        // start and store the promise so others can await it
        (session as any)._promptStartPromise = session.setupPromptStart();
        await (session as any)._promptStartPromise;
      } catch (error) {
        console.error("promptStart error:", error);
        socket.emit("error", {
          message: "Error processing prompt start",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // systemPrompt
    socket.on("systemPrompt", async (data: string) => {
      try {
        // if promptStart hasn't been called yet, kick it off now
        if (!(session as any)._promptStartPromise) {
          (session as any)._promptStartPromise = session.setupPromptStart();
        }
        await (session as any)._promptStartPromise;

        await session.setupSystemPrompt(undefined, data);
      } catch (error) {
        console.error("systemPrompt error:", error);
        socket.emit("error", {
          message: "Error processing system prompt",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // audioStart
    socket.on("audioStart", async () => {
      try {
        // ensure promptStart is finished before starting audio
        if (!(session as any)._promptStartPromise) {
          (session as any)._promptStartPromise = session.setupPromptStart();
        }
        await (session as any)._promptStartPromise;

        await session.setupStartAudio();
      } catch (error) {
        console.error("audioStart error:", error);
        socket.emit("error", {
          message: "Error processing audio start",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    });


    socket.on("voiceConfig", async (data) => {
      try {
        if (data && data.voiceId) {
          session.setVoiceId(data.voiceId);
          socket.emit("voiceConfigConfirmed", { voiceId: data.voiceId });
        }
      } catch (error) {
        console.error("voiceConfig error:", error);
        socket.emit("error", {
          message: "Error processing voice configuration",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    });

    socket.on("session-location", async (locationData) => {
      try {
        if (locationData && locationData.latitude && locationData.longitude) {
          console.log(`[LOCATION] Received coordinates for session ${sessionId}: ${locationData.latitude}, ${locationData.longitude}`);

          // Convert coordinates to city name automatically
          const cityInfo = await convertCoordinatesToCity(locationData.latitude, locationData.longitude);

          // Store comprehensive location data in the session object
          (session as any).userLocation = {
            latitude: locationData.latitude,
            longitude: locationData.longitude,
            accuracy: locationData.accuracy,
            timestamp: locationData.timestamp || Date.now(),
            // Add geocoded city information
            city: cityInfo.city,
            state: cityInfo.state,
            country: cityInfo.country,
            postcode: cityInfo.postcode,
            displayName: cityInfo.displayName,
            geocodingSuccess: cityInfo.success,
            geocodingError: cityInfo.error
          };

          console.log(`[LOCATION] Location data stored for session ${sessionId}:`, {
            coordinates: `${locationData.latitude}, ${locationData.longitude}`,
            city: cityInfo.city,
            state: cityInfo.state,
            country: cityInfo.country,
            geocodingSuccess: cityInfo.success
          });

          // Update session context for tools to access the new location data
          toolHandler.setSessionContext(activeSessions, sessionId);
        }
      } catch (error) {
        console.error("session-location error:", error);
        socket.emit("error", {
          message: "Error processing location data",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Handle domain information from client
    socket.on("session-domain", async (domainData) => {
      try {
        if (domainData && domainData.domain) {
          // Store domain data in the session object
          (session as any).domainInfo = {
            domain: domainData.domain,
            protocol: domainData.protocol,
            port: domainData.port,
            pathname: domainData.pathname,
            timestamp: Date.now()
          };
          console.log(`Domain info stored for session ${sessionId}:`, (session as any).domainInfo);
        }
      } catch (error) {
        console.error("session-domain error:", error);
        socket.emit("error", {
          message: "Error processing domain data",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    });

    socket.on("stopAudio", async () => {
      try {
        await session.endAudioContent();
        await new Promise((r) => setTimeout(r, 300));
        await session.endPrompt();
        await new Promise((r) => setTimeout(r, 300));
        await session.close();
        await new Promise((r) => setTimeout(r, 300));
      } catch (error) {
        console.error("stopAudio error:", error);
        socket.emit("error", {
          message: "Error processing streaming end events",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Cost tracking socket handlers (only active when --cost flag is used)
    if (COST_TRACKING_ENABLED) {
      // Get current session pricing
      socket.on('getSessionPricing', () => {
        if (session.isCostTrackingEnabled()) {
          socket.emit('sessionPricingUpdate', {
            sessionId: sessionId,
            tokenUsage: session.getTokenUsage(),
            costBreakdown: session.getCostBreakdown(),
            formattedCost: session.getFormattedCost(),
            costTrackingEnabled: true
          });
        }
      });

      // Send cost tracking status to client
      socket.emit('costTrackingStatus', { enabled: true });
    } else {
      socket.emit('costTrackingStatus', { enabled: false });
    }

    // socket.on("disconnect", async () => {
    //   // Capture final session totals before cleanup
    //   if (COST_TRACKING_ENABLED && bedrockClient.isSessionActive(sessionId)) {
    //     try {
    //       const sessionTotals = session.getTokenUsage();
    //       const sessionCosts = session.getCostBreakdown();

    //       // Add to cumulative totals
    //       cumulativeTotals.tokens.inputSpeech += sessionTotals.inputSpeech;
    //       cumulativeTotals.tokens.outputSpeech += sessionTotals.outputSpeech;
    //       cumulativeTotals.tokens.inputText += sessionTotals.inputText;
    //       cumulativeTotals.tokens.outputText += sessionTotals.outputText;
    //       cumulativeTotals.totalCost += sessionCosts.totalCostUsd;
    //       cumulativeTotals.sessionCount += 1;

    //       // Broadcast final cumulative totals to control panels
    //       io.emit("cumulativeUpdate", {
    //         cumulative: cumulativeTotals,
    //         sessionEnded: sessionId
    //       });
    //     } catch (error) {
    //       console.error(`Error capturing session totals for ${sessionId}:`, error);
    //     }
    //   }

    //   // Save and upload transcript before session cleanup
    //   let transcriptResult: any = null;
    //   try {
    //     const sessionStartTime = (session as any).startTime || new Date();
    //     transcriptResult = await transcriptService.saveAndUploadTranscript(sessionId, sessionStartTime);
    //     if (transcriptResult.success && transcriptResult.s3Key) {
    //       console.log(`[SESSION CLEANUP] Transcript saved to S3: ${transcriptResult.s3Key}`);
    //     }
    //   } catch (error) {
    //     console.error(`[SESSION CLEANUP] Failed to save transcript for session ${sessionId}:`, error);
    //   }

    //   // Process post-call webhook (after transcript is saved)
    //   try {
    //     // Try to obtain the audio key from the live session or fallback map.
    //     let audioS3Key = await resolveAudioKey(sessionId);

    //     // Short, bounded retry in case the upload finishes moments after disconnect (max ~900ms).
    //     for (let i = 0; !audioS3Key && i < 3; i++) {
    //       await new Promise((r) => setTimeout(r, 300));
    //       audioS3Key = await resolveAudioKey(sessionId);
    //     }

    //     const sessionStartTime = (session as any).startTime || new Date();

    //     if (transcriptResult?.success && transcriptResult.s3Key && audioS3Key) {
    //       await postCallWebhookService.processSessionEnd({
    //         sessionId: sessionId,
    //         startTime: sessionStartTime,
    //         transcriptS3Key: transcriptResult.s3Key,
    //         audioS3Key: audioS3Key,
    //         userId: undefined,
    //       });
    //       console.log(`[SESSION CLEANUP] Post-call webhook sent for ${sessionId}`);
    //     } else {
    //       console.log(
    //         `[SESSION CLEANUP] Skipping webhook - missing data. Transcript: ${!!transcriptResult?.s3Key}, Audio: ${!!audioS3Key}`
    //       );
    //     }
    //   } catch (error) {
    //     console.error(
    //       `[SESSION CLEANUP] Failed to process post-call webhook for session ${sessionId}:`,
    //       error
    //     );
    //   } finally {
    //     // Best-effort cleanup for the cached audio key
    //     audioKeyBySession.delete(sessionId);
    //   }

    //   // Remove session from our active sessions map
    //   activeSessions.delete(sessionId);

    //   if (bedrockClient.isSessionActive(sessionId)) {
    //     try {
    //       const cleanup = Promise.race([
    //         (async () => {
    //           await session.endAudioContent();
    //           await session.endPrompt();
    //           await session.close();
    //         })(),
    //         new Promise((_, reject) =>
    //           setTimeout(() => reject(new Error("cleanup timeout")), 3000)
    //         ),
    //       ]);
    //       await cleanup;
    //     } catch (error) {
    //       console.error(`disconnect cleanup error for ${socket.id}:`, error);
    //       try {
    //         bedrockClient.forceCloseSession(sessionId);
    //       } catch (e) {
    //         console.error(`forceClose failed for ${sessionId}:`, e);
    //       }
    //     } finally {
    //       if (socket.connected) socket.disconnect(true);
    //     }
    //   }
    // });
    socket.on("disconnect", async () => {
  // 1) Cost tracking aggregation (if enabled)
  if (COST_TRACKING_ENABLED && bedrockClient.isSessionActive(sessionId)) {
    try {
      const sessionTotals = session.getTokenUsage();
      const sessionCosts = session.getCostBreakdown();

      cumulativeTotals.tokens.inputSpeech += sessionTotals.inputSpeech;
      cumulativeTotals.tokens.outputSpeech += sessionTotals.outputSpeech;
      cumulativeTotals.tokens.inputText += sessionTotals.inputText;
      cumulativeTotals.tokens.outputText += sessionTotals.outputText;
      cumulativeTotals.totalCost += sessionCosts.totalCostUsd;
      cumulativeTotals.sessionCount += 1;

      io.emit("cumulativeUpdate", {
        cumulative: cumulativeTotals,
        sessionEnded: sessionId,
      });
    } catch (err) {
      console.error(`[DISCONNECT] Cost aggregation failed for ${sessionId}:`, err);
    }
  }

  // 2) Persist transcript to S3
  let transcriptResult: { success?: boolean; s3Key?: string } = {};
  try {
    const sessionStartTime = (session as any).startTime || new Date();
    transcriptResult = await transcriptService.saveAndUploadTranscript(sessionId, sessionStartTime);
    if (transcriptResult.success && transcriptResult.s3Key) {
      console.log(`[SESSION CLEANUP] Transcript saved to S3: ${transcriptResult.s3Key}`);

      // mirror into artifact cache for cross-event orchestration
      const art = artifactsBySession.get(sessionId) || {};
      art.transcriptS3Key = transcriptResult.s3Key;
      if (!art.startTime) art.startTime = sessionStartTime;
      // IMPORTANT: Store the session object for usage logging before it gets removed
      art.session = session;
      artifactsBySession.set(sessionId, art);
    }
  } catch (err) {
    console.error(`[SESSION CLEANUP] Failed to save transcript for ${sessionId}:`, err);
  }

  // 3) Coordinate both usage logging and webhook services (sequential, not duplicate)
  try {
    // Use the new coordinated function to avoid duplicates
    await processSessionEndServices(sessionId, session);
  } catch (err) {
    console.error(`[SESSION CLEANUP] Coordinated session end services failed for ${sessionId}:`, err);
  }

  // 4) Remove from active sessions and close Bedrock stream
  activeSessions.delete(sessionId);

  if (bedrockClient.isSessionActive(sessionId)) {
    try {
      const cleanup = Promise.race([
        (async () => {
          await session.endAudioContent();
          await session.endPrompt();
          await session.close();
        })(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("cleanup timeout")), 3000)),
      ]);
      await cleanup;
    } catch (err) {
      console.error(`disconnect cleanup error for ${socket.id}:`, err);
      try {
        bedrockClient.forceCloseSession(sessionId);
      } catch (e) {
        console.error(`forceClose failed for ${sessionId}:`, e);
      }
    } finally {
      if (socket.connected) socket.disconnect(true);
    }
  }
});

  } catch (error) {
    console.error("Session creation error:", error);
    socket.emit("error", {
      message: "Failed to initialize session",
      details: error instanceof Error ? error.message : String(error),
    });
    socket.disconnect();
  }
});

// ---- Domain Validation API -------------------------------------------------
app.post("/api/validate-domain", async (req, res) => {
  try {
    // Enhanced security validation
    const { domain, origin, referer } = req.body;

    // Check required fields
    if (!domain || !origin) {
      return res.status(400).json({
        authorized: false,
        error: "Missing required fields: domain and origin"
      });
    }

    // Validate request headers for CSRF protection
    const xRequestedWith = req.headers['x-requested-with'];
    const xNovaAgent = req.headers['x-nova-agent'];

    if (xRequestedWith !== 'XMLHttpRequest' || xNovaAgent !== 'widget-loader') {
      return res.status(403).json({
        authorized: false,
        error: "Invalid request headers"
      });
    }

    // Validate domain format
    if (!/^[a-zA-Z0-9.-]+$/.test(domain)) {
      return res.status(400).json({
        authorized: false,
        error: "Invalid domain format"
      });
    }

    // Validate origin format
    if (!/^https?:\/\/[a-zA-Z0-9.-]+(:[0-9]+)?$/.test(origin)) {
      return res.status(400).json({
        authorized: false,
        error: "Invalid origin format"
      });
    }

    // Rate limiting check (basic)
    const clientIP = req.ip || req.connection.remoteAddress;
    // TODO: Implement proper rate limiting with Redis or memory store

    const validationResult = await domainValidator.validateDomain({
      domain,
      origin,
      referer
    });

    // Log validation attempt for security monitoring
    console.log(`[SECURITY] Domain validation: ${domain} from ${clientIP} - ${validationResult.authorized ? 'AUTHORIZED' : 'DENIED'}`);

    // If authorized, include the appropriate script tag in the response
    if (validationResult.authorized) {
      const fullServerUrl = `${req.protocol}://${req.get('host')}`;
      const scriptResult = await domainValidator.getDomainScript(domain, fullServerUrl);

      if (scriptResult) {
        res.json({
          authorized: true,
          scriptTag: scriptResult.script,
          scriptType: scriptResult.scriptType,
          widgetScript: scriptResult.scriptType === 'default' ? `${fullServerUrl}/embed-widget.js` : null
        });
      } else {
        // Fallback to default script
        res.json({
          authorized: true,
          scriptTag: `<script src="${fullServerUrl}/embed-widget.js" async defer></script>`,
          scriptType: 'default',
          widgetScript: `${fullServerUrl}/embed-widget.js`
        });
      }
    } else {
      res.json(validationResult);
    }
  } catch (error) {
    console.error("Domain validation error:", error);
    res.status(500).json({
      authorized: false,
      error: "Internal server error"
    });
  }
});

// ---- Domain Management API (Admin) ------------------------------------------
// Get authorized domains
app.get("/api/admin/domains", requireAuthAPI, async (req, res) => {
  try {
    const config = await domainValidator.getConfigForAdmin();
    res.json({
      authorized_domains: config.authorized_domains || [],
      settings: config.settings || {}
    });
  } catch (error) {
    console.error("Error getting domains:", error);
    res.status(500).json({
      error: "Failed to load domains"
    });
  }
});

// Add domain to authorized list
app.post("/api/admin/domains", requireAuthAPI, async (req, res) => {
  try {
    const { domain } = req.body;

    if (!domain || typeof domain !== 'string') {
      return res.status(400).json({
        error: "Domain is required and must be a string"
      });
    }

    // Validate domain format
    const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/;
    if (!domainRegex.test(domain)) {
      return res.status(400).json({
        error: "Invalid domain format"
      });
    }

    if (domain.length > 253) {
      return res.status(400).json({
        error: "Domain name too long"
      });
    }

    const normalizedDomain = domain.toLowerCase().trim();

    // Add domain using the domain validator
    const success = await domainValidator.addAuthorizedDomain(normalizedDomain);

    if (!success) {
      return res.status(409).json({
        error: "Domain already exists in authorized list"
      });
    }

    console.log(`[ADMIN] Domain added: ${normalizedDomain} by ${req.ip}`);

    res.json({
      success: true,
      domain: normalizedDomain,
      message: "Domain added successfully"
    });
  } catch (error) {
    console.error("Error adding domain:", error);
    res.status(500).json({
      error: "Failed to add domain"
    });
  }
});

// Remove domain from authorized list
app.delete("/api/admin/domains", requireAuthAPI, async (req, res) => {
  try {
    const { domain } = req.body;

    if (!domain || typeof domain !== 'string') {
      return res.status(400).json({
        error: "Domain is required and must be a string"
      });
    }

    const normalizedDomain = domain.toLowerCase().trim();

    // Remove domain using the domain validator
    const success = await domainValidator.removeAuthorizedDomain(normalizedDomain);

    if (!success) {
      return res.status(404).json({
        error: "Domain not found in authorized list"
      });
    }

    console.log(`[ADMIN] Domain removed: ${normalizedDomain} by ${req.ip}`);

    res.json({
      success: true,
      domain: normalizedDomain,
      message: "Domain removed successfully"
    });
  } catch (error) {
    console.error("Error removing domain:", error);
    res.status(500).json({
      error: "Failed to remove domain"
    });
  }
});

// Toggle domain enabled/disabled status
app.put("/api/admin/domains/:domain/toggle", requireAuthAPI, async (req, res) => {
  try {
    const { domain } = req.params;

    if (!domain || typeof domain !== 'string') {
      return res.status(400).json({
        error: "Domain is required and must be a string"
      });
    }

    const normalizedDomain = decodeURIComponent(domain.toLowerCase().trim());

    // Toggle domain status using the domain validator
    const result = await domainValidator.toggleDomainStatus(normalizedDomain);

    if (!result.success) {
      return res.status(404).json({
        error: result.error || "Domain not found in authorized list"
      });
    }

    console.log(`[ADMIN] Domain ${result.enabled ? 'enabled' : 'disabled'}: ${normalizedDomain} by ${req.ip}`);

    res.json({
      success: true,
      domain: normalizedDomain,
      enabled: result.enabled,
      message: `Domain ${result.enabled ? 'enabled' : 'disabled'} successfully`
    });
  } catch (error) {
    console.error("Error toggling domain:", error);
    res.status(500).json({
      error: "Failed to toggle domain status"
    });
  }
});

// Update domain script type
app.put("/api/admin/domains/:domain/script-type", requireAuthAPI, async (req, res) => {
  try {
    const { domain } = req.params;
    const { scriptType } = req.body;

    if (!domain || typeof domain !== 'string') {
      return res.status(400).json({
        error: "Domain is required and must be a string"
      });
    }

    if (!scriptType || typeof scriptType !== 'string') {
      return res.status(400).json({
        error: "Script type is required and must be a string"
      });
    }

    const normalizedDomain = decodeURIComponent(domain.toLowerCase().trim());

    // Update domain script type using the domain validator
    const result = await domainValidator.updateDomainScriptType(normalizedDomain, scriptType);

    if (!result.success) {
      return res.status(404).json({
        error: result.error || "Domain not found or invalid script type"
      });
    }

    console.log(`[ADMIN] Domain script type updated: ${normalizedDomain} -> ${scriptType} by ${req.ip}`);

    res.json({
      success: true,
      domain: normalizedDomain,
      scriptType: scriptType,
      message: "Domain script type updated successfully"
    });
  } catch (error) {
    console.error("Error updating domain script type:", error);
    res.status(500).json({
      error: "Failed to update domain script type"
    });
  }
});

// Get available script types
app.get("/api/admin/script-types", requireAuthAPI, async (req, res) => {
  try {
    const scriptTypes = await domainValidator.getAvailableScriptTypes();
    res.json({
      scriptTypes,
      success: true
    });
  } catch (error) {
    console.error("Error getting script types:", error);
    res.status(500).json({
      error: "Failed to load script types"
    });
  }
});

// ---- Script Template Management API (Admin) --------------------------------
// Get all script templates
app.get("/api/admin/script-templates", requireAuthAPI, async (req, res) => {
  try {
    const scriptTemplates = await ScriptTemplateManager.getAllScriptTemplatesArray();
    res.json({
      scriptTemplates,
      success: true
    });
  } catch (error) {
    console.error("Error getting script templates:", error);
    res.status(500).json({
      error: "Failed to load script templates"
    });
  }
});

// Get script template names for dropdowns
app.get("/api/admin/script-template-names", requireAuthAPI, async (req, res) => {
  try {
    const scriptTemplateNames = await ScriptTemplateManager.getScriptTemplateNames();
    res.json({
      scriptTemplateNames,
      success: true
    });
  } catch (error) {
    console.error("Error getting script template names:", error);
    res.status(500).json({
      error: "Failed to load script template names"
    });
  }
});

// Get specific script template by ID
app.get("/api/admin/script-templates/:scriptId", requireAuthAPI, async (req, res) => {
  try {
    const { scriptId } = req.params;
    const scriptTemplate = await ScriptTemplateManager.getScriptTemplate(scriptId);

    if (!scriptTemplate) {
      return res.status(404).json({
        error: "Script template not found"
      });
    }

    res.json(scriptTemplate);
  } catch (error) {
    console.error("Error getting script template:", error);
    res.status(500).json({
      error: "Failed to load script template"
    });
  }
});

// Add new script template
app.post("/api/admin/script-templates", requireAuthAPI, async (req, res) => {
  try {
    const { scriptId, scriptTemplate } = req.body;

    if (!scriptId || typeof scriptId !== 'string') {
      return res.status(400).json({
        error: "Script ID is required and must be a string"
      });
    }

    if (!scriptTemplate || typeof scriptTemplate !== 'object') {
      return res.status(400).json({
        error: "Script template is required and must be an object"
      });
    }

    // Validate script template structure
    const validation = ScriptTemplateManager.validateScriptTemplate(scriptTemplate);
    if (!validation.valid) {
      return res.status(400).json({
        error: "Invalid script template structure",
        details: validation.errors
      });
    }

    // Validate script ID format
    const scriptIdRegex = /^[a-zA-Z0-9_-]+$/;
    if (!scriptIdRegex.test(scriptId)) {
      return res.status(400).json({
        error: "Script ID must contain only letters, numbers, underscores, and hyphens"
      });
    }

    const success = await ScriptTemplateManager.addScriptTemplate(scriptId, scriptTemplate);

    if (!success) {
      return res.status(409).json({
        error: "Script template already exists"
      });
    }

    // Clear domain validator script cache
    domainValidator.reloadScriptConfig();

    console.log(`[ADMIN] Script template added: ${scriptId} by ${req.ip}`);

    res.json({
      success: true,
      scriptId: scriptId,
      message: "Script template added successfully"
    });
  } catch (error) {
    console.error("Error adding script template:", error);
    res.status(500).json({
      error: "Failed to add script template"
    });
  }
});

// Update existing script template
app.put("/api/admin/script-templates/:scriptId", requireAuthAPI, async (req, res) => {
  try {
    const { scriptId } = req.params;
    const { scriptTemplate } = req.body;

    if (!scriptId || typeof scriptId !== 'string') {
      return res.status(400).json({
        error: "Script ID is required and must be a string"
      });
    }

    if (!scriptTemplate || typeof scriptTemplate !== 'object') {
      return res.status(400).json({
        error: "Script template is required and must be an object"
      });
    }

    // Validate script template structure
    const validation = ScriptTemplateManager.validateScriptTemplate(scriptTemplate);
    if (!validation.valid) {
      return res.status(400).json({
        error: "Invalid script template structure",
        details: validation.errors
      });
    }

    const success = await ScriptTemplateManager.updateScriptTemplate(decodeURIComponent(scriptId), scriptTemplate);

    if (!success) {
      return res.status(404).json({
        error: "Script template not found"
      });
    }

    // Clear domain validator script cache
    domainValidator.reloadScriptConfig();

    console.log(`[ADMIN] Script template updated: ${scriptId} by ${req.ip}`);

    res.json({
      success: true,
      scriptId: scriptId,
      message: "Script template updated successfully"
    });
  } catch (error) {
    console.error("Error updating script template:", error);
    res.status(500).json({
      error: "Failed to update script template"
    });
  }
});

// Delete script template
app.delete("/api/admin/script-templates/:scriptId", requireAuthAPI, async (req, res) => {
  try {
    const { scriptId } = req.params;

    if (!scriptId || typeof scriptId !== 'string') {
      return res.status(400).json({
        error: "Script ID is required and must be a string"
      });
    }

    const decodedScriptId = decodeURIComponent(scriptId);

    // Don't allow deletion of default script
    if (decodedScriptId === 'default') {
      return res.status(400).json({
        error: "Cannot delete default script template"
      });
    }

    const success = await ScriptTemplateManager.removeScriptTemplate(decodedScriptId);

    if (!success) {
      return res.status(404).json({
        error: "Script template not found"
      });
    }

    // Clear domain validator script cache
    domainValidator.reloadScriptConfig();

    console.log(`[ADMIN] Script template deleted: ${decodedScriptId} by ${req.ip}`);

    res.json({
      success: true,
      scriptId: decodedScriptId,
      message: "Script template deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting script template:", error);
    res.status(500).json({
      error: "Failed to delete script template"
    });
  }
});

// ---- MCP servers info -------------------------------------------------------
app.get("/api/mcp-servers", (_req, res) => {
  try {
    const mcpServersInfo: Record<
      string,
      { command: string; args: string[]; disabled: boolean; tools: McpTool[] }
    > = {};

    mcpManager.getAllServersInfo().forEach((info, name) => {
      mcpServersInfo[name] = {
        command: info.command,
        args: info.args,
        disabled: info.disabled === true,
        tools: mcpManager.getServerTools(name),
      };
    });

    res.status(200).json(mcpServersInfo);
  } catch (error) {
    console.error("Failed to get MCP server info:", error);
    res.status(500).json({ error: "Failed to get MCP server info" });
  }
});

// ---- Authentication Routes --------------------------------------------------
app.get("/api/auth/user", getCurrentUser);
app.post("/api/auth/logout", handleLogout);

// Authentication callback route
app.get("/auth/callback", (req, res) => {
  const { token, returnTo } = req.query;

  if (token) {
    // Redirect to the intended page with token for processing
    const destination = returnTo || '/control-panel.html';
    res.redirect(`${destination}?token=${token}`);
  } else {
    // No token, redirect to login
    res.redirect('/control-panel.html');
  }
});

// ---- Protected Routes (requires authentication) ----------------------------
// Make Socket.IO instance available to routes
app.set('io', io);

app.get("/ingest", requireAuth, (req, res) => {
  res.sendFile(path.resolve(process.cwd(), "public/ingest.html"));
});

// API
app.use("/api/ingest", requireAuthAPI, ingestRouter);

// ---- Control Panel API ------------------------------------------------------

app.get("/api/status", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// Session analytics endpoint
app.get("/api/sessions", requireAuthAPI, (_req, res) => {
  const sessionData: any[] = [];

  activeSessions.forEach((session, sessionId) => {
    const data: any = {
      sessionId,
      connectedAt: (session as any).connectionInfo?.connectedAt || 'unknown',
      ip: (session as any).connectionInfo?.ip || 'unknown',
      userAgent: (session as any).connectionInfo?.userAgent || 'unknown',
      referer: (session as any).connectionInfo?.referer || 'unknown'
    };

    // Add location info if available
    if ((session as any).userLocation) {
      data.location = (session as any).userLocation;
    }

    // Add domain info if available
    if ((session as any).domainInfo) {
      data.domain = (session as any).domainInfo;
    }

    sessionData.push(data);
  });

  res.json({
    totalActiveSessions: sessionData.length,
    sessions: sessionData,
    timestamp: new Date().toISOString()
  });
});

app.post("/api/config", requireAuthAPI, async (req, res) => {
  try {
    const body = req.body || {};
    console.log("[CONFIG UPDATE] Received configuration update request:", JSON.stringify(body, null, 2));

    // Get current configuration to check for voice changes
    const oldConfig = await ConfigManager.getConfig();

    const toSave = {
      systemPrompt: body.systemPrompt || "",
      voice: body.voice || "matthew",
      chunkSize: body.chunkSize || 512,
      enabledTools: body.enabledTools || [],
    };

    // Check if voice has changed
    const voiceChanged = oldConfig.voice !== toSave.voice;

    // Save to DynamoDB using ConfigManager
    const savedConfig = await ConfigManager.saveConfig(toSave);
    console.log("[CONFIG UPDATE] Saved to DynamoDB:", JSON.stringify(savedConfig, null, 2));

    // Handle KB ID update if provided
    if (body.knowledgeBaseId) {
      try {
        await KBConfigManager.updateKnowledgeBaseId(body.knowledgeBaseId, body.knowledgeBaseName || "Updated KB");
        console.log("[CONFIG UPDATE] Updated KB config via KBConfigManager:", body.knowledgeBaseId);
      } catch (kbError) {
        console.error("[CONFIG UPDATE] Failed to update KB config:", kbError);
      }
    }

    // If voice changed, update all active sessions
    if (voiceChanged) {
      console.log(`[CONFIG UPDATE] Voice changed from ${oldConfig.voice} to ${toSave.voice}, updating all active sessions`);
      activeSessions.forEach((session, sessionId) => {
        session.setVoiceId(toSave.voice);
        // Also notify the socket client about the voice change
        const socket = io.sockets.sockets.get(sessionId);
        if (socket) {
          socket.emit("voiceConfigConfirmed", { voiceId: toSave.voice });
        }
      });
    }

    res.json({
      ok: true,
      config: { ...savedConfig, knowledgeBaseId: body.knowledgeBaseId || null },
    });
  } catch (error) {
    console.error("[CONFIG UPDATE] Failed to save configuration:", error);
    res.status(500).json({
      error: "Failed to save configuration",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// Optional helper some templates call
app.post("/api/save-prompt", async (req, res) => {
  try {
    const { promptId, content, prompt } = req.body || {};
    const id = (promptId || "system").replace(/[^a-zA-Z0-9_-]/g, "");
    if (typeof content === "string") {
      const p = path.join(__dirname, "../public/prompts", `${id}.md`);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content, "utf8");
    }
    // If called with {prompt: "..."} update system prompt in DynamoDB
    if (typeof prompt === "string") {
      await ConfigManager.updateSystemPrompt(prompt);
      console.log("System prompt updated in DynamoDB via save-prompt endpoint");
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("Error saving prompt:", e);
    res.status(500).json({ error: "Failed to save prompt" });
  }
});

app.get("/api/available-tools", requireAuthAPI, async (_req, res) => {
  try {
    const enabled = await ConfigManager.getEnabledTools();

    // Get built-in tools
    const builtInToolsData = availableTools.map(tool => ({
      name: tool.toolSpec.name,
      description: tool.toolSpec.description,
      inputSchema: tool.toolSpec.inputSchema,
      enabled: enabled.includes(tool.toolSpec.name),
      type: 'built-in'
    }));

    // Get user-defined tools
    const userTools = await toolHandler.getUserToolsAsync();
    const userToolsData = userTools.map(tool => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.config.inputSchema,
      enabled: tool.enabled,
      type: 'user-defined',
      toolType: tool.type // webhook or script
    }));

    // Combine all tools
    const allTools = [...builtInToolsData, ...userToolsData];

    res.json({ tools: allTools });
  } catch (error) {
    console.error("Error loading available tools:", error);
    res.status(500).json({ error: "Failed to load available tools" });
  }
});

// Get current tool configuration
app.get("/api/config/tools", requireAuthAPI, async (_req, res) => {
  try {
    const enabledTools = await ConfigManager.getEnabledTools();
    res.json({ enabledTools });
  } catch (error) {
    console.error("Error loading tool config from DynamoDB:", error);
    res.json({ enabledTools: [] });
  }
});

// Save tool configuration  
app.post("/api/config/tools", requireAuthAPI, async (req, res) => {
  try {
    const { enabledTools } = req.body;

    if (!Array.isArray(enabledTools)) {
      return res.status(400).json({ error: "enabledTools must be an array" });
    }

    // Validate that all enabled tools are actually available built-in tools
    // (Custom tools are managed separately via /api/tools/custom endpoints)
    const availableToolNames = availableTools.map(t => t.toolSpec.name);
    const invalidTools = enabledTools.filter(tool => !availableToolNames.includes(tool));

    if (invalidTools.length > 0) {
      return res.status(400).json({
        error: "Invalid built-in tools specified",
        invalidTools,
        availableBuiltInTools: availableToolNames
      });
    }

    // Save to DynamoDB using ConfigManager
    await ConfigManager.updateEnabledTools(enabledTools);

    console.log(`Built-in tool configuration updated in DynamoDB: ${enabledTools.join(', ')}`);
    res.json({ success: true, enabledTools });
  } catch (error) {
    console.error("Error saving tool config to DynamoDB:", error);
    res.status(500).json({ error: "Failed to save tool configuration" });
  }
});

// ---- Custom Tool Management API Endpoints ----------------------------------

// Get all custom tools
app.get("/api/tools/custom", requireAuthAPI, async (req, res) => {
  try {
    const { ToolConfigDynamoManager } = await import('./services/tool-config-dynamo');
    const tools = await ToolConfigDynamoManager.loadUserTools();
    console.log(`[API] Loaded ${tools.length} custom tools from DynamoDB`);
    res.json({ tools });
  } catch (error) {
    console.error("Error loading custom tools from DynamoDB:", error);
    res.status(500).json({ error: "Failed to load custom tools" });
  }
});

// Add new custom tool
app.post("/api/tools/custom", requireAuthAPI, async (req, res) => {
  try {
    const { name, description, type, config } = req.body;

    // Validate input
    if (!name || !description || !type || !config) {
      return res.status(400).json({ error: "Missing required fields: name, description, type, config" });
    }

    if (!['webhook', 'script'].includes(type)) {
      return res.status(400).json({ error: "Tool type must be 'webhook' or 'script'" });
    }

    const { ToolConfigDynamoManager } = await import('./services/tool-config-dynamo');

    // Create tool definition
    const tool: UserDefinedTool = {
      id: ToolConfigDynamoManager.generateToolId(),
      name: name.trim(),
      description: description.trim(),
      type,
      enabled: true,
      config,
      createdAt: new Date().toISOString()
    };

    // Validate tool configuration
    const validation = ToolConfigDynamoManager.validateTool(tool);
    if (!validation.valid) {
      return res.status(400).json({
        error: "Tool validation failed",
        details: validation.errors
      });
    }

    // Save to DynamoDB
    const success = await ToolConfigDynamoManager.saveUserTool(tool);

    if (success) {
      // Also add to runtime ToolHandler
      await toolHandler.addUserTool(tool);

      console.log(`[API] Added custom tool: ${tool.name} (${tool.type}) to DynamoDB`);
      res.json({ success: true, tool });
    } else {
      res.status(400).json({ error: "Failed to add tool to DynamoDB" });
    }
  } catch (error) {
    console.error("Error adding custom tool:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// Update existing custom tool
app.put("/api/tools/custom/:toolId", requireAuthAPI, async (req, res) => {
  try {
    const { toolId } = req.params;
    const { name, description, config, enabled } = req.body;

    const { ToolConfigDynamoManager } = await import('./services/tool-config-dynamo');
    const existingTool = await ToolConfigDynamoManager.getUserTool(toolId);

    if (!existingTool) {
      return res.status(404).json({ error: "Tool not found" });
    }

    // Update tool fields
    const updatedTool: UserDefinedTool = {
      ...existingTool,
      name: name?.trim() || existingTool.name,
      description: description?.trim() || existingTool.description,
      config: config || existingTool.config,
      enabled: enabled !== undefined ? enabled : existingTool.enabled
    };

    // Validate updated tool
    const validation = ToolConfigDynamoManager.validateTool(updatedTool);
    if (!validation.valid) {
      return res.status(400).json({
        error: "Tool validation failed",
        details: validation.errors
      });
    }

    // Update in DynamoDB
    const success = await ToolConfigDynamoManager.updateUserTool(updatedTool);

    if (success) {
      // Update in runtime if status changed
      if (existingTool.enabled !== updatedTool.enabled) {
        toolHandler.updateUserToolStatus(toolId, updatedTool.enabled);
      } else {
        // Reload all tools to pick up changes
        await toolHandler.loadUserDefinedTools();
      }

      console.log(`[API] Updated custom tool: ${updatedTool.name}`);
      res.json({ success: true, tool: updatedTool });
    } else {
      res.status(400).json({ error: "Failed to update tool" });
    }
  } catch (error) {
    console.error("Error updating custom tool:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// Test tool before adding/updating
app.post("/api/tools/test", requireAuthAPI, async (req, res) => {
  try {
    const { type, config, testInput = {} } = req.body;

    if (!type || !config) {
      return res.status(400).json({ error: "Missing required fields: type, config" });
    }

    if (!['webhook', 'script'].includes(type)) {
      return res.status(400).json({ error: "Tool type must be 'webhook' or 'script'" });
    }

    let result;

    if (type === 'webhook') {
      const webhookExecutor = new WebhookExecutor();
      result = await webhookExecutor.testWebhook(config, testInput);
    } else if (type === 'script') {
      const scriptExecutor = new ScriptExecutor();

      // Get session context from toolHandler if available
      const sessionContext = toolHandler.getCurrentSessionContext();
      const requestHeaders = toolHandler.getRequestHeaders();
      const userAgent = toolHandler.getUserAgent();

      const executionContext = {
        session: sessionContext,
        requestHeaders: requestHeaders,
        userAgent: userAgent
      };

      result = await scriptExecutor.executeScript(config, testInput, executionContext);
    } else {
      return res.status(400).json({ error: "Unsupported tool type" });
    }

    console.log(`[API] Tool test result for ${type}: ${result.success ? 'SUCCESS' : 'FAILED'}`);
    res.json(result);
  } catch (error) {
    console.error("Error testing tool:", error);
    res.status(500).json({
      success: false,
      error: "Test failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// Delete custom tool
app.delete("/api/tools/custom/:toolId", requireAuthAPI, async (req, res) => {
  try {
    const { toolId } = req.params;

    const { ToolConfigDynamoManager } = await import('./services/tool-config-dynamo');
    const success = await ToolConfigDynamoManager.removeUserTool(toolId);

    if (success) {
      // Also remove from runtime ToolHandler
      toolHandler.removeUserTool(toolId);

      console.log(`[API] Deleted custom tool from DynamoDB: ${toolId}`);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Tool not found or failed to delete from DynamoDB" });
    }
  } catch (error) {
    console.error("Error deleting custom tool:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// Toggle tool on/off
app.put("/api/tools/custom/:toolId/toggle", requireAuthAPI, async (req, res) => {
  try {
    const { toolId } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: "enabled must be a boolean" });
    }

    const { ToolConfigDynamoManager } = await import('./services/tool-config-dynamo');
    const success = await ToolConfigDynamoManager.updateToolStatus(toolId, enabled);

    if (success) {
      // Also update runtime ToolHandler
      toolHandler.updateUserToolStatus(toolId, enabled);

      console.log(`[API] ${enabled ? 'Enabled' : 'Disabled'} custom tool in DynamoDB: ${toolId}`);
      res.json({ success: true, enabled });
    } else {
      res.status(404).json({ error: "Tool not found or failed to update in DynamoDB" });
    }
  } catch (error) {
    console.error("Error toggling tool status:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// Get all available tool specifications (built-in + custom + MCP)
app.get("/api/tools/all-specs", requireAuthAPI, (_req, res) => {
  try {
    const specs = toolHandler.getAllAvailableToolSpecs();
    res.json({ toolSpecs: specs });
  } catch (error) {
    console.error("Error loading tool specifications:", error);
    res.status(500).json({ error: "Failed to load tool specifications" });
  }
});

app.get("/api/knowledge-bases", requireAuthAPI, async (_req, res) => {
  try {
    // Import AWS SDK for Bedrock Agent (not Runtime)
    const { BedrockAgentClient, ListKnowledgeBasesCommand } = await import("@aws-sdk/client-bedrock-agent");

    // Debug: Log environment variables (without exposing sensitive data)
    console.log("AWS_REGION:", process.env.AWS_REGION);
    console.log("AWS_ACCESS_KEY_ID available:", !!process.env.AWS_ACCESS_KEY_ID);
    console.log("AWS_SECRET_ACCESS_KEY available:", !!process.env.AWS_SECRET_ACCESS_KEY);

    // Check if credentials are available
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      throw new Error("AWS credentials not found in environment variables");
    }

    // Initialize the client with credentials from environment
    const client = new BedrockAgentClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN // Optional
      }
    });

    // List knowledge bases
    const command = new ListKnowledgeBasesCommand({});
    const response = await client.send(command);

    // Format the response to match the expected structure
    const knowledgeBases = (response.knowledgeBaseSummaries || []).map((kb: any) => ({
      knowledgeBaseId: kb.knowledgeBaseId,
      name: kb.name || kb.knowledgeBaseId,
      description: kb.description || '',
      status: kb.status,
      createdAt: kb.createdAt,
      updatedAt: kb.updatedAt
    }));

    console.log(`Found ${knowledgeBases.length} knowledge bases`);
    res.json({ knowledgeBases });

  } catch (error) {
    console.error("Error fetching knowledge bases:", error);
    res.status(500).json({
      error: "Failed to fetch knowledge bases",
      message: error instanceof Error ? error.message : String(error),
      knowledgeBases: []
    });
  }
});

// Get current KB configuration
app.get("/api/config/knowledge-base", requireAuthAPI, async (_req, res) => {
  try {
    const kbConfig = await KBConfigManager.getKBConfig();
    res.json({
      selectedKnowledgeBaseId: kbConfig.kbId || null,
      selectedKnowledgeBaseName: kbConfig.kbName || null,
      lastUpdated: kbConfig.lastUpdated || null
    });
  } catch (error) {
    console.error("Error loading KB config from DynamoDB:", error);
    res.json({
      selectedKnowledgeBaseId: null,
      selectedKnowledgeBaseName: null,
      lastUpdated: null
    });
  }
});

// Save KB configuration
app.post("/api/config/knowledge-base", requireAuthAPI, async (req, res) => {
  try {
    const { knowledgeBaseId, knowledgeBaseName } = req.body;

    if (!knowledgeBaseId || !knowledgeBaseName) {
      return res.status(400).json({ error: "Knowledge Base ID and name are required" });
    }

    // Save to DynamoDB using KBConfigManager
    const kbConfig = await KBConfigManager.updateKnowledgeBaseId(knowledgeBaseId, knowledgeBaseName);

    console.log(`[KB CONFIG] Saved via KBConfigManager: ${knowledgeBaseName} (${knowledgeBaseId})`);

    // Also update the KnowledgeBaseConfig in memory
    try {
      await updateKBConfigFromDynamoDB();
      console.log(`Knowledge Base updated to: ${knowledgeBaseName} (${knowledgeBaseId})`);
    } catch (error) {
      console.warn("Could not update in-memory KB config:", error);
    }

    res.json({ success: true, kbConfig });
  } catch (error) {
    console.error("Error saving KB config:", error);
    res.status(500).json({ error: "Failed to save KB configuration" });
  }
});

// Direct route for the control panel file (also served by static middleware)
app.get("/control-panel.html", (req, res, next) => {
  console.log("🔥🔥🔥 CONTROL PANEL REQUEST RECEIVED! 🔥🔥🔥");
  console.log("URL:", req.originalUrl);
  console.log("Query:", req.query);
  console.log("Token present:", req.query.token ? "YES" : "NO");

  // Prevent caching of this file
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  requireAuth(req, res, next);
}, (_req, res) => {
  console.log("✅ Serving control panel file");

  // Additional cache prevention headers
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  res.sendFile(path.resolve(__dirname, "../public/control-panel.html"));
});

// Serve the embed widget with proper headers
app.get("/embed-widget.js", (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=300'); // 5 minute cache
  res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins for widget
  res.sendFile(path.resolve(__dirname, "../public/embed-widget.js"));
});

// Serve the widget demo page
app.get("/widget-demo", (req, res) => {
  res.sendFile(path.resolve(__dirname, "../widget-demo.html"));
});

// ---- DynamoDB Check Endpoint -----------------------------------------------
app.get("/api/dynamo-records", async (_req, res) => {
  try {
    const { DynamoDBClient, ScanCommand } = require("@aws-sdk/client-dynamodb");
    const { fromIni } = require("@aws-sdk/credential-providers");

    let credentials;
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      };
    } else {
      credentials = fromIni({ profile: AWS_PROFILE_NAME });
    }

    const client = new DynamoDBClient({
      region: AWS_REGION,
      credentials,
    });

    const command = new ScanCommand({
      TableName: process.env.DDB_TABLE || "url_ingestions",
      Limit: 20, // Limit to recent 20 records
    });

    const result = await client.send(command);
    const items = result.Items?.map((item: any) => {
      // Convert DynamoDB format to readable format
      const converted: any = {};
      for (const [key, value] of Object.entries(item)) {
        if (value && typeof value === 'object') {
          const type = Object.keys(value)[0];
          converted[key] = (value as any)[type];
        }
      }
      return converted;
    }) || [];

    res.json({
      success: true,
      count: items.length,
      totalCount: result.Count,
      records: items
    });

  } catch (error) {
    console.error("DynamoDB check error:", error);
    res.status(500).json({
      error: "Failed to check DynamoDB records",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// ---- S3 Bucket Browser API Endpoints ----------------------------------------
// List objects in S3 bucket with a given prefix
app.get("/api/s3/list", requireAuthAPI, async (req, res) => {
  try {
    const prefix = req.query.prefix as string || 'premiernx-bubble-transcripts/';
    const delimiter = '/'; // Use delimiter to simulate folder structure

    console.log(`[S3 BROWSER] Listing objects with prefix: ${prefix}`);

    // Import required AWS SDK components
    const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
    
    // Set up the command to list objects
    const command = new ListObjectsV2Command({
      Bucket: process.env.S3_BUCKET || 'ai-tools-bucket-18052025',
      Prefix: prefix,
      Delimiter: delimiter,
      MaxKeys: 1000
    });

    // Send the command
    const data = await s3Client.send(command);
    
    // Format the response
    const formattedResponse = {
      folders: (data.CommonPrefixes || []).map(cp => ({
        prefix: cp.Prefix,
        name: cp.Prefix?.replace(prefix, '').replace('/', '') || '',
        type: 'folder',
        path: cp.Prefix
      })),
      files: (data.Contents || []).filter(item => item.Key !== prefix).map(item => ({
        key: item.Key,
        name: item.Key?.replace(prefix, '') || '',
        size: item.Size,
        lastModified: item.LastModified,
        type: 'file',
        path: item.Key,
        extension: item.Key?.split('.').pop()?.toLowerCase() || ''
      })),
      prefix: prefix,
      parent: prefix.includes('/') ? prefix.split('/').slice(0, -2).join('/') + '/' : ''
    };

    // Return the formatted response
    res.status(200).json(formattedResponse);
  } catch (error) {
    console.error("[S3 BROWSER] Error listing S3 objects:", error);
    res.status(500).json({ 
      error: "Failed to list S3 objects", 
      details: error instanceof Error ? error.message : "Unknown error" 
    });
  }
});

// Download an S3 object
app.get("/api/s3/download", requireAuthAPI, async (req, res) => {
  try {
    const key = req.query.key as string;
    
    if (!key) {
      return res.status(400).json({ error: "Object key is required" });
    }

    console.log(`[S3 BROWSER] Downloading object with key: ${key}`);
    
    // Validate that the key belongs to our transcripts bucket
    if (!key.startsWith('premiernx-bubble-transcripts/')) {
      return res.status(403).json({ error: "Access denied to this object" });
    }
    
    // Import required AWS SDK components
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    
    // Set up the command to get the object
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET || 'ai-tools-bucket-18052025',
      Key: key
    });
    
    // Get the object
    const data = await s3Client.send(command);
    
    // Set appropriate headers for download
    // Set Content-Type for all files
    if (data.ContentType) {
      res.setHeader('Content-Type', data.ContentType);
    }
    if (data.ContentLength) {
      res.setHeader('Content-Length', data.ContentLength);
    }
    // Force download for all files by setting Content-Disposition to attachment
    const fileName = key.split('/').pop() || 'download';
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    
    // Stream the object directly to prevent binary corruption
    if (data.Body) {
      try {
        // Import the pipeline function for proper streaming
        const { pipeline } = await import('stream/promises');
        const { Readable } = await import('stream');
        
        // Convert AWS SDK stream to Node.js readable stream
        const nodeStream = Readable.from(data.Body as any);
        
        // Stream directly to response to preserve binary integrity
        await pipeline(nodeStream, res);
        
      } catch (streamError) {
        console.error('[S3 BROWSER] Stream pipeline error:', streamError);
        
        // Fallback: collect chunks as Uint8Array to preserve binary data
        if (!res.headersSent) {
          try {
            const chunks: Uint8Array[] = [];
            
            // Collect all chunks from the stream as Uint8Array
            for await (const chunk of data.Body as any) {
              chunks.push(new Uint8Array(chunk));
            }
            
            // Concatenate Uint8Arrays without conversion
            const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const result = new Uint8Array(totalLength);
            let offset = 0;
            
            for (const chunk of chunks) {
              result.set(chunk, offset);
              offset += chunk.length;
            }
            
            // Send as buffer preserving binary integrity
            res.end(Buffer.from(result));
            
          } catch (fallbackError) {
            console.error('[S3 BROWSER] Fallback method failed:', fallbackError);
            throw streamError;
          }
        }
      }
    } else {
      throw new Error("Empty response body from S3");
    }
    
  } catch (error) {
    console.error("[S3 BROWSER] Error downloading S3 object:", error);
    // Only send error response if headers haven't been sent yet
    if (!res.headersSent) {
      res.status(500).json({ 
        error: "Failed to download S3 object", 
        details: error instanceof Error ? error.message : "Unknown error" 
      });
    } else {
      res.end(); // End the response if headers were already sent
    }
  }
});

// Delete an S3 object
app.delete("/api/s3/delete", requireAuthAPI, async (req, res) => {
  try {
    const key = req.body.key as string;
    
    if (!key) {
      return res.status(400).json({ error: "Object key is required" });
    }

    console.log(`[S3 BROWSER] Deleting object with key: ${key}`);
    
    // Validate that the key belongs to our transcripts bucket
    if (!key.startsWith('premiernx-bubble-transcripts/')) {
      return res.status(403).json({ error: "Access denied to this object" });
    }
    
    // Import required AWS SDK components
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    
    // Set up the command to delete the object
    const command = new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET || 'ai-tools-bucket-18052025',
      Key: key
    });
    
    // Delete the object
    await s3Client.send(command);
    
    // Return success response
    res.status(200).json({ 
      success: true, 
      message: "Object deleted successfully", 
      key 
    });
    
  } catch (error) {
    console.error("[S3 BROWSER] Error deleting S3 object:", error);
    res.status(500).json({ 
      error: "Failed to delete S3 object", 
      details: error instanceof Error ? error.message : "Unknown error" 
    });
  }
});

// ---- KB ID compatibility endpoints (as in your original) -------------------
app.get("/api/kb-id", async (_req, res) => {
  try {
    const kbConfig = await KBConfigManager.getKBConfig();
    return res.status(200).json({ kbId: kbConfig.kbId });
  } catch (error) {
    console.error("Get KB ID error:", error);
    return res.status(500).json({ error: "Failed to get KB ID" });
  }
});

app.post("/api/kb-id", async (req, res) => {
  try {
    const { kbId } = req.body;
    if (!kbId || typeof kbId !== "string") {
      return res.status(400).json({ error: "Invalid KB ID" });
    }
    if (!/^[A-Z0-9]{10}$/.test(kbId)) {
      return res
        .status(400)
        .json({ error: "KB ID must be alphanumeric and 10 characters" });
    }

    // Update using KBConfigManager
    await KBConfigManager.updateKnowledgeBaseId(kbId);

    // Also update the KnowledgeBaseConfig in memory for backwards compatibility
    await updateKBConfigFromDynamoDB();

    console.log(`Legacy KB ID updated via KBConfigManager: ${kbId}`);

    return res
      .status(200)
      .json({ success: true, message: "KB ID updated", kbId });
  } catch (error) {
    console.error("Update KB ID error:", error);
    return res.status(500).json({ error: "Failed to update KB ID" });
  }
});

// ---- Health -----------------------------------------------------------------
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// ---- Start / Shutdown -------------------------------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`Server listening on http://localhost:${PORT}`);

  // Update KB config from DynamoDB during startup
  try {
    await updateKBConfigFromDynamoDB();
    console.log("✅ KB configuration synchronized with DynamoDB");
  } catch (error) {
    console.warn("⚠️  Failed to sync KB config from DynamoDB during startup:", error);
  }
});

process.on("SIGINT", async () => {
  const forceExitTimer = setTimeout(() => {
    console.error("Forcing server shutdown after timeout");
    process.exit(1);
  }, 5000);

  try {
    await mcpManager.closeAll();
    await new Promise<void>((resolve) => io.close(() => resolve()));
    const activeSessions = bedrockClient.getActiveSessions();

    await Promise.all(
      activeSessions.map(async (sid) => {
        try {
          await bedrockClient.closeSession(sid);
        } catch (error) {
          try {
            bedrockClient.forceCloseSession(sid);
          } catch { }
        }
      })
    );

    await new Promise<void>((resolve) => server.close(() => resolve()));
    clearTimeout(forceExitTimer);
    process.exit(0);
  } catch (error) {
    console.error("Shutdown error:", String(error));
    process.exit(1);
  }
});
