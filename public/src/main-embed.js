import { AudioPlayer } from "./lib/play/AudioPlayer.js";
import { ChatHistoryManager } from "./lib/util/ChatHistoryManager.js";

// Load audio recording service
const audioRecordingScript = document.createElement('script');
audioRecordingScript.src = './src/lib/audio/AudioRecordingService.js';
audioRecordingScript.onload = () => {
  console.log('[MAIN] AudioRecordingService loaded');
  // Initialize the audio recorder
  if (window.AudioRecordingService) {
    window.audioRecorder = new window.AudioRecordingService();
    console.log('[MAIN] AudioRecorder initialized');
  } else {
    console.error('[MAIN] AudioRecordingService not found after script load');
  }
};
document.head.appendChild(audioRecordingScript);

// Connect to the server
const socket = io();

// DOM elements
const startButton = document.getElementById("start");
const stopButton = document.getElementById("stop");
const textButton = document.getElementById("text");
const statusElement = document.getElementById("status");
const chatContainer = document.getElementById("chat-container");
const statusTextElement = document.getElementById("status-text");
const pulsatingOrb =
  document.getElementById("agent-image") ||
  document.getElementById("pulsating-orb") || { style: {}, classList: { add() {}, remove() {} } };
const configButton = document.getElementById("config-button");
const configModal = document.getElementById("config-modal");
const closeModalBtn = document.querySelector(".close-modal");
const promptSelect = document.getElementById("prompt-select");
const promptEditor = document.getElementById("prompt-editor");
const saveConfigBtn = document.getElementById("save-config");
const cancelConfigBtn = document.getElementById("cancel-config");

// Chat history management
let chat = { history: [] };
const chatRef = { current: chat };
const chatHistoryManager = ChatHistoryManager.getInstance(
  chatRef,
  (newChat) => {
    chat = { ...newChat };
    chatRef.current = chat;
    updateChatUI();
  }
);

// Audio processing variables
let audioContext;
let audioStream;
let isStreaming = false;
let isMuted = true;
let isChatVisible = false; // Changed: Subtitles off by default
let processor;
let sourceNode;
let analyser;
let audioDataArray;
let animationFrame;
let lastAudioTimestamp = 0;
let voiceActivityHistory = [];
let voiceFrequencyHistory = [];

// Audio recording variables
let audioRecorder = null;
let recordingInitialized = false;

// Location variables
let userLocation = null;
let locationPermissionRequested = false;

// Smooth animation parameters
let currentScale = 1.0;
let currentHue = 190;
let currentSaturation = 80;
let currentLightness = 55;
let currentGlow = 70;
let currentOpacity = 0.8;
let currentInnerGlowOpacity = 0.3;
let targetValues = {};
let smoothingFactor = 0.15;
let waitingForAssistantResponse = false;
let waitingForUserTranscription = false;
let userThinkingIndicator = null;
let assistantThinkingIndicator = null;
let transcriptionReceived = false;
let displayAssistantText = false;
let role;
let audioPlayer = new AudioPlayer();
window.audioPlayer = audioPlayer; // Make audioPlayer globally accessible for recording
let sessionInitialized = false;
let micPermissionError = false;
let promptCache = {};

// Custom system prompt - will be loaded from file
let SYSTEM_PROMPT = "";

// Function to refresh system prompt from server
async function refreshSystemPrompt() {
  try {
    const cfgRes = await fetch('/api/config');
    if (cfgRes.ok) {
      const cfg = await cfgRes.json();
      if (cfg && cfg.systemPrompt) {
        SYSTEM_PROMPT = cfg.systemPrompt;
        console.log("System prompt refreshed from server");
        return true;
      }
    }
  } catch (e) { 
    console.warn('Failed to refresh system prompt:', e); 
  }
  return false;
}

// Save prompt to server
async function savePromptToServer(promptId, content) {
  try {
    const response = await fetch('/api/save-prompt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ promptId, content }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to save prompt');
    }

    return await response.json();
  } catch (error) {
    console.error('Error saving prompt:', error);
    throw error;
  }
}

// Voice configuration
let currentVoiceId = "tiffany";
let currentVoiceDisplay = "tiffany";

// Language configuration
let currentLanguage = "en";

// i18n strings
const translations = {
  zh: {
    config: "配置",
    prompt: "提示词",
    language: "语言",
    mcpServers: "MCP服务器",
    knowledgeBase: "知识库",
    selectPrompt: "选择提示词:",
    customPrompt: "自定义提示词:",
    systemPrompt: "系统提示词:",
    selectLanguage: "选择语言:",
    kbId: "知识库 ID:",
    kbIdPlaceholder: "输入知识库 ID",
    save: "保存",
    cancel: "取消",
    loading: "加载中...",
    configSaved: "配置已保存",
    disconnected: "已断开连接",
    connected: "已连接到服务器",
    requestingMic: "正在请求麦克风权限...",
    micReady: "麦克风已准备就绪",
    recording: "正在录音中...",
    processing: "处理中...",
    ready: "已准备就绪",
    initSession: "初始化会话中...",
    sessionInited: "会话初始化成功",
    sessionError: "会话初始化错误",
    talkOrTap: "说话或点击打断",
    micPermError: "麦克风权限错误：",
    micPermDenied: "麦克风权限被拒绝。请在浏览器设置中允许麦克风访问。",
    refreshing: "正在刷新页面...",
    voiceSwitched: "已切换到{voice}声音",
    startChat: "点击下方电话按钮，开始对话",
    conversationEnded: "对话已结束",
    enabled: "已启用",
    disabled: "已禁用",
    command: "命令:",
    args: "参数:",
    availableTools: "可用工具",
    noTools: "该服务器未提供工具",
    noServers: "未配置MCP服务器",
    failedToLoad: "获取MCP服务器信息失败",
    loadError: "加载MCP服务器信息时出错",
  },
  en: {
    config: "Configuration",
    prompt: "Prompt",
    language: "Language",
    mcpServers: "MCP Servers",
    knowledgeBase: "Knowledge Base",
    selectPrompt: "Select Prompt:",
    customPrompt: "Custom Prompt:",
    systemPrompt: "System Prompt:",
    selectLanguage: "Select Language:",
    kbId: "Knowledge Base ID:",
    kbIdPlaceholder: "Enter Knowledge Base ID",
    save: "Save",
    cancel: "Cancel",
    loading: "Loading...",
    configSaved: "Configuration Saved",
    disconnected: "Disconnected",
    connected: "Connected to server",
    requestingMic: "Requesting microphone permission...",
    micReady: "Microphone ready",
    recording: "Recording...",
    processing: "Processing...",
    ready: "Ready",
    initSession: "Initializing session...",
    sessionInited: "Session initialized",
    sessionError: "Session initialization error",
    talkOrTap: "Talk or tap to interrupt",
    micPermError: "Microphone permission error: ",
    micPermDenied: "Microphone permission denied. Please enable microphone access in browser settings.",
    refreshing: "Refreshing page...",
    voiceSwitched: "Switched to {voice} voice",
    startChat: "Welcome! Press the call button and ask your question. Start by saying: 'Hello' or 'How can you help me today?'",
    conversationEnded: "Conversation ended",
    enabled: "Enabled",
    disabled: "Disabled",
    command: "Command:",
    args: "Arguments:",
    availableTools: "Available Tools",
    noTools: "No tools provided by this server",
    noServers: "No MCP servers configured",
    failedToLoad: "Failed to load MCP server information",
    loadError: "Error loading MCP server information",
  },
};

