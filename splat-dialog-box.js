/**
 * SplatDialogBox
 * 
 * A dialog box using Gaussian splat-based text for VR commentary.
 * Works well with splat rendering pipeline unlike canvas textures.
 */

import * as THREE from "three";
import { textSplats } from "@sparkjsdev/spark";

// Default config
const DEFAULT_CONFIG = {
    maxWidth: 6,           // Maximum width in world units before wrapping
    fontSize: 48,          // Base font size for splat text
    textColor: 0xffffff,   // White text
    outlineColor: 0x000000, // Black outline for readability
    attributionColor: 0x4fc3f7,  // Light blue for attribution
    lineSpacing: 1.4,      // Line spacing multiplier
    padding: 0.2,          // Padding around text
    outlineOffset: 0.002,  // Offset for outline shadow effect
};

// Animation
const FADE_DURATION = 500;  // ms
const DISPLAY_DURATION = 10000;  // ms (matches ybot.js timing)

/**
 * SplatDialogBox class
 * Creates a dialog box with splat-based text rendering
 */
export class SplatDialogBox {
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.group = new THREE.Group();
        this.group.name = 'splat-dialog-box';
        
        // Text elements
        this.textMeshes = [];  // Array of line meshes
        this.attributionMesh = null;
        
        // State
        this.currentText = '';
        this.characterName = '';
        this.opacity = 0;
        this.fadeTimer = null;
        this.hideTimer = null;
        
        // Initially hidden
        this.group.visible = false;
    }
    
    /**
     * Position the dialog box relative to a target position (e.g., the screen)
     * @param {THREE.Vector3} screenPosition - Position of the screen
     * @param {THREE.Quaternion} screenRotation - Optional rotation to match the screen's orientation
     * @param {Object} config - Config {offsetX, offsetY, offsetZ, width}
     */
    positionRelativeTo(screenPosition, screenRotation = null, config = {}) {
        const offsetX = config.offsetX ?? 0;
        const offsetY = config.offsetY ?? -1.3;  // Default: subtitle position at bottom of screen
        const offsetZ = config.offsetZ ?? 0.3;   // Slightly forward so text is visible
        
        // Update maxWidth from config if provided
        if (config.width) {
            this.config.maxWidth = config.width;
        }
        
        // Position using configured offsets
        this.group.position.set(
            screenPosition.x + offsetX,
            screenPosition.y + offsetY,
            screenPosition.z + offsetZ
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
        
        // Rebuild the text meshes
        this._rebuildText();
        
        this.group.visible = true;
        
        // Fade in
        this._fadeIn();
        
        // Schedule fade out
        this.hideTimer = setTimeout(() => {
            this._fadeOut();
        }, DISPLAY_DURATION);
        
        console.log('[SplatDialogBox] Showing:', text);
    }
    
    /**
     * Hide the dialog box immediately
     */
    hide() {
        if (this.fadeTimer) clearInterval(this.fadeTimer);
        if (this.hideTimer) clearTimeout(this.hideTimer);
        
        this.opacity = 0;
        this._updateOpacity();
        this.group.visible = false;
        
        console.log('[SplatDialogBox] Hidden');
    }
    
    /**
     * Check if dialog box is visible
     */
    isVisible() {
        return this.group.visible && this.opacity > 0;
    }
    
    /**
     * Rebuild the text meshes with current content
     */
    _rebuildText() {
        // Clear existing meshes
        this._clearMeshes();
        
        // Create quoted text
        const quote = `"${this.currentText}"`;
        
        // Simple line wrapping by character count estimate
        // We estimate based on maxWidth and fontSize
        const lines = this._wrapText(quote);
        
        // Calculate total height for centering
        const lineHeight = this.config.fontSize * this.config.lineSpacing * 0.003;
        const totalHeight = lines.length * lineHeight;
        
        // Create text splat for each line (with outline for readability)
        let y = totalHeight / 2 - lineHeight / 2;
        const outlineOffset = this.config.outlineOffset;
        
        for (const line of lines) {
            if (line.trim()) {
                // Create outline (dark shadow behind text) - 4 directions
                const offsets = [
                    [-outlineOffset, -outlineOffset],
                    [outlineOffset, -outlineOffset],
                    [-outlineOffset, outlineOffset],
                    [outlineOffset, outlineOffset],
                ];
                for (const [ox, oy] of offsets) {
                    const outline = this._createTextMesh(line, this.config.outlineColor, this.config.fontSize);
                    outline.position.set(ox, y + oy, -0.001); // Slightly behind
                    this.group.add(outline);
                    this.textMeshes.push(outline);
                }
                
                // Create main text (on top)
                const mesh = this._createTextMesh(line, this.config.textColor, this.config.fontSize);
                mesh.position.y = y;
                this.group.add(mesh);
                this.textMeshes.push(mesh);
            }
            y -= lineHeight;
        }
        
        // Create attribution below the text (with outline)
        const attributionText = `— ${this.characterName}`;
        
        // Attribution outline
        const attrOffsets = [
            [-outlineOffset, -outlineOffset],
            [outlineOffset, -outlineOffset],
            [-outlineOffset, outlineOffset],
            [outlineOffset, outlineOffset],
        ];
        for (const [ox, oy] of attrOffsets) {
            const outline = this._createTextMesh(attributionText, this.config.outlineColor, this.config.fontSize * 0.6);
            outline.position.set(ox, y - lineHeight * 0.3 + oy, -0.001);
            this.group.add(outline);
            this.textMeshes.push(outline);
        }
        
        // Attribution text
        this.attributionMesh = this._createTextMesh(
            attributionText, 
            this.config.attributionColor, 
            this.config.fontSize * 0.6
        );
        this.attributionMesh.position.y = y - lineHeight * 0.3;
        this.group.add(this.attributionMesh);
        
        // Update opacity
        this._updateOpacity();
    }
    
    /**
     * Create a text splat mesh
     * @param {string} text - Text content
     * @param {number} color - Color as hex number
     * @param {number} fontSize - Font size
     * @returns {THREE.Object3D}
     */
    _createTextMesh(text, color, fontSize) {
        const mesh = textSplats({
            text: text,
            font: "Georgia",  // Serif font to match the italic style
            fontSize: fontSize,
            color: new THREE.Color(color),
        });
        
        // Scale appropriately for world space
        // textSplats creates large meshes, scale down
        mesh.scale.setScalar(0.25 / 80);
        
        return mesh;
    }
    
    /**
     * Simple text wrapping based on character count
     * @param {string} text - Text to wrap
     * @returns {string[]} - Array of lines
     */
    _wrapText(text) {
        // Estimate chars per line based on maxWidth
        // This is approximate - actual width depends on font
        const charsPerLine = Math.floor(this.config.maxWidth * 12);
        
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';
        
        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            
            if (testLine.length > charsPerLine && currentLine) {
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
     * Clear all text meshes
     */
    _clearMeshes() {
        for (const mesh of this.textMeshes) {
            this.group.remove(mesh);
            if (mesh.dispose) mesh.dispose();
        }
        this.textMeshes = [];
        
        if (this.attributionMesh) {
            this.group.remove(this.attributionMesh);
            if (this.attributionMesh.dispose) this.attributionMesh.dispose();
            this.attributionMesh = null;
        }
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
            this._updateOpacity();
            
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
            this._updateOpacity();
            
            if (progress >= 1) {
                clearInterval(this.fadeTimer);
                this.fadeTimer = null;
                this.group.visible = false;
            }
        }, 16);
    }
    
    /**
     * Update opacity on all meshes
     * Uses SplatMesh's native opacity property for proper Spark rendering
     */
    _updateOpacity() {
        for (const mesh of this.textMeshes) {
            // Use native SplatMesh opacity property
            mesh.opacity = this.opacity;
        }
        
        if (this.attributionMesh) {
            this.attributionMesh.opacity = this.opacity;
        }
        
        // Only hide the group when fully transparent (opacity check happens in Spark)
        this.group.visible = this.opacity > 0;
    }
    
    /**
     * Get the group to add to scene
     */
    getGroup() {
        return this.group;
    }
    
    /**
     * Clean up resources
     */
    dispose() {
        if (this.fadeTimer) clearInterval(this.fadeTimer);
        if (this.hideTimer) clearTimeout(this.hideTimer);
        this._clearMeshes();
    }
}

