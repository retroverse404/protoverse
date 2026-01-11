import * as THREE from "three";
import { updateHUD, createAudioToggleButton, createCollisionMeshToggleButton, createMovementModeToggleButton, createGhostModeToggleButton, createFoundryToggleButton, createCinemaModeButton, initHud, getAudioEnabled, setFoundryButtonVisible, setCinemaButtonVisible } from "./hud.js";
import { initAudio, playWorldAudio, handleAudioToggle, setCurrentWorldData, ensureAudioContext, getCurrentWorldData } from "./audio.js";
import { initControls, createAnimationLoop } from "./controls.js";
import { ProtoVerse } from "./proto.js";
import { ProtoScene, loadWorldJSON } from "./scene.js";
import { createUrlResolver } from "./paths.js";
import { ProtoverseMultiplayer } from "./multiplayer.js";
import { CharacterManager } from "./character-manager.js";
import {
    initPhysics, 
    createPlayerBody, 
    setupThrusterInput, 
    updatePhysics, 
    setPhysicsEnabled,
    setDebugSphereVisible,
    setMovementMode,
    setGhostMode
} from "./physics.js";
import { showLoading, updateLoading, hideLoading } from "./loading.js";
import { config } from "./config.js";
import { initFoundryShare, hasWorldFoundryDisplays, toggleFoundry, toggleCinemaMode, setCinemaRenderer, updateCinemaMode, isCinemaModeActive, onCinemaModeChange, getFoundryScreenPosition, getFoundryScreenRotation, getFoundryDisplayConfig, updateFoundryDisplays, onPlaybackStateChange, setFoundryDisplayPaused } from "./foundry-share.js";
import { setVRMode } from "./characters/ybot.js";
import { initChatProvider } from "./ai/chat-provider.js";
import { initChatUI } from "./chat-ui.js";
import { initVRChat, updateVRChat } from "./vr-chat.js";
import { initVRCommentary } from "./vr-commentary-panel.js";
import { initVRPlaybackControls, updateVRPlaybackControls, showVRPlaybackButton, hideVRPlaybackButton, showDesktopPlaybackButton, hideDesktopPlaybackButton } from "./vr-playback-controls.js";
import { initSpatialAudio, loadWorldAudioSources, unloadWorldAudioSources } from "./spatial-audio.js";

// Multiplayer session management
import * as SessionManager from "./session-manager.js";
import { initMultiplayerPanel } from "./multiplayer-panel.js";
import { initHostControls, updateWorldInfo } from "./host-controls.js";
import { initCharacterSync, setWorldUrl as setCharacterSyncWorld, updateCharacterSync } from "./character-sync.js";

// Import Foundry functions for viewer sync
import { connectFoundry, disconnectFoundry, isFoundryConnected, getFoundryUrl } from "./foundry-share.js";

// URL resolution
const resolveUrl = createUrlResolver({ urlBase: config.urls.urlBase });

// Root world from config
const rootworld = config.world.rootWorld;

const stats = initHud();
initAudio(resolveUrl);

// ========== Scene Setup ==========
const protoScene = new ProtoScene();
const camera = protoScene.getCamera();
const renderer = protoScene.getRenderer();
const localFrame = protoScene.getLocalFrame();

// ========== Audio Listener Setup ==========
// Create audio listener for positional audio (attached to localFrame, like sparkxrstart)
const audioListener = new THREE.AudioListener();
localFrame.add(audioListener);

// ========== Spatial Audio Setup ==========
// Initialize spatial audio system for positional audio sources in worlds
initSpatialAudio(audioListener, protoScene.getScene(), resolveUrl);

// ========== Foundry Share Setup ==========
initFoundryShare(protoScene.getScene(), camera, localFrame, audioListener);
setCinemaRenderer(renderer); // Enable VR detection for cinema mode

// ========== Chat System Setup ==========
// Initialize chat UI and provider early for character conversations
initChatUI();
initChatProvider().then((success) => {
    if (success) {
        console.log("✓ Chat provider initialized (AI enabled)");
    } else {
        console.log("✓ Chat provider initialized (stock responses)");
    }
});

