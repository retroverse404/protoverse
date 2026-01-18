/**
 * VR Chat Panel
 * 
 * A 3D panel for displaying chat messages in VR.
 * Shows conversation history and current input.
 */

import * as THREE from "three";

// Panel dimensions
const PANEL_WIDTH = 0.8;
const PANEL_HEIGHT = 0.5;
const PANEL_PADDING = 0.02;

// Text settings
const FONT_SIZE = 24;
const LINE_HEIGHT = 1.4;
const MAX_MESSAGES = 6;

// Colors
const COLORS = {
    background: 'rgba(0, 0, 0, 0.85)',
    border: 'rgba(255, 255, 255, 0.3)',
    characterName: '#4fc3f7',
    userMessage: '#81d4fa',
    characterMessage: '#ffffff',
    inputBackground: 'rgba(255, 255, 255, 0.1)',
    inputText: '#ffffff',
    inputPlaceholder: 'rgba(255, 255, 255, 0.5)',
    cursor: '#4fc3f7',
};

/**
 * VR Chat Panel class
 */
export class VRChatPanel {
    constructor() {
        this.group = new THREE.Group();
        this.group.name = 'vr-chat-panel';
        
        // Canvas for rendering text
        this.canvas = document.createElement('canvas');
        this.canvas.width = 1024;
        this.canvas.height = 640;
        this.ctx = this.canvas.getContext('2d');
        
        // Create texture and mesh
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.magFilter = THREE.LinearFilter;
        
        const geometry = new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT);
        const material = new THREE.MeshBasicMaterial({
            map: this.texture,
            transparent: true,
            side: THREE.DoubleSide,
        });
        
        this.mesh = new THREE.Mesh(geometry, material);
        this.group.add(this.mesh);
        
        // State
        this.characterName = '';
        this.messages = [];  // {role: 'user'|'character', content: string}
        this.inputText = '';
        this.cursorVisible = true;
        this.streamingText = '';  // For streaming responses
        this.isStreaming = false;
        
        // Cursor blink
        this.cursorBlinkInterval = null;
        
        // Initially hidden
        this.group.visible = false;
        
