/**
 * Physics Module
 * 
 * Handles Rapier physics simulation for zero-G environment with thruster controls.
 */

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { physicsConfig } from "./physics-config.js";
import { ensureAudioContext } from "./audio.js";

// Module state
let world = null;
let playerBody = null;
let playerCollider = null;
let isInitialized = false;
let isEnabled = false;

// References to Three.js objects
let localFrameRef = null;
let cameraRef = null;
let sceneRef = null;

// Debug visualization
let debugSphere = null;
let debugSphereVisible = false;

// Collision bodies for world geometry
const collisionBodies = [];

// Movement mode: 'weightless' or 'gravityBoots'
let movementMode = 'gravityBoots';  // Default to FPS walking

// Ghost mode: true = pass through walls, false = solid collision
let ghostMode = true;  // Default to ghost mode (no collisions)

// Ground check state for walking
let isGrounded = false;

// Input state for thruster (keyboard)
const thrusterInput = {
    forward: false,   // W or ArrowUp
    backward: false,  // S or ArrowDown
    left: false,      // A or ArrowLeft
    right: false,     // D or ArrowRight
    up: false,        // R or Space
    down: false,      // F or Ctrl
    boost: false,     // Shift
};

// VR controller input state
const vrThrusterInput = {
    x: 0,  // Left/right from left thumbstick
    y: 0,  // Up/down from triggers
    z: 0,  // Forward/back from left thumbstick
    boost: false,  // From right trigger
};
let rendererRef = null;  // For XR gamepad access

// Thrust sound
let thrustAudio = null;
let isThrustSoundPlaying = false;
let thrustSoundStartTime = 0;
let thrustStopTimeout = null;
let thrustFadeInterval = null;
const THRUST_MIN_DURATION = 1000; // Minimum play time in ms
const THRUST_FADE_DURATION = 500; // Fade out duration in ms
const THRUST_VOLUME = 0.15;        // Normal playing volume

/**
 * Initialize thrust sound effect
 */
function initThrustSound() {
    thrustAudio = new Audio('/thrust.mp3');
    thrustAudio.loop = true;  // Loop while thrusting
    thrustAudio.volume = THRUST_VOLUME;
    // Preload the audio
    thrustAudio.load();
    console.log("✓ Thrust sound initialized");
}

/**
 * Start playing thrust sound
 */
async function startThrustSound() {
    if (!thrustAudio || !isEnabled) return;
    
    // Don't play thrust sound in gravity boots mode (FPS walking)
    if (movementMode === 'gravityBoots') return;
    
    // Cancel any pending stop or fade
    if (thrustStopTimeout) {
        clearTimeout(thrustStopTimeout);
        thrustStopTimeout = null;
    }
    if (thrustFadeInterval) {
        clearInterval(thrustFadeInterval);
        thrustFadeInterval = null;
    }
    
    // Restore volume (in case we were fading)
    thrustAudio.volume = THRUST_VOLUME;
    
    // If already playing, just continue
    if (isThrustSoundPlaying) return;
    
    // Ensure AudioContext is ready (required for VR audio on Quest)
    await ensureAudioContext();
    
    thrustAudio.currentTime = 0;
    thrustAudio.play().catch(err => {
        // Ignore autoplay errors (user hasn't interacted yet)
    });
    isThrustSoundPlaying = true;
    thrustSoundStartTime = Date.now();
}

/**
 * Stop playing thrust sound (with minimum duration and fade out)
 */
function stopThrustSound() {
    if (!thrustAudio || !isThrustSoundPlaying) return;
    
    // Calculate how long the sound has been playing
    const elapsed = Date.now() - thrustSoundStartTime;
    const remaining = THRUST_MIN_DURATION - elapsed;
    
    if (remaining > 0) {
        // Schedule fade after minimum duration
        if (!thrustStopTimeout) {
            thrustStopTimeout = setTimeout(() => {
                // Only fade if thrusters are still inactive
                if (!isAnyThrusterActive()) {
                    fadeOutThrustSound();
                }
                thrustStopTimeout = null;
            }, remaining);
        }
    } else {
        // Already played long enough, start fade
        fadeOutThrustSound();
    }
}

/**
 * Fade out thrust sound smoothly
 */
