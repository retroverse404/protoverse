// ========== Background Audio Management ==========
import { getAudioEnabled } from "./hud.js";

let currentAudio = null; // Currently playing audio element
let currentWorldData = null; // Cache current world data for audio checking
let urlResolver = null; // Function to resolve relative URLs
let audioContext = null; // Shared AudioContext for VR compatibility

/**
 * Initialize the audio module with a URL resolver function
 * @param {Function} resolveUrlFn - Function to resolve relative paths to full URLs
 */
export function initAudio(resolveUrlFn) {
    urlResolver = resolveUrlFn;
}

/**
 * Ensure AudioContext is created and resumed (required for VR audio)
 * Call this before playing any audio, especially in VR
 * @returns {Promise<boolean>} True if AudioContext is ready
 */
export async function ensureAudioContext() {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            console.warn("AudioContext not supported");
            return false;
        }
        
        if (!audioContext) {
            audioContext = new AudioContextClass();
        }
        
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
            console.log("AudioContext resumed for VR audio");
        }
        
        return audioContext.state === 'running';
    } catch (error) {
        console.warn("Failed to initialize AudioContext:", error);
        return false;
    }
}

/**
 * Setup iOS audio unlock - call this once at app startup
 * Listens for first user interaction and unlocks AudioContext
 * @param {THREE.AudioListener} threeAudioListener - Optional THREE.js AudioListener to also resume
 */
let audioUnlockSetup = false;
let threeListener = null;

export function setupIOSAudioUnlock(threeAudioListener = null) {
    if (audioUnlockSetup) return;
    audioUnlockSetup = true;
    threeListener = threeAudioListener;
    
    const unlockAudio = async () => {
        console.log("[Audio] User interaction detected, unlocking audio...");
        
        // Resume main audio context
        await ensureAudioContext();
        
        // Resume THREE.js AudioListener context (critical for spatial audio on iOS!)
        if (threeListener && threeListener.context) {
            const ctx = threeListener.context;
            console.log("[Audio] THREE context state before resume:", ctx.state);
            
            if (ctx.state === 'suspended') {
                try {
                    await ctx.resume();
                    console.log("[Audio] THREE.AudioListener context resumed:", ctx.state);
                } catch (e) {
                    console.warn("[Audio] Failed to resume THREE.AudioListener context:", e);
                }
            }
            
            // iOS workaround: play a silent buffer to truly unlock the context
            try {
                const buffer = ctx.createBuffer(1, 1, 22050);
                const source = ctx.createBufferSource();
                source.buffer = buffer;
                source.connect(ctx.destination);
                source.start(0);
                console.log("[Audio] iOS silent buffer played");
            } catch (e) {
                console.warn("[Audio] Silent buffer workaround failed:", e);
            }
            
            // Check state after workaround
            console.log("[Audio] THREE context state after workaround:", ctx.state);
        } else {
            console.warn("[Audio] No THREE.AudioListener context available!");
        }
        
        // Also try to unlock any HTML5 audio elements
        document.querySelectorAll('audio').forEach(audio => {
            audio.muted = false;
        });
        
        // Remove listeners after first unlock
        document.removeEventListener('touchstart', unlockAudio);
        document.removeEventListener('touchend', unlockAudio);
        document.removeEventListener('click', unlockAudio);
        console.log("[Audio] Audio unlocked");
    };
    
    // Listen for any user interaction
    document.addEventListener('touchstart', unlockAudio, { once: true });
    document.addEventListener('touchend', unlockAudio, { once: true });
    document.addEventListener('click', unlockAudio, { once: true });
    
    console.log("[Audio] iOS audio unlock listeners installed");
}

/**
 * Set the current world data (for use when toggling audio on)
 * @param {Object} worldData - World data object
 */
export function setCurrentWorldData(worldData) {
    currentWorldData = worldData;
}

/**
 * Get the current world data
 * @returns {Object} Current world data
 */
export function getCurrentWorldData() {
    return currentWorldData;
}

/**
 * Play background audio for a world if bgAudio or bgAudioUrl is specified
 * If no audio is specified in the world data, keep current audio playing
 * @param {Object} worldData - World data object that may contain bgAudio or bgAudioUrl
 */
export async function playWorldAudio(worldData) {
    // Check if world has bgAudio or bgAudioUrl field (support both)
    const audioUrlField = worldData?.bgAudioUrl || worldData?.bgAudio;
    
    // If no audio field specified, keep current audio playing (don't stop it)
    if (!audioUrlField) {
        console.log("No audio specified for world, keeping current audio");
        return;
    }
    
    // Resolve the audio URL
    const newAudioUrl = audioUrlField.startsWith('http') 
        ? audioUrlField 
        : (urlResolver ? urlResolver(audioUrlField) : audioUrlField);
    
    // Check if we're already playing this same audio
    if (currentAudio && currentAudio.src === newAudioUrl) {
        console.log("Already playing this audio, skipping");
        return;
    }
    
    // Stop current audio if playing (only when switching to different audio)
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio = null;
    }
    
    // Only play if audio is enabled
    if (!getAudioEnabled()) {
        return;
    }
    
    try {
        console.log("Playing background audio:", newAudioUrl);
        
        // Ensure AudioContext is ready (required for VR audio on Quest)
        await ensureAudioContext();
        
        // Create and play audio
        currentAudio = new Audio(newAudioUrl);
        currentAudio.loop = true; // Loop the background audio
        currentAudio.volume = 0.25; // Set volume (0.0 to 1.0)
        
        // Play with error handling
        await currentAudio.play().catch(error => {
            console.warn("Failed to play audio:", error);
            currentAudio = null;
        });
    } catch (error) {
        console.warn("Error loading audio:", error);
        currentAudio = null;
    }
}

/**
 * Handle audio toggle callback from HUD
 * @param {boolean} enabled - Whether audio is now enabled
 */
export async function handleAudioToggle(enabled) {
    console.log("handleAudioToggle:", enabled);
    console.log("  currentWorldData:", currentWorldData);
    console.log("  bgAudioUrl:", currentWorldData?.bgAudioUrl);
    
    if (enabled) {
        try {
            // Ensure AudioContext is ready (required for VR)
            const contextReady = await ensureAudioContext();
            console.log("  AudioContext ready:", contextReady);
            
            // If audio was just enabled and we have world data, play it
            if (currentWorldData) {
                await playWorldAudio(currentWorldData);
                console.log("  Audio started successfully");
            } else {
                console.warn("  No world data available for audio");
            }
        } catch (error) {
            console.error("  Error starting audio:", error);
        }
    } else {
        // If audio was just disabled, stop current audio
        if (currentAudio) {
            currentAudio.pause();
            currentAudio.currentTime = 0;
            console.log("  Audio stopped");
        }
    }
}

/**
 * Stop any currently playing audio
 */
export function stopAudio() {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio = null;
    }
}

/**
 * Set audio volume
 * @param {number} volume - Volume level from 0.0 to 1.0
 */
export function setVolume(volume) {
    if (currentAudio) {
        currentAudio.volume = Math.max(0, Math.min(1, volume));
    }
}