// Voice dropdown
function initVoiceDropdown() {
  const userBox = document.getElementById("user-box");
  const voiceDropdown = document.getElementById("voice-dropdown");
  const voiceOptions = document.querySelectorAll(".voice-option");
  const currentVoiceElement = document.getElementById("current-voice");

  // Check if required elements exist
  if (!userBox || !voiceDropdown) {
    return; // Exit early if elements don't exist
  }

  function updateSelectedVoice(voiceId) {
    voiceOptions.forEach((opt) => {
      if (opt.getAttribute("data-voice") === voiceId) {
        opt.classList.add("selected");
      } else {
        opt.classList.remove("selected");
      }
    });
  }
  updateSelectedVoice(currentVoiceId);

  userBox.addEventListener("click", (e) => {
    e.stopPropagation();
    voiceDropdown.classList.toggle("show");
  });

  voiceOptions.forEach((option) => {
    option.addEventListener("click", (e) => {
      e.stopPropagation();
      const voiceId = option.getAttribute("data-voice");
      const voiceName = option.querySelector(".voice-name").textContent;

      currentVoiceId = voiceId;
      if (voiceId === "tiffany") {
        currentVoiceDisplay = "tiffany";
      } else if (voiceId === "matthew") {
        currentVoiceDisplay = "matthew";
      } else if (voiceId === "amy") {
        currentVoiceDisplay = "amy";
      }

      currentVoiceElement.textContent = currentVoiceDisplay;
      updateSelectedVoice(voiceId);
      voiceDropdown.classList.remove("show");

      socket.emit("voiceConfig", { voiceId: currentVoiceId });

      sessionInitialized = false;

      statusElement.textContent = getText("voiceSwitched", { voice: currentVoiceDisplay });
      statusElement.className = "connected";
      setTimeout(() => {
        const currentKey = statusElement.getAttribute('data-i18n-key') || '';
        if (currentKey === 'voiceSwitched' || statusElement.textContent === getText("voiceSwitched", { voice: currentVoiceDisplay })) {
          statusElement.textContent = isStreaming ? getText("recording") : getText("ready");
          statusElement.className = isStreaming ? "recording" : "ready";
          statusElement.setAttribute('data-i18n-key', isStreaming ? 'recording' : 'ready');
        }
      }, 2000);
    });
  });

  document.addEventListener("click", () => {
    voiceDropdown.classList.remove("show");
  });
}

// i18n helpers
function getText(key, substitutions = {}) {
  const lang = translations[currentLanguage] || translations.zh;
  let text = lang[key] || key;
  Object.keys(substitutions).forEach((subKey) => {
    text = text.replace(`{${subKey}}`, substitutions[subKey]);
  });
  return text;
}

function updateUITexts() {
  document.querySelector(".modal-header h2").textContent = getText("config");
  document.querySelector(".tab[data-tab='prompt']").textContent = getText("prompt");
  document.querySelector(".tab[data-tab='language']").textContent = getText("language");
  document.querySelector(".tab[data-tab='mcp-servers']").textContent = getText("mcpServers");
  document.querySelector(".tab[data-tab='kb']").textContent = getText("knowledgeBase");
  document.querySelector("label[for='prompt-select']").textContent = getText("selectPrompt");
  document.querySelector("label[for='prompt-editor']").textContent = getText("systemPrompt");
  document.querySelector("label[for='language-select']").textContent = getText("selectLanguage");

  const kbInputLabel = document.querySelector("label[for='kb-id-input']");
  if (kbInputLabel) {
    kbInputLabel.textContent = getText("kbId");
  }

  const kbInput = document.getElementById("kb-id-input");
  if (kbInput && kbInput.getAttribute("placeholder") !== getText("kbIdPlaceholder")) {
    kbInput.setAttribute("placeholder", getText("kbIdPlaceholder"));
  }
  document.querySelector("#save-config").textContent = getText("save");
  document.querySelector("#cancel-config").textContent = getText("cancel");

  const mcpLoading = document.querySelector("#mcp-servers-container p");
  if (mcpLoading && mcpLoading.textContent.includes("加载中")) {
    mcpLoading.textContent = getText("loading");
  }

  if (statusElement) {
    const currentStatus = statusElement.textContent;
    if (currentStatus.includes("已断开连接")) {
      statusElement.textContent = getText("disconnected");
    } else if (currentStatus.includes("已连接到服务器")) {
      statusElement.textContent = getText("connected");
    } else if (currentStatus.includes("正在请求麦克风权限")) {
      statusElement.textContent = getText("requestingMic");
    } else if (currentStatus.includes("麦克风已准备就绪")) {
      statusElement.textContent = getText("micReady");
    } else if (currentStatus.includes("正在录音中")) {
      statusElement.textContent = getText("recording");
    } else if (currentStatus.includes("处理中")) {
      statusElement.textContent = getText("processing");
    } else if (currentStatus.includes("已准备就绪")) {
      statusElement.textContent = getText("ready");
    } else if (currentStatus.includes("初始化会话中")) {
      statusElement.textContent = getText("initSession");
    } else if (currentStatus.includes("会话初始化成功")) {
      statusElement.textContent = getText("sessionInited");
    } else if (currentStatus.includes("会话初始化错误")) {
      statusElement.textContent = getText("sessionError");
    } else if (currentStatus.includes("已切换到")) {
      statusElement.textContent = getText("voiceSwitched", { voice: currentVoiceDisplay });
    } else if (currentStatus.includes("配置已保存")) {
      statusElement.textContent = getText("configSaved");
    }
  }

  if (statusTextElement) {
    statusTextElement.textContent = getText("talkOrTap");
    statusTextElement.setAttribute('data-i18n-key', 'talkOrTap');
  }

  const emptyChat = document.querySelector("#empty-chat-subtitle");
  if (emptyChat) {
    emptyChat.textContent = getText("startChat");
  }

  const systemMessages = document.querySelectorAll(".message.system");
  systemMessages.forEach((msg) => {
    if (msg.textContent.includes("对话已结束")) {
      msg.textContent = getText("conversationEnded");
    }
  });
}