function fadeOutThrustSound() {
    if (!thrustAudio || !isThrustSoundPlaying || thrustFadeInterval) return;
    
    const fadeSteps = 20;
    const fadeStepTime = THRUST_FADE_DURATION / fadeSteps;
    const volumeStep = thrustAudio.volume / fadeSteps;
    
    thrustFadeInterval = setInterval(() => {
        if (thrustAudio.volume > volumeStep) {
            thrustAudio.volume -= volumeStep;
        } else {
            // Fade complete, stop the audio
            clearInterval(thrustFadeInterval);
            thrustFadeInterval = null;
            thrustAudio.pause();
            thrustAudio.currentTime = 0;
            thrustAudio.volume = THRUST_VOLUME; // Reset for next play
            isThrustSoundPlaying = false;
        }
    }, fadeStepTime);
}

/**
 * Force stop thrust sound immediately (bypass minimum duration and fade)
 */
function forceStopThrustSound() {
    if (!thrustAudio) return;
    
    if (thrustStopTimeout) {
        clearTimeout(thrustStopTimeout);
        thrustStopTimeout = null;
    }
    if (thrustFadeInterval) {
        clearInterval(thrustFadeInterval);
        thrustFadeInterval = null;
    }
    
    thrustAudio.pause();
    thrustAudio.currentTime = 0;
    thrustAudio.volume = THRUST_VOLUME; // Reset for next play
    isThrustSoundPlaying = false;
}

/**
 * Check if any movement thruster is active (not boost)
 */
function isAnyThrusterActive() {
    return thrusterInput.forward || thrusterInput.backward ||
           thrusterInput.left || thrusterInput.right ||
           thrusterInput.up || thrusterInput.down;
}

/**
 * Initialize the Rapier physics world
 * @returns {Promise<boolean>} True if initialization successful
 */
export async function initPhysics() {
    if (isInitialized) {
        console.warn("Physics already initialized");
        return true;
    }
    
    try {
        console.log("Initializing Rapier physics...");
        await RAPIER.init();
        
        // Create physics world with configured gravity
        const gravity = physicsConfig.gravity;
        world = new RAPIER.World(new RAPIER.Vector3(gravity.x, gravity.y, gravity.z));
        
        isInitialized = true;
        console.log("✓ Rapier physics initialized (zero-G mode)");
        
        // Initialize thrust sound
        initThrustSound();
        
        return true;
    } catch (error) {
        console.error("Failed to initialize Rapier:", error);
        return false;
    }
}

/**
 * Create the player physics body
 * Uses capsule for gravity boots (FPS walking) or sphere for weightless (thruster)
 * @param {THREE.Group} localFrame - The player's local frame (camera parent)
 * @param {THREE.Camera} camera - The camera for direction reference
 * @param {THREE.Scene} scene - The scene to add debug visualization to
 * @param {THREE.WebGLRenderer} renderer - The renderer (for VR controller access)
 */
export function createPlayerBody(localFrame, camera, scene, renderer = null) {
    if (!isInitialized || !world) {
        console.error("Physics not initialized, cannot create player body");
        return;
    }
    
    localFrameRef = localFrame;
    cameraRef = camera;
    sceneRef = scene;
    rendererRef = renderer;
    
    const pos = localFrame.position;
    
    // Get Y offset based on current mode
    const yOffset = getCollisionYOffset();
    
    // Create dynamic rigid body
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y + yOffset, pos.z)
        .setLinearDamping(physicsConfig.player.linearDamping)
        .setAngularDamping(physicsConfig.player.angularDamping)
        .setCcdEnabled(true) // Continuous collision detection for fast movement
        .setCanSleep(false); // Prevent abrupt stop from sleep threshold
    
    playerBody = world.createRigidBody(bodyDesc);
    
    // Create collider based on current movement mode
    createPlayerCollider();
    
    // Create debug mesh (will be updated based on mode)
    createDebugMesh();
    
    // Apply initial mode settings
    applyModePhysics(movementMode);
    
    // Set initial gravity based on mode (default is gravityBoots with gravity ON)
    updateGravity();
    
    console.log("✓ Player physics body created, mode:", movementMode, "ghostMode:", ghostMode);
}

/**
 * Get the Y offset for collision based on current mode
 */
function getCollisionYOffset() {
    if (movementMode === 'gravityBoots') {
        return physicsConfig.walking?.collisionYOffset ?? -0.85;
    }
    return physicsConfig.player.collisionYOffset || 0;
}

/**
 * Create the player collider based on current movement mode
 */
