/**
 * Character Manager
 * 
 * Manages character instances, animations, and state machines.
 */

import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { getCharacterDefinition } from "./characters/index.js";
import { worldToUniverse } from "./coordinate-transform.js";

const fbxLoader = new FBXLoader();

/**
 * Represents a single character instance in the world
 */
class CharacterInstance {
    constructor(definition, instanceData) {
        this.definition = definition;
        this.instanceData = instanceData;
        this.model = null;
        this.mixer = null;
        this.animations = new Map(); // animName -> { clip, action }
        this.currentState = null;
        this.currentAnimation = null;
        this.animationComplete = false;
        this.visible = true;
        
        // Custom state data (set by character definition)
        this.stateData = {};
        
        // Proximity tracking
        this.inProximity = false;
        this.proximityDistance = 5.0; // Default proximity distance
        
        // Audio
        this.sounds = new Map(); // soundName -> THREE.PositionalAudio
    }
}

/**
 * CharacterManager - Handles loading, spawning, and updating characters
 */
export class CharacterManager {
    constructor(scene, localFrame, resolveUrl, audioListener = null) {
        this.scene = scene;
        this.localFrame = localFrame;
        this.resolveUrl = resolveUrl;
        this.audioListener = audioListener;
        this.instances = new Map(); // worldUrl -> CharacterInstance[]
        
        // Cache loaded FBX models
        this.modelCache = new Map(); // url -> { model, animations }
        
        // Cache loaded audio buffers
        this.audioCache = new Map(); // url -> AudioBuffer
        this.audioLoader = new THREE.AudioLoader();
        
        // Lighting for characters (added once)
        this._hasLighting = false;
    }
    
    /**
     * Set the audio listener (can be set after construction)
     * @param {THREE.AudioListener} listener
     */
    setAudioListener(listener) {
        this.audioListener = listener;
    }
    
    /**
     * Load an audio buffer (with caching)
     * @param {string} url - Audio file URL
     * @returns {Promise<AudioBuffer>}
     */
    async _loadAudio(url) {
        if (this.audioCache.has(url)) {
            return this.audioCache.get(url);
        }
        
        return new Promise((resolve, reject) => {
            this.audioLoader.load(
                url,
                (buffer) => {
                    this.audioCache.set(url, buffer);
                    resolve(buffer);
                },
                undefined,
                (error) => {
                    console.error(`Failed to load audio: ${url}`, error);
                    reject(error);
                }
            );
        });
    }
    
    /**
     * Ensure scene has lighting for characters
     */
    _ensureLighting() {
        if (this._hasLighting) return;
        
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        ambientLight.name = 'characterAmbientLight';
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 10, 5);
        directionalLight.name = 'characterDirectionalLight';
        this.scene.add(directionalLight);
        