// ========== VR Chat Setup ==========
// Initialize VR chat system (keyboard + panel for in-VR conversations)
initVRChat(protoScene.getScene(), localFrame, camera, renderer);

// ========== VR Commentary Setup ==========
// Initialize VR commentary panel for cinema mode (3D text visible in VR)
initVRCommentary(protoScene.getScene(), camera);

// ========== VR Playback Controls Setup ==========
// Initialize VR playback button for controlling movie playback in VR
initVRPlaybackControls(protoScene.getScene(), localFrame, renderer);

// ========== Multiplayer Session Setup ==========
// Initialize session manager for multiplayer watch parties
// Support URL params for ngrok/remote testing: ?ws=wss://...&foundry=wss://...
const urlParams = new URLSearchParams(window.location.search);
const wsUrlParam = urlParams.get('ws');
const foundryUrlParam = urlParams.get('foundry');

if (wsUrlParam) {
    console.log('[Config] Using WS URL from URL param:', wsUrlParam);
}
if (foundryUrlParam) {
    // Ensure the foundry URL includes the /ws path
    let foundryUrl = foundryUrlParam;
    if (!foundryUrl.endsWith('/ws')) {
        foundryUrl = foundryUrl.replace(/\/$/, '') + '/ws';
    }
    console.log('[Config] Using Foundry URL from URL param:', foundryUrl);
    // Store for later use when connecting to Foundry
    window.FOUNDRY_URL_OVERRIDE = foundryUrl;
}

const wsUrl = wsUrlParam || config.multiplayer.wsUrl || import.meta.env?.VITE_WS_URL || "ws://localhost:8080";
SessionManager.initSessionManager(wsUrl);

// Initialize multiplayer panel (chat/log HUD)
initMultiplayerPanel();

// Show/hide host-only controls based on session state
SessionManager.onSessionCreated(() => {
    // Host: show Foundry and Cinema buttons
    setFoundryButtonVisible(true);
    setCinemaButtonVisible(true);
});

SessionManager.onSessionJoined(async (data) => {
    // Viewer: hide Foundry and Cinema buttons (host controls only)
    setFoundryButtonVisible(false);
    setCinemaButtonVisible(false);
    
    console.log('[Viewer] Session joined, data:', JSON.stringify(data));
    console.log('[Viewer] isMoviePlaying =', data.isMoviePlaying, '(type:', typeof data.isMoviePlaying, ')');
    
    // Late join support: if movie is already playing, auto-connect
    // Need to wait for displays to load since world might still be loading
    if (data.isMoviePlaying) {
        console.log('[Viewer] Movie already playing, waiting for displays to load...');
        const currentWorld = protoVerse.getCurrentWorldUrl() || rootworld;
        console.log('[Viewer] Current world:', currentWorld);
        
        // Retry connecting until displays are available (world might still be loading)
        const maxRetries = 20; // 10 seconds max wait
        let retries = 0;
        const tryConnect = async () => {
            console.log(`[Viewer] Attempting to connect (attempt ${retries + 1})...`);
            const connected = await connectFoundry(currentWorld, 0);
            console.log(`[Viewer] connectFoundry returned:`, connected);
            if (connected) {
                console.log('[Viewer] Successfully auto-connected to movie');
            } else if (retries < maxRetries) {
                retries++;
                console.log(`[Viewer] Displays not ready, retrying... (${retries}/${maxRetries})`);
                setTimeout(tryConnect, 500);
            } else {
                console.warn('[Viewer] Failed to auto-connect after max retries');
            }
        };
        tryConnect();
    } else {
        console.log('[Viewer] Movie NOT playing, skipping auto-connect');
    }
});

SessionManager.onSessionEnded(() => {
    // Session ended: show buttons again (back to non-session mode)
    setFoundryButtonVisible(true);
    setCinemaButtonVisible(true);
});

