/**
 * Physics Configuration
 * 
 * Tweak these values to adjust physics behavior.
 * All values can be changed at runtime via the exported config object.
 */

export const physicsConfig = {
    // ========== World Settings ==========
    gravity: { x: 0, y: 0, z: 0 },  // Zero-G environment (changed dynamically)
    gravityBoots: { x: 0, y: -9.81, z: 0 },  // Gravity for walking mode
    
    // ========== Movement Mode ==========
    // 'weightless' = zero-G with thruster
    // 'gravityBoots' = FPS-style walking with gravity
    movementMode: 'gravityBoots',
    
    // ========== Ghost Mode ==========
    // true = pass through walls (no collision)
    // false = solid collision with world geometry
    ghostMode: true,
    
    // ========== Player Settings ==========
    player: {
        // Collision shape
        radius: 0.2,              // Sphere radius in meters
        collisionYOffset: -0.25,    // Vertical offset from localFrame (1.0 = chest level in VR)
        
        // Mass and inertia
        mass: 10.0,                // Player mass in kg
        
        // Viscosity / Drag (scuba diving feel)
        // Higher values = more resistance = momentum slows faster
        // 0 = no drag (drifts forever), 0.1 = minimal, 2.0 = heavy drag
        linearDamping: 0.3,       // Gentle taper for graceful slowdown 
        angularDamping: 3.0,      // Rotational resistance (stabilizes tumbling)
        
        // Bounce behavior
        restitution: 1.0,         // Bounciness (1.0 = full bounce, 0 = no bounce)
        friction: 0.1,            // Surface friction
        
        // Movement limits
        maxLinearVelocity: 20.0,  // Max speed in m/s
        maxAngularVelocity: 10.0, // Max rotation speed in rad/s
    },
    
    // ========== Thruster Settings ==========
    thruster: {
        // Force magnitude (higher to overcome viscosity drag)
        force: 0.3,              // Thrust force in Newtons
        
        // Boost multiplier (when shift is held)
        boostMultiplier: 2.5,
        
        // Continuous vs impulse
        // true = force applied every frame while key held
        // false = single impulse on key press
        continuous: false,
    },
    
    // ========== Gravity Boots (Walking) Settings ==========
    walking: {
        speed: 4.0,              // Walk speed in m/s
        runMultiplier: 2.0,      // Run speed multiplier (shift held)
        jumpForce: 6.0,          // Jump impulse force (slightly higher for taller player)
        groundCheckDistance: 0.6, // Distance to check for ground below player
        stepHeight: 0.3,         // Max step height player can walk over
        
        // Capsule collision shape for FPS walking (tall standing player)
        capsuleRadius: 0.25,     // Radius of capsule ends
        capsuleHalfHeight: 0.9,  // Half the height of the cylinder part (total height ~2.3m)
        collisionYOffset: -1.15, // Center capsule at player feet
        
        // Physics properties for walking (override player defaults)
        linearDamping: 5.0,      // High damping for instant stop when releasing keys
        restitution: 0.0,        // No bounce - FPS style
        friction: 1.0,           // High friction for grip
    },
    
    // ========== Collision Mesh Settings ==========
    collisionMesh: {
        restitution: 1.0,         // How bouncy the walls are
        friction: 0.1,            // Wall friction
    },
    
    // ========== Debug Settings ==========
    debug: {
        logCollisions: false,     // Log collision events to console
        showVelocity: false,      // Show velocity in HUD
    },
};

/**
 * Helper to update config values at runtime
 * @param {string} path - Dot-notation path like "player.mass"
 * @param {any} value - New value
 */
export function setPhysicsConfig(path, value) {
    const parts = path.split('.');
    let obj = physicsConfig;
    for (let i = 0; i < parts.length - 1; i++) {
        obj = obj[parts[i]];
        if (!obj) {
            console.warn(`Physics config path not found: ${path}`);
            return;
        }
    }
    obj[parts[parts.length - 1]] = value;
    console.log(`Physics config updated: ${path} = ${value}`);
}

/**
 * Get a config value by path
 * @param {string} path - Dot-notation path like "player.mass"
 * @returns {any}
 */
export function getPhysicsConfig(path) {
    const parts = path.split('.');
    let obj = physicsConfig;
    for (const part of parts) {
        obj = obj[part];
        if (obj === undefined) {
            console.warn(`Physics config path not found: ${path}`);
            return undefined;
        }
    }
    return obj;
}


