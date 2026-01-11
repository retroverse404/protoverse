# ProtoVerse AI Code Guide

This document is designed for AI assistants working on this codebase. It explains the architecture, conventions, and common pitfalls to help you work effectively.

## Project Overview

ProtoVerse is a WebXR-enabled 3D world explorer built with Three.js and Gaussian Splatting. Users can navigate through interconnected worlds via portals, interact with animated characters, and experience physics-based movement.

**Key Technologies:**
- **Three.js** - 3D rendering
- **SparkJS** (`@sparkjsdev/spark`) - Gaussian Splatting renderer, VR support, portal system
- **Rapier.js** - Physics engine
- **Vite** - Build tool
- **WebXR** - VR support (Quest 3 tested)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                           main.js                                │
│  Entry point: creates scene, controls, protoverse, starts loop  │
└─────────────────────────────────────────────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          ▼                       ▼                       ▼
   ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
   │  scene.js   │         │  proto.js   │         │ controls.js │
   │ ProtoScene  │         │ ProtoVerse  │         │   Input     │
   │ Three.js    │         │ World/Portal│         │  Handling   │
   │ setup       │         │ management  │         │             │
   └─────────────┘         └─────────────┘         └─────────────┘
          │                       │
          │                       ├── verse-dag.js (World graph)
          │                       ├── world-state.js (Per-world state)
          │                       └── character-manager.js (NPCs)
          │
          └── Uses SparkJS for:
              - SplatMesh (Gaussian splats)
              - SparkPortals (portal rendering)
              - SparkXr (VR support)
              - SparkControls (camera movement)
