/**
 * Timeless Character Definition
 * 
 * A ghostly walking character that:
 * - Spawns at a location, walks in a random direction (±45° from spawn rotation)
 * - On wall collision, walks 10 more steps then fades away
 * - Waits 1-10 seconds, then respawns and repeats
 */

import * as THREE from "three";

const forwardDir = new THREE.Vector3();

/**
 * Character States (for animation state machine)
 */
export const TimelessStates = {
    WALKING: 'walking',
};

/**
 * Movement settings
 */
const MOVEMENT = {
    speed: 1.0,           // Units per second
    walkDistance: 10.0,    // Distance to walk before fading
    fadeSpeed: 2.0,       // How fast to fade out (opacity per second)
    minWaitTime: 3.0,     // Minimum respawn wait (seconds)
    maxWaitTime: 15.0,    // Maximum respawn wait (seconds)
    initialAngleRange: Math.PI / 4,  // ±45 degrees from spawn rotation
};

/**
 * Timeless Character Definition
 */
export const TimelessCharacter = {
    id: "timeless",
    name: "Timeless",
    
    // Available animations - each with its own FBX file
    // Paths are relative to /worlds/ (resolveUrl adds the prefix)
    animations: {
        walking: { 
            file: "/root/characters/timeless/walk.fbx",
            loop: true,
        },
    },
    
    // Spatial audio sources (using sparkxrstart-style settings)
    sounds: {
        hum: {
            file: "/root/characters/timeless/hum.mp3",
            refDistance: 5,      // Reference distance for falloff
            rolloffFactor: 1,    // How quickly sound fades
            maxDistance: 50,     // Max audible distance
            volume: 0.6,
            loop: true,
            positional: true,
        },
    },
    
    // Default settings
    defaultState: TimelessStates.WALKING,
    defaultScale: 0.01,
    
    /**
     * State machine definition
     * Note: We only use 'walking' state for animation - fading/waiting are handled in onUpdate
     */
    states: {
        [TimelessStates.WALKING]: {
            animation: 'walking',
            transitions: [],
        },
    },
    
    /**
     * Called when character is first spawned
     */
    onSpawn: (instance, manager) => {
        const model = instance.model;
        if (!model) return;
        
        // Extract Y rotation from spawn quaternion (stored in instanceData from world.json)
        const spawnQuaternion = instance.instanceData?.rotation || [0, 0, 0, 1];
        const euler = new THREE.Euler();
        euler.setFromQuaternion(new THREE.Quaternion(...spawnQuaternion));
        
        // Random direction ±45° from spawn rotation
        const randomOffset = (Math.random() - 0.5) * 2 * MOVEMENT.initialAngleRange;
        const startRotation = euler.y + randomOffset;
        
        // Get display name for logging
        const displayName = instance.instanceData?.name || 'Timeless';
        
        instance.stateData = {
            // For logging
            displayName,
            // Store spawn info for respawn
            spawnPosition: model.position.clone(),
            spawnRotation: euler.y,
            // Movement
            currentRotation: startRotation,
            controlledPosition: model.position.clone(),
            // Lifecycle
            phase: 'walking',
            distanceWalked: 0,
            waitEndTime: 0,
        };
        
        // Apply initial rotation (reset to clean Y-only rotation)
        model.rotation.set(0, startRotation, 0);
        
        console.log(`[${displayName}] Spawned at ${model.position.toArray()}, rotation: ${startRotation.toFixed(2)}`);
    },
    
    /**
     * Called every frame - handles movement, collision, fading, respawn
     */
    onUpdate: (instance, deltaTime, context) => {
        const model = instance.model;
        const state = instance.stateData;
        
        if (!model || !state || !context.scene) return;
        
        // ===== WAITING PHASE: hidden, waiting to respawn =====
        if (state.phase === 'waiting') {
            if (performance.now() >= state.waitEndTime) {
                // Respawn!
                state.controlledPosition.copy(state.spawnPosition);
                const randomOffset = (Math.random() - 0.5) * 2 * MOVEMENT.initialAngleRange;
                state.currentRotation = state.spawnRotation + randomOffset;
                state.phase = 'walking';
                state.distanceWalked = 0;
                
                // Restore visibility and opacity
                model.visible = true;
                model.traverse((child) => {
                    if (child.isMesh && child.material) {
                        child.material.opacity = 1.0;
                        child.material.transparent = false;
                    }
                });
                
                model.position.copy(state.controlledPosition);
                model.rotation.set(0, state.currentRotation, 0);
                console.log(`[${state.displayName}] Respawned!`);
            }
            return;
        }
        
        // ===== FADING PHASE: fading out while still walking =====
        if (state.phase === 'fading') {
            let allFaded = true;
            model.traverse((child) => {
                if (child.isMesh && child.material) {
                    child.material.transparent = true;
                    child.material.opacity -= MOVEMENT.fadeSpeed * deltaTime;
                    if (child.material.opacity > 0) {
                        allFaded = false;
                    } else {
                        child.material.opacity = 0;
                    }
                }
            });
            
            if (allFaded) {
                // Start waiting
                model.visible = false;
                state.phase = 'waiting';
                const waitTime = MOVEMENT.minWaitTime + Math.random() * (MOVEMENT.maxWaitTime - MOVEMENT.minWaitTime);
                state.waitEndTime = performance.now() + waitTime * 1000;
                console.log(`[${state.displayName}] Faded out, waiting ${waitTime.toFixed(1)}s`);
                return;
            }
            
            // Keep walking while fading (Mixamo models face +Z)
            forwardDir.set(Math.sin(state.currentRotation), 0, Math.cos(state.currentRotation));
            state.controlledPosition.addScaledVector(forwardDir, MOVEMENT.speed * deltaTime);
            model.position.copy(state.controlledPosition);
            model.rotation.set(0, state.currentRotation, 0);
            return;
        }
        
        // ===== WALKING PHASE: walk fixed distance then fade =====
        
        // Calculate forward direction (Mixamo models face +Z)
        forwardDir.set(Math.sin(state.currentRotation), 0, Math.cos(state.currentRotation));
        
        // Move forward
        const moveDistance = MOVEMENT.speed * deltaTime;
        state.controlledPosition.addScaledVector(forwardDir, moveDistance);
        state.distanceWalked += moveDistance;
        
        // Check if walked far enough
        if (state.distanceWalked >= MOVEMENT.walkDistance) {
            state.phase = 'fading';
        }
        
        // Override animation root motion - lock to our controlled position and rotation
        model.position.copy(state.controlledPosition);
        model.rotation.set(0, state.currentRotation, 0);
    },
    
    /**
     * Called when player enters proximity
     */
    onProximityEnter: (instance, manager, playerPosition) => {
        // Could make the character react to player
    },
    
    /**
     * Called when player exits proximity
     */
    onProximityExit: (instance, manager, playerPosition) => {
        // Could make the character resume normal behavior
    },
};
