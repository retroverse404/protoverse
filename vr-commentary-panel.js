/**
 * VR Commentary Panel
 * 
 * A 3D panel for displaying movie commentary in VR.
 * Shows Y-Bot's comments about the movie being watched.
 */

import * as THREE from "three";

// Default panel dimensions
const DEFAULT_WIDTH = 7.3;
const DEFAULT_HEIGHT = 1.2;
const DEFAULT_OFFSET_Y = 2.6;
const DEFAULT_OFFSET_Z = 0;

// Text settings
const FONT_SIZE = 64;

// Colors
const COLORS = {
    background: 'rgba(0, 0, 0, 0.85)',
    border: 'rgba(255, 255, 255, 0.2)',
    text: '#ffffff',
    attribution: '#4fc3f7',
};

// Animation
const FADE_DURATION = 500;  // ms
const DISPLAY_DURATION = 8000;  // ms

/**
 * VR Commentary Panel class
 */
export class VRCommentaryPanel {
    constructor(config = {}) {
        this.group = new THREE.Group();
        this.group.name = 'vr-commentary-panel';
        
        // Store config with defaults
        this.panelWidth = config.width || DEFAULT_WIDTH;
        this.panelHeight = config.height || DEFAULT_HEIGHT;
        this.offsetY = config.offsetY ?? DEFAULT_OFFSET_Y;
        this.offsetZ = config.offsetZ ?? DEFAULT_OFFSET_Z;
        console.log('[VRCommentaryPanel] Created with offsetY:', this.offsetY, 'offsetZ:', this.offsetZ);
        
        // Canvas for rendering text (higher res for larger panel)
        this.canvas = document.createElement('canvas');
        this.canvas.width = 2048;
        this.canvas.height = Math.round(2048 * (this.panelHeight / this.panelWidth));
        this.ctx = this.canvas.getContext('2d');
        
        // Create texture and mesh
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.magFilter = THREE.LinearFilter;
        
        const geometry = new THREE.PlaneGeometry(this.panelWidth, this.panelHeight);
        this.material = new THREE.MeshBasicMaterial({
            map: this.texture,
            transparent: true,
            side: THREE.DoubleSide,
            opacity: 0,
        });
        
        this.mesh = new THREE.Mesh(geometry, this.material);
        this.group.add(this.mesh);
        
        // State
        this.currentText = '';
        this.characterName = '';
        this.opacity = 0;
        this.fadeTimer = null;
        this.hideTimer = null;
        
        // Initially hidden
        this.group.visible = false;
        
        // Clear canvas initially
        this._render();
    }
    
    /**
     * Position the panel relative to a target position (e.g., the screen)
     * @param {THREE.Vector3} screenPosition - Position of the screen
     * @param {THREE.Quaternion} screenRotation - Optional rotation to match the screen's orientation
     */
    positionAboveScreen(screenPosition, screenRotation = null) {
        // Position using configured offsets
        this.group.position.set(
            screenPosition.x,
            screenPosition.y + this.offsetY,
            screenPosition.z + this.offsetZ
        );
        
        // Match the screen's rotation (face same direction as the screen)
        if (screenRotation) {
            this.group.quaternion.copy(screenRotation);
        } else {
            // Default: face forward along -Z (typical screen orientation)
            this.group.rotation.set(0, 0, 0);
        }
    }
    
    /**
     * Show commentary text
     * @param {string} text - Commentary text
     * @param {string} characterName - Name of the character (e.g., "Y-Bot")
     */
    show(text, characterName = "Y-Bot") {
        // Clear any existing timers
        if (this.fadeTimer) clearInterval(this.fadeTimer);
        if (this.hideTimer) clearTimeout(this.hideTimer);
        
        this.currentText = text;
        this.characterName = characterName;
        this.group.visible = true;
        
        this._render();
        
        // Fade in
        this._fadeIn();
        
        // Schedule fade out
        this.hideTimer = setTimeout(() => {
            this._fadeOut();
        }, DISPLAY_DURATION);
        
        console.log('[VRCommentaryPanel] Showing:', text);
    }
    
    /**
     * Hide the panel immediately
     */
    hide() {
        if (this.fadeTimer) clearInterval(this.fadeTimer);
        if (this.hideTimer) clearTimeout(this.hideTimer);
        
        this.opacity = 0;
        this.material.opacity = 0;
        this.group.visible = false;
        
        console.log('[VRCommentaryPanel] Hidden');
    }
    
    /**
     * Check if panel is visible
     */
    isVisible() {
        return this.group.visible && this.opacity > 0;
    }
    
