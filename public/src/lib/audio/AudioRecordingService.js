/**
 * High-Quality Session Audio Recording Service
 * Records both user voice and assistant audio with upload to S3
 */
class AudioRecordingService {
    constructor() {
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.isRecording = false;
        this.isUploading = false;
        this.hasUploaded = false;
        this.sessionId = null;
        this.startTime = null;
        this.userStream = null;
        this.systemStream = null;
        this.audioContext = null;
        this.audioBase64 = null; // Store base64 audio for webhook
        
        // High quality audio settings
        this.options = {
            mimeType: 'audio/webm;codecs=opus',
            audioBitsPerSecond: 128000 // 128kbps for high quality
        };
        
        // Fallback for browsers that don't support webm
        if (!MediaRecorder.isTypeSupported(this.options.mimeType)) {
            this.options = {
                mimeType: 'audio/mp4',
                audioBitsPerSecond: 128000
            };
        }
        
        // console.log(`[AUDIO] AudioRecordingService initialized with ${this.options.mimeType}`);
        
        // Add page unload handlers to ensure upload happens
        this.setupUnloadHandlers();
    }
    
    setupUnloadHandlers() {
        // Handle page unload/refresh
        window.addEventListener('beforeunload', () => {
            if (this.isRecording && !this.hasUploaded) {
                // console.log('[AUDIO] Page unloading, stopping recording and uploading...');
                this.stopRecording();
            }
        });
        
        // Handle page visibility changes
        // document.addEventListener('visibilitychange', () => {
        //     if (document.hidden && this.isRecording && !this.hasUploaded) {
        //         // console.log('[AUDIO] Page hidden, attempting upload...');
        //         this.stopRecording();
        //     }
        // });
    }
    
    // New method to capture assistant audio directly from AudioPlayer
    setupAudioPlayerCapture() {
        // Check if audioPlayer is available globally and initialized
        // console.log('[AUDIO] 🔍 Checking AudioPlayer availability...');
        // console.log(`[AUDIO] window.audioPlayer exists: ${!!window.audioPlayer}`);
        
        if (window.audioPlayer) {
            // console.log(`[AUDIO] AudioPlayer initialized: ${window.audioPlayer.initialized}`);
            // console.log(`[AUDIO] AudioPlayer has audioContext: ${!!window.audioPlayer.audioContext}`);
            // console.log(`[AUDIO] AudioPlayer has analyser: ${!!window.audioPlayer.analyser}`);
            
            if (window.audioPlayer.audioContext) {
                // console.log(`[AUDIO] AudioContext state: ${window.audioPlayer.audioContext.state}`);
                // console.log(`[AUDIO] AudioContext sample rate: ${window.audioPlayer.audioContext.sampleRate}Hz`);
            }
        }
        
        if (window.audioPlayer && window.audioPlayer.initialized && window.audioPlayer.audioContext && window.audioPlayer.analyser) {
            // console.log('[AUDIO] 🎯 Hooking into AudioPlayer for assistant audio capture');
            
            try {
                // Create a gain node in the AudioPlayer's audio graph to tap the assistant audio
                const assistantGain = window.audioPlayer.audioContext.createGain();
                assistantGain.gain.value = 1.0;
                
                // Get the worklet node (where assistant audio flows through)
                const workletNode = window.audioPlayer.workletNode;
                if (workletNode) {
                    // Create a media stream destination to capture assistant audio
                    this.assistantDestination = window.audioPlayer.audioContext.createMediaStreamDestination();
                    
                    // Connect worklet to our destination
                    workletNode.connect(assistantGain);
                    assistantGain.connect(this.assistantDestination);
                    
                    // console.log('[AUDIO] ✅ Assistant audio tap created via worklet node');
                    // console.log(`[AUDIO] Assistant stream tracks: ${this.assistantDestination.stream.getTracks().length}`);
                    
                    return true;
                } else {
                    console.log('[AUDIO] ⚠️ AudioPlayer workletNode not available');
                    return false;
                }
            } catch (error) {
                console.error('[AUDIO] ❌ Failed to hook into AudioPlayer:', error);
                return false;
            }
        } else {
            console.log('[AUDIO] ⚠️ AudioPlayer not available or not fully initialized - will record microphone only');
            if (window.audioPlayer) {
                // console.log(`[AUDIO] AudioPlayer state: initialized=${window.audioPlayer.initialized}, hasContext=${!!window.audioPlayer.audioContext}, hasAnalyser=${!!window.audioPlayer.analyser}`);
            } else {
                console.log('[AUDIO] window.audioPlayer is undefined');
            }
            return false;
        }
    }
    
