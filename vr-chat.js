/**
 * VR Chat System
 * 
 * Combines VR keyboard and chat panel for in-VR conversations.
 * Integrates with character chat systems.
 */

import * as THREE from "three";
import { VRKeyboard } from "./vr-keyboard.js";
import { VRChatPanel } from "./vr-chat-panel.js";
// VR playback controls are now updated in main.js

// Positioning
const PANEL_DISTANCE = 1.5;       // Distance from player toward character
const PANEL_HEIGHT_OFFSET = 0.2;  // Height offset from eye level
const KEYBOARD_DISTANCE = 1.0;    // Distance in front of player (closer to panel)
const KEYBOARD_HEIGHT = -0.25;    // Below eye level
const KEYBOARD_TILT = -0.4;       // Tilt angle in radians (tilted toward player)

/**
 * VR Chat System class
 */
class VRChatSystem {
    constructor() {
        this.keyboard = new VRKeyboard();
        this.panel = new VRChatPanel();
        
        // State
        this.isActive = false;
        this.characterName = '';
        this.characterPosition = new THREE.Vector3();
        this.onMessageCallback = null;
        this.onExitCallback = null;
        
        // Controller state tracking
        this.lastTriggerState = false;
        
        // Scene references
        this.scene = null;
        this.localFrame = null;
        this.camera = null;
        this.renderer = null;
        
        // Wire up keyboard events
        this.keyboard.onKeyPress = (key) => {
            this.panel.handleKeyPress(key);
        };
        
        this.keyboard.onSubmit = () => {
            this._sendMessage();
        };
    }
    
    /**
     * Initialize with scene references
     * @param {THREE.Scene} scene
     * @param {THREE.Group} localFrame - Player's local frame
     * @param {THREE.Camera} camera - The camera
     * @param {THREE.WebGLRenderer} renderer - The renderer (for VR camera access)
     */
    init(scene, localFrame, camera, renderer) {
        this.scene = scene;
        this.localFrame = localFrame;
        this.camera = camera;
        this.renderer = renderer;
        
        // Add keyboard and panel to scene (they manage their own visibility)
        scene.add(this.keyboard.group);
        scene.add(this.panel.group);
        
        console.log('[VRChat] Initialized');
    }
    
