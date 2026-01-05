/**
 * Amy Character Definition
 * 
 * A character that wanders between waypoints in a loop.
 * Waypoints can be defined in world.json per instance.
 */

import * as THREE from "three";

const forwardDir = new THREE.Vector3();
const targetDir = new THREE.Vector3();

/**
 * Character States
 */
export const AmyStates = {
    WALKING: 'walking',
    IDLE: 'idle',
};

/**
 * Movement settings
 */
const MOVEMENT = {
    speed: 0.8,              // Units per second
    turnSpeed: 2.0,          // Radians per second
    arrivalDistance: 0.3,    // How close to waypoint before considering "arrived"
    waitTimeMin: 1.0,        // Minimum wait at waypoint (seconds)
    waitTimeMax: 3.0,        // Maximum wait at waypoint (seconds)
    greetingDuration: 5.0,   // How long to stay idle when greeting player (seconds)
};

/**
 * Amy Character Definition
 */
export const AmyCharacter = {
    id: "amy",
    name: "Amy",
    
    // Available animations
    // Paths are relative to /worlds/ (resolveUrl adds the prefix)
    animations: {
        walking: { 
            file: "/cozyship/characters/amy/amy-walking.fbx",
            loop: true,
        },
        idle: {
            file: "/cozyship/characters/amy/amy-idle.fbx",
            loop: true,
        },
    },
    
    // Audio
    sounds: {
        heyThere: {
            file: "/cozyship/characters/amy/hey-there.mp3",
            refDistance: 5,
            rolloffFactor: 1,
            maxDistance: 50,
            volume: 1.0,
            loop: false,
            positional: false,  // Set to true if spatial audio works well
        },
    },
    
    // Default settings
    defaultState: AmyStates.WALKING,
    defaultScale: 0.01,
    proximityDistance: 3.0,  // How close player needs to be to trigger greeting (default is 5.0)
    
    /**
     * State machine definition
     */
    states: {
        [AmyStates.WALKING]: {
            animation: 'walking',
            transitions: [],
        },
        [AmyStates.IDLE]: {
            animation: 'idle',
            transitions: [],
        },
    },
    
    /**
     * Called when character is first spawned
     */
    onSpawn: (instance, manager) => {
        const model = instance.model;
        if (!model) return;
        
        // Get display name for logging
        const displayName = instance.instanceData?.name || 'Amy';
        
        // Get waypoints from instance data, or use defaults
        // Waypoints are specified as [[x, y, z], [x, y, z], ...]
        const waypoints = instance.instanceData?.waypoints || [
            [0, 0, 0],
            [2, 0, 0],
            [2, 0, 2],
            [0, 0, 2],
        ];
        
        // Convert waypoint arrays to Vector3
        const waypointVectors = waypoints.map(wp => new THREE.Vector3(wp[0], wp[1], wp[2]));
        
        instance.stateData = {
            displayName,
            // Waypoints
            waypoints: waypointVectors,
            currentWaypointIndex: 0,
            // Movement
            currentRotation: model.rotation.y,
            targetRotation: model.rotation.y,
            controlledPosition: model.position.clone(),
            // State
            phase: 'walking', // 'walking', 'turning', 'waiting', 'greeting'
            waitEndTime: 0,
            // Greeting
            hasGreeted: false,
            greetingEndTime: 0,
        };
        
        // Face first waypoint
        if (waypointVectors.length > 0) {
            const firstWaypoint = waypointVectors[0];
            const dx = firstWaypoint.x - model.position.x;
            const dz = firstWaypoint.z - model.position.z;
            instance.stateData.targetRotation = Math.atan2(dx, dz);
            instance.stateData.currentRotation = instance.stateData.targetRotation;
            model.rotation.set(0, instance.stateData.currentRotation, 0);
        }
        
        console.log(`[${displayName}] Spawned with ${waypointVectors.length} waypoints`);
    },
    
    /**
     * Called every frame
     */
    onUpdate: (instance, deltaTime, context) => {
        const model = instance.model;
        const state = instance.stateData;
        const manager = context.manager;
        
        if (!model || !state || state.waypoints.length === 0) return;
        
        const currentWaypoint = state.waypoints[state.currentWaypointIndex];
        
        // ===== GREETING PHASE (player approached) =====
        if (state.phase === 'greeting') {
            if (performance.now() >= state.greetingEndTime) {
                // Done greeting, resume walking
                state.phase = 'walking';
                
                // Switch to walking animation
                if (manager && instance.currentState !== AmyStates.WALKING) {
                    manager.transitionToState(instance, AmyStates.WALKING);
                }
            }
            return;
        }
        
        // ===== WAITING PHASE (idle animation at waypoint) =====
        if (state.phase === 'waiting') {
            if (performance.now() >= state.waitEndTime) {
                // Move to next waypoint
                state.currentWaypointIndex = (state.currentWaypointIndex + 1) % state.waypoints.length;
                const nextWaypoint = state.waypoints[state.currentWaypointIndex];
                
                // Calculate rotation to face next waypoint
                const dx = nextWaypoint.x - state.controlledPosition.x;
                const dz = nextWaypoint.z - state.controlledPosition.z;
                state.targetRotation = Math.atan2(dx, dz);
                
                state.phase = 'turning';
                
                // Switch to walking animation
                if (manager && instance.currentState !== AmyStates.WALKING) {
                    manager.transitionToState(instance, AmyStates.WALKING);
                }
            }
            return;
        }
        
        // ===== TURNING PHASE (still walking animation, just rotating) =====
        if (state.phase === 'turning') {
            // Calculate shortest rotation direction
            let rotationDiff = state.targetRotation - state.currentRotation;
            
            // Normalize to [-PI, PI]
            while (rotationDiff > Math.PI) rotationDiff -= Math.PI * 2;
            while (rotationDiff < -Math.PI) rotationDiff += Math.PI * 2;
            
            const turnAmount = MOVEMENT.turnSpeed * deltaTime;
            
            if (Math.abs(rotationDiff) < turnAmount) {
                // Finished turning
                state.currentRotation = state.targetRotation;
                state.phase = 'walking';
            } else {
                // Keep turning
                state.currentRotation += Math.sign(rotationDiff) * turnAmount;
            }
            
            model.rotation.set(0, state.currentRotation, 0);
            return;
        }
        
        // ===== WALKING PHASE =====
        
        // Calculate direction to current waypoint
        targetDir.set(
            currentWaypoint.x - state.controlledPosition.x,
            0,
            currentWaypoint.z - state.controlledPosition.z
        );
        const distanceToWaypoint = targetDir.length();
        
        // Check if arrived at waypoint
        if (distanceToWaypoint < MOVEMENT.arrivalDistance) {
            // Start waiting
            state.phase = 'waiting';
            const waitTime = MOVEMENT.waitTimeMin + Math.random() * (MOVEMENT.waitTimeMax - MOVEMENT.waitTimeMin);
            state.waitEndTime = performance.now() + waitTime * 1000;
            
            // Switch to idle animation
            if (manager && instance.currentState !== AmyStates.IDLE) {
                manager.transitionToState(instance, AmyStates.IDLE);
            }
            return;
        }
        
        // Move towards waypoint
        forwardDir.set(Math.sin(state.currentRotation), 0, Math.cos(state.currentRotation));
        const moveDistance = MOVEMENT.speed * deltaTime;
        state.controlledPosition.addScaledVector(forwardDir, moveDistance);
        
        // Apply position (override animation root motion)
        model.position.copy(state.controlledPosition);
        model.rotation.set(0, state.currentRotation, 0);
    },
    
    /**
     * Called when player enters proximity
     */
    onProximityEnter: (instance, manager, playerPosition) => {
        const name = instance.instanceData?.name || instance.definition.name;
        const state = instance.stateData;
        
        console.log(`Player approached ${name}`);
        
        // Only greet once per approach
        if (state && !state.hasGreeted) {
            state.hasGreeted = true;
            state.phase = 'greeting';
            state.greetingEndTime = performance.now() + MOVEMENT.greetingDuration * 1000;
            
            // Face the player
            if (instance.model && playerPosition) {
                const charPos = instance.model.position;
                const dx = playerPosition.x - charPos.x;
                const dz = playerPosition.z - charPos.z;
                state.currentRotation = Math.atan2(dx, dz);
                instance.model.rotation.set(0, state.currentRotation, 0);
            }
            
            // Switch to idle animation
            if (manager && instance.currentState !== AmyStates.IDLE) {
                manager.transitionToState(instance, AmyStates.IDLE);
            }
            
            // Play greeting sound
            if (manager) {
                manager.playSound(instance, 'heyThere');
            }
            
            console.log(`[${name}] Greeting player!`);
        }
    },
    
    /**
     * Called when player exits proximity
     */
    onProximityExit: (instance, manager, playerPosition) => {
        const name = instance.instanceData?.name || instance.definition.name;
        const state = instance.stateData;
        
        console.log(`Player left ${name}`);
        
        // Reset greeting flag so she can greet again next time
        if (state) {
            state.hasGreeted = false;
        }
    },
};

