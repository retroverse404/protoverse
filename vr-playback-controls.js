/**
 * VR Playback Controls
 * 
 * A 3D pause/play button for controlling Foundry display playback in VR.
 * Has its own controller handling so it works independently of VR chat.
 */

import * as THREE from "three";
import { toggleFoundryDisplayPause, isFoundryDisplayPaused } from "./foundry-share.js";

// Button dimensions
const BUTTON_SIZE = 0.4;
const BUTTON_DEPTH = 0.05;

// Colors
const COLORS = {
    buttonBg: 0x333333,
    buttonHover: 0x555555,
    playIcon: 0x4caf50,    // Green
    pauseIcon: 0xffffff,   // White
};

/**
 * VR Playback Button
 */
class VRPlaybackButton {
    constructor(worldUrl, displayIdentifier = 0) {
        this.worldUrl = worldUrl;
        this.displayIdentifier = displayIdentifier;
        this.group = new THREE.Group();
        this.group.name = 'vr-playback-button';
        
        // Button background (cylinder for rounded look)
        const bgGeometry = new THREE.CylinderGeometry(BUTTON_SIZE / 2, BUTTON_SIZE / 2, BUTTON_DEPTH, 32);
        this.bgMaterial = new THREE.MeshBasicMaterial({ color: COLORS.buttonBg });
        this.bgMesh = new THREE.Mesh(bgGeometry, this.bgMaterial);
        this.bgMesh.rotation.x = Math.PI / 2; // Face forward
        this.group.add(this.bgMesh);
        
        // Play icon (triangle)
        const playShape = new THREE.Shape();
        const s = BUTTON_SIZE * 0.3;
        playShape.moveTo(-s * 0.4, -s);
        playShape.lineTo(-s * 0.4, s);
        playShape.lineTo(s * 0.8, 0);
        playShape.closePath();
        
        const playGeometry = new THREE.ShapeGeometry(playShape);
        this.playMaterial = new THREE.MeshBasicMaterial({ color: COLORS.playIcon, side: THREE.DoubleSide });
        this.playIcon = new THREE.Mesh(playGeometry, this.playMaterial);
        this.playIcon.position.z = BUTTON_DEPTH / 2 + 0.001;
        this.group.add(this.playIcon);
        
        // Pause icon (two bars)
        const pauseGroup = new THREE.Group();
        const barWidth = BUTTON_SIZE * 0.1;
        const barHeight = BUTTON_SIZE * 0.4;
        const barGap = BUTTON_SIZE * 0.15;
        
        const barGeometry = new THREE.PlaneGeometry(barWidth, barHeight);
        this.pauseMaterial = new THREE.MeshBasicMaterial({ color: COLORS.pauseIcon, side: THREE.DoubleSide });
        
        const leftBar = new THREE.Mesh(barGeometry, this.pauseMaterial);
        leftBar.position.x = -barGap / 2 - barWidth / 2;
        pauseGroup.add(leftBar);
        
        const rightBar = new THREE.Mesh(barGeometry, this.pauseMaterial);
        rightBar.position.x = barGap / 2 + barWidth / 2;
        pauseGroup.add(rightBar);
        
        pauseGroup.position.z = BUTTON_DEPTH / 2 + 0.001;
        this.pauseIcon = pauseGroup;
        this.group.add(this.pauseIcon);
        
        // Set initial state
        this.isPaused = false;
        this._updateIconVisibility();
        
        // Make button interactive
        this.bgMesh.userData.isPlaybackButton = true;
        this.bgMesh.userData.button = this;
    }
    
    /**
     * Position the button relative to the screen
     * @param {THREE.Vector3} screenPosition - Center of the screen
     * @param {THREE.Quaternion} screenRotation - Screen rotation
     * @param {Object} buttonConfig - Button position config {offsetX, offsetY, offsetZ}
     */
    positionRelativeToScreen(screenPosition, screenRotation = null, buttonConfig = null) {
        // Use config offsets or defaults (to the left side of screen)
        const offsetX = buttonConfig?.offsetX ?? -4.0;   // Left side of screen
        const offsetY = buttonConfig?.offsetY ?? -1.5;   // Slightly below center
        const offsetZ = buttonConfig?.offsetZ ?? 0.3;    // Forward for visibility
        
        this.group.position.set(
            screenPosition.x + offsetX,
            screenPosition.y + offsetY,
            screenPosition.z + offsetZ
        );
        
        console.log('[VRPlaybackButton] Positioned at:', this.group.position.toArray(),
                    'offsets:', { offsetX, offsetY, offsetZ });
        
        if (screenRotation) {
            this.group.quaternion.copy(screenRotation);
        }
    }
    
