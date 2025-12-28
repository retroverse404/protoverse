import * as THREE from "three";
import {
  SparkPortals,
  SplatMesh,
  SparkControls,
} from "@sparkjsdev/spark";
import Stats from "stats.js";
import { updateHUD } from "./hud.js";
import { ProtoPortal, setupPortalLighting } from "./port.js";
import { worldNoAllocator } from "./worldno.js";
import { WorldState } from "./world-state.js";
import { worldToUniverse } from "./coordinate-transform.js";
import { VerseDag } from "./verse-dag.js";

// ========== Setup ==========
const stats = new Stats();
document.body.appendChild(stats.dom);

// Starting point
let rootworld = "/worlds/cozyship/world.json";
// let rootworld = "https://public-spz.t3.storage.dev/cozyship/world.json";
// Track current world URL (to world.json)
let currentWorldUrl = rootworld; // Track current world URL

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  90,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Local frame for camera (used for movement and teleportation)
const localFrame = new THREE.Group();
scene.add(localFrame);
localFrame.add(camera);

localFrame.position.set(0, 2, 0);

// Setup lighting for portal materials
setupPortalLighting(scene, camera);

// ========== Portal System ==========
const portals = new SparkPortals({
  renderer,
  scene,
  camera,
  localFrame,
  defaultPortalRadius: 1.0,
  sparkOptions: {
    maxStdDev: Math.sqrt(4),
    lodSplatScale: 0.5,
    behindFoveate: 0.3,
    coneFov0: 20.0,
    coneFov: 150.0,
    coneFoveate: 0.3,
  },
});

// ========== World Loading ==========
const worldState = new WorldState();
const verseDag = new VerseDag();

async function loadSplatandSetPosition(url, position = [0, 0, 0], world = 0) {
  console.log("Loading", url);

  const absoluteURL = new URL(url, window.location.href).href;

  const mesh = new SplatMesh({ url: absoluteURL, paged: true });
  await mesh.initialized;

  if (Array.isArray(position)) {
    mesh.position.fromArray(position);
  } else {
    mesh.position.copy(position);
  }
  mesh.quaternion.fromArray([0, 0, 0, 1]);
  if (world !== 0) {
    const universePos = worldToUniverse(mesh.position, world);
    mesh.position.copy(universePos);
  }

  scene.add(mesh);
  console.log("Loaded", url);
  return mesh;
} // loadSplatandSetPosition


async function loadWorldJSON(worldUrl) {
    console.log("loadWorldJSON:", worldUrl);
    const response = await fetch(worldUrl);
    const worlddata = await response.json();
    return worlddata;
} // loadWorldJSON

// ========== DAG-Driven World Sync ==========
const PRELOAD_HOPS = 1; // How many hops to preload

/**
 * Sync loaded worlds based on DAG traversal from the new root
 * @param {string} newRootUrl - The world URL to center on
 * @param {string} previousRootUrl - Where we came from (for keeping return portal)
 */