function initLanguageSelect() {
  const languageSelect = document.getElementById("language-select");
  if (languageSelect) {
    languageSelect.value = currentLanguage;
    languageSelect.addEventListener("change", () => {
      const selectedLanguage = languageSelect.value;
      const originalLanguage = currentLanguage;
      currentLanguage = selectedLanguage;
      updateUITexts();

      document.getElementById("cancel-config").addEventListener(
        "click",
        function onCancel() {
          currentLanguage = originalLanguage;
          updateUITexts();
          this.removeEventListener("click", onCancel);
        },
        { once: true }
      );
    });
  }
}

// KB ID (load/save)
async function loadCurrentKbId() {
  try {
    const response = await fetch('/api/kb-id');
    if (response.ok) {
      const data = await response.json();
      const currentKbIdElement = document.getElementById('current-kb-id');
      const kbIdInput = document.getElementById('kb-id-input');

      if (currentKbIdElement) {
        currentKbIdElement.textContent = data.kbId;
      }

      if (kbIdInput) {
        kbIdInput.value = data.kbId;
      }
    } else {
      console.error('Failed to load KB ID');
      document.getElementById('current-kb-id').textContent = currentLanguage === "en" ?
        "Failed to load" : "加载失败";
    }
  } catch (error) {
    console.error('Error loading KB ID:', error);
    document.getElementById('current-kb-id').textContent = currentLanguage === "en" ?
      "Error loading" : "加载错误";
  }
}

async function saveKbId(kbId) {
  try {
    const response = await fetch('/api/kb-id', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ kbId }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to save KB ID');
    }

    return await response.json();
  } catch (error) {
    console.error('Error saving KB ID:', error);
    throw error;
  }
}

// Config modal
function initConfigModal() {
  const tabs = document.querySelectorAll(".modal-tabs .tab");
  const tabContents = document.querySelectorAll(".tab-content");

  // Check if configButton exists before adding event listener
  if (configButton) {
    configButton.addEventListener("click", () => {
      configModal.classList.add("show");
      loadPromptOptions();
      loadMcpServers();
      loadCurrentKbId();
      updateUITexts();
      initLanguageSelect();
    });
  }

  // Check if closeModalBtn exists before adding event listener
  if (closeModalBtn) {
    closeModalBtn.addEventListener("click", () => {
      configModal.classList.remove("show");
    });
  }

  cancelConfigBtn.addEventListener("click", () => {
    configModal.classList.remove("show");
  });

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const tabId = tab.getAttribute("data-tab");
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      tabContents.forEach((content) => {
        content.classList.remove("active");
        if (content.id === `${tabId}-tab`) {
          content.classList.add("active");
        }
      });
    });
  });

  saveConfigBtn.addEventListener("click", async () => {
    try {
      const selectedLanguage = document.getElementById("language-select").value;
      const promptContent = promptEditor.value.trim();
      const kbIdInput = document.getElementById("kb-id-input");
      let configUpdated = false;

      SYSTEM_PROMPT = promptContent;

      await savePromptToServer("default", promptContent);
      promptCache["default"] = promptContent;
      configUpdated = true;

      if (selectedLanguage !== currentLanguage) {
        currentLanguage = selectedLanguage;
        updateUITexts();
        configUpdated = true;
      }

      if (kbIdInput && kbIdInput.value.trim()) {
        try {
          const kbId = kbIdInput.value.trim().toUpperCase();
          await saveKbId(kbId);
          const currentKbIdElement = document.getElementById('current-kb-id');
          if (currentKbIdElement) {
            currentKbIdElement.textContent = kbId;
          }
          configUpdated = true;
        } catch (kbError) {
          console.error("Error saving KB ID:", kbError);
          alert(currentLanguage === "en" ?
            "Failed to save Knowledge Base ID: " + kbError.message :
            "保存知识库ID失败: " + kbError.message);
        }
      }

      sessionInitialized = false;

      configModal.classList.remove("show");

      if (configUpdated) {
        statusElement.textContent = getText("configSaved");
        statusElement.className = "connected";
        statusElement.setAttribute('data-i18n-key', 'configSaved');
        setTimeout(() => {
          if (statusElement.getAttribute('data-i18n-key') === 'configSaved') {
            statusElement.textContent = isStreaming ? getText("recording") : getText("ready");
            statusElement.className = isStreaming ? "recording" : "ready";
            statusElement.setAttribute('data-i18n-key', isStreaming ? 'recording' : 'ready');
          }
        }, 2000);
      }
    } catch (error) {
      console.error("Error saving configuration:", error);
      statusElement.textContent = currentLanguage === "en" ? "Failed to save configuration" : "保存配置失败";
      statusElement.className = "error";
    }
  });
}

// Load system prompt (UI wiring)
async function loadPromptOptions() {
  promptSelect.style.display = "none";
  document.querySelector("label[for='prompt-select']").style.display = "none";

  const promptEditorLabel = document.querySelector("label[for='prompt-editor']");
  if (promptEditorLabel) {
    promptEditorLabel.textContent = getText("systemPrompt");
  }

  promptEditor.value = SYSTEM_PROMPT;
  promptEditor.disabled = false;
}

// Empty chat check
function checkEmptyChat() {
  if (!chat.history.length && !waitingForUserTranscription && !waitingForAssistantResponse) {
    chatContainer.innerHTML = `
            <div id="empty-chat">
                <div id="empty-chat-subtitle">${getText("startChat")}</div>
            </div>
        `;
    return true;
  }
  return false;
}

// Visualization
function setupAudioVisualization() {
  if (!audioContext || !sourceNode) return;

  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.8;

  sourceNode.connect(analyser);

  const bufferLength = analyser.frequencyBinCount;
  audioDataArray = new Uint8Array(bufferLength);

  updateOrbAnimation();
}

