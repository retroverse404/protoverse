/**
 * Physics Module
 * 
 * Handles Rapier physics simulation for zero-G environment with thruster controls.
 */

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { physicsConfig } from "./physics-config.js";

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

// Input state for thruster
const thrusterInput = {
    forward: false,   // W or ArrowUp
    backward: false,  // S or ArrowDown
    left: false,      // A or ArrowLeft
    right: false,     // D or ArrowRight
    up: false,        // R or Space
    down: false,      // F or Ctrl
    boost: false,     // Shift
};

// Thrust sound
let thrustAudio = null;
let isThrustSoundPlaying = false;
let thrustSoundStartTime = 0;
let thrustStopTimeout = null;
let thrustFadeInterval = null;
const THRUST_MIN_DURATION = 1000; // Minimum play time in ms
const THRUST_FADE_DURATION = 500; // Fade out duration in ms
const THRUST_VOLUME = 0.5;        // Normal playing volume

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
function startThrustSound() {
    if (!thrustAudio || !isEnabled) return;
    
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
 * Create the player physics body (sphere)
 * @param {THREE.Group} localFrame - The player's local frame (camera parent)
 * @param {THREE.Camera} camera - The camera for direction reference
 * @param {THREE.Scene} scene - The scene to add debug visualization to
 */
export function createPlayerBody(localFrame, camera, scene) {
    if (!isInitialized || !world) {
        console.error("Physics not initialized, cannot create player body");
        return;
    }
    
    localFrameRef = localFrame;
    cameraRef = camera;
    sceneRef = scene;
    
    const config = physicsConfig.player;
    const pos = localFrame.position;
    
    // Create dynamic rigid body
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setLinearDamping(config.linearDamping)
        .setAngularDamping(config.angularDamping)
        .setCcdEnabled(true); // Continuous collision detection for fast movement
    
    playerBody = world.createRigidBody(bodyDesc);
    
    // Create sphere collider
    const colliderDesc = RAPIER.ColliderDesc.ball(config.radius)
        .setRestitution(config.restitution)
        .setFriction(config.friction)
        .setMass(config.mass);
    
    playerCollider = world.createCollider(colliderDesc, playerBody);
    
    // Create debug wireframe sphere for visualization
    const debugGeometry = new THREE.SphereGeometry(config.radius, 16, 16);
    const debugMaterial = new THREE.MeshBasicMaterial({
        color: 0xff00ff, // Magenta for visibility
        wireframe: true,
        transparent: true,
        opacity: 0.7
    });
    debugSphere = new THREE.Mesh(debugGeometry, debugMaterial);
    debugSphere.visible = debugSphereVisible;
    scene.add(debugSphere);
    
    console.log("✓ Player physics body created (sphere, radius:", config.radius, ")");
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
        // Sync player body position with current localFrame position
        const pos = localFrameRef.position;
        playerBody.setTranslation(new RAPIER.Vector3(pos.x, pos.y, pos.z), true);
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
    playerBody.setTranslation(new RAPIER.Vector3(pos.x, pos.y, pos.z), true);
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

/**
 * Setup keyboard input listeners for thruster control
 */
export function setupThrusterInput() {
    document.addEventListener("keydown", (e) => {
        updateThrusterKey(e.code, true);
    });
    
    document.addEventListener("keyup", (e) => {
        updateThrusterKey(e.code, false);
    });
    
    // Clear inputs when window loses focus
    window.addEventListener("blur", () => {
        Object.keys(thrusterInput).forEach(key => thrusterInput[key] = false);
        forceStopThrustSound();  // Immediate stop on blur
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
 * Apply thruster forces based on current input
 */
function applyThrusterForces() {
    if (!playerBody || !cameraRef) return;
    
    const config = physicsConfig.thruster;
    let force = config.force;
    
    // Apply boost multiplier
    if (thrusterInput.boost) {
        force *= config.boostMultiplier;
    }
    
    // Calculate thrust direction based on camera's world orientation
    const thrustDir = new THREE.Vector3();
    
    // Get camera's world direction (the direction it's looking)
    const forward = new THREE.Vector3();
    cameraRef.getWorldDirection(forward);
    
    // Get camera's world right vector
    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    
    // World up for vertical movement
    const up = new THREE.Vector3(0, 1, 0);
    
    // Accumulate thrust direction
    if (thrusterInput.forward) thrustDir.add(forward);
    if (thrusterInput.backward) thrustDir.sub(forward);
    if (thrusterInput.right) thrustDir.add(right);
    if (thrusterInput.left) thrustDir.sub(right);
    if (thrusterInput.up) thrustDir.add(up);
    if (thrusterInput.down) thrustDir.sub(up);
    
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
    
    // Apply thruster forces
    applyThrusterForces();
    
    // Step the physics simulation
    world.step();
    
    // Clamp velocity
    clampVelocity();
    
    // Sync localFrame position with physics body
    if (playerBody && localFrameRef) {
        const pos = playerBody.translation();
        localFrameRef.position.set(pos.x, pos.y, pos.z);
        
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
 * Get the Rapier world instance (for debugging)
 * @returns {RAPIER.World|null}
 */
export function getPhysicsWorld() {
    return world;
}

