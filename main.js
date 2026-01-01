import { updateHUD, createAudioToggleButton, createCollisionMeshToggleButton, createPhysicsToggleButton, initHud } from "./hud.js";
import { initAudio, playWorldAudio, handleAudioToggle, setCurrentWorldData } from "./audio.js";
import { initControls, createAnimationLoop } from "./controls.js";
import { ProtoVerse } from "./proto.js";
import { ProtoScene, loadWorldJSON } from "./scene.js";
import { createUrlResolver } from "./paths.js";
import { ProtoverseMultiplayer } from "./multiplayer.js";
import { 
    initPhysics, 
    createPlayerBody, 
    setupThrusterInput, 
    updatePhysics, 
    setPhysicsEnabled,
    isPhysicsEnabled,
    addCollisionMesh,
    setDebugSphereVisible
} from "./physics.js";


const USE_CDN = false;

let urlBase = USE_CDN ? "https://public-spz.t3.storage.dev" : "/worlds"
let urlConfig = { urlBase, useCdn: USE_CDN };
const resolveUrl = createUrlResolver({ urlBase });


// Starting point (relative path - resolved when fetching)
const rootworld = "/root/world.json";

const stats = initHud();
initAudio(resolveUrl);

// ========== Scene Setup ==========
const protoScene = new ProtoScene();
const camera = protoScene.getCamera();
const renderer = protoScene.getRenderer();
const localFrame = protoScene.getLocalFrame();

// ========== ProtoVerse Setup ==========
const protoVerse = new ProtoVerse(protoScene, {
    preloadHops: 2,
    showPortalLabels: false,
    useUrlsForLabels: true,
    urlBase: urlConfig.urlBase,
    useCdn: urlConfig.useCdn,
    resolveUrl: resolveUrl,
    onWorldChange: (worldUrl, worldData) => {
        // Handle world change (e.g., play audio)
        setCurrentWorldData(worldData);
        playWorldAudio(worldData);
        // Join the matching multiplayer room when world changes
        multiplayer.joinWorld(worldUrl, playerName);
    }
});

// ========== Multiplayer Setup ==========
const playerName = `player-${Math.floor(Math.random() * 10000)}`;
const multiplayer = new ProtoverseMultiplayer(protoScene.getScene(), {
    wsUrl: import.meta.env?.VITE_WS_URL,
});

// Start of Execution Here 

// Load initial world data for camera position, then use DAG to load everything
const initialWorldData = await loadWorldJSON(resolveUrl(rootworld));
console.log("main.js: initialWorldData loaded:");
console.log("  keys:", Object.keys(initialWorldData));
console.log("  collisionUrl:", initialWorldData.collisionUrl);

// Set initial camera position from world data
localFrame.position.fromArray(initialWorldData.position);
localFrame.quaternion.fromArray(initialWorldData.rotation);

// ========== Controls & VR Setup ==========
const { controls, sparkXr } = initControls(renderer, camera, localFrame, {
    enableVr: true,
    animatePortal: true,
    xrFramebufferScale: 0.5,
});

// ========== Physics Setup (before loading worlds so collision meshes get registered) ==========
await initPhysics();
createPlayerBody(localFrame, camera, protoScene.getScene());
setupThrusterInput();

// Initialize ProtoVerse with root world (this will trigger onWorldChange callback)
// NOTE: This must happen AFTER physics is initialized so collision meshes get registered
await protoVerse.initialize(rootworld, initialWorldData);

// Create audio toggle button (in HUD)
createAudioToggleButton(handleAudioToggle);

// Create collision mesh toggle button (in HUD, below audio toggle)
// Also controls debug sphere visibility
createCollisionMeshToggleButton((visible) => {
    console.log("Collision mesh visibility:", visible);
    // Also show/hide the player collision debug sphere
    setDebugSphereVisible(visible);
});

// Create physics toggle button (in HUD, below collision mesh toggle)
createPhysicsToggleButton((enabled) => {
    console.log("Physics enabled:", enabled);
    setPhysicsEnabled(enabled);
    
    // Only disable keyboard movement when physics is enabled
    // Keep mouse look (pointerControls) active for camera direction
    if (controls) {
        if (controls.fpsMovement) controls.fpsMovement.enable = !enabled;
        // pointerControls stays enabled for mouse look
    }
});

// ========== Resize Handler ==========
window.addEventListener("resize", () => {
  protoScene.handleResize();
  protoVerse.getPortals().updateAspect(camera.aspect);
});

// ========== Animation Loop ==========
const animationLoop = createAnimationLoop({
    stats,
    controls,
    sparkXr,
    renderer,
    camera,
    localFrame,
    updateHUD: () => updateHUD(camera, protoVerse, rootworld),
    updatePortals: () => protoVerse.updatePortals(),
    updatePortalDisks: (time, isInVR, animatePortal) => protoVerse.updatePortalDisks(time, isInVR, animatePortal),
    updateMultiplayer: (time) => {
        multiplayer.update(
            time,
            localFrame.position.toArray(),
            localFrame.quaternion.toArray(),
            { playerName }
        );
    },
    updatePhysics: (deltaTime) => updatePhysics(deltaTime),
    animatePortal: true,
});

renderer.setAnimationLoop(animationLoop);