    /**
     * Handle click/select
     */
    onClick() {
        const newState = toggleFoundryDisplayPause(this.worldUrl, this.displayIdentifier);
        if (newState !== null) {
            this.isPaused = newState;
            this._updateIconVisibility();
        }
        return this.isPaused;
    }
    
    /**
     * Update icon visibility based on pause state
     */
    _updateIconVisibility() {
        // Show play icon when paused, pause icon when playing
        this.playIcon.visible = this.isPaused;
        this.pauseIcon.visible = !this.isPaused;
    }
    
    /**
     * Sync state with actual display
     */
    syncState() {
        const paused = isFoundryDisplayPaused(this.worldUrl, this.displayIdentifier);
        if (paused !== null && paused !== this.isPaused) {
            this.isPaused = paused;
            this._updateIconVisibility();
        }
    }
    
    /**
     * Set hover state
     */
    setHover(isHover) {
        this.bgMaterial.color.setHex(isHover ? COLORS.buttonHover : COLORS.buttonBg);
    }
    
    /**
     * Dispose resources
     */
    dispose() {
        this.bgMesh.geometry.dispose();
        this.bgMaterial.dispose();
        this.playIcon.geometry.dispose();
        this.playMaterial.dispose();
        this.pauseIcon.children.forEach(child => {
            child.geometry.dispose();
        });
        this.pauseMaterial.dispose();
    }
}

// Singleton management
let vrPlaybackButton = null;
let sceneRef = null;
let localFrameRef = null;
let rendererRef = null;

// Raycaster for VR interaction
const raycaster = new THREE.Raycaster();
let lastTriggerState = false;

// Laser pointer for VR
let laserPointer = null;
const LASER_LENGTH = 5;
const LASER_COLOR = 0x00ffff;  // Cyan
const LASER_COLOR_HOVER = 0x00ff00;  // Green when hovering over button

/**
 * Initialize VR playback controls
 * @param {THREE.Scene} scene
 * @param {THREE.Group} localFrame - Player's local frame for coordinate transforms
 * @param {THREE.WebGLRenderer} renderer - For XR session access
 */
export function initVRPlaybackControls(scene, localFrame, renderer) {
    sceneRef = scene;
    localFrameRef = localFrame;
    rendererRef = renderer;
    console.log('[VRPlaybackControls] Initialized with scene, localFrame, and renderer');
}

/**
 * Create and show the playback button
 * @param {string} worldUrl - World URL
 * @param {THREE.Vector3} screenPosition - Screen center position
 * @param {THREE.Quaternion} screenRotation - Screen rotation
 * @param {number|string} displayIdentifier - Display index or name
 * @param {Object} buttonConfig - Button position config from world.json {offsetX, offsetY, offsetZ}
 */
export function showVRPlaybackButton(worldUrl, screenPosition, screenRotation = null, displayIdentifier = 0, buttonConfig = null) {
    if (!sceneRef) {
        console.warn('[VRPlaybackControls] Not initialized');
        return;
    }
    
    // Remove existing button if any
    hideVRPlaybackButton();
    
    // Create new button
    vrPlaybackButton = new VRPlaybackButton(worldUrl, displayIdentifier);
    vrPlaybackButton.positionRelativeToScreen(screenPosition, screenRotation, buttonConfig);
    sceneRef.add(vrPlaybackButton.group);
    
    // Create laser pointer if it doesn't exist
    createLaserPointer();
    
    console.log('[VRPlaybackControls] Button shown at', vrPlaybackButton.group.position);
}

/**
 * Hide and remove the playback button
 */
export function hideVRPlaybackButton() {
    if (vrPlaybackButton && sceneRef) {
        sceneRef.remove(vrPlaybackButton.group);
        vrPlaybackButton.dispose();
        vrPlaybackButton = null;
    }
    
    // Also hide the laser pointer
    hideLaserPointer();
}

/**
 * Get the button mesh for raycasting
 */