// ========== ProtoVerse Setup ==========
const protoVerse = new ProtoVerse(protoScene, {
    preloadHops: config.world.preloadHops,
    showPortalLabels: config.portals.showLabels,
    useUrlsForLabels: config.portals.useUrlsForLabels,
    urlBase: config.urls.urlBase,
    useCdn: config.urls.useCdn,
    backgroundPreloadCollision: config.world.backgroundPreloadCollision,
    waitForFullLoad: config.world.waitForFullLoad,
    resolveUrl: resolveUrl,
    onWorldChange: (worldUrl, worldData) => {
        // Handle world change (e.g., play audio)
        setCurrentWorldData(worldData);
        playWorldAudio(worldData);
        // Join the matching multiplayer room when world changes
        if (config.multiplayer.enabled && multiplayer) {
            multiplayer.joinWorld(worldUrl, playerName);
        }
        // Update host controls with new world
        updateWorldInfo(worldUrl, null);
        // Update character sync world
        setCharacterSyncWorld(worldUrl);
        if (config.debug.logWorldChanges) {
            console.log("World changed:", worldUrl, worldData?.name);
        }
    }
});

// ========== Character Manager Setup ==========
const characterManager = new CharacterManager(
    protoScene.getScene(),
    protoScene.getLocalFrame(),
    resolveUrl,
    audioListener  // For positional character audio
);
protoVerse.setCharacterManager(characterManager);

// Initialize character sync for multiplayer (host broadcasts, viewers puppet)
initCharacterSync(characterManager);

// ========== Multiplayer Setup ==========
const playerName = `${config.multiplayer.playerNamePrefix}-${Math.floor(Math.random() * 10000)}`;
const multiplayer = config.multiplayer.enabled 
    ? new ProtoverseMultiplayer(protoScene.getScene(), {
        wsUrl: config.multiplayer.wsUrl || import.meta.env?.VITE_WS_URL,
    })
    : null;

// Start of Execution Here 

// Show loading overlay
showLoading('Loading world data...');

// Load initial world data for camera position, then use DAG to load everything
updateLoading(10, 'Loading world configuration...');
const initialWorldData = await loadWorldJSON(resolveUrl(rootworld));
console.log("main.js: initialWorldData loaded:");
console.log("  keys:", Object.keys(initialWorldData));
console.log("  collisionUrl:", initialWorldData.collisionUrl);
console.log("  bgAudioUrl:", initialWorldData.bgAudioUrl);

// Set initial world data for audio (so clicking audio toggle will play it)
setCurrentWorldData(initialWorldData);

// Set initial camera position from world data
localFrame.position.fromArray(initialWorldData.position);

// Apply starting rotation from config (if specified), otherwise use world.json rotation
if (config.world.startingCameraRotation) {
    const [x, y, z] = config.world.startingCameraRotation;
    // Set localFrame rotation (camera's world rotation = localFrame rotation since camera is a child)
    localFrame.rotation.set(x, y, z);
} else {
    localFrame.quaternion.fromArray(initialWorldData.rotation);
}

// ========== Controls & VR Setup ==========
updateLoading(20, 'Initializing controls...');
const { controls, sparkXr } = initControls(renderer, camera, localFrame, {
    enableVr: config.vr.enabled,
    animatePortal: config.portals.animatePortal,
    xrFramebufferScale: config.vr.framebufferScale,
    onEnterXr: async () => {
        // Resume AudioContext when entering VR (this is a valid user gesture)
        await ensureAudioContext();
        // If audio is enabled, try to start/resume the current world's audio
        if (getAudioEnabled()) {
            const worldData = getCurrentWorldData();
            if (worldData) {
                playWorldAudio(worldData);
            }
        }
        // Set VR mode for character chat systems (chat disabled in VR)
        setVRMode(true);
        // Update cinema mode to use VR sphere instead of CSS overlay
        if (isCinemaModeActive()) {
            const currentWorldUrl = protoVerse.getCurrentWorldUrl() || rootworld;
            updateCinemaMode(currentWorldUrl);
        }
        console.log("VR audio context ready");
    },
    onExitXr: () => {
        // Re-enable chat systems when exiting VR
        setVRMode(false);
        // Update cinema mode to use CSS overlay instead of VR sphere
        if (isCinemaModeActive()) {
            const currentWorldUrl = protoVerse.getCurrentWorldUrl() || rootworld;
            updateCinemaMode(currentWorldUrl);
        }
        console.log("Exited VR mode");
    },
});

