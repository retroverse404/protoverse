/**
 * Spatial Audio System
 * 
 * Manages positional audio sources defined in world.json files.
 * Features:
 * - Continuous looping audio (ambient sounds)
 * - Proximity-triggered one-shot audio
 * - Debug visualization spheres
 * - Per-world audio source management
 */

import * as THREE from "three";
import { getAudioEnabled, onAudioToggle, getCollisionMeshVisible, onCollisionMeshToggle } from "./hud.js";

// Audio listener (attached to localFrame)
let audioListener = null;
const audioLoader = new THREE.AudioLoader();

// Per-world audio sources: Map<worldUrl, AudioSource[]>
const worldAudioSources = new Map();

// Scene reference for adding debug meshes
let sceneRef = null;

// URL resolver function
let urlResolver = null;

/**
 * Audio source instance
 */
class AudioSource {
    constructor(config, positionalAudio, debugMesh) {
        this.config = config;
        this.audio = positionalAudio;
        this.mesh = debugMesh;
        this.triggered = false; // For non-looping proximity triggers
        this.position = new THREE.Vector3().fromArray(config.position || [0, 0, 0]);
    }
    
    dispose() {
        if (this.audio) {
            if (this.audio.isPlaying) {
                this.audio.stop();
            }
            this.audio.disconnect();
        }
        if (this.mesh && sceneRef) {
            sceneRef.remove(this.mesh);
            this.mesh.geometry?.dispose();
            this.mesh.material?.dispose();
        }
    }
}

/**
 * Initialize the spatial audio system
 * @param {THREE.AudioListener} listener - Audio listener (should be attached to localFrame)
 * @param {THREE.Scene} scene - Scene for debug meshes
 * @param {Function} resolveUrl - URL resolver function
 */
export function initSpatialAudio(listener, scene, resolveUrl) {
    audioListener = listener;
    sceneRef = scene;
    urlResolver = resolveUrl;
    
    // Register for audio toggle events
    onAudioToggle(handleAudioToggle);
    
    // Register for collision mesh toggle (reuse for debug visualization)
    onCollisionMeshToggle(handleDebugVisibilityToggle);
    
    console.log("[SpatialAudio] Initialized");
}

/**
 * Load audio sources for a world from its worldData
 * @param {string} worldUrl - World URL identifier
 * @param {Object} worldData - World data containing audioSources array
 * @param {number} worldno - World number for coordinate transform
 */
export async function loadWorldAudioSources(worldUrl, worldData, worldno) {
    const audioSources = worldData?.audioSources;
    if (!audioSources || audioSources.length === 0) {
        return;
    }
    
    // Don't reload if already loaded
    if (worldAudioSources.has(worldUrl)) {
        console.log(`[SpatialAudio] Audio sources already loaded for ${worldUrl}`);
        return;
    }
    
    console.log(`[SpatialAudio] Loading ${audioSources.length} audio source(s) for ${worldUrl}`);
    
    const sources = [];
    const showDebug = getCollisionMeshVisible();
    
    for (const config of audioSources) {
        try {
            const source = await createAudioSource(config, worldno, showDebug);
            if (source) {
                sources.push(source);
            }
        } catch (error) {
            console.error(`[SpatialAudio] Failed to load audio source:`, config.name || config.url, error);
        }
    }
    
    worldAudioSources.set(worldUrl, sources);
    console.log(`[SpatialAudio] Loaded ${sources.length} audio source(s) for ${worldUrl}`);
    // Note: startWorldAudio is called by proto.js after loading completes
}

/**
 * Create a single audio source
 */
async function createAudioSource(config, worldno, showDebug) {
    const {
        name = "Audio Source",
        url,
        position = [0, 0, 0],
        refDistance = 5,
        rolloffFactor = 1,
        maxDistance = 50,
        volume = 1,
        loop = true,
        triggerRadius = null,
        distanceModel = "linear",  // "linear", "inverse", or "exponential"
    } = config;
    
    if (!url) {
        console.warn("[SpatialAudio] Audio source missing url:", name);
        return null;
    }
    
    // Resolve URL
    const audioUrl = url.startsWith('http') 
        ? url 
        : (urlResolver ? urlResolver(url) : url);
    
    return new Promise((resolve, reject) => {
        const positionalAudio = new THREE.PositionalAudio(audioListener);
        
        audioLoader.load(
            audioUrl,
            (buffer) => {
                positionalAudio.setBuffer(buffer);
                positionalAudio.setDistanceModel(distanceModel);
                positionalAudio.setRefDistance(refDistance);
                positionalAudio.setRolloffFactor(rolloffFactor);
                positionalAudio.setMaxDistance(maxDistance);
                positionalAudio.setLoop(loop);
                positionalAudio.setVolume(volume);
                
                // Create debug mesh (red wireframe sphere)
                const debugMesh = new THREE.Mesh(
                    new THREE.SphereGeometry(0.3, 12, 12),
                    new THREE.MeshBasicMaterial({ 
                        color: loop ? 0x00ff00 : 0xff0000, // Green for looping, red for triggered
                        wireframe: true,
                        transparent: true,
                        opacity: 0.8
                    })
                );
                
                // Position in world coordinates
                // Note: For non-root worlds, we'd need worldToUniverse transform
                // For now, positions are relative to world origin
                debugMesh.position.fromArray(position);
                debugMesh.add(positionalAudio);
                debugMesh.visible = showDebug;
                debugMesh.name = `audio-debug-${name}`;
                
                // Add label
                debugMesh.userData.audioName = name;
                
                if (sceneRef) {
                    sceneRef.add(debugMesh);
                }
                
                const source = new AudioSource(
                    { ...config, name, url: audioUrl },
                    positionalAudio,
                    debugMesh
                );
                
                console.log(`[SpatialAudio] Loaded: ${name} (${loop ? 'looping' : 'triggered'}, model=${distanceModel}, ref=${refDistance}, max=${maxDistance}, rolloff=${rolloffFactor})`);
                resolve(source);
            },
            undefined,
            (error) => {
                console.error(`[SpatialAudio] Error loading ${name}:`, error);
                reject(error);
            }
        );
    });
}

