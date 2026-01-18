/**
 * Character Sync
 * 
 * Handles synchronization of AI characters (like Y-Bot) between
 * the host (who runs the AI) and viewers (who puppet the characters).
 */

import * as THREE from 'three';
import * as SessionManager from './session-manager.js';
import { showSplatCommentary, hideSplatCommentary } from '../splat-dialog-box.js';

// Local references
let characterManagerRef = null;
let worldUrlRef = null;
let isHost = false;
let syncIntervalMs = 100; // 10 Hz
let lastSyncTime = 0;
let unsubscribers = [];

// Puppet mode: viewers receive character updates instead of running AI
const puppetCharacters = new Map(); // characterId -> { position, rotation, animation, comment }

// Track displayed comments to avoid re-showing the same comment
const lastDisplayedComment = new Map(); // characterId -> { comment, timestamp }

// VR mode state (set from main.js)
let isInVRMode = false;

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
    
    // Host receives request to send full state when new viewer joins
    unsubscribers.push(SessionManager.onRequestFullState((msg) => {
        if (isHost && characterManagerRef && worldUrlRef) {
            console.log(`[CharacterSync] Sending full character state to new viewer: ${msg.viewerName}`);
            // Immediately broadcast current character state
            broadcastCharacterState();
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
        
        const stateData = instance.stateData || {};
        const state = {
            id: instance.definition?.id || instance.instanceData?.type,
            position: instance.model.position.toArray(),
            rotation: instance.model.quaternion.toArray(),
            animation: instance.currentAnimation,
            state: instance.currentState,
            // Include any active comment from stateData
            comment: stateData.lastComment || null,
            commentTime: stateData.lastCommentTime || null,
            // Include screen info for VR positioning
            screenPosition: stateData.screenPosition ? stateData.screenPosition.toArray() : null,
            screenRotation: stateData.screenRotation ? stateData.screenRotation.toArray() : null,
            panelConfig: stateData.displayConfig?.vrCommentaryPanel || null,
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
            commentTime: charState.commentTime,
            receivedAt: Date.now(),
        });
        
        // Display new commentary (if changed)
        if (charState.comment) {
            const lastComment = lastDisplayedComment.get(charState.id);
            const isNewComment = !lastComment || 
                lastComment.comment !== charState.comment ||
                (charState.commentTime && lastComment.timestamp !== charState.commentTime);
            
            if (isNewComment) {
                lastDisplayedComment.set(charState.id, {
                    comment: charState.comment,
                    timestamp: charState.commentTime || Date.now(),
                });
                
                // Show commentary using SplatDialogBox (works in both VR and non-VR)
                console.log(`[CharacterSync] Showing synced commentary: "${charState.comment}"`);
                
                // Use splat-based dialog box for 3D commentary
                // Convert arrays back to THREE objects if needed
                let screenPos = null;
                let screenRot = null;
                
                if (charState.screenPosition && Array.isArray(charState.screenPosition)) {
                    screenPos = new THREE.Vector3().fromArray(charState.screenPosition);
                }
                if (charState.screenRotation && Array.isArray(charState.screenRotation)) {
                    screenRot = new THREE.Quaternion().fromArray(charState.screenRotation);
                }
                
                showSplatCommentary(charState.comment, charState.id || 'Y-Bot', 
                    screenPos, 
                    screenRot,
                    charState.panelConfig || null);
            }
        }
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
 * Set VR mode (call from main.js when entering/exiting VR)
 */
export function setCharacterSyncVRMode(inVR) {
    isInVRMode = inVR;
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
    lastDisplayedComment.clear();
    characterManagerRef = null;
    worldUrlRef = null;
    isHost = false;
    isInVRMode = false;
}