async function syncWorldsFromDag(newRootUrl, previousRootUrl, portalPair ) {
    console.log("=== syncWorldsFromDag ===");
    console.log("New root:", newRootUrl);
    console.log("Previous root:", previousRootUrl);

    // Phase 1: Ensure all reachable worlds have their worldData loaded
    // This is needed so the DAG knows about all outgoing portals
    verseDag.setRoot(newRootUrl);
    
    // Load root world data if missing
    let rootNode = verseDag.getWorld(newRootUrl);
    if (!rootNode || !rootNode.worldData) {
        console.warn("rootNode not in DAG. This probably indicates a bug.");
        console.log("Loading world data for root:", newRootUrl);
        const worldData = await loadWorldJSON(newRootUrl);
        verseDag.loadWorldData(newRootUrl, worldData);
    }
    
    // Iteratively discover and load world data for reachable worlds
    // Keep going until no new worlds are discovered
    let discoveredNew = true;
    while (discoveredNew) {
        discoveredNew = false;
        const plan = verseDag.getTraversalPlan(PRELOAD_HOPS);
        
        for (const node of plan.worldsToLoad) {
            if (!node.worldData) {
                console.log("Discovering world data for:", node.url);
                const worldData = await loadWorldJSON(node.url);
                verseDag.loadWorldData(node.url, worldData);
                discoveredNew = true;
            }
        }
    }
    
    // Phase 2: Now get the final traversal plan with complete knowledge
    const plan = verseDag.getTraversalPlan(PRELOAD_HOPS);
    
    console.log("Traversal plan:");
    console.log("  Worlds to load:", plan.worldsToLoad.map(n => n.url));
    console.log("  Portals to setup:", plan.portalsToSetup.map(e => `${e.sourceUrl} -> ${e.destinationUrl}`));
    console.log("  Worlds to flush:", plan.worldsToFlush.map(n => n.url));

    // 1. Flush worlds that are too far away
    for (const node of plan.worldsToFlush) {
        const worldUrl = node.url;
        // Don't flush the previous root (we need its return portal)
        if (worldUrl === previousRootUrl) {
            console.log("Keeping previous root for return portal:", worldUrl);
            continue;
        }
        
        const state = worldState.get(worldUrl);
        if (state) {
            console.log("Flushing world:", worldUrl);
            // Dispose all portals
            for (const protoPortal of state.portalPairs) {
                if (protoPortal instanceof ProtoPortal) {
                    protoPortal.dispose();
                }
            }
            state.portalPairs = [];
            
            // Remove mesh from scene
            if (state.mesh) {
                scene.remove(state.mesh);
                state.mesh = null;
            }
            
            worldState.delete(worldUrl);
        }
    }

    // 2. Load world meshes for worlds in the plan
    for (const node of plan.worldsToLoad) {
        const worldUrl = node.url;
        const worldData = node.worldData; // Already loaded in Phase 1
        
        // Skip mesh loading if already loaded
        if (worldState.has(worldUrl) && worldState.get(worldUrl).mesh) {
            console.log("World mesh already loaded:", worldUrl);
            continue;
        }

        // Allocate worldno (0 for root, new number for others)
        const isRoot = (worldUrl === newRootUrl);
        let state = worldState.get(worldUrl);
        let worldno;
        
        if (state) {
            worldno = state.worldno;
        } else {
            worldno = isRoot && !previousRootUrl ? 0 : worldNoAllocator.allocate();
            state = worldState.create(worldUrl, worldData, worldno);
        }

        // Load mesh if not already loaded
        if (!state.mesh) {
            console.log("Loading mesh for:", worldUrl, "worldno:", worldno);
            const mesh = await loadSplatandSetPosition(worldData.splatUrl, [0, 0, 0], worldno);
            state.mesh = mesh;
            console.log("  Mesh position:", mesh.position.toArray());
        }
    }

    // if previous root exists, let's patch up the label on the exit portal
    if (previousRootUrl) {
        console.log("We're coming from ", previousRootUrl);
        const state = worldState.get(newRootUrl);
        const previousRootState = worldState.get(previousRootUrl);
        if (previousRootState) {
            const previousRootPortal = previousRootState.portalPairs.find(p => p instanceof ProtoPortal && p.destinationUrl === newRootUrl);
            if (previousRootPortal) {
                console.log(previousRootState);
                console.log(previousRootPortal);
                const portalName = previousRootState.name;
                previousRootPortal.updateLabelText(portalName);
            }else{
                // likely a persistant portal  of ours we just crossed back from
                console.warn("Previous root portal not found for ", previousRootUrl);
            }
        }else{
            console.warn("Previous root state not found for ", previousRootUrl);
        }
    }

    // 3. Set up portals based on plan
    for (const edge of plan.portalsToSetup) {
        const sourceUrl = edge.sourceUrl;
        const destUrl = edge.destinationUrl;
        const portalData = edge.portalData;
        
        if (!portalData) {
            console.warn("No portal data for edge:", sourceUrl, "->", destUrl);
            continue;
        }

        const sourceState = worldState.get(sourceUrl);
        const destState = worldState.get(destUrl);
        
        if (!sourceState || !destState) {
            console.warn("Missing state for portal:", sourceUrl, "->", destUrl);
            continue;
        }

        // Check if portal already exists
        const existingPortal = sourceState.portalPairs.find(
            p => p instanceof ProtoPortal && p.destinationUrl === destUrl
        );
        if (existingPortal) {
            console.log("Portal already exists:", sourceUrl, "->", destUrl);
            console.log("  Existing portal exit pos:", existingPortal.pair.exitPortal.position.toArray());
            console.log("  Dest state worldno:", destState.worldno);
            console.log("  Dest mesh pos:", destState.mesh?.position?.toArray());

            // go ahead and update label just in case it's one of ours we're returning from
            existingPortal.updateLabelText(portalData.name);

            continue;
        }

        console.log("Setting up portal:", sourceUrl, "->", destUrl);
        console.log("  Source worldno:", sourceState.worldno, "Dest worldno:", destState.worldno);
        
        const pair = portals.addPortalPair({ radius: 1.0 });
        const start = portalData.start;
        const destination = portalData.destination;
        
        // Adjust positions to universe coordinates
        const adjustedStartPos = worldToUniverse(start.position, sourceState.worldno);
        const adjustedDestPos = worldToUniverse(destination.position, destState.worldno);
        
        console.log("  Start local:", start.position, "-> universe:", adjustedStartPos.toArray());
        console.log("  Dest local:", destination.position, "-> universe:", adjustedDestPos.toArray());
        
        pair.entryPortal.position.copy(adjustedStartPos);
        pair.entryPortal.quaternion.fromArray(start.rotation);
        pair.exitPortal.position.copy(adjustedDestPos);
        pair.exitPortal.quaternion.fromArray(destination.rotation);

        // Create ProtoPortal
        const protoPortal = new ProtoPortal(pair, destUrl, scene, portals);
        
        // Create label (use portal name or destination URL)
        const portalName = portalData.name || destUrl;
        await protoPortal.createLabel(portalName, adjustedStartPos.toArray(), start.rotation);
        
        // Create ring
        protoPortal.createRing(adjustedStartPos.toArray(), start.rotation, 1.0);

        // Set up crossing callback
        const fromName = sourceState.name;
        pair.onCross = async (pair, fromEntry) => {
            if (fromEntry) {
                console.log(`Portal crossed: ${fromName} -> ${portalName}`);
                currentWorldUrl = destUrl;
                await syncWorldsFromDag(destUrl, sourceUrl, pair);
            } else {
                console.log(`Portal crossed (reverse): ${portalName} -> ${fromName}`);
                currentWorldUrl = sourceUrl;
                await syncWorldsFromDag(sourceUrl, destUrl, pair);
            }
        };

        sourceState.portalPairs.push(protoPortal);
    }

    // Debug output
    verseDag.debugPrint();
} // syncWorldsFromDag

