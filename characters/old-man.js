/**
 * Old Man Character Definition
 * 
 * Defines the old man character with animations and state machine logic.
 */

import * as THREE from "three";

/**
 * Character States
 */
export const OldManStates = {
    IDLE: 'idle',
    JUMPING: 'jumping',
    WAVING: 'waving',
};

/**
 * Old Man Character Definition
 */
export const OldManCharacter = {
    id: "old-man",
    name: "Old Man",
    
    // Available animations - each with its own FBX file
    // NOTE: Animation keys must match what's referenced in states[].animation
    // Paths are relative to /worlds/ (resolveUrl adds the prefix)
    animations: {
        idle: { 
            file: "/memory/characters/old-man/old-man-idl.fbx",
            loop: true,
        },
        waving: { 
            file: "/memory/characters/old-man/old-man-wave.fbx",
            loop: false,
        },
        jumping: { 
            file: "/memory/characters/old-man/old-man-jumping-down.fbx",
            loop: false,
        },
    },
    
    // Audio sources for this character (using sparkxrstart-style settings)
    sounds: {
        mumble: {
            file: "/memory/characters/old-man/mumble.mp3",
            refDistance: 5,
            rolloffFactor: 1,
            maxDistance: 50,
            volume: 0.8,
            loop: false,
            positional: true,
        },
    },
    
    // Default settings
    defaultState: OldManStates.IDLE,
    defaultScale: 0.015,
    
    /**
     * State machine definition
     * Each state defines:
     * - animation: which animation to play
     * - transitions: conditions to move to other states
     */
    states: {
        [OldManStates.IDLE]: {
            animation: 'idle',
            transitions: [
                {
                    to: OldManStates.WAVING,
                    condition: (instance, context) => {
                        // Transition to waving when player is close (within 3 units)
                        // Only wave once per approach (hasWaved resets when player leaves)
                        const canWave = instance.definition.animations.waving; // Check animation exists
                        const isClose = context.playerDistance < 3.0;
                        const hasntWaved = !instance.stateData?.hasWaved;
                        return canWave && isClose && hasntWaved;
                    },
                    onTransition: (instance, manager) => {
                        console.log("Old man starts waving!");
                        instance.stateData.hasWaved = true;
                        
                        // Face the player (Mixamo models face +Z)
                        if (instance.model && manager?.localFrame) {
                            const charPos = instance.model.position;
                            const playerPos = manager.localFrame.position;
                            
                            // Calculate angle to player
                            const dx = playerPos.x - charPos.x;
                            const dz = playerPos.z - charPos.z;
                            const angleToPlayer = Math.atan2(dx, dz);
                            
                            // Set rotation (clean Y-only rotation)
                            instance.model.rotation.set(0, angleToPlayer, 0);
                        }
                        
                        // Play mumble sound
                        if (manager) {
                            manager.playSound(instance, 'mumble');
                        }
                    }
                }
            ],
        },
        [OldManStates.JUMPING]: {
            animation: 'jumping',
            transitions: [
                {
                    to: OldManStates.IDLE,
                    condition: (instance, context) => {
                        // Transition to idle when jump animation completes
                        return instance.animationComplete;
                    }
                }
            ],
        },
        [OldManStates.WAVING]: {
            animation: 'waving',
            transitions: [
                {
                    to: OldManStates.IDLE,
                    condition: (instance, context) => {
                        // Return to idle when wave animation completes
                        return instance.animationComplete;
                    },
                    onTransition: (instance) => {
                        console.log("Old man finished waving, returning to idle");
                    }
                }
            ],
        },
    },
    
    /**
     * Called when character is first spawned
     */
    onSpawn: (instance, manager) => {
        // Initialize custom state data
        instance.stateData = {
            hasWaved: false,
            spawnTime: performance.now(),
        };
    },
    
    /**
     * Called every frame
     */
    onUpdate: (instance, deltaTime, context) => {
        // Custom per-frame logic can go here
        // context contains: { playerPosition, playerDistance }
    },
    
    /**
     * Called when player enters proximity
     */
    onProximityEnter: (instance, manager, playerPosition) => {
        const name = instance.instanceData?.name || instance.definition.name;
        console.log(`Player approached ${name}`);
        // Could trigger a reaction here
    },
    
    /**
     * Called when player exits proximity
     */
    onProximityExit: (instance, manager, playerPosition) => {
        const name = instance.instanceData?.name || instance.definition.name;
        console.log(`Player left ${name}`);
        // Reset wave flag so they'll wave again next time
        if (instance.stateData) {
            instance.stateData.hasWaved = false;
        }
    },
};
