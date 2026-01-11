/**
 * Character Sync
 * 
 * Handles synchronization of AI characters (like Y-Bot) between
 * the host (who runs the AI) and viewers (who puppet the characters).
 */

import * as SessionManager from './session-manager.js';

// Local references
let characterManagerRef = null;
let worldUrlRef = null;
let isHost = false;
let syncIntervalMs = 100; // 10 Hz
let lastSyncTime = 0;
let unsubscribers = [];

// Puppet mode: viewers receive character updates instead of running AI
const puppetCharacters = new Map(); // characterId -> { position, rotation, animation, comment }

/**
 * Initialize character sync
 * @param {CharacterManager} characterManager - Reference to the character manager
 */
export function initCharacterSync(characterManager) {
    characterManagerRef = characterManager;
    
    // Listen for session events
    unsubscribers.push(SessionManager.onSessionCreated(() => {
        isHost = true;
        characterManagerRef?.setPuppetMode(false);
        console.log('[CharacterSync] Hosting - will broadcast character state');
    }));
    
    unsubscribers.push(SessionManager.onSessionJoined(() => {
        isHost = false;
        characterManagerRef?.setPuppetMode(true);
        console.log('[CharacterSync] Viewing - will receive character state (puppet mode)');
    }));
    
    unsubscribers.push(SessionManager.onSessionEnded(() => {
        isHost = false;
        characterManagerRef?.setPuppetMode(false);
        puppetCharacters.clear();
    }));
    
    // Listen for character sync messages
    unsubscribers.push(SessionManager.onCharacterSync((data) => {
        if (!isHost && data.characters) {
            applyCharacterSync(data.characters);
        }
    }));
}

/**
 * Set the current world URL
 */
export function setWorldUrl(worldUrl) {
    worldUrlRef = worldUrl;
}

/**
 * Update character sync (call each frame)
 * - Host: broadcast character states
 * - Viewer: apply puppet states
 * @param {number} time - Current time in ms
 */
export function updateCharacterSync(time) {
    if (!SessionManager.inSession() || !characterManagerRef || !worldUrlRef) {
        return;
    }
    
    if (isHost) {
        // Host broadcasts character state at regular intervals
        if (time - lastSyncTime >= syncIntervalMs) {
            lastSyncTime = time;
            broadcastCharacterState();
        }
    } else {
        // Viewers apply puppet state to characters
        applyPuppetState();
    }
}

/**
 * Broadcast current character state (host only)
 */
function broadcastCharacterState() {
    const characters = characterManagerRef.getCharacters(worldUrlRef);
    if (!characters || characters.length === 0) return;
    
    const characterStates = [];
    
    for (const instance of characters) {
        if (!instance.model) continue;
        
        const state = {
            id: instance.definition?.id || instance.instanceData?.type,
            position: instance.model.position.toArray(),
            rotation: instance.model.quaternion.toArray(),
            animation: instance.currentAnimation,
            state: instance.currentState,
            // Include any active comment from stateData
            comment: instance.stateData?.lastComment || null,
        };
        
        characterStates.push(state);
    }
    
    if (characterStates.length > 0) {
        SessionManager.sendCharacterSync(characterStates);
    }
}

/**
 * Apply received character sync (viewer only)
 */
function applyCharacterSync(characters) {
    for (const charState of characters) {
        puppetCharacters.set(charState.id, {
            position: charState.position,
            rotation: charState.rotation,
            animation: charState.animation,
            state: charState.state,
            comment: charState.comment,
            receivedAt: Date.now(),
        });
    }
}

/**
 * Apply puppet state to local characters (viewer only)
 */
function applyPuppetState() {
    if (!characterManagerRef || !worldUrlRef) return;
    
    const characters = characterManagerRef.getCharacters(worldUrlRef);
    if (!characters) return;
    
    for (const instance of characters) {
        if (!instance.model) continue;
        
        const charId = instance.definition?.id || instance.instanceData?.type;
        const puppetState = puppetCharacters.get(charId);
        
        if (!puppetState) continue;
        
        // Apply position (with smoothing)
        if (puppetState.position) {
            const targetPos = new THREE.Vector3().fromArray(puppetState.position);
            instance.model.position.lerp(targetPos, 0.2);
        }
        
        // Apply rotation (with smoothing)
        if (puppetState.rotation) {
            const targetRot = new THREE.Quaternion().fromArray(puppetState.rotation);
            instance.model.quaternion.slerp(targetRot, 0.2);
        }
        
        // Apply animation if changed
        if (puppetState.animation && puppetState.animation !== instance.currentAnimation) {
            characterManagerRef.transitionToState(instance, puppetState.state || puppetState.animation);
        }
    }
}

/**
 * Check if we're in puppet mode (viewer, not host)
 */
export function isPuppetMode() {
    return SessionManager.inSession() && !isHost;
}

/**
 * Check if we're the host
 */
export function isHostMode() {
    return SessionManager.inSession() && isHost;
}

/**
 * Get puppet state for a character
 */
export function getPuppetState(characterId) {
    return puppetCharacters.get(characterId);
}

/**
 * Cleanup
 */
export function disposeCharacterSync() {
    for (const unsub of unsubscribers) {
        unsub();
    }
    unsubscribers = [];
    puppetCharacters.clear();
    characterManagerRef = null;
    worldUrlRef = null;
    isHost = false;
}

// Need THREE for Vector3 and Quaternion
import * as THREE from 'three';