function updateOrbAnimation() {
  if (!analyser || !isStreaming || !pulsatingOrb) {
    cancelAnimationFrame(animationFrame);
    return;
  }

  const frequencyData = new Uint8Array(analyser.frequencyBinCount);
  const timeData = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(frequencyData);
  analyser.getByteTimeDomainData(timeData);

  audioDataArray = frequencyData;

  let sum = 0;
  let bassSum = 0;
  let midSum = 0;
  let trebleSum = 0;

  const bassRange = Math.floor(frequencyData.length * 0.3);
  const midRange = Math.floor(frequencyData.length * 0.6);

  let zeroCrossings = 0;
  let prevSample = timeData[0] < 128 ? -1 : 1;

  for (let i = 1; i < timeData.length; i++) {
    const currentSample = timeData[i] < 128 ? -1 : 1;
    if (prevSample !== currentSample) {
      zeroCrossings++;
    }
    prevSample = currentSample;
  }

  const now = Date.now();
  if (now - lastAudioTimestamp > 50) {
    const voiceActivityScore = (zeroCrossings / timeData.length) * 1000;
    voiceActivityHistory.push(voiceActivityScore);
    if (voiceActivityHistory.length > 20) {
      voiceActivityHistory.shift();
    }
    const frequencyFeature = { bass: 0, mid: 0, treble: 0 };
    lastAudioTimestamp = now;
  }

  for (let i = 0; i < frequencyData.length; i++) {
    sum += frequencyData[i];
    if (i < bassRange) {
      bassSum += frequencyData[i];
    } else if (i < midRange) {
      midSum += frequencyData[i];
    } else {
      trebleSum += frequencyData[i];
    }
  }

  const average = sum / frequencyData.length;
  const bassAvg = bassSum / bassRange;
  const midAvg = midSum / (midRange - bassRange);
  const trebleAvg = trebleSum / (frequencyData.length - midRange);

  const voiceActivityLevel = Math.min(1.0, zeroCrossings / (timeData.length * 0.15));
  const volumeFactor = Math.pow(average / 128, 0.5);
  const dynamicScaleFactor = Math.max(
    volumeFactor,
    voiceActivityLevel * 0.7 + Math.sin(Date.now() / 200) * 0.05
  );

  const scale = 1 + Math.min(0.5, dynamicScaleFactor * 0.7);
  const opacity = 0.8 + (average / 256) * 0.2;

  const bassIntensity = Math.min(1.0, bassAvg / 110);
  const midIntensity = Math.min(1.0, midAvg / 90);
  const trebleIntensity = Math.min(1.0, trebleAvg / 70);

  const soundEnergy = bassIntensity * 0.5 + midIntensity * 0.3 + trebleIntensity * 0.2;
  const isPulsating = soundEnergy > 0.2 || voiceActivityLevel > 0.3;

  const baseGlow = 60;
  const glow = baseGlow + Math.min(120, average * 1.0 + voiceActivityLevel * 60);

  let r, g, b;
  if (voiceActivityLevel > 0.3) {
    r = Math.floor(50 + trebleIntensity * 100 + bassIntensity * 50);
    g = Math.floor(80 + midIntensity * 90);
    b = Math.floor(200 + voiceActivityLevel * 55);
  } else {
    r = Math.floor(30 + bassIntensity * 100);
    g = Math.floor(150 + midIntensity * 60);
    b = Math.floor(220 + trebleIntensity * 35);
  }

  let transformStyle = `scale(${scale})`;
  if (isPulsating) {
    const offsetX = (Math.random() - 0.5) * 5 * voiceActivityLevel;
    const offsetY = (Math.random() - 0.5) * 5 * voiceActivityLevel;
    transformStyle += ` translate(${offsetX}px, ${offsetY}px)`;
  }

  pulsatingOrb.style.transform = transformStyle;
  pulsatingOrb.style.opacity = opacity;

  pulsatingOrb.style.boxShadow = `
    0 0 ${glow}px rgba(${r}, ${g}, ${b}, ${0.6 + voiceActivityLevel * 0.2}), 
    0 0 ${glow * 1.5}px rgba(${r}, ${g}, ${b}, ${0.3 + soundEnergy * 0.2}), 
    inset 0 0 ${40 + average * 0.6 + voiceActivityLevel * 30}px rgba(255, 255, 255, ${0.4 + trebleIntensity * 0.3 + voiceActivityLevel * 0.3})
  `;

  if (average > 30 || voiceActivityLevel > 0.2) {
    pulsatingOrb.style.background = `radial-gradient(
      circle, 
      rgba(${r + 50}, ${g + 30}, ${b + 20}, ${0.7 + voiceActivityLevel * 0.3}) 0%,
      rgba(${r}, ${g}, ${b}, ${0.6 + soundEnergy * 0.2}) 60%,
      rgba(${r - 30}, ${g - 20}, ${b - 10}, ${0.5 + bassIntensity * 0.2}) 100%
    )`;
  }

  animationFrame = requestAnimationFrame(updateOrbAnimation);
}

function stopAudioVisualization() {
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }
  if (pulsatingOrb) {
    pulsatingOrb.style.transform = "";
    pulsatingOrb.style.opacity = "";
    pulsatingOrb.style.boxShadow = "";
  }
}

// Location request function
async function requestUserLocation() {
  if (!navigator.geolocation) {
    console.warn("Geolocation is not supported by this browser");
    return null;
  }

  if (locationPermissionRequested && userLocation) {
    return userLocation;
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        userLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: Date.now()
        };
        locationPermissionRequested = true;
        
        // Send location to server for session storage
        if (socket && socket.connected) {
          socket.emit('session-location', userLocation);
        }
        
        console.log("Location obtained:", userLocation);
        resolve(userLocation);
      },
      (error) => {
        console.warn("Location permission denied or unavailable:", error.message);
        locationPermissionRequested = true;
        resolve(null);
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 300000 // 5 minutes
      }
    );
  });
}

// Domain capture function
function captureDomainInfo() {
  try {
    const domainInfo = {
      domain: window.location.hostname,
      protocol: window.location.protocol,
      port: window.location.port || (window.location.protocol === 'https:' ? '443' : '80'),
      pathname: window.location.pathname,
      timestamp: Date.now()
    };
    
    // Send domain info to server for session storage
    if (socket && socket.connected) {
      socket.emit('session-domain', domainInfo);
      console.log("Domain info sent:", domainInfo);
    }
    
    return domainInfo;
  } catch (error) {
    console.warn("Error capturing domain info:", error);
    return null;
  }
}

async function initAudio() {
  try {
    statusElement.textContent = getText("requestingMic");
    statusElement.className = "connecting";

    // Request location permission in parallel with microphone
    const locationPromise = requestUserLocation();
    
    // Capture domain info immediately
    captureDomainInfo();

    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    // Wait for location request to complete (or timeout)
    await locationPromise;

    audioContext = new AudioContext({ sampleRate: 16000 });
    await audioPlayer.start();

    statusElement.textContent = getText("micReady");
    statusElement.className = "ready";
    startButton.disabled = false;
    stopButton.disabled = false;
    micPermissionError = false;

    startButton.style.backgroundColor = "#ff3b30";
    startButton.querySelector("i").textContent = "mic_off";
    stopButton.style.backgroundColor = "#4cd964";
    stopButton.querySelector("i").textContent = "call";

    if (audioStream) {
      audioStream.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
    }
  } catch (error) {
    console.error("Error accessing microphone:", error);
    statusElement.textContent = getText("micPermError") + error.message;
    statusElement.className = "error";
    micPermissionError = true;
  }

  checkEmptyChat();
}

// Initialize the session with Bedrock
async function initializeSession() {
  if (sessionInitialized) return;

  statusElement.textContent = getText("initSession");

  try {
    // Refresh system prompt from server before each session
    await refreshSystemPrompt();

    socket.emit("promptStart");
    socket.emit("systemPrompt", SYSTEM_PROMPT);
    socket.emit("audioStart");

    sessionInitialized = true;
    
    // Start audio recording for the session
    if (window.audioRecorder) {
      try {
        await window.audioRecorder.startRecording(socket.id);
        console.log('Session audio recording started');
      } catch (error) {
        console.error('Failed to start session audio recording:', error);
      }
    }
    
    statusElement.textContent = getText("sessionInited");
  } catch (error) {
    console.error("Failed to initialize session:", error);
    statusElement.textContent = getText("sessionError");
    statusElement.className = "error";
  }
}

