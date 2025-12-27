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
// let rootworld = "/worlds/cozyship/world.json";
let rootworld = "https://public-spz.t3.storage.dev/cozyship/world.json";
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

async function flushPortalsAndWorlds(fromURL, destinationUrl) {
    console.log("flushPortalsAndWorlds:", fromURL, destinationUrl);

    for (const [worldUrl, state] of worldState.entries()) {
        if (worldUrl !== fromURL && worldUrl !== destinationUrl) {
            console.log("Flushing world:", worldUrl);
            // Remove and dispose all portals
            for (const protoPortal of state.portalPairs) {
                if (protoPortal instanceof ProtoPortal) {
                    protoPortal.dispose();
                }
            }
            state.portalPairs = [];
            
            // Remove mesh from scene
            if (state.mesh) {
                scene.remove(state.mesh);
                // Don't dispose immediately - let the renderer finish its cycle
                // The mesh will be garbage collected after scene removal
                state.mesh = null;
            }

            // Delete world state entry (automatically releases worldno)
            worldState.delete(worldUrl);
        }else if (worldUrl === fromURL) {
            console.log("Removing portals from :", worldUrl);
            for (const protoPortal of state.portalPairs) {
                if (protoPortal instanceof ProtoPortal && protoPortal.destinationUrl !== destinationUrl) {
                    console.log("Removing portal:", protoPortal.destinationUrl);
                    protoPortal.dispose();
                } else if (protoPortal instanceof ProtoPortal) {
                    console.log("Keeping portal:", protoPortal.destinationUrl);
                    // change the label of the portal to the entry world name
                    const entryWorldState = worldState.get(fromURL);
                    const entryWorldName = entryWorldState?.name || fromURL.split("/")[2] || "Unknown";
                    console.log("Changing portal label to:", entryWorldName);
                    await protoPortal.updateLabelText(entryWorldName);
                }
            }
            // Filter out disposed portals
            state.portalPairs = state.portalPairs.filter(p => 
                !(p instanceof ProtoPortal) || p.destinationUrl === destinationUrl
            );
        }else if (worldUrl === destinationUrl) {
            // When returning through a portal, the portal is in the destination world's state
            // Update the label for the portal that leads back to fromURL
            console.log("Checking destination world for return portal:", worldUrl);
            for (const protoPortal of state.portalPairs) {
                if (protoPortal instanceof ProtoPortal && protoPortal.destinationUrl === fromURL) {
                    console.log("Updating return portal label to:", fromURL);
                    const fromWorldState = worldState.get(fromURL);
                    const fromWorldName = fromWorldState?.name || fromURL.split("/")[2] || "Unknown";
                    console.log("Changing return portal label to:", fromWorldName);
                    await protoPortal.updateLabelText(fromWorldName);
                }
            }
        }
    }
}

async function loadPortalsFromWorlData(worldUrl, fromroot) {
  // Get world state (must already exist)
  const state = worldState.get(worldUrl);
  if (!state) {
    console.error("loadPortalsFromWorlData: world state not found for", worldUrl);
    return [];
  }
  
  const worldData = state.data;
  // console.log("loadPortalsFromWorlData:", worldData);
  
  // should only set up portals once on world load. So check whether this is called again.  
  if (state.portalPairs.length > 0) {
    console.warn("loadPortalsFromWorlData: state already has", state.portalPairs.length, "portals for", worldUrl);
  }
  
  let destMeshes = [];
  for (const portalData of worldData.portals) {
    console.log("portalData:", portalData);

    if(fromroot === portalData.destination.url) {
        console.log("Skipping portal to previous world:", portalData.destination.url, "fromroot:", fromroot);
        continue;
    }
    console.log("Creating portal to:", portalData.destination.url, "fromroot:", fromroot);

    // Allocate a world number for this destination world
    const worldno = worldNoAllocator.allocate();
    
    const pair = portals.addPortalPair({ radius: 1.0 });
    const start = portalData.start;
    const destination = portalData.destination;
    console.log("setting portal to :",destination.url);
    console.log("worldno:", worldno);
    console.log("start position:", start.position);
    console.log("destination position:", destination.position);
    
    // Adjust start position from world to universe coordinates
    const adjustedStartPos = worldToUniverse(start.position, state.worldno);
    
    // Adjust destination position from world to universe coordinates
    // Note: Don't modify destination.position directly as it's stored in state.data
    const adjustedDestPos = worldToUniverse(destination.position, worldno);
    
    pair.entryPortal.position.copy(adjustedStartPos);
    pair.entryPortal.quaternion.fromArray(start.rotation);
    pair.exitPortal.position.copy(adjustedDestPos);
    pair.exitPortal.quaternion.fromArray(destination.rotation);

    // Create ProtoPortal instance
    const protoPortal = new ProtoPortal(pair, destination.url, scene, portals);
    
    // Create text label above portal
    if(!portalData.name){
        console.error("loadPortalsFromWorlData: portal data has no name:", portalData);
    }
    const portalName = portalData.name;
    await protoPortal.createLabel(portalName, adjustedStartPos.toArray(), start.rotation);

    // create label for return view of portal
    const fromName = state.name;
    
    // Create gold ring around portal
    protoPortal.createRing(adjustedStartPos.toArray(), start.rotation, 1.0);

    pair.onCross = async (pair, fromEntry) => {

        if (fromEntry) {
            console.log(`Portal callback triggered from entry! ${fromName} -> ${portalName}`);
            currentWorldUrl = destination.url; // Update current world URL
            await flushPortalsAndWorlds(worldUrl, destination.url);
            await loadWorldAsRoot(destination.url, worldUrl);
        }else{
            console.log(`Portal callback triggered from exit! ${portalName} -> ${fromName}`);
            currentWorldUrl = worldUrl; // Update current world URL
            await flushPortalsAndWorlds(destination.url, worldUrl);
            await loadWorldAsRoot(worldUrl, destination.url);
        }
    };
    
    // Store ProtoPortal in world state
    state.portalPairs.push(protoPortal);
    
    destMeshes.push([destination.url, worldno]);
  }
  return destMeshes;
}

