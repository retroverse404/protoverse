/**
 * VR Keyboard
 * 
 * A 3D virtual keyboard for VR text input using laser pointer.
 * Point controller at keys and pull trigger to type.
 */

import * as THREE from "three";

// Keyboard layout (QWERTY)
const KEYBOARD_LAYOUT = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '⌫'],
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', "'"],
    ['⇧', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.'],
    ['␣', '↵'],  // Space and Enter
];

// Special key mappings
const SPECIAL_KEYS = {
    '⌫': 'Backspace',
    '⇧': 'Shift',
    '␣': 'Space',
    '↵': 'Enter',
};

// Key dimensions
const KEY_WIDTH = 0.06;
const KEY_HEIGHT = 0.06;
const KEY_DEPTH = 0.015;
const KEY_GAP = 0.008;
const KEYBOARD_SCALE = 1.0;

// Colors
const COLORS = {
    keyDefault: 0x2a2a2a,
    keyHover: 0x4a4a4a,
    keyPressed: 0x0077cc,
    keyText: 0xffffff,
    keySpecial: 0x3a3a3a,
    background: 0x1a1a1a,
};

/**
 * VR Keyboard class
 */
export class VRKeyboard {
    constructor() {
        this.group = new THREE.Group();
        this.group.name = 'vr-keyboard';
        
        this.keys = new Map();  // mesh -> key data
        this.keyMeshes = [];    // for raycasting
        this.hoveredKey = null;
        this.isShiftActive = false;
        
        // Callbacks
        this.onKeyPress = null;  // (key: string) => void
        this.onSubmit = null;    // () => void
        
        // Raycaster for controller interaction
        this.raycaster = new THREE.Raycaster();
        this.raycaster.far = 5;
        
        // Laser line
        this.laserLine = null;
        this.laserEndPoint = null;
        
        // Build the keyboard
        this._buildKeyboard();
        this._createLaser();
        
        // Initially hidden
        this.group.visible = false;
    }
    
    /**
     * Build the 3D keyboard
     */
    _buildKeyboard() {
        // Background panel
        const totalWidth = 11 * (KEY_WIDTH + KEY_GAP) * KEYBOARD_SCALE;
        const totalHeight = 5 * (KEY_HEIGHT + KEY_GAP) * KEYBOARD_SCALE + 0.02;
        
        const bgGeometry = new THREE.BoxGeometry(totalWidth + 0.04, totalHeight + 0.04, 0.01);
        const bgMaterial = new THREE.MeshBasicMaterial({ 
            color: COLORS.background,
            transparent: true,
            opacity: 0.9,
        });
        const background = new THREE.Mesh(bgGeometry, bgMaterial);
        background.position.z = -KEY_DEPTH / 2 - 0.005;
        this.group.add(background);
        
        // Create keys for each row
        let yOffset = (KEYBOARD_LAYOUT.length - 1) * (KEY_HEIGHT + KEY_GAP) * KEYBOARD_SCALE / 2;
        
        for (let row = 0; row < KEYBOARD_LAYOUT.length; row++) {
            const rowKeys = KEYBOARD_LAYOUT[row];
            const rowWidth = rowKeys.length * (KEY_WIDTH + KEY_GAP) - KEY_GAP;
            let xOffset = -rowWidth * KEYBOARD_SCALE / 2;
            
            for (let col = 0; col < rowKeys.length; col++) {
                const keyChar = rowKeys[col];
                const isSpecial = SPECIAL_KEYS[keyChar] !== undefined;
                
                // Determine key width (space bar is wider)
                let keyWidth = KEY_WIDTH;
                if (keyChar === '␣') {
                    keyWidth = KEY_WIDTH * 5;  // Space bar
                } else if (keyChar === '↵') {
                    keyWidth = KEY_WIDTH * 3;  // Enter key
                } else if (keyChar === '⌫') {
                    keyWidth = KEY_WIDTH * 1.5;  // Backspace
                }
                
                // Create key mesh
                const keyGeometry = new THREE.BoxGeometry(
                    keyWidth * KEYBOARD_SCALE,
                    KEY_HEIGHT * KEYBOARD_SCALE,
                    KEY_DEPTH
                );
                const keyMaterial = new THREE.MeshBasicMaterial({
                    color: isSpecial ? COLORS.keySpecial : COLORS.keyDefault,
                });
                const keyMesh = new THREE.Mesh(keyGeometry, keyMaterial);
                
                // Position key
                keyMesh.position.set(
                    xOffset + (keyWidth * KEYBOARD_SCALE) / 2,
                    yOffset,
                    0
                );
                
                // Create text label
                const canvas = document.createElement('canvas');
                canvas.width = 64;
                canvas.height = 64;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 32px system-ui, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                
                // Display character
                let displayChar = keyChar;
                if (keyChar === '␣') displayChar = '―';
                ctx.fillText(displayChar, 32, 32);
                
                const textTexture = new THREE.CanvasTexture(canvas);
                const textMaterial = new THREE.MeshBasicMaterial({
                    map: textTexture,
                    transparent: true,
                });
                const textGeometry = new THREE.PlaneGeometry(
                    KEY_WIDTH * KEYBOARD_SCALE * 0.8,
                    KEY_HEIGHT * KEYBOARD_SCALE * 0.8
                );
                const textMesh = new THREE.Mesh(textGeometry, textMaterial);
                textMesh.position.z = KEY_DEPTH / 2 + 0.001;
                // Disable raycasting on text so it doesn't block key detection
                textMesh.raycast = () => {};
                keyMesh.add(textMesh);
                
                // Store key data
                this.keys.set(keyMesh, {
                    char: keyChar,
                    isSpecial,
                    material: keyMaterial,
                    originalColor: isSpecial ? COLORS.keySpecial : COLORS.keyDefault,
                });
                
                this.keyMeshes.push(keyMesh);
                this.group.add(keyMesh);
                
                xOffset += (keyWidth + KEY_GAP) * KEYBOARD_SCALE;
            }
            
            yOffset -= (KEY_HEIGHT + KEY_GAP) * KEYBOARD_SCALE;
        }
    }
    