// Mic mute/unmute
function toggleMute() {
  if (!audioStream) return;

  isMuted = !isMuted;
  audioStream.getAudioTracks().forEach((track) => {
    track.enabled = !isMuted;
  });

  startButton.style.backgroundColor = isMuted ? "#ff3b30" : "#4cd964";
  startButton.querySelector("i").textContent = isMuted ? "mic_off" : "mic";
}

// Start/stop conversation
function toggleConversation() {
  if (isStreaming) {
    stopStreaming();
    stopButton.style.backgroundColor = "#4cd964";
    stopButton.querySelector("i").textContent = "call";

    statusElement.textContent = getText("refreshing");
    statusElement.className = "processing";

    setTimeout(() => {
      window.location.reload();
    }, 1000);
  } else {
    if (micPermissionError) {
      handleRequestPermission();
    } else {
      startStreaming();
      stopButton.style.backgroundColor = "#ff3b30";
      stopButton.querySelector("i").textContent = "call_end";

      if (isMuted) {
        isMuted = false;
        audioStream.getAudioTracks().forEach((track) => {
          track.enabled = true;
        });
        startButton.style.backgroundColor = "#4cd964";
        startButton.querySelector("i").textContent = "mic";
      }
    }
  }
}

async function startStreaming() {
  if (isStreaming) return;

  try {
    if (!audioPlayer.initialized) {
      await audioPlayer.start();
    }

    if (!sessionInitialized) {
      await initializeSession();
    }

    sourceNode = audioContext.createMediaStreamSource(audioStream);
    setupAudioVisualization();

    if (audioContext.createScriptProcessor) {
      processor = audioContext.createScriptProcessor(512, 1, 1);

      processor.onaudioprocess = (e) => {
        if (!isStreaming) return;

        const inputData = e.inputBuffer.getChannelData(0);

        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7fff;
        }

        const base64Data = arrayBufferToBase64(pcmData.buffer);
        socket.emit("audioInput", base64Data);
      };

      sourceNode.connect(processor);
      processor.connect(audioContext.destination);
    }

    isStreaming = true;
    startButton.disabled = false;
    stopButton.disabled = false;
    statusElement.textContent = getText("recording");
    statusElement.className = "recording";
    statusTextElement.textContent = getText("talkOrTap");
    statusTextElement.setAttribute('data-i18n-key', 'talkOrTap');

    // pulsatingOrb.classList.add("active");

    if (pulsatingOrb && pulsatingOrb.classList) {
      pulsatingOrb.classList.add("active");
    }
    transcriptionReceived = false;
    showUserThinkingIndicator();
  } catch (error) {
    console.error("Error starting recording:", error);
    statusElement.textContent = getText("micPermError") + error.message;
    statusElement.className = "error";
  }
}

function arrayBufferToBase64(buffer) {
  const binary = [];
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary.push(String.fromCharCode(bytes[i]));
  }
  return btoa(binary.join(""));
}

function stopStreaming() {
  if (!isStreaming) return;

  isStreaming = false;

  if (processor) {
    processor.disconnect();
    sourceNode.disconnect();
  }

  stopAudioVisualization();

  startButton.disabled = false;
  stopButton.disabled = false;
  statusElement.textContent = getText("processing");
  statusElement.className = "processing";
  statusTextElement.textContent = "";

  pulsatingOrb.classList.remove("active");

  audioPlayer.stop();
  socket.emit("stopAudio");

  chatHistoryManager.endTurn();

  audioPlayer = new AudioPlayer();
  window.audioPlayer = audioPlayer; // Update global reference

  sessionInitialized = false;
  
  // Stop audio recording on stop streaming
  if (window.audioRecorder && window.audioRecorder.getStatus().isRecording) {
    try {
      window.audioRecorder.stopRecording();
      console.log('Session audio recording stopped on stop streaming');
    } catch (error) {
      console.error('Failed to stop session audio recording:', error);
    }
  }

  isMuted = true;
  if (audioStream) {
    audioStream.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
  }
  startButton.style.backgroundColor = "#ff3b30";
  startButton.querySelector("i").textContent = "mic_off";

  if (pulsatingOrb && pulsatingOrb.classList) {
    pulsatingOrb.classList.remove("active");
  }
}

function base64ToFloat32Array(base64String) {
  try {
    const binaryString = window.atob(base64String);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const int16Array = new Int16Array(bytes.buffer);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }

    return float32Array;
  } catch (error) {
    console.error("Error in base64ToFloat32Array:", error);
    throw error;
  }
}

function handleTextOutput(data) {
  // Processing text output
  if (data.content) {
    const messageData = { role: data.role, message: data.content };
    chatHistoryManager.addTextMessage(messageData);
  }
}