// Start of Execution Here 

// Load initial world data for camera position, then use DAG to load everything
const initialWorldData = await loadWorldJSON(rootworld);
verseDag.loadWorldData(rootworld, initialWorldData);

// Use DAG-driven sync for initial load
await syncWorldsFromDag(rootworld, null, null);

// Set initial camera position from world data
localFrame.position.fromArray(initialWorldData.position);
localFrame.quaternion.fromArray(initialWorldData.rotation);

// ========== Controls ==========
const controls = new SparkControls({
  renderer,
  canvas: renderer.domElement,
});

// ========== Resize Handler ==========
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  portals.updateAspect(camera.aspect);
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(function animate(time) {
  stats.begin();

  // Update controls
  controls.update(localFrame);

  // Update HUD with camera world position and orientation
  // Get worldno from current world's state
  let worldno = 0;
  const currentState = worldState.get(currentWorldUrl);
  if (currentState && currentState.worldno !== undefined) {
    worldno = currentState.worldno;
  }
  updateHUD(camera, currentWorldUrl, worldno);

  // Update portal labels (rotation animation)
  for (const [worldUrl, state] of worldState.entries()) {
    for (const protoPortal of state.portalPairs) {
      if (protoPortal instanceof ProtoPortal) {
        protoPortal.updateLabelRotation(time);
      }
    }
  }

  // Update portals and render
  portals.animateLoopHook();

  stats.end();
});