    /**
     * Start a VR chat session
     * @param {string} characterName - Name of character
     * @param {THREE.Vector3} characterPosition - Character's world position
     * @param {Function} onMessage - Callback when user sends message (receives message text)
     * @param {Function} onExit - Callback when chat is closed
     * @param {string} initialGreeting - Initial message from character
     */
    startChat(characterName, characterPosition, onMessage, onExit, initialGreeting = null) {
        if (!this.scene || !this.localFrame) {
            console.error('[VRChat] Not initialized');
            return;
        }
        
        this.isActive = true;
        this.characterName = characterName;
        this.characterPosition.copy(characterPosition);
        this.onMessageCallback = onMessage;
        this.onExitCallback = onExit;
        
        // Get actual camera world position (important for VR where camera has offset from localFrame)
        const cameraWorldPos = new THREE.Vector3();
        const cameraWorldQuat = new THREE.Quaternion();
        
        if (this.renderer?.xr?.isPresenting) {
            // In VR: get the XR camera's position in XR reference space, then transform to world space
            const xrCamera = this.renderer.xr.getCamera();
            
            // Get camera position in XR reference space
            const xrPos = new THREE.Vector3();
            const xrQuat = new THREE.Quaternion();
            xrCamera.getWorldPosition(xrPos);
            xrCamera.getWorldQuaternion(xrQuat);
            
            // Transform from XR reference space to world space using localFrame
            // (same transform we apply to controllers)
            cameraWorldPos.copy(xrPos);
            cameraWorldPos.applyMatrix4(this.localFrame.matrixWorld);
            
            cameraWorldQuat.copy(xrQuat);
            cameraWorldQuat.premultiply(this.localFrame.quaternion);
        } else {
            // Not in VR: use regular camera
            this.camera.getWorldPosition(cameraWorldPos);
            this.camera.getWorldQuaternion(cameraWorldQuat);
        }
        
        // Get forward direction from camera
        const forward = new THREE.Vector3(0, 0, -1);
        forward.applyQuaternion(cameraWorldQuat);
        forward.y = 0;  // Project onto horizontal plane
        forward.normalize();
        
        // Panel position: in front of player, toward character
        const panelPos = cameraWorldPos.clone()
            .addScaledVector(forward, PANEL_DISTANCE)
            .add(new THREE.Vector3(0, PANEL_HEIGHT_OFFSET, 0));
        
        // Panel rotation: face the player (rotate 180° so front faces player)
        const panelRotation = new THREE.Quaternion();
        const lookAtMatrix = new THREE.Matrix4();
        const panelLookTarget = cameraWorldPos.clone();
        panelLookTarget.y = panelPos.y;  // Keep panel upright
        lookAtMatrix.lookAt(panelLookTarget, panelPos, new THREE.Vector3(0, 1, 0));  // Swapped order to face player
        panelRotation.setFromRotationMatrix(lookAtMatrix);
        
        // Keyboard position: closer to player, below eye level
        const keyboardPos = cameraWorldPos.clone()
            .addScaledVector(forward, KEYBOARD_DISTANCE)
            .add(new THREE.Vector3(0, KEYBOARD_HEIGHT, 0));
        
        // Keyboard rotation: face player with tilt
        const keyboardRotation = new THREE.Quaternion();
        const keyboardLookAt = new THREE.Matrix4();
        const keyboardLookTarget = cameraWorldPos.clone();
        keyboardLookTarget.y = keyboardPos.y;  // Keep keyboard oriented to player
        keyboardLookAt.lookAt(keyboardLookTarget, keyboardPos, new THREE.Vector3(0, 1, 0));  // Swapped order to face player
        keyboardRotation.setFromRotationMatrix(keyboardLookAt);
        
        // Add tilt (rotate around local X axis to angle keyboard toward player)
        const tiltQuat = new THREE.Quaternion();
        tiltQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), KEYBOARD_TILT);
        keyboardRotation.multiply(tiltQuat);
        
        // Show panel and keyboard
        this.panel.show(panelPos, panelRotation, characterName);
        this.keyboard.show(keyboardPos, keyboardRotation);
        
        // Add initial greeting if provided
        if (initialGreeting) {
            this.panel.addMessage(initialGreeting, 'character');
        }
        
        console.log('[VRChat] Started chat with', characterName, 'at camera pos:', cameraWorldPos.toArray());
    }
    
    /**
     * End the VR chat session
     */
    endChat() {
        if (!this.isActive) return;
        
        this.isActive = false;
        this.keyboard.hide();
        this.panel.hide();
        
        if (this.onExitCallback) {
            this.onExitCallback();
        }
        
        this.onMessageCallback = null;
        this.onExitCallback = null;
        
        console.log('[VRChat] Ended chat');
    }
    
    /**
     * Check if chat is active
     */
    isChatActive() {
        return this.isActive;
    }
    
    /**
     * Send the current input as a message
     */
    _sendMessage() {
        const text = this.panel.getInputText().trim();
        if (!text) return;
        
        // Add user message to panel
        this.panel.addMessage(text, 'user');
        this.panel.clearInput();
        
        // Call message callback
        if (this.onMessageCallback) {
            this.onMessageCallback(text);
        }
    }
    
    /**
     * Add a character response message
     * @param {string} message
     */
    addCharacterMessage(message) {
        this.panel.addMessage(message, 'character');
    }
    
    /**
     * Start streaming a character response
     */
    startStreamingResponse() {
        this.panel.startStreaming();
    }
    
    /**
     * Append to streaming response
     * @param {string} token
     */
    appendToStreamingResponse(token) {
        this.panel.appendToStreaming(token);
    }
    
    /**
     * End streaming response
     */
    endStreamingResponse() {
        this.panel.endStreaming();
    }
    
    /**
     * Update the VR chat system (call every frame when in VR)
     * Uses targetRaySpace directly (same pattern as physics.js VR input)
     * @param {THREE.WebGLRenderer} renderer
     */
    update(renderer) {
        if (!this.isActive || !renderer.xr.isPresenting) return;
        
        const session = renderer.xr.getSession();
        const frame = renderer.xr.getFrame();
        const refSpace = renderer.xr.getReferenceSpace();
        
        if (!session || !frame || !refSpace) return;
        
        let controllerPosition = null;
        let controllerRotation = null;
        let triggerPressed = false;
        let bButtonPressed = false;
        
        // Find right controller and get its pose
        for (const source of session.inputSources) {
            if (source.handedness === 'right') {
                const gamepad = source.gamepad;
                
                if (gamepad) {
                    // Trigger is button 0 (lower threshold for easier activation)
                    const triggerValue = gamepad.buttons[0]?.value || 0;
                    const triggerNow = triggerValue > 0.2;  // Lower threshold
                    
                    // Detect trigger press (rising edge)
                    triggerPressed = triggerNow && !this.lastTriggerState;
                    this.lastTriggerState = triggerNow;
                    
                    // B button is buttons[5] on Quest, A is buttons[4]
                    bButtonPressed = gamepad.buttons[5]?.pressed || gamepad.buttons[4]?.pressed;
                }
                
                // Get ray pose (where controller is pointing)
                if (source.targetRaySpace) {
                    const pose = frame.getPose(source.targetRaySpace, refSpace);
                    if (pose) {
                        const pos = pose.transform.position;
                        const ori = pose.transform.orientation;
                        
                        // Controller pose is in XR reference space
                        // Need to transform to world space by applying localFrame transform
                        controllerPosition = new THREE.Vector3(pos.x, pos.y, pos.z);
                        controllerRotation = new THREE.Quaternion(ori.x, ori.y, ori.z, ori.w);
                        
                        // Transform controller position/rotation to world space
                        // The XR camera is a child of localFrame, so controller positions
                        // need the same transform applied
                        controllerPosition.applyMatrix4(this.localFrame.matrixWorld);
                        controllerRotation.premultiply(this.localFrame.quaternion);
                    }
                }
                break;
            }
        }
        
        // Fallback: try left controller if right not found
        if (!controllerPosition) {
            for (const source of session.inputSources) {
                if (source.handedness === 'left' && source.targetRaySpace) {
                    const pose = frame.getPose(source.targetRaySpace, refSpace);
                    if (pose) {
                        const pos = pose.transform.position;
                        const ori = pose.transform.orientation;
                        
                        controllerPosition = new THREE.Vector3(pos.x, pos.y, pos.z);
                        controllerRotation = new THREE.Quaternion(ori.x, ori.y, ori.z, ori.w);
                        
                        // Transform to world space
                        controllerPosition.applyMatrix4(this.localFrame.matrixWorld);
                        controllerRotation.premultiply(this.localFrame.quaternion);
                        
                        // Also get trigger from left controller
                        const gamepad = source.gamepad;
                        if (gamepad) {
                            const triggerValue = gamepad.buttons[0]?.value || 0;
                            const triggerNow = triggerValue > 0.5;
                            triggerPressed = triggerNow && !this.lastTriggerState;
                            this.lastTriggerState = triggerNow;
                        }
                    }
                    break;
                }
            }
        }
        
        // Update keyboard with controller input
        if (controllerPosition && controllerRotation) {
            this.keyboard.update(controllerPosition, controllerRotation, triggerPressed, this.scene);
        }
        
        // Check for B button to close chat
        if (bButtonPressed) {
            this.endChat();
        }
    }
    
    /**
     * Clean up resources
     */
    dispose() {
        this.keyboard.dispose();
        this.panel.dispose();
        
        if (this.scene) {
            this.scene.remove(this.keyboard.group);
            this.scene.remove(this.panel.group);
        }
    }
}