function createPlayerCollider() {
    if (!world || !playerBody) return;
    
    // Remove existing collider if any
    if (playerCollider) {
        world.removeCollider(playerCollider, true);
        playerCollider = null;
    }
    
    let colliderDesc;
    
    if (movementMode === 'gravityBoots') {
        // Capsule for FPS walking (taller, standing upright)
        const walkConfig = physicsConfig.walking || {};
        const radius = walkConfig.capsuleRadius ?? 0.25;
        const halfHeight = walkConfig.capsuleHalfHeight ?? 0.6;
        
        colliderDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius)
            .setRestitution(walkConfig.restitution ?? 0.0)
            .setFriction(walkConfig.friction ?? 1.0)
            .setMass(physicsConfig.player.mass);
        
        console.log(`[Physics] Created capsule collider: radius=${radius}, halfHeight=${halfHeight}`);
    } else {
        // Sphere for weightless/thruster mode
        const config = physicsConfig.player;
        
        colliderDesc = RAPIER.ColliderDesc.ball(config.radius)
            .setRestitution(config.restitution)
            .setFriction(config.friction)
            .setMass(config.mass);
        
        console.log(`[Physics] Created sphere collider: radius=${config.radius}`);
    }
    
    playerCollider = world.createCollider(colliderDesc, playerBody);
}

/**
 * Create/update debug mesh to match current collider shape
 */
function createDebugMesh() {
    // Remove existing debug mesh
    if (debugSphere && sceneRef) {
        sceneRef.remove(debugSphere);
        debugSphere.geometry.dispose();
        debugSphere.material.dispose();
        debugSphere = null;
    }
    
    if (!sceneRef) return;
    
    let debugGeometry;
    
    if (movementMode === 'gravityBoots') {
        // Capsule geometry for walking mode
        const walkConfig = physicsConfig.walking || {};
        const radius = walkConfig.capsuleRadius ?? 0.25;
        const halfHeight = walkConfig.capsuleHalfHeight ?? 0.6;
        // CapsuleGeometry(radius, length, capSegments, radialSegments)
        debugGeometry = new THREE.CapsuleGeometry(radius, halfHeight * 2, 8, 16);
    } else {
        // Sphere geometry for weightless mode
        debugGeometry = new THREE.SphereGeometry(physicsConfig.player.radius, 16, 16);
    }
    
    const debugMaterial = new THREE.MeshBasicMaterial({
        color: movementMode === 'gravityBoots' ? 0x00ff00 : 0xff00ff, // Green for capsule, magenta for sphere
        wireframe: true,
        transparent: true,
        opacity: 0.7
    });
    
    debugSphere = new THREE.Mesh(debugGeometry, debugMaterial);
    debugSphere.visible = debugSphereVisible;
    sceneRef.add(debugSphere);
}

/**
 * Apply physics properties for a given mode
 */
function applyModePhysics(mode) {
    if (!playerBody || !playerCollider) return;
    
    if (mode === 'gravityBoots') {
        const walkConfig = physicsConfig.walking || {};
        playerBody.setLinearDamping(walkConfig.linearDamping ?? 5.0);
        playerCollider.setRestitution(walkConfig.restitution ?? 0.0);
        playerCollider.setFriction(walkConfig.friction ?? 1.0);
    } else {
        const playerConfig = physicsConfig.player;
        playerBody.setLinearDamping(playerConfig.linearDamping);
        playerCollider.setRestitution(playerConfig.restitution);
        playerCollider.setFriction(playerConfig.friction);
    }
}

/**
 * Set debug sphere visibility
 * @param {boolean} visible 
 */
export function setDebugSphereVisible(visible) {
    debugSphereVisible = visible;
    if (debugSphere) {
        debugSphere.visible = visible;
    }
}

/**
 * Add a collision mesh to the physics world as a static trimesh
 * @param {THREE.Group} collisionMesh - The loaded GLB collision mesh
 * @param {number} worldno - World number for position offset
 */