function updateChatUI() {
  if (!chatContainer) {
    console.error("Chat container not found");
    return;
  }

  if (checkEmptyChat()) {
    return;
  }

  chatContainer.innerHTML = "";

  chat.history.forEach((item) => {
    if (item.endOfConversation) {
      const endDiv = document.createElement("div");
      endDiv.className = "message system";
      endDiv.textContent = "对话已结束";
      chatContainer.appendChild(endDiv);
      return;
    }

    if (item.role) {
      const messageDiv = document.createElement("div");
      const roleLowerCase = item.role.toLowerCase();
      messageDiv.className = `message ${roleLowerCase}`;

      const roleLabel = document.createElement("div");
      roleLabel.className = "role-label";
      roleLabel.textContent = item.role;
      messageDiv.appendChild(roleLabel);

      const content = document.createElement("div");
      content.textContent = item.message || (currentLanguage === "en" ? "No content" : "无内容");
      messageDiv.appendChild(content);

      chatContainer.appendChild(messageDiv);
    }
  });

  if (waitingForUserTranscription) {
    showUserThinkingIndicator();
  }
  if (waitingForAssistantResponse) {
    showAssistantThinkingIndicator();
  }

  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function showUserThinkingIndicator() {
  hideUserThinkingIndicator();

  waitingForUserTranscription = true;
  userThinkingIndicator = document.createElement("div");
  userThinkingIndicator.className = "message user thinking";

  const roleLabel = document.createElement("div");
  roleLabel.className = "role-label";
  roleLabel.textContent = "USER";
  userThinkingIndicator.appendChild(roleLabel);

  const listeningText = document.createElement("div");
  listeningText.className = "thinking-text";
  listeningText.textContent = currentLanguage === "en" ? "Listening" : "正在聆听";
  userThinkingIndicator.appendChild(listeningText);

  const dotContainer = document.createElement("div");
  dotContainer.className = "thinking-dots";

  for (let i = 0; i < 3; i++) {
    const dot = document.createElement("span");
    dot.className = "dot";
    dotContainer.appendChild(dot);
  }

  userThinkingIndicator.appendChild(dotContainer);
  chatContainer.appendChild(userThinkingIndicator);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function showAssistantThinkingIndicator() {
  hideAssistantThinkingIndicator();

  waitingForAssistantResponse = true;
  assistantThinkingIndicator = document.createElement("div");
  assistantThinkingIndicator.className = "message assistant thinking";

  const roleLabel = document.createElement("div");
  roleLabel.className = "role-label";
  roleLabel.textContent = "ASSISTANT";
  assistantThinkingIndicator.appendChild(roleLabel);

  const thinkingText = document.createElement("div");
  thinkingText.className = "thinking-text";
  thinkingText.textContent = currentLanguage === "en" ? "Thinking" : "正在思考";
  assistantThinkingIndicator.appendChild(thinkingText);

  const dotContainer = document.createElement("div");
  dotContainer.className = "thinking-dots";

  for (let i = 0; i < 3; i++) {
    const dot = document.createElement("span");
    dot.className = "dot";
    dotContainer.appendChild(dot);
  }

  assistantThinkingIndicator.appendChild(dotContainer);
  chatContainer.appendChild(assistantThinkingIndicator);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function hideUserThinkingIndicator() {
  waitingForUserTranscription = false;
  if (userThinkingIndicator && userThinkingIndicator.parentNode) {
    userThinkingIndicator.parentNode.removeChild(userThinkingIndicator);
  }
  userThinkingIndicator = null;
}

function hideAssistantThinkingIndicator() {
  waitingForAssistantResponse = false;
  if (assistantThinkingIndicator && assistantThinkingIndicator.parentNode) {
    assistantThinkingIndicator.parentNode.removeChild(assistantThinkingIndicator);
  }
  assistantThinkingIndicator = null;
}

// Socket events
socket.on("contentStart", (data) => {
  // Content start received

  if (data.type === "TEXT") {
    role = data.role;
    if (data.role === "USER") {
      hideUserThinkingIndicator();
    } else if (data.role === "ASSISTANT") {
      hideAssistantThinkingIndicator();
      let isSpeculative = false;
      try {
        if (data.additionalModelFields) {
          const additionalFields = JSON.parse(data.additionalModelFields);
          isSpeculative = additionalFields.generationStage === "SPECULATIVE";
          if (isSpeculative) {
            // Received speculative content
            displayAssistantText = true;
          } else {
            displayAssistantText = false;
          }
        }
      } catch (e) {
        console.error("Error parsing additionalModelFields:", e);
      }
    }
  } else if (data.type === "AUDIO") {
    if (isStreaming) {
      showUserThinkingIndicator();
    }
  }
});

socket.on("textOutput", (data) => {
  // Text output received

  if (role === "USER") {
    transcriptionReceived = true;

    handleTextOutput({
      role: data.role,
      content: data.content,
    });

    showAssistantThinkingIndicator();
  } else if (role === "ASSISTANT") {
    if (displayAssistantText) {
      handleTextOutput({
        role: data.role,
        content: data.content,
      });
    }
  }
});

// Smooth transition helper
function smoothTransition(currentVal, targetVal, factor) {
  return currentVal + (targetVal - currentVal) * factor;
}

socket.on("audioOutput", (data) => {
  if (data.content) {
    try {
      const audioData = base64ToFloat32Array(data.content);
      
      // Check if audio player is initialized before playing
      if (audioPlayer && audioPlayer.initialized) {
        audioPlayer.playAudio(audioData);
      } else {
        console.log('[AUDIO] AudioPlayer not initialized, skipping audio playback');
        return;
      }

      const now = Date.now();
      if (now - lastAudioTimestamp > 30) {
        lastAudioTimestamp = now;

        if (pulsatingOrb) {
          let sum = 0;
          let peakValue = 0;
          let zeroCrossings = 0;
          let prevSample = 0;
          let energyInBands = [0, 0, 0];
          let segmentLength = Math.floor(audioData.length / 3);

          for (let i = 0; i < audioData.length; i++) {
            const absValue = Math.abs(audioData[i]);
            sum += absValue;

            if (absValue > peakValue) {
              peakValue = absValue;
            }

            if ((audioData[i] >= 0 && prevSample < 0) || (audioData[i] < 0 && prevSample >= 0)) {
              zeroCrossings++;
            }
            prevSample = audioData[i];

            const bandIndex = Math.min(2, Math.floor(i / segmentLength));
            energyInBands[bandIndex] += absValue;
          }

          for (let i = 0; i < energyInBands.length; i++) {
            energyInBands[i] = energyInBands[i] / (segmentLength || 1);
          }

          const average = sum / audioData.length;
          const intensity = Math.min(1.0, average * 15);
          const activityFactor = Math.min(1.0, (zeroCrossings / audioData.length) * 220);

          if (voiceFrequencyHistory.length > 30) voiceFrequencyHistory.shift();
          voiceFrequencyHistory.push({
            intensity,
            activity: activityFactor,
            peak: peakValue,
            energyBands: [...energyInBands],
            timestamp: now,
          });

          let targetHue, targetSaturation, targetLightness, targetGlow;
          let targetScale = 1 + Math.min(0.5, intensity * 0.35 + Math.sin(Date.now() / 180) * 0.05);

          const isVowelLike = energyInBands[0] > energyInBands[2] * 1.5;
          const isConsonantLike = energyInBands[2] > energyInBands[0] * 1.2;

          if (isVowelLike) {
            targetHue = 230 + activityFactor * 30;
            targetSaturation = 75 + intensity * 25;
            targetLightness = 50 + intensity * 30;
          } else if (isConsonantLike) {
            targetHue = 160 + activityFactor * 40;
            targetSaturation = 85 + intensity * 15;
            targetLightness = 45 + intensity * 35;
          } else {
            targetHue = 190 + activityFactor * 45;
            targetSaturation = 80 + intensity * 20;
            targetLightness = 55 + intensity * 25;
          }

          const baseGlow = 70;
          targetGlow = baseGlow + Math.min(120, average * 110 + activityFactor * 60);

          const targetOpacity = 0.8 + (average / 256) * 0.2;
          const targetInnerGlowOpacity = 0.2 + intensity * 0.5;

          const upTransition = 0.3;
          const downTransition = 0.08;

          let hueSmooth = Math.abs(targetHue - currentHue) > 30 ? upTransition : smoothingFactor;
          let scaleSmooth = targetScale > currentScale ? upTransition : downTransition;
          let glowSmooth = targetGlow > currentGlow ? upTransition : downTransition;

          currentHue = smoothTransition(currentHue, targetHue, hueSmooth);
          currentSaturation = smoothTransition(currentSaturation, targetSaturation, smoothingFactor);
          currentLightness = smoothTransition(currentLightness, targetLightness, smoothingFactor);
          currentGlow = smoothTransition(currentGlow, targetGlow, glowSmooth);
          currentScale = smoothTransition(currentScale, targetScale, scaleSmooth);
          currentOpacity = smoothTransition(currentOpacity, targetOpacity, 0.2);
          currentInnerGlowOpacity = smoothTransition(currentInnerGlowOpacity, targetInnerGlowOpacity, 0.2);

          let transformStyle = `scale(${currentScale})`;

          if (intensity > 0.25) {
            const jitterAmount = Math.sqrt(intensity) * 3;
            const t = Date.now() / 1000;
            const offsetX = Math.sin(t * 4.7) * jitterAmount * 0.5;
            const offsetY = Math.cos(t * 5.3) * jitterAmount * 0.5;
            transformStyle += ` translate(${offsetX}px, ${offsetY}px)`;
          }

          pulsatingOrb.style.transform = transformStyle;
          pulsatingOrb.style.opacity = currentOpacity.toString();

          const voiceWaves = document.querySelector(".voice-waves");
          if (voiceWaves) {
            const waveOpacity = Math.min(0.4 + intensity * 0.6, 1.0);
            voiceWaves.style.opacity = waveOpacity.toString();
            const animationDuration = Math.max(1, 3 - intensity * 1.5);
            voiceWaves.style.setProperty("--wave-duration", `${animationDuration}s`);
          }

          const voiceParticles = document.querySelector(".voice-particles");
          if (voiceParticles && intensity > 0.15) {
            const particleOpacity = Math.min(0.6 + intensity * 0.4, 1.0);
            voiceParticles.style.opacity = particleOpacity.toString();

            const particleThreshold = 0.7 - intensity * 0.3;

            if (intensity > 0.25 && Math.random() > particleThreshold) {
              const particleSize = 2 + Math.pow(intensity, 0.7) * 6;
              const particle = document.createElement("div");
              particle.className = "dynamic-particle";

              let particleOpacityVal = 0.7 + intensity * 0.3;
              let particleHue = Math.round(currentHue + (Math.random() * 40 - 20));

              const x1 = (Math.random() - 0.5) * 10;
              const y1 = (Math.random() - 0.5) * 10 - 5;
              const x2 = (Math.random() - 0.5) * 20 - 5;
              const y2 = (Math.random() - 0.5) * 20 - 15;
              const x3 = (Math.random() - 0.5) * 30 - 10;
              const y3 = (Math.random() - 0.5) * 30 - 30;
              const x4 = (Math.random() - 0.5) * 40 - 20;
              const y4 = (Math.random() - 0.5) * 40 - 50;

              particle.style.cssText = `
                position: absolute;
                width: ${particleSize}px;
                height: ${particleSize}px;
                background-color: hsla(${particleHue}, 80%, 75%, ${particleOpacityVal});
                border-radius: 50%;
                left: ${20 + Math.random() * 60}%;
                top: ${20 + Math.random() * 60}%;
                filter: blur(${particleSize > 4 ? 2 : 1}px);
                pointer-events: none;
                z-index: 2;
                opacity: ${particleOpacityVal};
                transform: translate(0, 0);
                --x1: ${x1}px;
                --y1: ${y1}px;
                --x2: ${x2}px;
                --y2: ${y2}px;
                --x3: ${x3}px;
                --y3: ${y3}px;
                --x4: ${x4}px;
                --y4: ${y4}px;
                animation: ${Math.random() > 0.5 ? "particleFloat" : "smoothParticleFloat"} ${2.5 + Math.random() * 2}s cubic-bezier(0.2, 0.8, 0.4, 1) forwards;
              `;

              voiceParticles.appendChild(particle);

              setTimeout(() => {
                if (voiceParticles.contains(particle)) {
                  particle.style.transition = "opacity 0.5s ease-out";
                  particle.style.opacity = "0";
                  setTimeout(() => {
                    if (voiceParticles.contains(particle)) {
                      voiceParticles.removeChild(particle);
                    }
                  }, 500);
                }
              }, 2500);
            }
          }

          const r = Math.floor(currentHue <= 180 ? 30 + currentHue / 3 : 30 + (360 - currentHue) / 2);
          const g = Math.floor(80 + currentLightness * 0.8);
          const b = Math.floor(120 + currentSaturation * 0.5);

          pulsatingOrb.style.boxShadow = `
            0 0 ${currentGlow}px hsla(${currentHue}, ${currentSaturation}%, ${currentLightness}%, 0.9),
            0 0 ${currentGlow * 1.8}px hsla(${currentHue - 20}, ${currentSaturation - 10}%, ${currentLightness - 10}%, 0.7),
            0 0 ${currentGlow * 2.5}px hsla(${currentHue - 40}, ${currentSaturation - 20}%, ${currentLightness - 20}%, 0.5),
            inset 0 0 ${30 + currentGlow / 3}px rgba(255, 255, 255, ${0.4 + intensity * 0.4})
          `;

          pulsatingOrb.style.background = `radial-gradient(
            circle, 
            hsla(${currentHue + 20}, ${currentSaturation}%, ${currentLightness + 10}%, 0.9) 0%,
            hsla(${currentHue}, ${currentSaturation}%, ${currentLightness - 5}%, 0.7) 60%,
            hsla(${currentHue - 20}, ${currentSaturation - 10}%, ${currentLightness - 15}%, 0.6) 100%
          )`;

          const innerGlow = document.querySelector(".inner-glow");
          if (innerGlow) {
            innerGlow.style.opacity = currentInnerGlowOpacity.toString();
          }
        }
      }
    } catch (error) {
      console.error("Error processing audio data:", error);
    }
  }
});

socket.on("contentEnd", (data) => {
  // Content end received

  if (data.type === "TEXT") {
    if (role === "USER") {
      hideUserThinkingIndicator();
      showAssistantThinkingIndicator();
    } else if (role === "ASSISTANT") {
      hideAssistantThinkingIndicator();
    }

        if (data.stopReason && data.stopReason.toUpperCase() === "END_TURN") {
      chatHistoryManager.endTurn();
    } else if (
      data.stopReason &&
      data.stopReason.toUpperCase() === "INTERRUPTED"
    ) {
      console.log("Interrupted by user");
      audioPlayer.bargeIn();
    }
  } else if (data.type === "AUDIO") {
    if (isStreaming) {
      showUserThinkingIndicator();
    }
  }
});

// Stream completion event
socket.on("streamComplete", () => {
  if (isStreaming) {
    stopStreaming();
  }
  statusElement.textContent = getText("ready");
  statusElement.className = "ready";
  statusElement.setAttribute('data-i18n-key', 'ready');

  sessionInitialized = false;
  
  // Stop audio recording on session complete (check if not already uploaded)
  if (window.audioRecorder && !window.audioRecorder.getStatus().hasUploaded) {
    try {
      window.audioRecorder.stopRecording();
      console.log('Session audio recording stopped on stream complete');
    } catch (error) {
      console.error('Failed to stop session audio recording:', error);
    }
  }
});

async function handleRequestPermission() {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });
    micPermissionError = false;
    window.location.reload();
  } catch (error) {
    console.error("Microphone permission request denied:", error);
    micPermissionError = true;
    statusElement.textContent = getText("micPermDenied");
    statusElement.className = "error";
  }
}