export function getVRPlaybackButtonMesh() {
    return vrPlaybackButton?.bgMesh || null;
}

/**
 * Handle button click (call from VR controller interaction)
 */
export function handleVRPlaybackButtonClick() {
    return vrPlaybackButton?.onClick() ?? null;
}

/**
 * Set button hover state
 */
export function setVRPlaybackButtonHover(isHover) {
    vrPlaybackButton?.setHover(isHover);
}

/**
 * Sync button state with display
 */
export function syncVRPlaybackButtonState() {
    vrPlaybackButton?.syncState();
}

/**
 * Check if a mesh is the playback button
 */
export function isPlaybackButtonMesh(mesh) {
    return mesh?.userData?.isPlaybackButton === true;
}

/**
 * Create the laser pointer mesh
 */
function createLaserPointer() {
    if (laserPointer) return;
    
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array([0, 0, 0, 0, 0, -LASER_LENGTH]);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    const material = new THREE.LineBasicMaterial({ 
        color: LASER_COLOR,
        linewidth: 2,
        transparent: true,
        opacity: 0.8
    });
    
    laserPointer = new THREE.Line(geometry, material);
    laserPointer.name = 'vr-laser-pointer';
    laserPointer.frustumCulled = false;
    laserPointer.visible = false;  // Start hidden
    
    if (sceneRef) {
        sceneRef.add(laserPointer);
        console.log('[VRPlaybackControls] Laser pointer created');
    }
}

/**
 * Update laser pointer position and visibility
 */
function updateLaserPointer(controllerPosition, controllerRotation, isHovering) {
    if (!laserPointer) {
        createLaserPointer();
    }
    
    if (!laserPointer) return;
    
    // Position and orient laser from controller
    laserPointer.position.copy(controllerPosition);
    laserPointer.quaternion.copy(controllerRotation);
    
    // Change color when hovering
    laserPointer.material.color.setHex(isHovering ? LASER_COLOR_HOVER : LASER_COLOR);
    laserPointer.visible = true;
}

/**
 * Hide laser pointer
 */
function hideLaserPointer() {
    if (laserPointer) {
        laserPointer.visible = false;
    }
}

/**
 * Update VR playback controls (call each frame)
 * Gets controller data directly from XR session.
 * @param {THREE.WebGLRenderer} renderer - The renderer (optional, uses stored ref if not provided)
 */
export function updateVRPlaybackControls(renderer) {
    const r = renderer || rendererRef;
    
    // Hide desktop button when in VR (it would cover the screen)
    if (r?.xr?.isPresenting && desktopButton) {
        desktopButton.style.display = 'none';
    } else if (!r?.xr?.isPresenting && desktopButton && desktopWorldUrl) {
        // Show desktop button when not in VR (if it was set up)
        desktopButton.style.display = 'flex';
    }
    
    // Only work VR interaction when button exists and we're in VR
    if (!vrPlaybackButton || !r?.xr?.isPresenting) {
        hideLaserPointer();
        return;
    }
    
    // Sync button state periodically
    vrPlaybackButton.syncState();
    
    // Get XR session data
    const session = r.xr.getSession();
    const frame = r.xr.getFrame();
    const refSpace = r.xr.getReferenceSpace();
    
    if (!session || !frame || !refSpace) {
        hideLaserPointer();
        return;
    }
    
    // Find controller and get its pose
    let controllerPosition = null;
    let controllerRotation = null;
    let triggerPressed = false;
    
    // Try right controller first, then left
    for (const handedness of ['right', 'left']) {
        for (const source of session.inputSources) {
            if (source.handedness === handedness && source.targetRaySpace) {
                const pose = frame.getPose(source.targetRaySpace, refSpace);
                if (pose) {
                    const pos = pose.transform.position;
                    const ori = pose.transform.orientation;
                    
                    controllerPosition = new THREE.Vector3(pos.x, pos.y, pos.z);
                    controllerRotation = new THREE.Quaternion(ori.x, ori.y, ori.z, ori.w);
                    
                    // Transform to world space if we have localFrame
                    if (localFrameRef) {
                        controllerPosition.applyMatrix4(localFrameRef.matrixWorld);
                        controllerRotation.premultiply(localFrameRef.quaternion);
                    }
                    
                    // Check trigger
                    const gamepad = source.gamepad;
                    if (gamepad) {
                        const triggerValue = gamepad.buttons[0]?.value || 0;
                        const triggerNow = triggerValue > 0.5;
                        triggerPressed = triggerNow && !lastTriggerState;
                        lastTriggerState = triggerNow;
                    }
                    
                    break;  // Found a controller
                }
            }
        }
        if (controllerPosition) break;  // Stop if we found one
    }
    
    if (!controllerPosition) {
        hideLaserPointer();
        return;
    }
    
    // Set up raycaster from controller
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(controllerRotation);
    raycaster.set(controllerPosition, direction);
    
    // Check intersection with button
    const intersects = raycaster.intersectObject(vrPlaybackButton.bgMesh);
    const isHovering = intersects.length > 0;
    
    // Update laser pointer
    updateLaserPointer(controllerPosition, controllerRotation, isHovering);
    
    if (isHovering) {
        // Hovering over button
        vrPlaybackButton.setHover(true);
        
        // Check for click
        if (triggerPressed) {
            console.log('[VRPlaybackControls] Button clicked!');
            vrPlaybackButton.onClick();
        }
    } else {
        vrPlaybackButton.setHover(false);
    }
}