export function addCollisionMesh(collisionMesh, worldno = 0) {
    if (!isInitialized || !world) {
        console.error("Physics not initialized, cannot add collision mesh");
        return;
    }
    
    const config = physicsConfig.collisionMesh;
    
    // Force update of entire hierarchy's world matrices BEFORE traversing
    // This ensures child meshes have correct world positions
    collisionMesh.updateMatrixWorld(true);
    
    console.log("Adding collision mesh to physics, parent position:", 
        collisionMesh.position.toArray(), "worldno:", worldno);
    
    // Traverse the collision mesh and create trimesh colliders for each mesh
    collisionMesh.traverse((child) => {
        if (child.isMesh && child.geometry) {
            const geometry = child.geometry;
            
            // Get world transform (matrix already updated above)
            const position = new THREE.Vector3();
            const quaternion = new THREE.Quaternion();
            const scale = new THREE.Vector3();
            child.matrixWorld.decompose(position, quaternion, scale);
            
            console.log("  Child mesh world position:", position.toArray());
            
            // Get vertices and indices
            const positionAttr = geometry.attributes.position;
            const indexAttr = geometry.index;
            
            if (!positionAttr) {
                console.warn("Mesh has no position attribute, skipping");
                return;
            }
            
            // Convert vertices to flat array, applying scale
            const vertices = new Float32Array(positionAttr.count * 3);
            for (let i = 0; i < positionAttr.count; i++) {
                vertices[i * 3] = positionAttr.getX(i) * scale.x;
                vertices[i * 3 + 1] = positionAttr.getY(i) * scale.y;
                vertices[i * 3 + 2] = positionAttr.getZ(i) * scale.z;
            }
            
            // Get indices (or generate them for non-indexed geometry)
            let indices;
            if (indexAttr) {
                indices = new Uint32Array(indexAttr.array);
            } else {
                // Generate indices for non-indexed geometry
                indices = new Uint32Array(positionAttr.count);
                for (let i = 0; i < positionAttr.count; i++) {
                    indices[i] = i;
                }
            }
            
            // Create fixed (static) rigid body
            const bodyDesc = RAPIER.RigidBodyDesc.fixed()
                .setTranslation(position.x, position.y, position.z)
                .setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w });
            
            const body = world.createRigidBody(bodyDesc);
            
            // Create trimesh collider
            try {
                const colliderDesc = RAPIER.ColliderDesc.trimesh(vertices, indices)
                    .setRestitution(config.restitution)
                    .setFriction(config.friction);
                
                const collider = world.createCollider(colliderDesc, body);
                collisionBodies.push({ body, collider, mesh: child });
                
                // Get body translation for debug
                const bodyPos = body.translation();
                console.log("  Added trimesh collider:", child.name || "unnamed", 
                    "verts:", positionAttr.count, "tris:", indices.length / 3,
                    "at physics pos:", [bodyPos.x.toFixed(2), bodyPos.y.toFixed(2), bodyPos.z.toFixed(2)]);
            } catch (error) {
                console.error("Failed to create trimesh collider:", error);
            }
        }
    });
}

/**
 * Remove collision bodies for a specific world (when flushing)
 * @param {THREE.Group} collisionMesh - The collision mesh to remove
 */
export function removeCollisionMesh(collisionMesh) {
    if (!world) return;
    
    // Find and remove bodies associated with this mesh
    for (let i = collisionBodies.length - 1; i >= 0; i--) {
        const entry = collisionBodies[i];
        if (collisionMesh.getObjectById(entry.mesh.id)) {
            world.removeRigidBody(entry.body);
            collisionBodies.splice(i, 1);
        }
    }
}

/**
 * Enable or disable physics simulation
 * @param {boolean} enabled 
 */
export function setPhysicsEnabled(enabled) {
    isEnabled = enabled;
    
    if (enabled && playerBody && localFrameRef) {
        // Sync player body position with current localFrame position (with Y offset)
        const pos = localFrameRef.position;
        const yOffset = physicsConfig.player.collisionYOffset || 0;
        playerBody.setTranslation(new RAPIER.Vector3(pos.x, pos.y + yOffset, pos.z), true);
        playerBody.setLinvel(new RAPIER.Vector3(0, 0, 0), true);
        playerBody.setAngvel(new RAPIER.Vector3(0, 0, 0), true);
        console.log("Physics enabled, player synced to position:", pos.toArray());
    } else if (!enabled) {
        // Clear all thruster input and stop sound when physics is disabled
        Object.keys(thrusterInput).forEach(key => thrusterInput[key] = false);
        forceStopThrustSound();
        console.log("Physics disabled");
    }
}

/**
 * Check if physics is enabled
 * @returns {boolean}
 */
export function isPhysicsEnabled() {
    return isEnabled;
}

/**
 * Sync physics body position to localFrame (call after portal crossing)
 * This prevents the physics body from snapping the player back to the old position
 */
export function syncPlayerToLocalFrame() {
    if (!playerBody || !localFrameRef) return;
    
    const pos = localFrameRef.position;
    const yOffset = physicsConfig.player.collisionYOffset || 0;
    playerBody.setTranslation(new RAPIER.Vector3(pos.x, pos.y + yOffset, pos.z), true);
    // Reset velocity so player doesn't keep momentum through portal
    playerBody.setLinvel(new RAPIER.Vector3(0, 0, 0), true);
    playerBody.setAngvel(new RAPIER.Vector3(0, 0, 0), true);
    console.log("Physics body synced to localFrame after portal:", pos.toArray(), 
        "isEnabled:", isEnabled);
}