    async startRecording(sessionId) {
        try {
            // Prevent starting new recording if one is already active or uploading
            if (this.isRecording) {
                // console.log('[AUDIO] Recording already in progress, cannot start new recording');
                return false;
            }
            
            if (this.isUploading) {
                // console.log('[AUDIO] Previous session still uploading, waiting...');
                // Wait for upload to complete before starting new recording
                const maxWaitTime = 10000; // 10 seconds max
                const startWait = Date.now();
                while (this.isUploading && (Date.now() - startWait) < maxWaitTime) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                
                if (this.isUploading) {
                    // console.log('[AUDIO] Timeout waiting for upload, proceeding anyway');
                }
            }
            
            this.sessionId = sessionId;
            this.startTime = new Date();
            this.recordedChunks = [];
            this.hasUploaded = false; // Reset for new session
            
            // console.log(`[AUDIO] Starting recording for session: ${sessionId}`);
            
            // Get user microphone stream with high quality settings
            this.userStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true, 
                    autoGainControl: true,
                    sampleRate: 48000,
                    channelCount: 1
                }
            });
            
            // console.log('[AUDIO] User microphone stream obtained');
            
            // Hook into AudioPlayer for assistant audio instead of system capture
            const hasAssistantAudio = this.setupAudioPlayerCapture();
            
            // If AudioPlayer is not ready yet, try again after a short delay
            if (!hasAssistantAudio) {
                // console.log('[AUDIO] 🔄 AudioPlayer not ready, will retry in 2 seconds...');
                setTimeout(() => {
                    const retrySuccess = this.setupAudioPlayerCapture();
                    if (retrySuccess) {
                        // console.log('[AUDIO] 🎉 Successfully hooked into AudioPlayer on retry!');
                        // console.log('[AUDIO] ⚠️ Note: Recording already started with microphone only - assistant audio may not be included in this session');
                    }
                }, 2000);
            }
            
            // Create audio context for processing
            this.audioContext = new AudioContext({ 
                sampleRate: 48000,
                latencyHint: 'playback'
            });
            
            const destination = this.audioContext.createMediaStreamDestination();
            
            // Add user microphone to the mix
            const userSource = this.audioContext.createMediaStreamSource(this.userStream);
            const userGain = this.audioContext.createGain();
            userGain.gain.value = 1.0; // Full volume for user voice
            userSource.connect(userGain);
            userGain.connect(destination);
            
            // Add assistant audio if available
            if (this.assistantDestination && this.assistantDestination.stream.getAudioTracks().length > 0) {
                // console.log('[AUDIO] 🎵 Adding assistant audio to mix...');
                
                // Create a sample rate converter since assistant is 24kHz and recording is 48kHz
                const assistantSource = this.audioContext.createMediaStreamSource(this.assistantDestination.stream);
                const assistantGain = this.audioContext.createGain();
                assistantGain.gain.value = 0.8; // Slightly lower volume for assistant to avoid feedback
                assistantSource.connect(assistantGain);
                assistantGain.connect(destination);
                
                // console.log('[AUDIO] ✅ Mixed audio setup: User microphone + Assistant audio (direct tap)');
            } else {
                console.log('[AUDIO] 🎤 Audio setup: User microphone only');
                if (!this.assistantDestination) {
                    console.log('[AUDIO] ⚠️ Assistant destination not available');
                } else if (this.assistantDestination.stream.getAudioTracks().length === 0) {
                    console.log('[AUDIO] ⚠️ Assistant stream has no audio tracks');
                }
            }
            
            // Start recording the mixed stream
            this.mediaRecorder = new MediaRecorder(destination.stream, this.options);
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.recordedChunks.push(event.data);
                    // console.log(`[AUDIO] Recorded chunk: ${event.data.size} bytes`);
                }
            };
            
            this.mediaRecorder.onstop = () => {
                // console.log('[AUDIO] Recording stopped, initiating upload...');
                this.uploadRecording();
            };
            
            this.mediaRecorder.onerror = (event) => {
                console.error('[AUDIO] MediaRecorder error:', event);
            };
            
            this.mediaRecorder.start(1000); // Collect data every second for better quality
            this.isRecording = true;
            
            // console.log(`[AUDIO] ✅ Started high-quality recording for session: ${sessionId}`);
            // console.log(`[AUDIO] Recording format: ${this.options.mimeType} at ${this.options.audioBitsPerSecond}bps`);
            
            return true;
            
        } catch (error) {
            console.error('[AUDIO] ❌ Failed to start recording:', error);
            this.cleanup();
            return false;
        }
    }
    
    stopRecording() {
        if (this.mediaRecorder && this.isRecording && !this.isUploading && !this.hasUploaded) {
            console.log(`[AUDIO] Stopping recording for session: ${this.sessionId}`);
            this.mediaRecorder.stop();
            this.isRecording = false;
        } else {
            if (!this.mediaRecorder) {
                console.log('[AUDIO] No media recorder to stop');
            } else if (!this.isRecording) {
                console.log('[AUDIO] Recording already stopped');
            } else if (this.isUploading) {
                console.log('[AUDIO] Upload already in progress, skipping stop');
            } else if (this.hasUploaded) {
                console.log('[AUDIO] Recording already uploaded, skipping stop');
            }
        }
    }
    
    async uploadRecording() {
        // Prevent multiple uploads
        if (this.isUploading || this.hasUploaded) {
            // console.log('[AUDIO] Upload already in progress or completed, skipping...');
            return;
        }
        
        if (this.recordedChunks.length === 0) {
            console.log('[AUDIO] No audio data to upload');
            this.cleanup();
            return;
        }
        
        // Check if page is unloading or document is not in a good state
        // if (document.hidden || document.visibilityState === 'hidden') {
        //     console.log('[AUDIO] Page is hidden/unloading, deferring upload...');
        //     // Try to use sendBeacon for background upload
        //     this.uploadViaBeacon();
        //     return;
        // }
        
        try {
            console.log(`[AUDIO] Preparing upload: ${this.recordedChunks.length} chunks`);
            this.isUploading = true;
            
            // Create high-quality blob from recorded chunks
            const audioBlob = new Blob(this.recordedChunks, {
                type: this.options.mimeType
            });
            
            console.log(`[AUDIO] Audio blob created: ${(audioBlob.size / 1024 / 1024).toFixed(2)} MB`);
            
            // Generate filename matching transcript format
            const date = this.startTime.toISOString().split('T')[0]; // YYYY-MM-DD
            const time = this.startTime.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
            
            const fileExtension = this.options.mimeType.includes('webm') ? 'webm' : 'mp4';
            const filename = `${this.sessionId}_${date}_${time}.${fileExtension}`;
            
            console.log(`[AUDIO] Upload filename: ${filename}`);
            
            // Upload to same S3 location as transcript
            const formData = new FormData();
            formData.append('audio', audioBlob, filename);
            formData.append('sessionId', this.sessionId);
            formData.append('startTime', this.startTime.toISOString());
            formData.append('fileSize', audioBlob.size.toString());
            
            console.log('[AUDIO] Uploading to server...');
            
            // Add timeout and better error handling with retry logic
            let uploadSuccess = false;
            let lastError = null;
            const maxRetries = 2; // Keep it simple with 2 attempts
            
            console.log(`[AUDIO] Starting upload with ${maxRetries} max attempts...`);
            
            for (let attempt = 0; attempt < maxRetries && !uploadSuccess; attempt++) {
                console.log(`[AUDIO] Upload attempt ${attempt + 1} of ${maxRetries}`);
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 10000); // Shorter 10 second timeout
                    
                    const response = await fetch('/api/upload-session-audio', {
                        method: 'POST',
                        body: formData,
                        signal: controller.signal,
                        // Add credentials and proper headers for CORS
                        credentials: 'same-origin',
                        headers: {
                            // Don't set Content-Type, let browser set it with boundary
                            'X-Requested-With': 'XMLHttpRequest'
                        }
                    });
                    
                    clearTimeout(timeoutId);
                    console.log(`[AUDIO] Server response status: ${response.status} (attempt ${attempt + 1})`);
                    
                    if (response.ok) {
                        const contentType = response.headers.get('content-type');
                        if (contentType && contentType.includes('application/json')) {
                            const result = await response.json();
                            console.log(`[AUDIO] ✅ Successfully uploaded: ${result.s3Key}`);
                            console.log(`[AUDIO] File size: ${(result.fileSize / 1024 / 1024).toFixed(2)} MB`);
                            
                            this.hasUploaded = true;
                            uploadSuccess = true;
                            
                            // Show success notification to user
                            this.showUploadSuccess(result);
                        } else {
                            const textResult = await response.text();
                            console.log('[AUDIO] ✅ Upload successful (non-JSON response):', textResult);
                            this.hasUploaded = true;
                            uploadSuccess = true;
                            this.showUploadSuccess({ message: 'Upload completed successfully' });
                        }
                    } else {
                        const errorText = await response.text();
                        lastError = new Error(`HTTP ${response.status}: ${errorText}`);
                        console.error(`[AUDIO] ❌ Upload failed (attempt ${attempt + 1}):`, response.status, errorText);
                        
                        // Don't retry for client errors (4xx)
                        if (response.status >= 400 && response.status < 500) {
                            console.log('[AUDIO] Client error, not retrying');
                            break;
                        }
                    }
                } catch (fetchError) {
                    lastError = fetchError;
                    
                    // Log as info instead of error since this is expected during session teardown
                    if (fetchError.name === 'TypeError' && fetchError.message === 'Failed to fetch') {
                        console.log(`[AUDIO] ℹ️ Network unavailable (attempt ${attempt + 1}): ${fetchError.message} - will retry or use fallback`);
                    } else if (fetchError.name === 'AbortError') {
                        console.log(`[AUDIO] ℹ️ Upload timeout (attempt ${attempt + 1}) - will retry or use fallback`);
                    } else {
                        console.log(`[AUDIO] ℹ️ Upload error (attempt ${attempt + 1}): ${fetchError.message} - will retry or use fallback`);
                    }
                    
                    // For any network error, wait briefly then continue to next attempt or fallback
                    if (attempt < maxRetries - 1) {
                        console.log(`[AUDIO] Waiting 1 second before retry ${attempt + 2}...`);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }
            }
            
            console.log(`[AUDIO] Upload loop completed. Success: ${uploadSuccess}`);
            
            if (!uploadSuccess) {
                console.log('[AUDIO] All fetch attempts failed, trying beacon upload as last resort...');
                this.uploadViaBeacon();
                // Don't throw error since we tried beacon upload
                return;
            }
            
        } catch (error) {
            console.log('[AUDIO] ℹ️ Upload process encountered an issue:', error.message, '- using beacon fallback');
            
            // Always fall back to beacon upload instead of showing error
            this.uploadViaBeacon();
        } finally {
            this.isUploading = false;
            // Always cleanup after upload attempt
            this.cleanup();
        }
    }
    
    // Fallback upload method using sendBeacon for page unload scenarios
    uploadViaBeacon() {
        try {
            console.log('[AUDIO] Attempting upload via sendBeacon...');
            
            if (this.recordedChunks.length === 0) {
                console.log('[AUDIO] No data for beacon upload');
                return;
            }
            
            // Create audio blob
            const audioBlob = new Blob(this.recordedChunks, {
                type: this.options.mimeType
            });
            
            const date = this.startTime.toISOString().split('T')[0];
            const time = this.startTime.toTimeString().split(' ')[0].replace(/:/g, '-');
            const fileExtension = this.options.mimeType.includes('webm') ? 'webm' : 'mp4';
            const filename = `${this.sessionId}_${date}_${time}.${fileExtension}`;
            
            // Create FormData for beacon
            const formData = new FormData();
            formData.append('audio', audioBlob, filename);
            formData.append('sessionId', this.sessionId);
            formData.append('startTime', this.startTime.toISOString());
            formData.append('fileSize', audioBlob.size.toString());
            
            // Use sendBeacon for reliable upload during page unload
            if (navigator.sendBeacon) {
                const sent = navigator.sendBeacon('/api/upload-session-audio', formData);
                console.log(`[AUDIO] Beacon upload ${sent ? 'queued' : 'failed'}`);
                if (sent) {
                    this.hasUploaded = true;
                }
            } else {
                console.log('[AUDIO] sendBeacon not supported, upload may be lost');
            }
            
        } catch (error) {
            console.error('[AUDIO] Error in beacon upload:', error);
        } finally {
            this.cleanup();
        }
    }
    
    cleanup() {
        console.log('[AUDIO] Cleaning up recording resources...');
        
        // Stop all media streams
        if (this.userStream) {
            this.userStream.getTracks().forEach(track => track.stop());
            this.userStream = null;
        }
        
        if (this.systemStream) {
            this.systemStream.getTracks().forEach(track => track.stop());
            this.systemStream = null;
        }
        
        // Close audio context
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
            this.audioContext = null;
        }
        
        // Clear recorded data
        this.recordedChunks = [];
        this.sessionId = null;
        this.startTime = null;
        this.isRecording = false;
        this.isUploading = false;
        // Note: Don't reset hasUploaded here as it prevents duplicate uploads
        
        console.log('[AUDIO] Cleanup completed');
    }
    
    showUploadSuccess(result) {
        // Create a temporary success notification
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #10b981;
            color: white;
            padding: 12px 16px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 14px;
            max-width: 300px;
        `;
        notification.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 4px;">🎙️ Recording Saved</div>
            <div style="opacity: 0.9; font-size: 12px;">Session audio uploaded successfully</div>
        `;
        
        document.body.appendChild(notification);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 5000);
    }
    
    showUploadError(message) {
        // Create a temporary error notification
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #ef4444;
            color: white;
            padding: 12px 16px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 14px;
            max-width: 300px;
        `;
        notification.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 4px;">⚠️ Recording Error</div>
            <div style="opacity: 0.9; font-size: 12px;">${message}</div>
        `;
        
        document.body.appendChild(notification);
        
        // Auto-remove after 8 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 8000);
    }
    
    // Method to check recording status
    getStatus() {
        return {
            isRecording: this.isRecording,
            isUploading: this.isUploading,
            hasUploaded: this.hasUploaded,
            sessionId: this.sessionId,
            startTime: this.startTime,
            chunksRecorded: this.recordedChunks.length,
            hasUserStream: !!this.userStream,
            hasSystemStream: !!this.systemStream,
            audioFormat: this.options.mimeType
        };
    }
    
    // Method to force reset state (for debugging or edge cases)
    forceReset() {
        console.log('[AUDIO] Force resetting recording service state');
        this.cleanup();
        this.hasUploaded = false;
        this.isUploading = false;
        this.mediaRecorder = null;
    }
}

// Make available globally
window.AudioRecordingService = AudioRecordingService;

console.log('[AUDIO] AudioRecordingService loaded and ready');