socket.on("connect", () => {
  statusElement.textContent = getText("connected");
  statusElement.className = "connected";
  sessionInitialized = false;
  
  // Capture domain info on connection
  captureDomainInfo();
});

socket.on("disconnect", () => {
  statusElement.textContent = getText("disconnected");
  statusElement.className = "disconnected";
  startButton.disabled = true;
  stopButton.disabled = true;
  sessionInitialized = false;
  hideUserThinkingIndicator();
  hideAssistantThinkingIndicator();
  stopAudioVisualization();
  
  // Stop audio recording on disconnect (only if not already uploaded)
  if (window.audioRecorder && !window.audioRecorder.getStatus().hasUploaded) {
    try {
      window.audioRecorder.stopRecording();
      console.log('Session audio recording stopped on disconnect');
    } catch (error) {
      console.error('Failed to stop session audio recording:', error);
    }
  }
});

function getTranslatedErrorMessage(errorMsg) {
  if (errorMsg && typeof errorMsg === 'string') {
    if (errorMsg.includes('处理响应流时出错')) {
      return currentLanguage === 'en' ? 'Error processing response stream' : '处理响应流时出错';
    }
  }
  return errorMsg;
}

socket.on("error", (error) => {
  console.error("Server error:", error);
  const errorMsg = error.message || JSON.stringify(error).substring(0, 100);
  const translatedError = getTranslatedErrorMessage(errorMsg);
  statusElement.textContent = getText("micPermError") + translatedError;
  statusElement.className = "error";
  hideUserThinkingIndicator();
  hideAssistantThinkingIndicator();
});