async function loadAdjacentWorlds(worldUrl, destMeshes) {
    for (const destMesh of destMeshes) {
        console.log("Loading destination mesh:", destMesh);
        const destWorldUrl = destMesh[0];
        const destresponse = await fetch(destWorldUrl);
        const destWorldData = await destresponse.json();
        
        // Add adjacent world to DAG (this also adds its portals)
        verseDag.loadWorldData(destWorldUrl, destWorldData);
        
        let mesh = await loadSplatandSetPosition(destWorldData.splatUrl, [0, 0, 0], destMesh[1]);
        
        // Store mesh in world state
        const state = worldState.getOrCreate(destWorldUrl, destWorldData, destMesh[1]);
        state.mesh = mesh;
        state.worldno = destMesh[1]; // Ensure worldno is set
        state.name = destWorldData.name; // Ensure name is set
    }
}

// ========== DAG-Driven World Sync ==========
const PRELOAD_HOPS = 1; // How many hops to preload

/**
 * Sync loaded worlds based on DAG traversal from the new root
 * @param {string} newRootUrl - The world URL to center on
 * @param {string} previousRootUrl - Where we came from (for keeping return portal)
 */
async function syncWorldsFromDag(newRootUrl, previousRootUrl = null) {
    console.log("=== syncWorldsFromDag ===");
    console.log("New root:", newRootUrl);
    console.log("Previous root:", previousRootUrl);

    // Phase 1: Ensure all reachable worlds have their worldData loaded
    // This is needed so the DAG knows about all outgoing portals
    verseDag.setRoot(newRootUrl);
    
    // Load root world data if missing
    let rootNode = verseDag.getWorld(newRootUrl);
    if (!rootNode || !rootNode.worldData) {
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
        
        // Create label (use portal name or destination world name)
        const portalName = portalData.name || destState.name || destUrl.split("/")[2];
        await protoPortal.createLabel(portalName, adjustedStartPos.toArray(), start.rotation);
        
        // Create ring
        protoPortal.createRing(adjustedStartPos.toArray(), start.rotation, 1.0);

        // Set up crossing callback
        const fromName = sourceState.name;
        pair.onCross = async (pair, fromEntry) => {
            if (fromEntry) {
                console.log(`Portal crossed: ${fromName} -> ${portalName}`);
                currentWorldUrl = destUrl;
                await syncWorldsFromDag(destUrl, sourceUrl);
            } else {
                console.log(`Portal crossed (reverse): ${portalName} -> ${fromName}`);
                currentWorldUrl = sourceUrl;
                await syncWorldsFromDag(sourceUrl, destUrl);
            }
        };

        sourceState.portalPairs.push(protoPortal);
    }

    // Debug output
    verseDag.debugPrint();
}

async function loadWorldAsRoot(url, fromroot) {

    // load JSON file for world
    const worldData = await loadWorldJSON(url);

    // Populate the DAG with this world and its portals
    verseDag.loadWorldData(url, worldData);
    verseDag.setRoot(url);

    // TODO: this can be simplified but let's be explicit for now
    let state = null;
    if(fromroot == null){
        state = worldState.create(url, worldData);
    }else{
        state = worldState.get(url);
        if(!state){
            console.log("loadWorldAsRoot: world state not found for", fromroot," creating");
            state = worldState.create(url, worldData);
        }
    }
    console.log("loadWorldAsRoot: loaded state for: ", state.name);

    // First set up the portals
    const destMeshes = await loadPortalsFromWorlData(url, fromroot);

    // Load the root world splat
    if (fromroot == null) {
        const mesh = await loadSplatandSetPosition(worldData.splatUrl, [0, 0, 0], 0);
        state.mesh = mesh;
    }else{
        // if we're entering from the back of a portail (from destiantion to source) 
        // then we're already loaded.
    }

    // now load all worlds connected to the root world via portals
    await loadAdjacentWorlds(url, destMeshes);
    
    // Debug: print DAG state
    verseDag.debugPrint();
    
    return worldData;
}

// Start of Execution Here 

// Load initial world data for camera position, then use DAG to load everything
const initialWorldData = await loadWorldJSON(rootworld);
verseDag.loadWorldData(rootworld, initialWorldData);

// Use DAG-driven sync for initial load
await syncWorldsFromDag(rootworld, null);

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