/**
 * Check if physics is initialized
 * @returns {boolean}
 */
export function isPhysicsInitialized() {
    return isInitialized;
}

// Track if chat input is focused (disable movement when typing)
let chatInputFocused = false;

/**
 * Setup keyboard input listeners for thruster control
 */
export function setupThrusterInput() {
    document.addEventListener("keydown", (e) => {
        // Ignore keyboard input when chat is focused
        if (chatInputFocused) return;
        updateThrusterKey(e.code, true);
    });
    
    document.addEventListener("keyup", (e) => {
        // Always process keyup to avoid stuck keys
        updateThrusterKey(e.code, false);
    });
    
    // Clear inputs when window loses focus
    window.addEventListener("blur", () => {
        Object.keys(thrusterInput).forEach(key => thrusterInput[key] = false);
        forceStopThrustSound();  // Immediate stop on blur
    });
    
    // Listen for chat focus events
    window.addEventListener("chat-focus", (e) => {
        chatInputFocused = e.detail?.focused || false;
        if (chatInputFocused) {
            // Clear all inputs when chat is focused
            Object.keys(thrusterInput).forEach(key => thrusterInput[key] = false);
            forceStopThrustSound();
        }
    });
    
    console.log("✓ Thruster input listeners set up");
}

function updateThrusterKey(code, pressed) {
    // Only track thruster input when physics is enabled
    if (!isEnabled) return;
    
    // Track if any thruster was active before this key change
    const wasActive = isAnyThrusterActive();
    
    switch (code) {
        case "KeyW":
        case "ArrowUp":
            thrusterInput.forward = pressed;
            break;
        case "KeyS":
        case "ArrowDown":
            thrusterInput.backward = pressed;
            break;
        case "KeyA":
        case "ArrowLeft":
            thrusterInput.left = pressed;
            break;
        case "KeyD":
        case "ArrowRight":
            thrusterInput.right = pressed;
            break;
        case "KeyR":
        case "Space":
            thrusterInput.up = pressed;
            break;
        case "KeyF":
        case "ControlLeft":
        case "ControlRight":
            thrusterInput.down = pressed;
            break;
        case "ShiftLeft":
        case "ShiftRight":
            thrusterInput.boost = pressed;
            break;
    }
    
    // Check if thruster state changed
    const isActive = isAnyThrusterActive();
    if (!wasActive && isActive) {
        startThrustSound();
    } else if (wasActive && !isActive) {
        stopThrustSound();
    }
}

/**
 * Update VR controller input for thrusters
 * Called each frame when in VR mode
 */
function updateVrThrusterInput() {
    if (!rendererRef || !rendererRef.xr.isPresenting) {
        vrThrusterInput.x = 0;
        vrThrusterInput.y = 0;
        vrThrusterInput.z = 0;
        vrThrusterInput.boost = false;
        return false;
    }
    
    const session = rendererRef.xr.getSession();
    if (!session) return false;
    
    let hasInput = false;
    
    for (const source of session.inputSources) {
        const gamepad = source.gamepad;
        if (!gamepad) continue;
        
        if (source.handedness === "left") {
            // Left thumbstick for movement (axes 2 and 3)
            vrThrusterInput.x = gamepad.axes[2] || 0;  // Left/right
            vrThrusterInput.z = gamepad.axes[3] || 0;  // Forward/back
            // Left trigger (button 0) for up, left grip (button 1) for down
            vrThrusterInput.y = (gamepad.buttons[0]?.value || 0) - (gamepad.buttons[1]?.value || 0);
            
            if (Math.abs(vrThrusterInput.x) > 0.1 || 
                Math.abs(vrThrusterInput.y) > 0.1 || 
                Math.abs(vrThrusterInput.z) > 0.1) {
                hasInput = true;
            }
        } else if (source.handedness === "right") {
            // Right trigger for boost
            vrThrusterInput.boost = gamepad.buttons[0]?.pressed || false;
        }
    }
    
    return hasInput;
}

/**
 * Apply thruster forces based on current input (keyboard + VR)
 */