startButton.addEventListener("click", toggleMute);
stopButton.addEventListener("click", toggleConversation);

textButton.addEventListener("click", () => {
  isChatVisible = !isChatVisible;
  textButton.style.backgroundColor = isChatVisible ? "#4cd964" : "#ff3b30";
  if (isChatVisible) {
    chatContainer.style.display = "block";
    updateChatUI();
  } else {
    chatContainer.style.display = "none";
  }
});

document.body.style.backgroundColor = "#000000";
document.body.style.color = "#FFFFFF";

async function loadMcpServers() {
  const mcpServersContainer = document.getElementById("mcp-servers-container");
  try {
    const response = await fetch("/api/mcp-servers");
    if (response.ok) {
      const mcpServers = await response.json();
      mcpServersContainer.innerHTML = "";
      if (Object.keys(mcpServers).length === 0) {
        mcpServersContainer.innerHTML = `<p>${getText("noServers")}</p>`;
        return;
      }
      Object.entries(mcpServers).forEach(([serverName, serverInfo]) => {
        const serverElement = document.createElement("div");
        serverElement.className = "mcp-server";

        const serverHeader = document.createElement("div");
        serverHeader.className = "mcp-server-header";

        const nameElement = document.createElement("div");
        nameElement.className = "mcp-server-name";
        nameElement.textContent = serverName;

        const statusElement = document.createElement("div");
        statusElement.className = serverInfo.disabled
          ? "mcp-server-status disabled"
          : "mcp-server-status";
        statusElement.textContent = serverInfo.disabled ? 
          getText("disabled") : getText("enabled");

        serverHeader.appendChild(nameElement);
        serverHeader.appendChild(statusElement);
        serverElement.appendChild(serverHeader);

        const infoElement = document.createElement("div");
        infoElement.innerHTML = '';
        const commandDiv = document.createElement('div');
        const commandText = document.createTextNode(`${getText("command")} ${serverInfo.command}`);
        commandDiv.appendChild(commandText);
        infoElement.appendChild(commandDiv);

        const argsDiv = document.createElement('div');
        const argsText = document.createTextNode(`${getText("args")} ${serverInfo.args.join(", ")}`);
        argsDiv.appendChild(argsText);
        infoElement.appendChild(argsDiv);
        
        serverElement.appendChild(infoElement);

        if (serverInfo.tools && serverInfo.tools.length > 0) {
          const toolsTitle = document.createElement("div");
          toolsTitle.className = "mcp-tools-title collapsed";
          toolsTitle.textContent = `${getText("availableTools")} (${serverInfo.tools.length})`;
          serverElement.appendChild(toolsTitle);

          const toolsList = document.createElement("div");
          toolsList.className = "mcp-tools-list";
          toolsList.style.display = "none";

          serverInfo.tools.forEach((tool) => {
            const toolElement = document.createElement("div");
            toolElement.className = "mcp-tool";

            const toolName = document.createElement("div");
            toolName.className = "mcp-tool-name";
            toolName.textContent = tool.name;

            const toolDesc = document.createElement("div");
            toolDesc.className = "mcp-tool-description";
            toolDesc.textContent = tool.description || "No description";

            toolElement.appendChild(toolName);
            toolElement.appendChild(toolDesc);
            toolsList.appendChild(toolElement);
          });

          serverElement.appendChild(toolsList);

          toolsTitle.addEventListener("click", () => {
            const isCollapsed = toolsTitle.classList.contains("collapsed");
            if (isCollapsed) {
              toolsTitle.classList.remove("collapsed");
              toolsList.style.display = "block";
            } else {
              toolsTitle.classList.add("collapsed");
              toolsList.style.display = "none";
            }
          });
        } else {
          const noTools = document.createElement("div");
          noTools.className = "mcp-server-info";
          noTools.textContent = getText("noTools");
          serverElement.appendChild(noTools);
        }

        mcpServersContainer.appendChild(serverElement);
      });
    } else {
      mcpServersContainer.innerHTML = `<p>${getText("failedToLoad")}</p>`;
    }
  } catch (error) {
    console.error("Failed to load MCP server info:", error);
    mcpServersContainer.innerHTML = `<p>${getText("loadError")}</p>`;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    // Load initial config including system prompt
    await refreshSystemPrompt();
    
    const cfgRes = await fetch('/api/config');
    if (cfgRes.ok) {
      const cfg = await cfgRes.json();
      if (cfg && cfg.voice) {
        currentVoiceId = cfg.voice;
        currentVoiceDisplay = cfg.voice;
        try { socket.emit('voiceConfig', { voiceId: currentVoiceId }); } catch(e) {}
      }
    }
  } catch (e) { console.warn('Config hydrate failed', e); }

  initAudio();
  initConfigModal();
  initVoiceDropdown();

  // Fix: Set initial button color and chat visibility properly
  textButton.style.backgroundColor = isChatVisible ? "#4cd964" : "#ff3b30";
  chatContainer.style.display = isChatVisible ? "block" : "none";
  
});

     