    /**
     * Fade in animation
     */
    _fadeIn() {
        const startTime = performance.now();
        const startOpacity = this.opacity;
        
        this.fadeTimer = setInterval(() => {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / FADE_DURATION, 1);
            
            this.opacity = startOpacity + (1 - startOpacity) * progress;
            this.material.opacity = this.opacity;
            
            if (progress >= 1) {
                clearInterval(this.fadeTimer);
                this.fadeTimer = null;
            }
        }, 16);
    }
    
    /**
     * Fade out animation
     */
    _fadeOut() {
        const startTime = performance.now();
        const startOpacity = this.opacity;
        
        this.fadeTimer = setInterval(() => {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / FADE_DURATION, 1);
            
            this.opacity = startOpacity * (1 - progress);
            this.material.opacity = this.opacity;
            
            if (progress >= 1) {
                clearInterval(this.fadeTimer);
                this.fadeTimer = null;
                this.group.visible = false;
            }
        }, 16);
    }
    
    /**
     * Render the panel to canvas
     */
    _render() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const padding = 48;
        
        // Clear canvas
        ctx.clearRect(0, 0, w, h);
        
        // Background
        ctx.fillStyle = COLORS.background;
        ctx.beginPath();
        ctx.roundRect(0, 0, w, h, 24);
        ctx.fill();
        
        // Border
        ctx.strokeStyle = COLORS.border;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(0, 0, w, h, 24);
        ctx.stroke();
        
        // Text
        ctx.font = `italic ${FONT_SIZE}px Georgia, serif`;
        ctx.fillStyle = COLORS.text;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Quote marks and text
        const quote = `"${this.currentText}"`;
        const lines = this._wrapText(quote, w - padding * 2);
        
        const lineHeight = FONT_SIZE * 1.3;
        const totalTextHeight = lines.length * lineHeight;
        let y = (h - totalTextHeight) / 2 + lineHeight / 2;
        
        for (const line of lines) {
            ctx.fillText(line, w / 2, y);
            y += lineHeight;
        }
        
        // Attribution
        ctx.font = `${FONT_SIZE * 0.5}px system-ui, -apple-system, sans-serif`;
        ctx.fillStyle = COLORS.attribution;
        ctx.fillText(`— ${this.characterName}`, w / 2, h - 30);
        
        // Update texture
        this.texture.needsUpdate = true;
    }
    
    /**
     * Wrap text to fit within width
     * @param {string} text
     * @param {number} maxWidth
     * @returns {string[]}
     */
    _wrapText(text, maxWidth) {
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';
        
        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = this.ctx.measureText(testLine);
            
            if (metrics.width > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        
        if (currentLine) {
            lines.push(currentLine);
        }
        
        return lines.length > 0 ? lines : [''];
    }
    
    /**
     * Clean up resources
     */
    dispose() {
        if (this.fadeTimer) clearInterval(this.fadeTimer);
        if (this.hideTimer) clearTimeout(this.hideTimer);
        this.mesh.geometry.dispose();
        this.material.dispose();
        this.texture.dispose();
    }
}

// Singleton instance
let vrCommentaryPanel = null;
let sceneRef = null;
let cameraRef = null;

// Current panel config for comparison
let currentPanelConfig = null;

/**
 * Initialize VR commentary system
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 */
export function initVRCommentary(scene, camera) {
    sceneRef = scene;
    cameraRef = camera;
    console.log('[VRCommentary] System ready');
}

/**
 * Create or recreate the panel with new config
 * @param {Object} config - Panel config {width, height, offsetY, offsetZ}
 */
function ensurePanel(config = {}) {
    // Check if we need to recreate the panel
    const configKey = JSON.stringify(config);
    console.log('[VRCommentary] ensurePanel called with config:', config, 'configKey:', configKey);
    console.log('[VRCommentary] current configKey:', currentPanelConfig);
    if (vrCommentaryPanel && currentPanelConfig === configKey) {
        console.log('[VRCommentary] Panel already exists with same config, skipping');
        return; // Panel already exists with same config
    }
    
    // Dispose old panel if exists
    if (vrCommentaryPanel) {
        sceneRef?.remove(vrCommentaryPanel.group);
        vrCommentaryPanel.dispose();
    }
    
    // Create new panel with config
    vrCommentaryPanel = new VRCommentaryPanel(config);
    sceneRef?.add(vrCommentaryPanel.group);
    currentPanelConfig = configKey;
    console.log('[VRCommentary] Panel created with config:', config);
}

/**
 * Show VR commentary
 * @param {string} text - Commentary text
 * @param {string} characterName - Character name
 * @param {THREE.Vector3} screenPosition - Position of the screen (to position panel below)
 * @param {THREE.Quaternion} screenRotation - Rotation of the screen (to match panel orientation)
 * @param {Object} panelConfig - Optional panel config {width, height, offsetY, offsetZ}
 */
export function showVRCommentary(text, characterName, screenPosition, screenRotation = null, panelConfig = null) {
    if (!sceneRef) {
        console.warn('[VRCommentary] Not initialized');
        return;
    }
    
    // Ensure panel exists with correct config
    ensurePanel(panelConfig || {});
    
    if (screenPosition) {
        vrCommentaryPanel.positionAboveScreen(screenPosition, screenRotation);
    }
    
    vrCommentaryPanel.show(text, characterName);
}

/**
 * Hide VR commentary
 */
export function hideVRCommentary() {
    if (vrCommentaryPanel) {
        vrCommentaryPanel.hide();
    }
}

/**
 * Check if VR commentary is visible
 */
export function isVRCommentaryVisible() {
    return vrCommentaryPanel?.isVisible() ?? false;
}

/**
 * Dispose VR commentary resources
 */
export function disposeVRCommentary() {
    if (vrCommentaryPanel) {
        if (sceneRef) {
            sceneRef.remove(vrCommentaryPanel.group);
        }
        vrCommentaryPanel.dispose();
        vrCommentaryPanel = null;
    }
}