function applyThrusterForces() {
    if (!playerBody || !cameraRef) return;
    
    // Update VR controller input
    const hasVrInput = updateVrThrusterInput();
    
    const config = physicsConfig.thruster;
    let force = config.force;
    
    // Apply boost multiplier
    if (thrusterInput.boost || vrThrusterInput.boost) {
        force *= config.boostMultiplier;
    }
    
    // Calculate thrust direction based on localFrame orientation (body, not head)
    // This decouples thrust from where you're looking in VR
    const thrustDir = new THREE.Vector3();
    
    // Get localFrame's world forward direction (negative Z in local space)
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(localFrameRef.quaternion);
    
    // Get localFrame's world right vector (positive X in local space)
    const right = new THREE.Vector3(1, 0, 0);
    right.applyQuaternion(localFrameRef.quaternion);
    
    // World up for vertical movement (always world Y)
    const up = new THREE.Vector3(0, 1, 0);
    
    // Accumulate thrust direction from keyboard
    if (thrusterInput.forward) thrustDir.add(forward);
    if (thrusterInput.backward) thrustDir.sub(forward);
    if (thrusterInput.right) thrustDir.add(right);
    if (thrusterInput.left) thrustDir.sub(right);
    if (thrusterInput.up) thrustDir.add(up);
    if (thrusterInput.down) thrustDir.sub(up);
    
    // Add VR controller input (analog, so we scale by the axis values)
    // Deadzone of 0.1 to prevent drift
    if (Math.abs(vrThrusterInput.z) > 0.1) {
        // Z axis: negative is forward, positive is backward
        thrustDir.addScaledVector(forward, -vrThrusterInput.z);
    }
    if (Math.abs(vrThrusterInput.x) > 0.1) {
        // X axis: positive is right, negative is left
        thrustDir.addScaledVector(right, vrThrusterInput.x);
    }
    if (Math.abs(vrThrusterInput.y) > 0.1) {
        // Y: trigger for up, grip for down
        thrustDir.addScaledVector(up, vrThrusterInput.y);
    }
    
    // Handle thrust sound for VR input
    if (hasVrInput && !isThrustSoundPlaying) {
        startThrustSound();
    } else if (!hasVrInput && !isAnyThrusterActive() && isThrustSoundPlaying) {
        stopThrustSound();
    }
    
    // Normalize and apply force
    if (thrustDir.lengthSq() > 0) {
        thrustDir.normalize().multiplyScalar(force);
        
        if (config.continuous) {
            // Apply as force (continuous thrust)
            playerBody.addForce(new RAPIER.Vector3(thrustDir.x, thrustDir.y, thrustDir.z), true);
        } else {
            // Apply as impulse (single push)
            playerBody.applyImpulse(new RAPIER.Vector3(thrustDir.x, thrustDir.y, thrustDir.z), true);
        }
    }
}

/**
 * Clamp player velocity to max values
 */
function clampVelocity() {
    if (!playerBody) return;
    
    const config = physicsConfig.player;
    const linvel = playerBody.linvel();
    const speed = Math.sqrt(linvel.x * linvel.x + linvel.y * linvel.y + linvel.z * linvel.z);
    
    if (speed > config.maxLinearVelocity) {
        const scale = config.maxLinearVelocity / speed;
        playerBody.setLinvel(new RAPIER.Vector3(
            linvel.x * scale,
            linvel.y * scale,
            linvel.z * scale
        ), true);
    }
}

/**
 * Update physics simulation (call every frame)
 * @param {number} deltaTime - Time since last frame in seconds
 */
