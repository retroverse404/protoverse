/**
 * Mobile Controls - Virtual Joystick
 * 
 * Provides touch-based movement controls for mobile devices.
 * Easy to enable/disable via config or by not calling init().
 * 
 * Usage:
 *   import { initMobileControls, getMobileInput, isMobileDevice } from './mobile-controls.js';
 *   
 *   if (isMobileDevice()) {
 *       initMobileControls();
 *   }
 *   
 *   // In your update loop:
 *   const input = getMobileInput();
 *   // input.x: -1 to 1 (left/right)
 *   // input.y: -1 to 1 (forward/back, negative = forward)
 *   // input.active: boolean (is joystick being touched)
 */

// Configuration
const CONFIG = {
    // Joystick size and position
    joystickSize: 120,          // Outer ring diameter
    knobSize: 50,               // Inner knob diameter
    deadzone: 0.15,             // Ignore small movements
    
    // Position from edges (in pixels)
    marginLeft: 30,
    marginBottom: 30,
    
    // Visual styling
    outerColor: 'rgba(255, 255, 255, 0.2)',
    outerBorder: 'rgba(255, 255, 255, 0.4)',
    knobColor: 'rgba(255, 255, 255, 0.5)',
    knobActiveColor: 'rgba(100, 150, 255, 0.7)',
};

// State
let initialized = false;
let enabled = true;
let joystickContainer = null;
let joystickOuter = null;
let joystickKnob = null;
let activeTouch = null;
let joystickCenter = { x: 0, y: 0 };
let currentInput = { x: 0, y: 0, active: false };

/**
 * Check if the current device is likely a mobile/touch device (but NOT a VR headset)
 */
export function isMobileDevice() {
    // Exclude VR headsets (Quest browser, etc.) - they have their own controllers
    if (/OculusBrowser|Quest|Oculus/i.test(navigator.userAgent)) {
        return false;
    }
    
    return (
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    );
}

/**
 * Initialize mobile controls
 * @param {Object} options - Override default config
 */
export function initMobileControls(options = {}) {
    if (initialized) return;
    
    // Merge options with defaults
    Object.assign(CONFIG, options);
    
    createJoystickUI();
    attachEventListeners();
    
    initialized = true;
    console.log('[MobileControls] Initialized virtual joystick');
}

/**
 * Get current mobile input state
 * @returns {{ x: number, y: number, active: boolean }}
 */
export function getMobileInput() {
    if (!enabled || !initialized) {
        return { x: 0, y: 0, active: false };
    }
    return { ...currentInput };
}

/**
 * Enable or disable mobile controls
 */
export function setMobileControlsEnabled(value) {
    enabled = value;
    if (joystickContainer) {
        joystickContainer.style.display = enabled ? 'block' : 'none';
    }
    if (!enabled) {
        currentInput = { x: 0, y: 0, active: false };
    }
}

/**
 * Check if mobile controls are enabled
 */
export function isMobileControlsEnabled() {
    return enabled && initialized;
}

/**
 * Cleanup and remove mobile controls
 */
export function destroyMobileControls() {
    if (joystickContainer) {
        joystickContainer.remove();
        joystickContainer = null;
        joystickOuter = null;
        joystickKnob = null;
    }
    initialized = false;
    currentInput = { x: 0, y: 0, active: false };
    console.log('[MobileControls] Destroyed');
}

/**
 * Create the joystick UI elements
 */
function createJoystickUI() {
    // Container
    joystickContainer = document.createElement('div');
    joystickContainer.id = 'mobile-joystick';
    joystickContainer.style.cssText = `
        position: fixed;
        left: ${CONFIG.marginLeft}px;
        bottom: ${CONFIG.marginBottom}px;
        width: ${CONFIG.joystickSize}px;
        height: ${CONFIG.joystickSize}px;
        z-index: 1000;
        touch-action: none;
        pointer-events: auto;
    `;
    
    // Outer ring
    joystickOuter = document.createElement('div');
    joystickOuter.style.cssText = `
        position: absolute;
        width: 100%;
        height: 100%;
        border-radius: 50%;
        background: ${CONFIG.outerColor};
        border: 2px solid ${CONFIG.outerBorder};
        box-sizing: border-box;
    `;
    
    // Inner knob
    joystickKnob = document.createElement('div');
    joystickKnob.style.cssText = `
        position: absolute;
        width: ${CONFIG.knobSize}px;
        height: ${CONFIG.knobSize}px;
        border-radius: 50%;
        background: ${CONFIG.knobColor};
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        transition: background 0.1s;
    `;
    
    joystickOuter.appendChild(joystickKnob);
    joystickContainer.appendChild(joystickOuter);
    document.body.appendChild(joystickContainer);
    
    // Calculate center position
    updateJoystickCenter();
}