// ============ Singleton API for easy use ============

let splatDialogBox = null;
let sceneRef = null;

/**
 * Initialize the splat dialog box system
 * @param {THREE.Scene} scene
 */
export function initSplatDialogBox(scene) {
    sceneRef = scene;
    console.log('[SplatDialogBox] System ready');
}

/**
 * Show a splat dialog box with commentary
 * @param {string} text - Commentary text
 * @param {string} characterName - Character name
 * @param {THREE.Vector3} screenPosition - Position to place near
 * @param {THREE.Quaternion} screenRotation - Rotation to match
 * @param {Object} panelConfig - Config {width, height, offsetY, offsetZ}
 */
export function showSplatCommentary(text, characterName, screenPosition, screenRotation = null, panelConfig = null) {
    if (!sceneRef) {
        console.warn('[SplatDialogBox] Not initialized - sceneRef is null');
        return;
    }
    
    console.log('[SplatDialogBox] showSplatCommentary called:', {
        text: text?.substring(0, 30) + '...',
        characterName,
        hasScreenPosition: !!screenPosition,
        screenPosition: screenPosition ? `(${screenPosition.x?.toFixed(2)}, ${screenPosition.y?.toFixed(2)}, ${screenPosition.z?.toFixed(2)})` : null,
        panelConfig
    });
    
    // Create dialog box if needed
    if (!splatDialogBox) {
        splatDialogBox = new SplatDialogBox(panelConfig || {});
        sceneRef.add(splatDialogBox.getGroup());
        console.log('[SplatDialogBox] Created and added to scene');
    }
    
    // Position relative to screen
    if (screenPosition) {
        splatDialogBox.positionRelativeTo(screenPosition, screenRotation, panelConfig || {});
        console.log('[SplatDialogBox] Positioned at:', splatDialogBox.group.position);
    } else {
        console.warn('[SplatDialogBox] No screenPosition provided - dialog box not positioned');
    }
    
    splatDialogBox.show(text, characterName);
}

/**
 * Hide the splat dialog box
 */
export function hideSplatCommentary() {
    if (splatDialogBox) {
        splatDialogBox.hide();
    }
}

/**
 * Check if splat dialog box is visible
 */
export function isSplatCommentaryVisible() {
    return splatDialogBox?.isVisible() ?? false;
}

/**
 * Dispose splat dialog box resources
 */
export function disposeSplatDialogBox() {
    if (splatDialogBox) {
        if (sceneRef) {
            sceneRef.remove(splatDialogBox.getGroup());
        }
        splatDialogBox.dispose();
        splatDialogBox = null;
    }
}