export function updatePhysics(deltaTime) {
    if (!isInitialized || !world || !isEnabled) return;
    
    // Apply movement based on mode
    if (movementMode === 'gravityBoots') {
        // Check if grounded
        checkGrounded();
        // Apply walking movement
        applyWalkingMovement();
    } else {
        // Apply thruster forces (weightless mode)
        applyThrusterForces();
    }
    
    // Step the physics simulation
    world.step();
    
    // Clamp velocity
    clampVelocity();
    
    // Sync localFrame position with physics body (subtract Y offset based on mode)
    if (playerBody && localFrameRef) {
        const pos = playerBody.translation();
        const yOffset = getCollisionYOffset();
        localFrameRef.position.set(pos.x, pos.y - yOffset, pos.z);
        
        // Update debug sphere position
        if (debugSphere) {
            debugSphere.position.set(pos.x, pos.y, pos.z);
        }
        
        // Optionally sync rotation (uncomment if you want physics to control rotation)
        // const rot = playerBody.rotation();
        // localFrameRef.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    }
}

/**
 * Check if player is on the ground (for gravity boots mode)
 */
function checkGrounded() {
    if (!world || !playerBody) {
        isGrounded = false;
        return;
    }
    
    const pos = playerBody.translation();
    const checkDist = physicsConfig.walking?.groundCheckDistance || 0.3;
    
    // Cast a ray downward from the player
    const rayOrigin = new RAPIER.Vector3(pos.x, pos.y, pos.z);
    const rayDir = new RAPIER.Vector3(0, -1, 0);
    
    const ray = new RAPIER.Ray(rayOrigin, rayDir);
    const hit = world.castRay(ray, checkDist + physicsConfig.player.radius, true, null, null, playerCollider);
    
    isGrounded = hit !== null;
}

/**
 * Apply walking movement (for gravity boots mode)
 */
function applyWalkingMovement() {
    if (!playerBody || !localFrameRef) return;
    
    // Update VR controller input
    updateVrThrusterInput();
    
    const config = physicsConfig.walking || {};
    let speed = config.speed || 4.0;
    
    // Apply run multiplier
    if (thrusterInput.boost || vrThrusterInput.boost) {
        speed *= config.runMultiplier || 2.0;
    }
    
    // Calculate movement direction based on localFrame orientation
    const moveDir = new THREE.Vector3();
    
    // Get localFrame forward direction (negative Z in local space)
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(localFrameRef.quaternion);
    forward.y = 0; // Project onto horizontal plane
    forward.normalize();
    
    // Get localFrame right vector (positive X in local space)
    const right = new THREE.Vector3(1, 0, 0);
    right.applyQuaternion(localFrameRef.quaternion);
    right.y = 0; // Project onto horizontal plane
    right.normalize();
    
    // Accumulate movement direction from keyboard
    if (thrusterInput.forward) moveDir.add(forward);
    if (thrusterInput.backward) moveDir.sub(forward);
    if (thrusterInput.right) moveDir.add(right);
    if (thrusterInput.left) moveDir.sub(right);
    
    // Add VR controller input
    if (Math.abs(vrThrusterInput.z) > 0.1) {
        moveDir.addScaledVector(forward, -vrThrusterInput.z);
    }
    if (Math.abs(vrThrusterInput.x) > 0.1) {
        moveDir.addScaledVector(right, vrThrusterInput.x);
    }
    
    // Normalize and apply speed
    if (moveDir.lengthSq() > 0) {
        moveDir.normalize();
        moveDir.multiplyScalar(speed);
    }
    
    // Handle vertical movement
    let verticalVel = 0;
    
    if (ghostMode) {
        // Ghost mode: allow flying up/down with R/Space and F/Ctrl
        if (thrusterInput.up) verticalVel = speed;
        if (thrusterInput.down) verticalVel = -speed;
        if (Math.abs(vrThrusterInput.y) > 0.1) {
            verticalVel = vrThrusterInput.y * speed;
        }
        
        playerBody.setLinvel(
            new RAPIER.Vector3(moveDir.x, verticalVel, moveDir.z),
            true
        );
    } else {
        // Normal walking: preserve vertical velocity (for gravity/jumping)
        const currentVel = playerBody.linvel();
        playerBody.setLinvel(
            new RAPIER.Vector3(moveDir.x, currentVel.y, moveDir.z),
            true
        );
        
        // Handle jump (Space or R key, or VR up input)
        if (isGrounded && (thrusterInput.up || vrThrusterInput.y > 0.5)) {
            jump();
        }
    }
}

/**
 * Get current player velocity (for HUD display)
 * @returns {{x: number, y: number, z: number, speed: number}|null}
 */
export function getPlayerVelocity() {
    if (!playerBody) return null;
    const vel = playerBody.linvel();
    return {
        x: vel.x,
        y: vel.y,
        z: vel.z,
        speed: Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z)
    };
}

/**
 * Stop player movement (set velocity to zero)
 * Useful for stopping momentum when entering conversations, menus, etc.
 */
export function stopPlayerMovement() {
    if (!playerBody) return;
    playerBody.setLinvel(new RAPIER.Vector3(0, 0, 0), true);
    playerBody.setAngvel(new RAPIER.Vector3(0, 0, 0), true);
}

/**
 * Get the Rapier world instance (for debugging)
 * @returns {RAPIER.World|null}
 */
export function getPhysicsWorld() {
    return world;
}

// ========== Movement Mode Functions ==========

/**
 * Update gravity based on current movement mode and ghost mode
 * Gravity is only active when: gravityBoots mode AND ghost mode OFF
 */