// ========== Physics Setup (before loading worlds so collision meshes get registered) ==========
updateLoading(30, 'Initializing physics...');
await initPhysics();
createPlayerBody(localFrame, camera, protoScene.getScene(), renderer);
setupThrusterInput();

// Initialize ProtoVerse with root world (this will trigger onWorldChange callback)
// NOTE: This must happen AFTER physics is initialized so collision meshes get registered
updateLoading(40, 'Loading world and collision meshes...');
await protoVerse.initialize(rootworld, initialWorldData);

// Hide loading overlay after everything is loaded
hideLoading();

// ========== Multiplayer Host Controls ==========
// Initialize host controls for creating/joining sessions
initHostControls({
    worldUrl: rootworld,
    foundryUrl: null, // Will be set when Foundry connects
});

// Set world URL for character sync
setCharacterSyncWorld(rootworld);

// Playback sync: Host broadcasts pause/play state, viewers receive it
onPlaybackStateChange((worldUrl, displayName, isPaused) => {
    if (SessionManager.isHosting()) {
        // Host broadcasts playback state to viewers
        SessionManager.sendPlaybackSync(isPaused, Date.now());
        
        // Send chat message
        const hostName = SessionManager.getLocalName() || 'Host';
        if (isPaused) {
            SessionManager.sendChat(`⏸️ ${hostName} paused the movie`);
        } else {
            SessionManager.sendChat(`▶️ ${hostName} resumed the movie`);
        }
    }
});

// Receive playback sync from host (viewers only)
SessionManager.onPlaybackSync((data) => {
    if (!SessionManager.isHosting()) {
        // Viewer receives playback state from host
        const currentWorld = protoVerse.getCurrentWorldUrl() || rootworld;
        setFoundryDisplayPaused(currentWorld, 0, data.isPaused);
    }
});

// Receive Foundry connection sync from host (viewers connect/disconnect)
SessionManager.onFoundrySync(async (data) => {
    if (!SessionManager.isHosting()) {
        const currentWorld = protoVerse.getCurrentWorldUrl() || rootworld;
        
        if (data.isConnected) {
            // Host turned on movie - viewer should connect
            console.log('[Viewer] Host started movie, connecting to Foundry...');
            await connectFoundry(currentWorld, 0);
        } else {
            // Host turned off movie - viewer should disconnect
            console.log('[Viewer] Host stopped movie, disconnecting from Foundry...');
            disconnectFoundry(currentWorld, 0);
        }
    }
});

// Create audio toggle button (in HUD)
createAudioToggleButton(handleAudioToggle);

// Create collision mesh toggle button (in HUD, below audio toggle)
// Also controls debug sphere visibility
createCollisionMeshToggleButton((visible) => {
    console.log("Collision mesh visibility:", visible);
    // Also show/hide the player collision debug sphere
    setDebugSphereVisible(visible);
});

// Create movement mode toggle button (Thrust vs Gravity Boots)
createMovementModeToggleButton((mode) => {
    console.log("Movement mode:", mode);
    setMovementMode(mode);
    setPhysicsEnabled(true); // Always enable physics when a movement mode is active
    
    // Disable keyboard movement (handled by physics now)
    if (controls && controls.fpsMovement) {
        controls.fpsMovement.enable = false;
    }
});

// Create ghost mode toggle button (pass through walls)
createGhostModeToggleButton((enabled) => {
    console.log("Ghost mode:", enabled);
    setGhostMode(enabled);
});

// Enable ghost mode by default (pass through walls on startup)
setGhostMode(true);

// Enable physics by default if configured (must be after controls are set up)
if (config.debug.physicsEnabled) {
    setPhysicsEnabled(true);
    setMovementMode('gravityBoots'); // Default to FPS walking
    if (controls && controls.fpsMovement) {
        controls.fpsMovement.enable = false;
    }
}