/**
 * Start playing audio for a world (looping sources only)
 * Only plays if audio is enabled in HUD
 */
export function startWorldAudio(worldUrl) {
    if (!getAudioEnabled()) {
        console.log(`[SpatialAudio] Skipping start for ${worldUrl} - audio disabled`);
        return;
    }
    
    const sources = worldAudioSources.get(worldUrl);
    if (!sources || sources.length === 0) return;
    
    console.log(`[SpatialAudio] Starting ${sources.length} audio source(s) for ${worldUrl}`);
    
    for (const source of sources) {
        if (source.config.loop && !source.audio.isPlaying) {
            try {
                source.audio.play();
            } catch (error) {
                console.warn(`[SpatialAudio] Failed to play ${source.config.name}:`, error);
            }
        }
    }
}

/**
 * Stop all audio for a world
 */
export function stopWorldAudio(worldUrl) {
    const sources = worldAudioSources.get(worldUrl);
    if (!sources) return;
    
    for (const source of sources) {
        if (source.audio.isPlaying) {
            source.audio.pause();
        }
    }
}

/**
 * Unload and dispose audio sources for a world
 */
export function unloadWorldAudioSources(worldUrl) {
    const sources = worldAudioSources.get(worldUrl);
    if (!sources) return;
    
    console.log(`[SpatialAudio] Unloading ${sources.length} audio source(s) for ${worldUrl}`);
    
    for (const source of sources) {
        source.dispose();
    }
    
    worldAudioSources.delete(worldUrl);
}

/**
 * Check proximity triggers for all loaded worlds
 * Call this each frame from the update loop
 * @param {THREE.Vector3} listenerPosition - Current listener position
 */
export function updateProximityTriggers(listenerPosition) {
    if (!getAudioEnabled()) return;
    
    for (const [worldUrl, sources] of worldAudioSources) {
        for (const source of sources) {
            // Only check non-looping audio with triggerRadius
            if (!source.config.loop && source.config.triggerRadius && !source.triggered) {
                const distance = listenerPosition.distanceTo(source.mesh.position);
                
                if (distance <= source.config.triggerRadius) {
                    try {
                        source.audio.play();
                    } catch (error) {
                        console.warn(`[SpatialAudio] Failed to trigger ${source.config.name}:`, error);
                    }
                    source.triggered = true;
                    console.log(`[SpatialAudio] Triggered: ${source.config.name}`);
                }
            }
        }
    }
}

/**
 * Reset proximity triggers for a world (allows re-triggering)
 */
export function resetProximityTriggers(worldUrl) {
    const sources = worldAudioSources.get(worldUrl);
    if (!sources) return;
    
    for (const source of sources) {
        source.triggered = false;
    }
}

/**
 * Handle audio toggle from HUD
 */
function handleAudioToggle(enabled) {
    console.log(`[SpatialAudio] Audio toggle: ${enabled}`);
    
    for (const [worldUrl, sources] of worldAudioSources) {
        if (enabled) {
            // Start looping sources
            for (const source of sources) {
                if (source.config.loop && !source.audio.isPlaying) {
                    try {
                        source.audio.play();
                        console.log(`[SpatialAudio] Started: ${source.config.name}`);
                    } catch (error) {
                        console.warn(`[SpatialAudio] Failed to play ${source.config.name}:`, error);
                    }
                }
            }
        } else {
            // Stop all sources
            for (const source of sources) {
                if (source.audio.isPlaying) {
                    source.audio.pause();
                    console.log(`[SpatialAudio] Stopped: ${source.config.name}`);
                }
            }
        }
    }
}

/**
 * Handle debug visibility toggle (tied to collision mesh visibility)
 */
function handleDebugVisibilityToggle(visible) {
    for (const [worldUrl, sources] of worldAudioSources) {
        for (const source of sources) {
            if (source.mesh) {
                source.mesh.visible = visible;
            }
        }
    }
}

/**
 * Set visibility for a specific world's audio debug meshes
 */
export function setWorldAudioDebugVisible(worldUrl, visible) {
    const sources = worldAudioSources.get(worldUrl);
    if (!sources) return;
    
    const showDebug = visible && getCollisionMeshVisible();
    for (const source of sources) {
        if (source.mesh) {
            source.mesh.visible = showDebug;
        }
    }
}

/**
 * Get all audio sources for a world
 */
export function getWorldAudioSources(worldUrl) {
    return worldAudioSources.get(worldUrl) || [];
}

/**
 * Check if a world has audio sources loaded
 */
export function hasWorldAudioSources(worldUrl) {
    return worldAudioSources.has(worldUrl);
}