/**
 * Update the stored center position of the joystick
 */
function updateJoystickCenter() {
    if (!joystickContainer) return;
    const rect = joystickContainer.getBoundingClientRect();
    joystickCenter = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
    };
}

/**
 * Attach touch event listeners
 */
function attachEventListeners() {
    // Handle window resize
    window.addEventListener('resize', updateJoystickCenter);
    window.addEventListener('orientationchange', () => {
        setTimeout(updateJoystickCenter, 100);
    });
    
    // Touch start on joystick
    joystickContainer.addEventListener('touchstart', handleTouchStart, { passive: false });
    
    // Touch move/end on document (to handle dragging outside joystick)
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd, { passive: false });
    document.addEventListener('touchcancel', handleTouchEnd, { passive: false });
}

/**
 * Handle touch start
 */
function handleTouchStart(e) {
    if (!enabled) return;
    
    // Only track one touch for the joystick
    if (activeTouch !== null) return;
    
    const touch = e.changedTouches[0];
    activeTouch = touch.identifier;
    
    updateJoystickCenter();
    updateJoystickPosition(touch.clientX, touch.clientY);
    
    joystickKnob.style.background = CONFIG.knobActiveColor;
    currentInput.active = true;
    
    e.preventDefault();
}

/**
 * Handle touch move
 */
function handleTouchMove(e) {
    if (!enabled || activeTouch === null) return;
    
    // Find our tracked touch
    for (const touch of e.changedTouches) {
        if (touch.identifier === activeTouch) {
            updateJoystickPosition(touch.clientX, touch.clientY);
            e.preventDefault();
            break;
        }
    }
}

/**
 * Handle touch end
 */
function handleTouchEnd(e) {
    if (activeTouch === null) return;
    
    // Check if our tracked touch ended
    for (const touch of e.changedTouches) {
        if (touch.identifier === activeTouch) {
            resetJoystick();
            break;
        }
    }
}

/**
 * Update joystick knob position and input values
 */
function updateJoystickPosition(touchX, touchY) {
    const maxRadius = (CONFIG.joystickSize - CONFIG.knobSize) / 2;
    
    // Calculate offset from center
    let dx = touchX - joystickCenter.x;
    let dy = touchY - joystickCenter.y;
    
    // Calculate distance and clamp to max radius
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > maxRadius) {
        dx = (dx / distance) * maxRadius;
        dy = (dy / distance) * maxRadius;
    }
    
    // Update knob visual position
    const knobX = 50 + (dx / maxRadius) * 50;
    const knobY = 50 + (dy / maxRadius) * 50;
    joystickKnob.style.left = `${knobX}%`;
    joystickKnob.style.top = `${knobY}%`;
    
    // Calculate normalized input (-1 to 1)
    let inputX = dx / maxRadius;
    let inputY = dy / maxRadius;
    
    // Apply deadzone
    if (Math.abs(inputX) < CONFIG.deadzone) inputX = 0;
    if (Math.abs(inputY) < CONFIG.deadzone) inputY = 0;
    
    currentInput.x = inputX;
    currentInput.y = inputY;
}

/**
 * Reset joystick to center position
 */
function resetJoystick() {
    activeTouch = null;
    currentInput = { x: 0, y: 0, active: false };
    
    if (joystickKnob) {
        joystickKnob.style.left = '50%';
        joystickKnob.style.top = '50%';
        joystickKnob.style.background = CONFIG.knobColor;
    }
}