    /**
     * Create laser pointer line
     */
    _createLaser() {
        const laserGeometry = new THREE.BufferGeometry();
        const positions = new Float32Array(6);  // 2 points * 3 coordinates
        laserGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        
        const laserMaterial = new THREE.LineBasicMaterial({
            color: 0x00aaff,
            transparent: true,
            opacity: 0.6,
        });
        
        this.laserLine = new THREE.Line(laserGeometry, laserMaterial);
        this.laserLine.frustumCulled = false;
        
        // End point sphere
        const sphereGeometry = new THREE.SphereGeometry(0.008, 16, 16);
        const sphereMaterial = new THREE.MeshBasicMaterial({ color: 0x00aaff });
        this.laserEndPoint = new THREE.Mesh(sphereGeometry, sphereMaterial);
        this.laserEndPoint.visible = false;
    }
    
    /**
     * Show the keyboard at a position facing a direction
     * @param {THREE.Vector3} position - World position
     * @param {THREE.Quaternion} rotation - Rotation to face
     */
    show(position, rotation) {
        this.group.position.copy(position);
        this.group.quaternion.copy(rotation);
        this.group.visible = true;
        this.isShiftActive = false;
        console.log('[VRKeyboard] Shown at', position.toArray());
    }
    
    /**
     * Hide the keyboard
     */
    hide() {
        this.group.visible = false;
        this.laserLine.visible = false;
        this.laserEndPoint.visible = false;
        this._clearHover();
        console.log('[VRKeyboard] Hidden');
    }
    
    /**
     * Check if keyboard is visible
     */
    isVisible() {
        return this.group.visible;
    }
    