// ============================================
// Desktop Playback Button (non-VR mode)
// ============================================

let desktopButton = null;
let desktopWorldUrl = null;
let desktopDisplayIdentifier = 0;
let desktopIsPaused = false;

/**
 * Create and show the desktop playback button
 */
export function showDesktopPlaybackButton(worldUrl, displayIdentifier = 0) {
    // Store references for click handler
    desktopWorldUrl = worldUrl;
    desktopDisplayIdentifier = displayIdentifier;
    
    if (desktopButton) {
        desktopButton.style.display = 'flex';
        syncDesktopButtonState();
        return;
    }
    
    // Create button element
    desktopButton = document.createElement('button');
    desktopButton.id = 'desktop-playback-button';
    desktopButton.style.cssText = `
        position: fixed;
        bottom: 30px;
        left: 50%;
        transform: translateX(-50%);
        width: 60px;
        height: 60px;
        border-radius: 50%;
        border: none;
        background: rgba(40, 40, 40, 0.9);
        color: white;
        font-size: 24px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        transition: background 0.2s, transform 0.1s;
        z-index: 1000;
    `;
    
    // Hover effects
    desktopButton.addEventListener('mouseenter', () => {
        desktopButton.style.background = 'rgba(60, 60, 60, 0.95)';
        desktopButton.style.transform = 'translateX(-50%) scale(1.05)';
    });
    desktopButton.addEventListener('mouseleave', () => {
        desktopButton.style.background = 'rgba(40, 40, 40, 0.9)';
        desktopButton.style.transform = 'translateX(-50%) scale(1)';
    });
    
    // Click handler
    desktopButton.addEventListener('click', () => {
        if (desktopWorldUrl) {
            const newState = toggleFoundryDisplayPause(desktopWorldUrl, desktopDisplayIdentifier);
            if (newState !== null) {
                desktopIsPaused = newState;
                updateDesktopButtonIcon();
                console.log('[PlaybackControls] Desktop button clicked, paused:', desktopIsPaused);
            }
        }
    });
    
    document.body.appendChild(desktopButton);
    syncDesktopButtonState();
    
    console.log('[PlaybackControls] Desktop button shown');
}

/**
 * Hide the desktop playback button
 */
export function hideDesktopPlaybackButton() {
    if (desktopButton) {
        desktopButton.style.display = 'none';
    }
}

/**
 * Sync desktop button state with actual display
 */
function syncDesktopButtonState() {
    if (!desktopButton || !desktopWorldUrl) return;
    
    const paused = isFoundryDisplayPaused(desktopWorldUrl, desktopDisplayIdentifier);
    if (paused !== null) {
        desktopIsPaused = paused;
        updateDesktopButtonIcon();
    }
}

/**
 * Update desktop button icon based on pause state
 */
function updateDesktopButtonIcon() {
    if (!desktopButton) return;
    
    if (desktopIsPaused) {
        // Show play icon (triangle)
        desktopButton.innerHTML = '▶';
        desktopButton.title = 'Play';
    } else {
        // Show pause icon (two bars)
        desktopButton.innerHTML = '⏸';
        desktopButton.title = 'Pause';
    }
}