// Singleton instance
let vrChatInstance = null;

/**
 * Get or create the VR chat system instance
 * @returns {VRChatSystem}
 */
export function getVRChat() {
    if (!vrChatInstance) {
        vrChatInstance = new VRChatSystem();
    }
    return vrChatInstance;
}

/**
 * Initialize VR chat system
 * @param {THREE.Scene} scene
 * @param {THREE.Group} localFrame
 * @param {THREE.Camera} camera
 * @param {THREE.WebGLRenderer} renderer
 */
export function initVRChat(scene, localFrame, camera, renderer) {
    const vrChat = getVRChat();
    vrChat.init(scene, localFrame, camera, renderer);
}

/**
 * Check if VR chat is active
 */
export function isVRChatActive() {
    return vrChatInstance?.isChatActive() || false;
}

/**
 * Start a VR chat
 */
export function startVRChat(characterName, characterPosition, onMessage, onExit, initialGreeting) {
    const vrChat = getVRChat();
    vrChat.startChat(characterName, characterPosition, onMessage, onExit, initialGreeting);
}

/**
 * End VR chat
 */
export function endVRChat() {
    if (vrChatInstance) {
        vrChatInstance.endChat();
    }
}

/**
 * Add a character message to VR chat
 */
export function addVRChatMessage(message) {
    if (vrChatInstance) {
        vrChatInstance.addCharacterMessage(message);
    }
}

/**
 * Start streaming response in VR chat
 */
export function startVRChatStreaming() {
    if (vrChatInstance) {
        vrChatInstance.startStreamingResponse();
    }
}

/**
 * Append to streaming response in VR chat
 */
export function appendVRChatStreaming(token) {
    if (vrChatInstance) {
        vrChatInstance.appendToStreamingResponse(token);
    }
}

/**
 * End streaming response in VR chat
 */
export function endVRChatStreaming() {
    if (vrChatInstance) {
        vrChatInstance.endStreamingResponse();
    }
}

/**
 * Update VR chat (call every frame)
 */
export function updateVRChat(renderer) {
    if (vrChatInstance) {
        vrChatInstance.update(renderer);
    }
}