function updateGravity() {
    if (!world) return;
    
    // Gravity only when: gravity boots AND not ghost mode
    const shouldHaveGravity = movementMode === 'gravityBoots' && !ghostMode;
    
    if (shouldHaveGravity) {
        const g = physicsConfig.gravityBoots;
        world.gravity = new RAPIER.Vector3(g.x, g.y, g.z);
        console.log(`[Physics] Gravity ON: (${g.x}, ${g.y}, ${g.z})`);
    } else {
        world.gravity = new RAPIER.Vector3(0, 0, 0);
        console.log(`[Physics] Gravity OFF (zero-G)`);
    }
}

/**
 * Set movement mode
 * @param {'weightless' | 'gravityBoots'} mode
 */
export function setMovementMode(mode) {
    if (mode !== 'weightless' && mode !== 'gravityBoots') {
        console.warn(`Invalid movement mode: ${mode}`);
        return;
    }
    
    const previousMode = movementMode;
    movementMode = mode;
    physicsConfig.movementMode = mode;
    
    // Update gravity based on mode and ghost state
    updateGravity();
    
    // Stop thrust sound when entering walking mode
    if (mode === 'gravityBoots') {
        stopThrustSound();
    }
    
    // Recreate collider with new shape if mode changed
    if (playerBody && previousMode !== mode) {
        // Store current position before recreating
        const currentPos = playerBody.translation();
        const currentVel = playerBody.linvel();
        
        // Create new collider (capsule or sphere)
        createPlayerCollider();
        
        // Update debug mesh to match new collider
        createDebugMesh();
        
        // Apply physics properties for new mode
        applyModePhysics(mode);
        
        // Adjust Y position for new collider offset
        const newYOffset = getCollisionYOffset();
        const oldYOffset = mode === 'gravityBoots' 
            ? (physicsConfig.player.collisionYOffset || 0)
            : (physicsConfig.walking?.collisionYOffset ?? -0.85);
        const yAdjust = newYOffset - oldYOffset;
        
        playerBody.setTranslation(
            new RAPIER.Vector3(currentPos.x, currentPos.y + yAdjust, currentPos.z),
            true
        );
        
        console.log(`[Physics] Switched collider shape for ${mode} mode`);
    }
    
    // Stop current momentum when switching modes
    stopPlayerMovement();
}

/**
 * Get current movement mode
 * @returns {'weightless' | 'gravityBoots'}
 */
export function getMovementMode() {
    return movementMode;
}

/**
 * Toggle movement mode between weightless and gravityBoots
 * @returns {'weightless' | 'gravityBoots'} New mode
 */
export function toggleMovementMode() {
    const newMode = movementMode === 'weightless' ? 'gravityBoots' : 'weightless';
    setMovementMode(newMode);
    return newMode;
}

// ========== Ghost Mode Functions ==========

/**
 * Set ghost mode
 * @param {boolean} enabled - true = pass through walls, false = solid collision
 */
export function setGhostMode(enabled) {
    ghostMode = enabled;
    physicsConfig.ghostMode = enabled;
    
    // Update collision groups for player
    if (playerCollider) {
        if (enabled) {
            // Ghost mode: player doesn't collide with anything
            playerCollider.setCollisionGroups(0x00010000); // Group 1, collides with nothing
        } else {
            // Solid mode: player collides with world geometry
            playerCollider.setCollisionGroups(0x00010002); // Group 1, collides with group 2
        }
    }
    
    // Update gravity (ghost mode disables gravity)
    updateGravity();
    
    console.log(`[Physics] Ghost mode: ${enabled ? 'ON (no gravity, pass through walls)' : 'OFF (solid)'}`);
}

/**
 * Get ghost mode state
 * @returns {boolean}
 */
export function getGhostMode() {
    return ghostMode;
}

/**
 * Toggle ghost mode
 * @returns {boolean} New ghost mode state
 */
export function toggleGhostMode() {
    setGhostMode(!ghostMode);
    return ghostMode;
}

/**
 * Check if player is grounded (for gravity boots mode)
 * @returns {boolean}
 */
export function isPlayerGrounded() {
    return isGrounded;
}

/**
 * Perform a jump (only works in gravity boots mode when grounded)
 */
export function jump() {
    if (movementMode !== 'gravityBoots' || !isGrounded || !playerBody) return;
    
    const jumpForce = physicsConfig.walking?.jumpForce || 5.0;
    const vel = playerBody.linvel();
    playerBody.setLinvel(new RAPIER.Vector3(vel.x, jumpForce, vel.z), true);
    isGrounded = false;
    console.log('[Physics] Jump!');
}