        this._hasLighting = true;
    }
    
    /**
     * Load an FBX file (with caching)
     * @param {string} url - URL to FBX file
     * @param {boolean} useOriginal - If true, return original model (first load), otherwise clone
     * @returns {Promise<{model: THREE.Group, animations: THREE.AnimationClip[]}>}
     */
    async _loadFBX(url, useOriginal = true) {
        // Check cache first - always clone from cache
        if (this.modelCache.has(url)) {
            const cached = this.modelCache.get(url);
            // Use SkeletonUtils.clone for proper skeleton/bone handling in animated characters
            const clonedModel = SkeletonUtils.clone(cached.model);
            return {
                model: clonedModel,
                animations: cached.animations,
            };
        }
        
        const absoluteURL = new URL(url, window.location.href).href;
        
        return new Promise((resolve, reject) => {
            fbxLoader.load(
                absoluteURL,
                (result) => {
                    
                    // Cache a clone for future use, keep original for first instance
                    // Use SkeletonUtils.clone for proper skeleton handling
                    this.modelCache.set(url, {
                        model: SkeletonUtils.clone(result),
                        animations: result.animations || [],
                    });
                    
                    // Return original model (better for animations)
                    resolve({
                        model: result,
                        animations: result.animations || [],
                    });
                },
                (progress) => {
                    if (progress.total) {
                        console.log(`  Loading ${url}: ${(progress.loaded / progress.total * 100).toFixed(0)}%`);
                    }
                },
                (error) => {
                    console.error(`Failed to load FBX: ${url}`, error);
                    reject(error);
                }
            );
        });
    }
    
    /**
     * Spawn a character instance
     * @param {Object} instanceData - Instance data from world.json
     * @param {Array<number>} worldPosition - World's base position
     * @param {number} worldno - World number
     * @param {string} worldUrl - World URL for tracking
     * @returns {Promise<CharacterInstance>}
     */
    async spawnCharacter(instanceData, worldPosition, worldno, worldUrl) {
        const { type, position = [0, 0, 0], rotation = [0, 0, 0, 1], scale, initialState, triggers = true } = instanceData;
        
        // Get character definition
        const definition = getCharacterDefinition(type);
        if (!definition) {
            console.error(`[CharacterManager] Unknown character type: ${type}`);
            throw new Error(`Unknown character type: ${type}`);
        }
        
        const displayName = instanceData.name || definition.name;
        console.log(`[CharacterManager] Spawning "${displayName}" at`, position);
        
        // Create instance
        const instance = new CharacterInstance(definition, instanceData);
        instance.triggersEnabled = triggers;
        
        // Set proximity distance (from instanceData, definition, or default)
        instance.proximityDistance = instanceData.proximityDistance 
            ?? definition.proximityDistance 
            ?? 5.0;
        
        // Determine initial state
        const startState = initialState || definition.defaultState || Object.keys(definition.states || {})[0];
        const stateConfig = definition.states?.[startState];
        const startAnimation = stateConfig?.animation || definition.defaultAnimation || Object.keys(definition.animations)[0];
        
        // Get animation definition
        const animDef = definition.animations[startAnimation];
        if (!animDef) {
            console.error(`[CharacterManager] Animation "${startAnimation}" not found! Available:`, Object.keys(definition.animations));
            throw new Error(`Animation "${startAnimation}" not found for character "${type}"`);
        }
        
        // Resolve URL and load the model for the initial animation
        const modelUrl = this.resolveUrl ? this.resolveUrl(animDef.file) : animDef.file;
        console.log(`[CharacterManager] Loading initial model from: ${modelUrl}`);
        const { model, animations } = await this._loadFBX(modelUrl);
        console.log(`[CharacterManager] Model loaded. Animation clips found: ${animations.length}`);
        if (animations.length > 0) {
            console.log(`[CharacterManager] Animation clip names:`, animations.map(a => a.name));
        }
        instance.model = model;
        
        // Set position from character's local coordinates
        // NOTE: worldPosition from world.json is the CAMERA starting position, NOT a world offset
        // Splats are loaded at [0,0,0] and transformed with worldToUniverse, so characters should too
        model.position.fromArray(position);
        
        // Apply worldToUniverse transform if not root world (worldno !== 0)
        // This matches how splats are positioned in scene.js loadSplatandSetPosition
        if (worldno !== 0) {
            const universePos = worldToUniverse(model.position, worldno);
            model.position.copy(universePos);
        }
        
        // Set rotation
        if (rotation.length === 4) {
            model.quaternion.fromArray(rotation);
        } else if (rotation.length === 3) {
            model.rotation.fromArray(rotation);
        }
        
        // Set scale
        const finalScale = scale ?? definition.defaultScale ?? 1;
        if (typeof finalScale === 'number') {
            model.scale.setScalar(finalScale);
        } else if (Array.isArray(finalScale)) {
            model.scale.fromArray(finalScale);
        }
        
        // Set up animation mixer
        instance.mixer = new THREE.AnimationMixer(model);
        
        // Store initial animation from this FBX
        if (animations.length > 0) {
            const clip = animations[0];
            const action = instance.mixer.clipAction(clip);
            
            // Configure looping explicitly
            if (animDef.loop === false) {
                action.setLoop(THREE.LoopOnce);
                action.clampWhenFinished = true;
            } else {
                action.setLoop(THREE.LoopRepeat);
            }
            
            instance.animations.set(startAnimation, { clip, action });
        }
        
        // Preload all other animations defined in the character
        const otherAnimations = Object.keys(definition.animations).filter(name => name !== startAnimation);
        if (otherAnimations.length > 0) {
            console.log(`[CharacterManager] Preloading ${otherAnimations.length} additional animation(s)...`);
            
            for (const animName of otherAnimations) {
                const otherAnimDef = definition.animations[animName];
                const otherModelUrl = this.resolveUrl ? this.resolveUrl(otherAnimDef.file) : otherAnimDef.file;
                
                try {
                    const { animations: otherAnims } = await this._loadFBX(otherModelUrl);
                    
                    if (otherAnims.length > 0) {
                        const clip = otherAnims[0];
                        const action = instance.mixer.clipAction(clip);
                        
                        if (otherAnimDef.loop === false) {
                            action.setLoop(THREE.LoopOnce);
                            action.clampWhenFinished = true;
                        } else {
                            action.setLoop(THREE.LoopRepeat);
                        }
                        
                        instance.animations.set(animName, { clip, action });
                        console.log(`[CharacterManager] Preloaded animation "${animName}"`);
                    }
                } catch (error) {
                    console.error(`[CharacterManager] Failed to preload animation "${animName}":`, error);
                }
            }
        }
        
        // Listen for animation completion
        instance.mixer.addEventListener('finished', (e) => {
            instance.animationComplete = true;
            
            // Call onComplete callback if defined
            const currentAnimDef = definition.animations[instance.currentAnimation];
            if (currentAnimDef?.onComplete) {
                currentAnimDef.onComplete(instance, this);
            }
        });
        
        // Set initial state and play animation
        instance.currentState = startState;
        instance.currentAnimation = startAnimation;
        instance.animationComplete = false;
        
        const animData = instance.animations.get(startAnimation);
        if (animData) {
            console.log(`[CharacterManager] Playing initial animation "${startAnimation}" - clip: "${animData.clip.name}", duration: ${animData.clip.duration.toFixed(2)}s`);
            animData.action.play();
        } else {
            console.error(`[CharacterManager] No animation data found for initial animation "${startAnimation}"!`);
        }
        
        // Ensure lighting
        this._ensureLighting();
        
        // Add to scene
        this.scene.add(model);
        
        // Set up sounds if defined and audio listener is available
        // This must happen before onSpawn so sounds are available
        if (definition.sounds && this.audioListener) {
            await this._setupCharacterSounds(instance, definition.sounds);
        }
        
        // Call onSpawn hook (after sounds are ready)
        if (definition.onSpawn) {
            definition.onSpawn(instance, this);
        }
        
        // Track instance
        if (!this.instances.has(worldUrl)) {
            this.instances.set(worldUrl, []);
        }
        this.instances.get(worldUrl).push(instance);
        
        return instance;
    }
    
    /**
     * Set up positional audio sources for a character
     * @param {CharacterInstance} instance
     * @param {Object} soundDefs - Sound definitions from character definition
     */
    async _setupCharacterSounds(instance, soundDefs) {
        for (const [soundName, soundDef] of Object.entries(soundDefs)) {
            try {
                const url = this.resolveUrl ? this.resolveUrl(soundDef.file) : soundDef.file;
                const buffer = await this._loadAudio(url);
                
                let sound;
                
                // Use positional or non-positional audio based on config
                const usePositional = soundDef.positional !== false;
                
                if (usePositional) {
                    // Create positional audio attached to character model
                    // Using same simple approach as sparkxrstart (no custom panner config)
                    sound = new THREE.PositionalAudio(this.audioListener);
                    sound.setRefDistance(soundDef.refDistance || 5);
                    sound.setRolloffFactor(soundDef.rolloffFactor || 1);
                    sound.setMaxDistance(soundDef.maxDistance || 50);
                } else {
                    // Non-positional audio
                    sound = new THREE.Audio(this.audioListener);
                }
                
                sound.setBuffer(buffer);
                sound.setVolume(soundDef.volume || 1.0);
                sound.setLoop(soundDef.loop || false);
                
                // Attach to character model
                instance.model.add(sound);
                instance.sounds.set(soundName, sound);
                
                // Autoplay looping sounds (or if explicitly set)
                if (soundDef.autoplay || (soundDef.loop && soundDef.autoplay !== false)) {
                    sound.play();
                    console.log(`[CharacterManager] Autoplaying looping sound "${soundName}"`);
                }
                
                console.log(`[CharacterManager] Loaded ${usePositional ? 'positional' : 'non-positional'} sound "${soundName}" for character`);
            } catch (error) {
                console.error(`[CharacterManager] Failed to load sound "${soundName}":`, error);
            }
        }
    }
    
    /**
     * Play a sound for a character
     * @param {CharacterInstance} instance
     * @param {string} soundName
     */
    playSound(instance, soundName) {
        const sound = instance.sounds.get(soundName);
        if (sound) {
            // Stop if already playing, then restart
            if (sound.isPlaying) {
                sound.stop();
            }
            sound.play();
            console.log(`[CharacterManager] Playing sound "${soundName}"`);
        } else {
            console.warn(`[CharacterManager] Sound "${soundName}" not found for character`);
        }
    }
    
    /**
     * Transition a character to a new state
     * @param {CharacterInstance} instance
     * @param {string} newState
     */
    async transitionToState(instance, newState) {
        const definition = instance.definition;
        const stateConfig = definition.states?.[newState];
        
        if (!stateConfig) {
            console.warn(`State "${newState}" not found for character "${definition.id}"`);
            return;
        }
        
        const animName = stateConfig.animation;
        const animDef = definition.animations[animName];
        
        if (!animDef) {
            console.warn(`Animation "${animName}" not found for state "${newState}"`);
            return;
        }
        
        console.log(`[CharacterManager] Transitioning to state "${newState}", animation "${animName}"`);
        console.log(`[CharacterManager] Animation already loaded: ${instance.animations.has(animName)}`);
        
        // Stop current animation
        const currentAnimData = instance.animations.get(instance.currentAnimation);
        if (currentAnimData) {
            console.log(`[CharacterManager] Fading out current animation: ${instance.currentAnimation}`);
            currentAnimData.action.fadeOut(0.3);
        }
        
        // Load animation if not already loaded
        if (!instance.animations.has(animName)) {
            console.log(`[CharacterManager] Loading animation from: ${animDef.file}`);
            const modelUrl = this.resolveUrl ? this.resolveUrl(animDef.file) : animDef.file;
            const { animations } = await this._loadFBX(modelUrl);
            
            console.log(`[CharacterManager] Loaded ${animations.length} animation clips`);
            
            if (animations.length > 0) {
                const clip = animations[0];
                const action = instance.mixer.clipAction(clip);
                
                // Configure looping explicitly
                if (animDef.loop === false) {
                    action.setLoop(THREE.LoopOnce);
                    action.clampWhenFinished = true;
                } else {
                    // Explicitly set looping for animations that should repeat
                    action.setLoop(THREE.LoopRepeat);
                }
                
                instance.animations.set(animName, { clip, action });
            }
        }
        
        // Play new animation
        const newAnimData = instance.animations.get(animName);
        if (newAnimData) {
            console.log(`[CharacterManager] Playing animation "${animName}" - clip: "${newAnimData.clip.name}", duration: ${newAnimData.clip.duration.toFixed(2)}s, tracks: ${newAnimData.clip.tracks.length}`);
            console.log(`[CharacterManager] Loop: ${animDef.loop !== false}`);
            // Ensure action is enabled and has proper weight
            newAnimData.action.enabled = true;
            newAnimData.action.setEffectiveTimeScale(1);
            newAnimData.action.setEffectiveWeight(1);
            newAnimData.action.reset();
            newAnimData.action.fadeIn(0.3);
            newAnimData.action.play();
            console.log(`[CharacterManager] Action isRunning: ${newAnimData.action.isRunning()}, weight: ${newAnimData.action.getEffectiveWeight()}`);
        } else {
            console.error(`[CharacterManager] No animation data found for "${animName}"!`);
        }
        
        // Update state
        instance.currentState = newState;
        instance.currentAnimation = animName;
        instance.animationComplete = false;
    }
    
    /**
     * Set visibility for all characters in a world
     * @param {string} worldUrl - World URL
     * @param {boolean} visible - Whether to show characters
     */
    setWorldCharactersVisible(worldUrl, visible) {
        const instances = this.instances.get(worldUrl);
        if (!instances) return;
        
        for (const instance of instances) {
            if (instance.model) {
                instance.model.visible = visible;
                instance.visible = visible;
            }
        }
    }
    
    /**
     * Remove all characters for a world
     * @param {string} worldUrl - World URL
     */
    removeWorldCharacters(worldUrl) {
        const instances = this.instances.get(worldUrl);
        if (!instances) return;
        
        for (const instance of instances) {
            if (instance.mixer) {
                instance.mixer.stopAllAction();
            }
            if (instance.model) {
                this.scene.remove(instance.model);
                instance.model.traverse((child) => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                });
            }
        }
        
        this.instances.delete(worldUrl);
    }
    
    /**
     * Check if characters are loaded for a world
     * @param {string} worldUrl - World URL
     * @returns {boolean}
     */
    hasCharacters(worldUrl) {
        return this.instances.has(worldUrl) && this.instances.get(worldUrl).length > 0;
    }
    
    /**
     * Get character instances for a world
     * @param {string} worldUrl - World URL
     * @returns {CharacterInstance[]}
     */
    getCharacters(worldUrl) {
        return this.instances.get(worldUrl) || [];
    }
    
    /**
     * Update all characters (call every frame)
     * @param {number} deltaTime - Time since last frame in seconds
     */
    update(deltaTime) {
        // Get player position from localFrame
        const playerPosition = this.localFrame.position;
        
        for (const [worldUrl, instances] of this.instances) {
            for (const instance of instances) {
                // Skip if not visible
                if (!instance.visible || !instance.model) continue;
                
                // Calculate distance to player
                const charPos = instance.model.position;
                const playerDistance = playerPosition.distanceTo(charPos);
                
                // Create context for state machine and updates
                const context = {
                    playerPosition,
                    playerDistance,
                    deltaTime,
                    scene: this.scene,  // For raycasting against collision meshes
                    manager: this,      // Allow characters to trigger state transitions
                };
                
                // Update animation mixer
                if (instance.mixer) {
                    instance.mixer.update(deltaTime);
                }
                
                // Process state machine transitions
                this._processStateMachine(instance, context);
                
                // Process proximity triggers
                if (instance.triggersEnabled) {
                    this._processProximity(instance, playerPosition, playerDistance);
                }
                
                // Custom update function
                if (instance.definition.onUpdate) {
                    instance.definition.onUpdate(instance, deltaTime, context);
                }
            }
        }
    }
    
    /**
     * Process state machine transitions
     * @param {CharacterInstance} instance
     * @param {Object} context
     */
    _processStateMachine(instance, context) {
        const definition = instance.definition;
        const currentStateConfig = definition.states?.[instance.currentState];
        
        if (!currentStateConfig?.transitions) return;
        
        // Check each transition condition
        for (const transition of currentStateConfig.transitions) {
            if (transition.condition(instance, context)) {
                // Execute onTransition callback if defined
                if (transition.onTransition) {
                    transition.onTransition(instance, this);
                }
                
                // Transition to new state
                this.transitionToState(instance, transition.to);
                break; // Only one transition per frame
            }
        }
    }
    
    /**
     * Process proximity triggers
     * @param {CharacterInstance} instance
     * @param {THREE.Vector3} playerPosition
     * @param {number} distance
     */
    _processProximity(instance, playerPosition, distance) {
        const definition = instance.definition;
        const proximityThreshold = instance.proximityDistance;
        
        const wasInProximity = instance.inProximity;
        const isInProximity = distance <= proximityThreshold;
        
        if (isInProximity && !wasInProximity) {
            // Entered proximity
            instance.inProximity = true;
            
            if (definition.onProximityEnter) {
                definition.onProximityEnter(instance, this, playerPosition);
            }
        } else if (!isInProximity && wasInProximity) {
            // Exited proximity
            instance.inProximity = false;
            
            if (definition.onProximityExit) {
                definition.onProximityExit(instance, this, playerPosition);
            }
        }
    }
}