        // Initial render
        this._render();
    }
    
    /**
     * Show the panel
     * @param {THREE.Vector3} position - World position
     * @param {THREE.Quaternion} rotation - Rotation to face player
     * @param {string} characterName - Name of character being chatted with
     */
    show(position, rotation, characterName) {
        this.characterName = characterName;
        this.messages = [];
        this.inputText = '';
        this.streamingText = '';
        this.isStreaming = false;
        
        this.group.position.copy(position);
        this.group.quaternion.copy(rotation);
        this.group.visible = true;
        
        // Start cursor blink
        this._startCursorBlink();
        
        this._render();
        console.log('[VRChatPanel] Shown for', characterName);
    }
    
    /**
     * Hide the panel
     */
    hide() {
        this.group.visible = false;
        this._stopCursorBlink();
        console.log('[VRChatPanel] Hidden');
    }
    
    /**
     * Check if panel is visible
     */
    isVisible() {
        return this.group.visible;
    }
    
    /**
     * Add a message to the chat
     * @param {string} content - Message text
     * @param {string} role - 'user' or 'character'
     */
    addMessage(content, role) {
        this.messages.push({ role, content });
        
        // Trim old messages
        while (this.messages.length > MAX_MESSAGES) {
            this.messages.shift();
        }
        
        this._render();
    }
    
    /**
     * Start a streaming message (character typing)
     */
    startStreaming() {
        this.isStreaming = true;
        this.streamingText = '';
        this._render();
    }
    
    /**
     * Append to streaming message
     * @param {string} token - Text to append
     */
    appendToStreaming(token) {
        this.streamingText += token;
        this._render();
    }
    
    /**
     * End streaming and add as complete message
     */
    endStreaming() {
        if (this.streamingText) {
            this.addMessage(this.streamingText, 'character');
        }
        this.isStreaming = false;
        this.streamingText = '';
        this._render();
    }
    
    /**
     * Set the input text
     * @param {string} text
     */
    setInputText(text) {
        this.inputText = text;
        this._render();
    }
    
    /**
     * Get the current input text
     */
    getInputText() {
        return this.inputText;
    }
    
    /**
     * Clear the input text
     */
    clearInput() {
        this.inputText = '';
        this._render();
    }
    
    /**
     * Handle a key press
     * @param {string} key - Key character or 'Backspace'
     */
    handleKeyPress(key) {
        if (key === 'Backspace') {
            this.inputText = this.inputText.slice(0, -1);
        } else {
            this.inputText += key;
        }
        this._render();
    }
    
    /**
     * Start cursor blinking
     */
    _startCursorBlink() {
        this._stopCursorBlink();
        this.cursorVisible = true;
        this.cursorBlinkInterval = setInterval(() => {
            this.cursorVisible = !this.cursorVisible;
            this._render();
        }, 530);
    }
    
    /**
     * Stop cursor blinking
     */
    _stopCursorBlink() {
        if (this.cursorBlinkInterval) {
            clearInterval(this.cursorBlinkInterval);
            this.cursorBlinkInterval = null;
        }
    }
    
    /**
     * Render the panel to canvas
     */
    _render() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const padding = PANEL_PADDING * w / PANEL_WIDTH;
        
        // Clear canvas
        ctx.clearRect(0, 0, w, h);
        
        // Background
        ctx.fillStyle = COLORS.background;
        ctx.beginPath();
        ctx.roundRect(0, 0, w, h, 16);
        ctx.fill();
        
        // Border
        ctx.strokeStyle = COLORS.border;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(0, 0, w, h, 16);
        ctx.stroke();
        
        // Header with character name
        ctx.fillStyle = COLORS.characterName;
        ctx.font = `bold ${FONT_SIZE}px system-ui, -apple-system, sans-serif`;
        ctx.fillText(this.characterName, padding, padding + FONT_SIZE);
        
        // Divider line
        const headerBottom = padding + FONT_SIZE + 10;
        ctx.strokeStyle = COLORS.border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padding, headerBottom);
        ctx.lineTo(w - padding, headerBottom);
        ctx.stroke();
        
        // Messages area
        let y = headerBottom + 20;
        const maxMessageWidth = w - padding * 2;
        const messageHeight = FONT_SIZE * LINE_HEIGHT;
        
        ctx.font = `${FONT_SIZE}px system-ui, -apple-system, sans-serif`;
        
        for (const msg of this.messages) {
            const isUser = msg.role === 'user';
            ctx.fillStyle = isUser ? COLORS.userMessage : COLORS.characterMessage;
            
            // Word wrap
            const lines = this._wrapText(msg.content, maxMessageWidth - 20);
            
            for (const line of lines) {
                if (isUser) {
                    // Right-align user messages
                    const textWidth = ctx.measureText(line).width;
                    ctx.fillText(line, w - padding - textWidth, y);
                } else {
                    ctx.fillText(line, padding, y);
                }
                y += messageHeight;
            }
            
            y += 5;  // Gap between messages
        }
        
        // Streaming message (if active)
        if (this.isStreaming && this.streamingText) {
            ctx.fillStyle = COLORS.characterMessage;
            const lines = this._wrapText(this.streamingText, maxMessageWidth - 20);
            for (const line of lines) {
                ctx.fillText(line, padding, y);
                y += messageHeight;
            }
        }
        
        // Input area at bottom
        const inputHeight = 50;
        const inputY = h - padding - inputHeight;
        
        // Input background
        ctx.fillStyle = COLORS.inputBackground;
        ctx.beginPath();
        ctx.roundRect(padding, inputY, w - padding * 2, inputHeight, 8);
        ctx.fill();
        
        // Input border
        ctx.strokeStyle = COLORS.border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(padding, inputY, w - padding * 2, inputHeight, 8);
        ctx.stroke();
        
        // Input text or placeholder
        const textY = inputY + inputHeight / 2 + FONT_SIZE / 3;
        
        if (this.inputText) {
            ctx.fillStyle = COLORS.inputText;
            ctx.fillText(this.inputText, padding + 12, textY);
            
            // Cursor
            if (this.cursorVisible) {
                const textWidth = ctx.measureText(this.inputText).width;
                ctx.fillStyle = COLORS.cursor;
                ctx.fillRect(padding + 14 + textWidth, inputY + 10, 2, inputHeight - 20);
            }
        } else {
            ctx.fillStyle = COLORS.inputPlaceholder;
            ctx.fillText('Type a message...', padding + 12, textY);
            
            // Cursor at start
            if (this.cursorVisible) {
                ctx.fillStyle = COLORS.cursor;
                ctx.fillRect(padding + 12, inputY + 10, 2, inputHeight - 20);
            }
        }
        
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
        this._stopCursorBlink();
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
        this.texture.dispose();
    }
}