    /**
     * Update keyboard with controller input
     * @param {THREE.Vector3} controllerPosition - Controller world position
     * @param {THREE.Quaternion} controllerRotation - Controller rotation
     * @param {boolean} triggerPressed - Is trigger pressed this frame
     * @param {THREE.Scene} scene - Scene to add laser to
     */
    update(controllerPosition, controllerRotation, triggerPressed, scene) {
        if (!this.group.visible) return;
        
        // Ensure laser is in scene
        if (!this.laserLine.parent) {
            scene.add(this.laserLine);
            scene.add(this.laserEndPoint);
        }
        
        // Set up raycaster from controller
        const direction = new THREE.Vector3(0, 0, -1);
        direction.applyQuaternion(controllerRotation);
        
        this.raycaster.set(controllerPosition, direction);
        
        // Check for key intersections
        const intersects = this.raycaster.intersectObjects(this.keyMeshes, false);
        
        // Update laser line
        const positions = this.laserLine.geometry.attributes.position.array;
        positions[0] = controllerPosition.x;
        positions[1] = controllerPosition.y;
        positions[2] = controllerPosition.z;
        
        if (intersects.length > 0) {
            const hit = intersects[0];
            positions[3] = hit.point.x;
            positions[4] = hit.point.y;
            positions[5] = hit.point.z;
            
            this.laserEndPoint.position.copy(hit.point);
            this.laserEndPoint.visible = true;
            this.laserLine.visible = true;
            
            // Handle hover
            const keyMesh = hit.object;
            if (keyMesh !== this.hoveredKey) {
                this._clearHover();
                this._setHover(keyMesh);
            }
            
            // Handle trigger press
            if (triggerPressed && this.hoveredKey) {
                this._pressKey(this.hoveredKey);
            }
        } else {
            // No hit - extend laser forward
            const endPoint = controllerPosition.clone().addScaledVector(direction, 2);
            positions[3] = endPoint.x;
            positions[4] = endPoint.y;
            positions[5] = endPoint.z;
            
            this.laserEndPoint.visible = false;
            this.laserLine.visible = true;
            this._clearHover();
        }
        
        this.laserLine.geometry.attributes.position.needsUpdate = true;
    }
    
    /**
     * Set hover state on a key
     */
    _setHover(keyMesh) {
        const keyData = this.keys.get(keyMesh);
        if (keyData) {
            keyData.material.color.setHex(COLORS.keyHover);
            this.hoveredKey = keyMesh;
        }
    }
    
    /**
     * Clear hover state
     */
    _clearHover() {
        if (this.hoveredKey) {
            const keyData = this.keys.get(this.hoveredKey);
            if (keyData) {
                keyData.material.color.setHex(keyData.originalColor);
            }
            this.hoveredKey = null;
        }
    }
    
    /**
     * Press a key
     */
    _pressKey(keyMesh) {
        const keyData = this.keys.get(keyMesh);
        if (!keyData) return;
        
        // Visual feedback
        keyData.material.color.setHex(COLORS.keyPressed);
        setTimeout(() => {
            if (this.hoveredKey === keyMesh) {
                keyData.material.color.setHex(COLORS.keyHover);
            } else {
                keyData.material.color.setHex(keyData.originalColor);
            }
        }, 100);
        
        const keyChar = keyData.char;
        
        // Handle special keys
        if (keyChar === '⇧') {
            this.isShiftActive = !this.isShiftActive;
            console.log('[VRKeyboard] Shift:', this.isShiftActive);
            return;
        }
        
        if (keyChar === '↵') {
            console.log('[VRKeyboard] Enter pressed');
            if (this.onSubmit) {
                this.onSubmit();
            }
            return;
        }
        
        if (keyChar === '⌫') {
            console.log('[VRKeyboard] Backspace pressed');
            if (this.onKeyPress) {
                this.onKeyPress('Backspace');
            }
            return;
        }
        
        // Regular key
        let char = keyChar;
        if (keyChar === '␣') {
            char = ' ';
        } else if (!this.isShiftActive) {
            char = keyChar.toLowerCase();
        }
        
        console.log('[VRKeyboard] Key pressed:', char);
        
        if (this.onKeyPress) {
            this.onKeyPress(char);
        }
        
        // Auto-disable shift after typing
        if (this.isShiftActive && keyChar !== '⇧') {
            this.isShiftActive = false;
        }
    }
    
    /**
     * Clean up resources
     */
    dispose() {
        // Remove from scene
        if (this.laserLine.parent) {
            this.laserLine.parent.remove(this.laserLine);
        }
        if (this.laserEndPoint.parent) {
            this.laserEndPoint.parent.remove(this.laserEndPoint);
        }
        
        // Dispose geometries and materials
        this.keyMeshes.forEach(mesh => {
            mesh.geometry.dispose();
            mesh.material.dispose();
        });
        
        this.laserLine.geometry.dispose();
        this.laserLine.material.dispose();
        this.laserEndPoint.geometry.dispose();
        this.laserEndPoint.material.dispose();
    }
}