```

---

## Core Concepts

### 1. World System

**Worlds** are defined in `public/worlds/<world-name>/world.json`:

```json
{
  "name": "World Name",
  "splatUrl": "/worldname/splats/world-lod-0.spz",
  "collisionUrl": "/worldname/collision.glb",
  "bgAudioUrl": "/worldname/ambient.mp3",
  "position": [x, y, z],
  "rotation": [qx, qy, qz, qw],
  "portals": [...],
  "characters": [...]
}
```

- **splatUrl**: Gaussian splat file (.spz format)
- **collisionUrl**: GLB mesh for physics collisions
- **position/rotation**: Camera starting position in this world

### 2. WorldNo System

Each loaded world gets a unique `worldno` (0, 1, 2, ...). This is used for:
- **Coordinate transforms**: `worldToUniverse()` offsets positions so multiple worlds don't overlap
- **Physics separation**: Each world's collision mesh is registered with its worldno

**Important**: Root world is always `worldno = 0`. Non-root worlds get positive numbers.

### 3. Local Frame

The `localFrame` is a `THREE.Group` that contains the camera. This is crucial:
- Moving the player = moving `localFrame`
- Camera rotation is set on `localFrame.rotation` for FPS-style controls
- VR uses `localFrame` as the XR reference space
- Audio listener should be attached to `localFrame`, not camera

### 4. Portal System

Portals use SparkJS's `SparkPortals` class with custom `ProtoPortal` wrappers:
- Portals are bidirectional pairs (entry ↔ exit)
- Crossing a portal triggers `syncWorldsFromDag()` to load/unload worlds
- The `VerseDag` tracks which worlds are reachable within N hops

### 5. Character System

Characters are defined in `characters/*.js` and registered in `characters/index.js`.

**Character Definition Structure:**
```javascript
export const MyCharacter = {
  id: "my-char",           // Unique identifier
  name: "My Character",    // Display name
  
  animations: {
    idle: { file: "/world/chars/char/idle.fbx", loop: true },
    walk: { file: "/world/chars/char/walk.fbx", loop: true },
  },
  
  sounds: {
    greeting: { file: "/world/chars/char/hi.mp3", positional: false },
  },
  
  defaultState: "idle",
  defaultScale: 0.01,
  proximityDistance: 5.0,
  
  states: {
    idle: { animation: 'idle', transitions: [...] },
    walk: { animation: 'walk', transitions: [...] },
  },
  
  onSpawn: (instance, manager) => { ... },
  onUpdate: (instance, deltaTime, context) => { ... },
  onProximityEnter: (instance, manager, playerPosition) => { ... },
  onProximityExit: (instance, manager, playerPosition) => { ... },
};
```

**Instance Data** (from world.json):
```json
{
  "name": "Character Instance Name",
  "type": "my-char",
  "position": [x, y, z],
  "rotation": [qx, qy, qz, qw],
  "scale": 0.01,
  "waypointGraph": [
    { "id": "start", "pos": [x,y,z], "edges": ["waypoint2"] },
    { "id": "waypoint2", "pos": [x,y,z], "edges": ["start", "waypoint3"] }
  ]
}
```

### 6. Waypoint Graph System

Characters like Amy use a DAG (Directed Acyclic Graph) for natural wandering:

```javascript
// In world.json, define waypointGraph per character instance
"waypointGraph": [
  { "id": "start", "pos": [-7.86, 4.99, 6.05], "edges": ["door"] },
  { "id": "door", "pos": [-7.86, 4.99, 1.05], "edges": ["start", "hallway"] },
  ...
]
```

**Behavior:**
- At each node, pick random edge (excluding previous node to avoid backtracking)
- 20% chance to pause at a node (1-5 seconds)
- Never backtracks unless it's the only option
- See `amy.js` for implementation: `buildWaypointGraph()`, `pickRandomNextNode()`

### 7. Foundry Streaming

Foundry is a custom Rust server for screen/audio streaming (replaces VNC).

**Server**: `~/projects/foundry/` - Rust application using xcap + OpenH264
**Client**: `foundry-share.js` + `public/foundry-worker.js`

```json
// world.json
"foundryDisplays": [
  {
    "name": "Screen Share",
    "wsUrl": "ws://localhost:23646/ws",
    "position": [-13.33, 6.5, -0.06],
    "width": 3.5,
    "aspectRatio": 1.777
  }
]
```

See `docs/foundry-streaming.md` for full setup instructions.

### 8. AI Chat System

Characters can have AI-powered conversations using Braintrust.

**Desktop**: `chat-ui.js` - 2D overlay chat window
**VR**: `vr-chat.js` + `vr-keyboard.js` + `vr-chat-panel.js` - 3D keyboard/panel

**Configuration:**
- `config.js`: `ai.enabled`, `ai.projectName`
- Character: `CHAT.promptSlug` for Braintrust prompt ID
- Environment: `VITE_BRAINTRUST_API_KEY`

**Flow:**
1. Player approaches character → `onProximityEnter`
2. `stopPlayerMovement()` halts player
3. `showChat()` (desktop) or `startVRChat()` (VR)
4. User types → `getChatResponse()` → Braintrust streaming
5. Response appears via `startStreamingMessage()` / `appendToStreamingMessage()`

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `main.js` | Entry point, creates all managers, starts render loop |
| `config.js` | Centralized configuration (world, VR, multiplayer, debug, AI) |
| `scene.js` | `ProtoScene` class - Three.js scene/camera/renderer setup |
| `proto.js` | `ProtoVerse` class - World loading, portals, DAG sync |
| `verse-dag.js` | `VerseDag` - Graph of world connections |
| `world-state.js` | `WorldState` - Per-world runtime state |
| `character-manager.js` | `CharacterManager` - NPC spawning, animation, state machine |
| `characters/index.js` | Character registry |
| `physics.js` | Rapier physics integration, `stopPlayerMovement()` |
| `physics-config.js` | Physics parameters (thrust, bounce, drag) |
| `controls.js` | Input handling (keyboard, mouse, VR controllers) |
| `hud.js` | UI elements (FPS, buttons, orientation display) |
| `loading.js` | Loading progress bar |
| `audio.js` | Background audio management |
| `spatial-audio.js` | Positional audio sources from world.json |
| `coordinate-transform.js` | `worldToUniverse()` transform |
| `port.js` | `ProtoPortal` class |
| `sparkdisk.js` / `sparkring.js` | Portal visual effects |
| **Streaming** | |
| `foundry-share.js` | Foundry video/audio streaming client |
| `public/foundry-worker.js` | WebCodecs H.264 decoder worker |
| **AI Chat** | |
| `chat-ui.js` | Desktop 2D chat interface |
| `ai/chat-provider.js` | Chat response abstraction (AI or stock) |
| `ai/bt.js` | Braintrust API integration |
| **VR Chat** | |
| `vr-chat.js` | VR chat system orchestrator |
| `vr-keyboard.js` | 3D virtual keyboard for VR |
| `vr-chat-panel.js` | 3D chat message display panel |

---

## Common Patterns

### URL Resolution

Asset URLs in world.json are relative to `/worlds/`. Use `resolveUrl()`:

```javascript
// In world.json: "splatUrl": "/root/splats/root.spz"
// Resolves to: "/worlds/root/splats/root.spz"
const fullUrl = resolveUrl("/root/splats/root.spz");
```

### State Machine Transitions

Characters can trigger state transitions via the manager:

```javascript
// In onUpdate or onProximityEnter:
if (manager && instance.currentState !== MyStates.GREETING) {
    manager.transitionToState(instance, MyStates.GREETING);
}
```

### Playing Sounds

```javascript
// In character hooks:
if (manager) {
    manager.playSound(instance, 'greeting');
}
```

### Overriding Animation Root Motion

Mixamo animations often include root motion. Override in `onUpdate`:

```javascript
onUpdate: (instance, deltaTime, context) => {
    // Calculate your own position
    state.controlledPosition.addScaledVector(forward, speed * deltaTime);
    
    // Override animation's position
    model.position.copy(state.controlledPosition);
    model.rotation.set(0, state.currentRotation, 0);
}
```

---

## Common Gotchas & Lessons Learned

### 1. Rotation: Use `model.rotation.set(0, y, 0)` not `model.rotation.y = y`

When a model has a quaternion set (from world.json), setting only `rotation.y` may not work correctly. Always use:
```javascript
model.rotation.set(0, yRotation, 0);
```

### 2. Mixamo Characters Face +Z

Mixamo exports face +Z (not Three.js default -Z). Forward direction:
```javascript
// Correct for Mixamo:
forwardDir.set(Math.sin(rotation), 0, Math.cos(rotation));

// NOT this (would be backwards):
// forwardDir.set(-Math.sin(rotation), 0, -Math.cos(rotation));
```

### 3. FBX Cloning Requires SkeletonUtils

When caching/cloning animated FBX models:
```javascript
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
const clone = SkeletonUtils.clone(originalModel);
```

Regular `.clone()` breaks bone references.

### 4. Positional Audio Can Be Distorted

If spatial audio sounds distorted, try:
```javascript
sounds: {
    mySound: {
        file: "...",
        positional: false,  // Disable spatialization
    }
}
```

Or use simpler settings:
```javascript
audio.setDistanceModel('linear');
audio.setRolloffFactor(1);
audio.setRefDistance(5);
audio.setMaxDistance(50);
```

### 5. Scene Traversal is Expensive

Don't do `scene.traverse()` every frame. Cache results:
```javascript
// BAD - every frame:
onUpdate: () => {
    scene.traverse(child => { ... }); // Very slow!
}

// GOOD - cache and refresh periodically:
let cachedMeshes = [];
let lastCacheTime = 0;
if (now - lastCacheTime > 2000) {
    cachedMeshes = [];
    scene.traverse(child => cachedMeshes.push(child));
    lastCacheTime = now;
}
```

### 6. Instance Data vs Definition

- `instance.definition` - The character type definition (shared)
- `instance.instanceData` - The specific instance config from world.json
- `instance.stateData` - Runtime state you create in `onSpawn`

### 7. Rapier Physics "Sleeping"

Rapier puts slow-moving bodies to sleep, causing abrupt stops. Disable if needed:
```javascript
rigidBodyDesc.setCanSleep(false);
```

### 8. AudioContext Requires User Gesture

For VR audio, ensure AudioContext is resumed with a user gesture:
```javascript
if (audioContext.state === 'suspended') {
    audioContext.resume();
}
```

### 9. worldToUniverse for Non-Root Worlds

Characters/objects in non-root worlds need coordinate transform:
```javascript
if (worldno !== 0) {
    const universePos = worldToUniverse(localPos, worldno);
    model.position.copy(universePos);
}
```

### 10. Loading Order Matters

In `character-manager.js`, the order is:
1. Load FBX model
2. Set position/rotation
3. Set up animation mixer
4. Set up sounds (before onSpawn!)
5. Call `onSpawn`
6. Start initial animation

---

## Configuration System

All config is in `config.js`. Access via:

```javascript
import { config } from './config.js';

// Direct access:
config.world.rootWorld
config.debug.physicsEnabled

// Or via helper:
import { getConfig, setConfig } from './config.js';
getConfig('world.rootWorld');
setConfig('debug.showFps', true);
```

**Key Config Sections:**
- `world` - Root world, preload hops, loading behavior
- `urls` - CDN vs local, base URLs
- `portals` - Labels, animation
- `vr` - Enabled, framebuffer scale, rotation mode
- `multiplayer` - WebSocket config
- `audio` - Default state, volumes
- `debug` - FPS, logging, physics toggle

---

## Adding a New Character

1. **Create FBX animations** in `public/worlds/<world>/characters/<char>/`

2. **Create character definition** in `characters/<char>.js`:
   - Define states, animations, sounds
   - Implement `onSpawn`, `onUpdate`, proximity handlers

3. **Register in `characters/index.js`**:
   ```javascript
   import { MyCharacter } from './my-char.js';
   export const characterRegistry = {
       // ...existing...
       "my-char": MyCharacter,
   };
   ```

4. **Add to world.json**:
   ```json
   "characters": [{
       "name": "My Character",
       "type": "my-char",
       "position": [0, 0, 0],
       "rotation": [0, 0, 0, 1],
       "scale": 0.01
   }]
   ```

---

## Testing

- **Local dev**: `npm run dev` (Vite dev server)
- **VR testing**: Use Quest 3 browser, connect to dev server on local network
- **Collision mesh editing**: `tools/collision-editor.html`
- **Physics tuning**: Adjust `physics-config.js`

---

## Deployment

- **Netlify**: Configured via `netlify.toml`
- **Assets**: Splats (.spz) served from Tigris CDN, not bundled
- **Build**: `npm run build` - excludes `public/worlds/` from bundle

---

## Tips for AI Assistants

1. **Read relevant files before making changes** - especially `character-manager.js` for character work, `proto.js` for world/portal work.

2. **Test coordinate systems** - Position bugs are common. Log positions liberally.

3. **Check console for errors** - Many issues show up as Three.js or FBX loader warnings.

4. **Preserve user's manual edits** - If user modified world.json positions/rotations, don't overwrite them.

5. **Keep it simple** - Avoid over-engineering. Single-purpose functions, minimal abstraction.

6. **Performance matters** - VR needs 72+ FPS. Avoid per-frame allocations and traversals.

7. **Use existing patterns**:
   - `timeless.js` - Walking characters with sounds
   - `old-man.js` - Proximity reactions  
   - `amy.js` - Waypoint graph pathing + AI chat integration

8. **VR coordinate spaces** - WebXR poses are in XR reference space. Transform to world space via `localFrame.matrixWorld` before using in Three.js. See `vr-chat.js` for examples.

9. **AI is optional** - Chat features require Braintrust API key. Always check `config.ai.enabled` and fall back gracefully to stock phrases.

---

*Last updated: January 2026*