// Create Foundry toggle button if world has Foundry displays
if (hasWorldFoundryDisplays(rootworld) || true) { // Always show for now
    createFoundryToggleButton(async () => {
        const currentWorldUrl = protoVerse.getCurrentWorldUrl() || rootworld;
        const wasConnected = isFoundryConnected(currentWorldUrl);
        const result = await toggleFoundry(currentWorldUrl);
        
        // If host, sync Foundry state to viewers and send chat message
        if (SessionManager.isHosting()) {
            const foundryUrl = getFoundryUrl(currentWorldUrl);
            console.log(`[Host] Sending foundry-sync: isConnected=${result}`);
            SessionManager.sendFoundrySync(result, foundryUrl);
            
            const hostName = SessionManager.getLocalName() || 'Host';
            if (result) {
                SessionManager.sendChat(`🎬 ${hostName} started the movie`);
            } else {
                SessionManager.sendChat(`⏹️ ${hostName} stopped the movie`);
            }
        }
        
        return result;
    });
    
    // Create cinema mode button (dims environment for watching)
    createCinemaModeButton(() => {
        const currentWorldUrl = protoVerse.getCurrentWorldUrl() || rootworld;
        return toggleCinemaMode(currentWorldUrl);
    });
    
    // Listen for cinema mode changes to show/hide playback buttons
    onCinemaModeChange((isActive, worldUrl) => {
        if (isActive) {
            // Only show playback buttons for host (not viewers)
            // Viewers can't control playback - host syncs pause/play to them
            if (!SessionManager.inSession() || SessionManager.isHosting()) {
                const screenPosition = getFoundryScreenPosition(worldUrl);
                const screenRotation = getFoundryScreenRotation(worldUrl);
                const displayConfig = getFoundryDisplayConfig(worldUrl);
                
                if (screenPosition) {
                    // VR button (3D in scene)
                    showVRPlaybackButton(
                        worldUrl,
                        screenPosition,
                        screenRotation,
                        0,
                        displayConfig?.vrPlaybackButton
                    );
                    
                    // Desktop button (2D overlay)
                    showDesktopPlaybackButton(worldUrl, 0);
                }
            }
        } else {
            // Hide playback buttons when cinema mode ends
            hideVRPlaybackButton();
            hideDesktopPlaybackButton();
        }
    });
}

// ========== Resize Handler ==========
window.addEventListener("resize", () => {
  protoScene.handleResize();
  protoVerse.getPortals().updateAspect(camera.aspect);
});

// ========== Animation Loop ==========
const animationLoop = createAnimationLoop({
    stats: config.debug.showFps ? stats : null,
    controls,
    sparkXr,
    renderer,
    camera,
    localFrame,
    updateHUD: () => updateHUD(camera, protoVerse, rootworld),
    updatePortals: () => protoVerse.updatePortals(),
    updatePortalDisks: (time, isInVR, animatePortal) => protoVerse.updatePortalDisks(time, isInVR, animatePortal),
    updateMultiplayer: config.multiplayer.enabled && multiplayer ? (time) => {
        multiplayer.update(
            time,
            localFrame.position.toArray(),
            localFrame.quaternion.toArray(),
            { playerName }
        );
    } : null,
    updatePhysics: (deltaTime) => updatePhysics(deltaTime),
    updateCharacters: (deltaTime, time) => {
        // Always update character manager (animations need to tick)
        // In puppet mode, the character-sync will handle position/state
        characterManager.update(deltaTime);
        // Update character sync (host broadcasts, viewers receive)
        updateCharacterSync(time);
        // Update VR chat system (keyboard/panel interaction)
        updateVRChat(renderer);
        // Update VR playback controls (pause/play button interaction)
        updateVRPlaybackControls(renderer);
    },
    updateFoundry: (time) => updateFoundryDisplays(time),
    animatePortal: config.portals.animatePortal,
});

renderer.setAnimationLoop(animationLoop);

