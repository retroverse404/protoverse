# ProtoVerse Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              main.js (Entry Point)                          │
│  - Initializes all systems                                                  │
│  - Creates animation loop                                                   │
│  - Connects components                                                      │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         │                           │                           │
         ▼                           ▼                           ▼
┌─────────────────┐      ┌─────────────────────┐      ┌─────────────────┐
│   ProtoScene    │      │     ProtoVerse      │      │    Controls     │
│   (scene.js)    │◄────►│    (proto.js)       │      │  (controls.js)  │
├─────────────────┤      ├─────────────────────┤      ├─────────────────┤
│ • Three.js Scene│      │ • Portal management │      │ • Keyboard/Mouse│
│ • Camera        │      │ • World DAG         │      │ • Animation loop│
│ • Renderer      │      │ • World loading     │      │ • SparkXr (VR)  │
│ • LocalFrame    │      │ • Character mgmt    │      │ • FPS movement  │
│ • Splat loading │      │ • Audio integration │      └────────┬────────┘
│ • GLB collision │      │ • Foundry displays  │               │
└────────┬────────┘      └──────────┬──────────┘               │
         │                          │                           │
         │                          ▼                           │
         │               ┌─────────────────────┐               │
         │               │    SparkPortals     │               │
         │               │  (@sparkjsdev/spark)│               │
         │               ├─────────────────────┤               │
         │               │ • Portal rendering  │               │
         │               │ • Teleportation     │               │
         │               │ • Cross-world views │               │
         │               └─────────────────────┘               │
         │                                                      │
         └──────────────────────┬───────────────────────────────┘
                                │
                                ▼
```

## Core Data Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           world.json files                                │
│  /public/worlds/{worldname}/world.json                                   │
├──────────────────────────────────────────────────────────────────────────┤
│  {                                                                        │
│    "name": "World Name",                                                  │
│    "splatUrl": "/path/to/splat.spz",      ─────► ProtoScene              │
│    "collisionUrl": "/path/to/mesh.glb",   ─────► Physics                 │
│    "position": [x, y, z],                                                │
│    "rotation": [qx, qy, qz, qw],                                         │
│    "portals": [...],                       ─────► ProtoVerse/SparkPortals│
│    "characters": [...],                    ─────► CharacterManager       │
│    "audioSources": [...],                  ─────► SpatialAudio           │
│    "foundryDisplays": [...]                ─────► FoundryShare           │
│  }                                                                        │
└──────────────────────────────────────────────────────────────────────────┘
```

## Module Dependencies

```
                    ┌─────────────┐
                    │  config.js  │
                    │ (settings)  │
                    └──────┬──────┘
                           │ used by all
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  physics.js │    │   proto.js  │    │   main.js   │
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                  │                  │
       │                  │                  │
       ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────┐
│                      hud.js                          │
│  • Audio toggle      • Collision mesh toggle        │
│  • Physics toggle    • Foundry button               │
│  • Position display                                  │
└─────────────────────────────────────────────────────┘
```

## Foundry Streaming System (Video & Audio)

The Foundry system provides real-time screen and audio streaming from a desktop to the metaverse. It replaces VNC-based approaches with a custom Rust server using H.264 video encoding.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Foundry Streaming Architecture                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Foundry Server (Rust)                             │    │
│  │                 ~/projects/foundry/                                  │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │                                                                      │    │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │    │
│  │  │ Screen Capture│    │ H.264 Encoder│    │ WebSocket    │          │    │
│  │  │  (xcap crate) │───►│ (OpenH264)   │───►│ Server       │          │    │
│  │  │  30fps        │    │ 1080p max    │    │ /ws endpoint │          │    │
│  │  └──────────────┘    └──────────────┘    └──────┬───────┘          │    │
│  │                                                  │                   │    │
│  │  ┌──────────────┐    ┌──────────────┐           │                   │    │
│  │  │ Audio Capture│    │ PCM Stereo   │           │                   │    │
│  │  │ (cpal crate) │───►│ 48kHz i16    │───────────┘                   │    │
│  │  │ BlackHole 2ch│    │              │                               │    │
│  │  └──────────────┘    └──────────────┘                               │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                      │                                       │
│                                      │ WebSocket (binary frames)             │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Protoverse Client                                 │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │                                                                      │    │
│  │  ┌──────────────────────┐    ┌────────────────────────┐             │    │
│  │  │  foundry-share.js    │    │  foundry-worker.js     │             │    │
│  │  ├──────────────────────┤    │  (Web Worker)          │             │    │
│  │  │ • WebSocket client   │    ├────────────────────────┤             │    │
│  │  │ • Audio playback     │◄──►│ • WebCodecs VideoDecoder│            │    │
│  │  │ • THREE.js texture   │    │ • H.264 → VideoFrame   │             │    │
│  │  │ • 3D plane mesh      │    │ • Hardware accelerated │             │    │
│  │  └──────────────────────┘    └────────────────────────┘             │    │
│  │           │                                                          │    │
│  │           ▼                                                          │    │
│  │  ┌──────────────────────────────────────────────────────────┐       │    │
│  │  │                  3D Display in World                      │       │    │
│  │  │  • PlaneGeometry with VideoTexture                       │       │    │
│  │  │  • Positioned via world.json foundryDisplays             │       │    │
│  │  │  • Configurable width/aspectRatio                        │       │    │
│  │  └──────────────────────────────────────────────────────────┘       │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Foundry Protocol

```
┌─────────────────────────────────────────────────────────────────┐
│                    WebSocket Binary Protocol                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  VIDEO PACKET (magic: 0x56494445 "VIDE")                        │
│  ┌────────┬────────┬────────┬───────────────────────────────┐  │
│  │ Magic  │ Width  │ Height │ H.264 NAL Units (AVC format)  │  │
│  │ 4 bytes│ 2 bytes│ 2 bytes│ Variable length               │  │
│  └────────┴────────┴────────┴───────────────────────────────┘  │
│                                                                  │
│  AUDIO PACKET (magic: 0x41554449 "AUDI")                        │
│  ┌────────┬─────────┬──────────┬────────────────────────────┐  │
│  │ Magic  │ Channels│ SampleHz │ PCM i16 samples (LE)       │  │
│  │ 4 bytes│ 2 bytes │ 4 bytes  │ Variable length            │  │
│  └────────┴─────────┴──────────┴────────────────────────────┘  │
│                                                                  │
│  Client → Server: Mode negotiation ("avc" or "hevc")            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Foundry Setup Requirements

1. **BlackHole Audio Driver** - Routes system audio for capture
   - Install: `brew install blackhole-2ch`
   - Configure: System Preferences → Sound → Create Multi-Output Device
   - Select both speakers and BlackHole 2ch

2. **macOS Permissions** - Screen Recording permission required

3. **Run Server**: `cd ~/projects/foundry && cargo run --release`
   - Default: `ws://localhost:23646/ws`

### world.json Configuration

```json
"foundryDisplays": [
  {
    "name": "Screen Share",
    "wsUrl": "ws://localhost:23646/ws",
    "position": [-13.33, 6.5, -0.06],
    "rotation": [0, 0, 0, 1],
    "width": 3.5,
    "aspectRatio": 1.777
  }
]
```

## Physics System

```
┌────────────────────────────────────────────────────────────────┐
│                        physics.js                               │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────────┐   │
│  │   Rapier    │    │  Player Body │    │ Collision Mesh  │   │
│  │   World     │◄───│   (Sphere)   │◄───│   (from GLB)    │   │
│  └─────────────┘    └──────────────┘    └─────────────────┘   │
│         │                  │                                    │
│         │                  ▼                                    │
│         │          ┌──────────────┐                            │
│         │          │   Thruster   │◄─── Keyboard (WASD/Arrows) │
│         │          │    Input     │◄─── VR Controllers         │
│         │          └──────────────┘                            │
│         │                  │                                    │
│         ▼                  ▼                                    │
│  ┌────────────────────────────────┐                            │
│  │      updatePhysics(dt)         │                            │
│  │  • Apply forces                │                            │
│  │  • Step simulation             │                            │
│  │  • Sync localFrame position    │                            │
│  │  • stopPlayerMovement()        │◄─── Called when chatting   │
│  └────────────────────────────────┘                            │
│                                                                 │
│  physics-config.js: thrustForce, drag, bounce, collisionRadius │
└────────────────────────────────────────────────────────────────┘
```

## Character System

```
┌─────────────────────────────────────────────────────────────────┐
│                     Character System                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────┐                                        │
│  │ characters/index.js │  Character Registry                    │
│  │  • OldManCharacter  │                                        │
│  │  • TimelessCharacter│                                        │
│  │  • AmyCharacter     │                                        │
│  └──────────┬──────────┘                                        │
│             │                                                    │
│             ▼                                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              CharacterManager (character-manager.js)     │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │  • spawnCharacter(worldUrl, instanceData)               │   │
│  │  • update(deltaTime) - calls onUpdate for each          │   │
│  │  • transitionToState(instance, newState)                │   │
│  │  • playSound(instance, soundName)                       │   │
│  │  • Proximity detection → onProximityEnter/Exit          │   │
│  └─────────────────────────────────────────────────────────┘   │
│             │                                                    │
│             ▼                                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Character Definition (e.g., amy.js)         │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │  • id, name                                              │   │
│  │  • animations: { walking: {...}, idle: {...} }          │   │
│  │  • sounds: { greeting: {...} }                          │   │
│  │  • states: { WALKING: {...}, IDLE: {...} }              │   │
│  │  • onSpawn(instance, manager)                           │   │
│  │  • onUpdate(instance, deltaTime, context)               │   │
│  │  • onProximityEnter/Exit(instance, manager, playerPos)  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Amy's Waypoint Graph System

Amy uses a directed graph (DAG) for natural wandering behavior:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Waypoint Graph System                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  world.json:                                                     │
│  "waypointGraph": [                                             │
│    { "id": "start", "pos": [x,y,z], "edges": ["door"] },       │
│    { "id": "door", "pos": [x,y,z], "edges": ["start","hall"] },│
│    { "id": "hall", "pos": [x,y,z], "edges": ["door","kitchen"]},│
│    ...                                                          │
│  ]                                                               │
│                                                                  │
│  Behavior:                                                       │
│  • At each node, pick random edge (excluding previous node)     │
│  • 20% chance to pause at node (1-5 seconds)                    │
│  • Never backtracks unless it's the only option                 │
│  • Mimics natural, non-repetitive movement                      │
│                                                                  │
│  State Machine:                                                  │
│  walking → turning → walking → waiting → turning → ...          │
│       ↓                                                          │
│  greeting (when player approaches)                               │
│       ↓                                                          │
│  chatting (conversation active)                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Audio System

```
┌────────────────────────────────────────────────────────────────────┐
│                         Audio Systems                               │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────┐     ┌──────────────────┐                     │
│  │    audio.js      │     │ spatial-audio.js │                     │
│  ├──────────────────┤     ├──────────────────┤                     │
│  │ Background music │     │ Positional audio │                     │
│  │ (bgAudioUrl)     │     │ from world.json  │                     │
│  │                  │     │ audioSources     │                     │
│  └────────┬─────────┘     └────────┬─────────┘                     │
│           │                        │                                │
│           │         ┌──────────────┘                                │
│           │         │                                               │
│           ▼         ▼                                               │
│  ┌─────────────────────────────────────┐                           │
│  │        THREE.AudioListener          │                           │
│  │     (attached to localFrame)        │                           │
│  └─────────────────────────────────────┘                           │
│                     │                                               │
│           ┌─────────┴─────────┐                                    │
│           ▼                   ▼                                    │
│  ┌─────────────────┐  ┌─────────────────┐                         │
│  │  THREE.Audio    │  │ THREE.Positional│                         │
│  │  (non-spatial)  │  │     Audio       │                         │
│  └─────────────────┘  └─────────────────┘                         │
│                                                                     │
│  Mute Toggle (hud.js) ─────► All audio systems respect this        │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

## AI Chat System

```
┌─────────────────────────────────────────────────────────────────┐
│                       AI Chat System                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Desktop Mode                            │  │
│  │  ┌───────────────┐     ┌─────────────────────┐            │  │
│  │  │  chat-ui.js   │◄───►│    Character        │            │  │
│  │  ├───────────────┤     │  (e.g., amy.js)     │            │  │
│  │  │ • showChat()  │     │  onProximityEnter   │            │  │
│  │  │ • hideChat()  │     └──────────┬──────────┘            │  │
│  │  │ • addMessage()│                │                        │  │
│  │  │ • streaming   │                │                        │  │
│  │  └───────────────┘                │                        │  │
│  └───────────────────────────────────┼───────────────────────┘  │
│                                      │                           │
│  ┌───────────────────────────────────┼───────────────────────┐  │
│  │                    VR Mode        │                        │  │
│  │  ┌───────────────┐                │                        │  │
│  │  │  vr-chat.js   │◄───────────────┘                        │  │
│  │  ├───────────────┤                                         │  │
│  │  │ • startVRChat()                                         │  │
│  │  │ • updateVRChat()                                        │  │
│  │  │ • VR keyboard + panel                                   │  │
│  │  └───────┬───────┘                                         │  │
│  │          │                                                  │  │
│  │          ▼                                                  │  │
│  │  ┌───────────────┐    ┌───────────────┐                   │  │
│  │  │vr-keyboard.js │    │vr-chat-panel.js                   │  │
│  │  ├───────────────┤    ├───────────────┤                   │  │
│  │  │ • QWERTY keys │    │ • Message list │                   │  │
│  │  │ • Laser pointer│   │ • Input field  │                   │  │
│  │  │ • Trigger=press│   │ • Canvas render│                   │  │
│  │  └───────────────┘    └───────────────┘                   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                      │                           │
│                                      ▼                           │
│                           ┌─────────────────────┐               │
│                           │  ai/chat-provider.js│               │
│                           ├─────────────────────┤               │
│                           │ • getChatResponse() │               │
│                           │ • Stock fallback    │               │
│                           └──────────┬──────────┘               │
│                                      │                           │
│                                      ▼                           │
│                           ┌─────────────────────┐               │
│                           │    ai/bt.js         │               │
│                           ├─────────────────────┤               │
│                           │ Braintrust API      │               │
│                           │ • invokeBTStream()  │               │
│                           │ • Streaming LLM     │               │
│                           └─────────────────────┘               │
│                                                                  │
│  config.js: ai.enabled, ai.projectName                          │
│  Character: CHAT.promptSlug (Braintrust prompt ID)              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### VR Chat Interaction

```
┌─────────────────────────────────────────────────────────────────┐
│                    VR Chat Coordinate Spaces                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  XR Reference Space (WebXR)          World Space (Three.js)     │
│  ┌─────────────────────┐             ┌─────────────────────┐    │
│  │ • Origin at VR start│             │ • Scene coordinates │    │
│  │ • Controller poses  │─────────────│ • localFrame offset │    │
│  │ • Camera tracking   │  transform  │ • Keyboard/panel    │    │
│  └─────────────────────┘  via        └─────────────────────┘    │
│                          localFrame                              │
│                          .matrixWorld                            │
│                                                                  │
│  Controller Input:                                               │
│  • Right trigger (button 0) → Type key                          │
│  • B button (button 5) → Close chat                             │
│  • targetRaySpace → Laser direction                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Multiplayer System

```
┌─────────────────────────────────────────────────────────────────┐
│                      Multiplayer System                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────┐         ┌─────────────────────┐        │
│  │ multiplayer.js      │◄───────►│  WebSocket Server   │        │
│  │ (client)            │         │  (server/server.js) │        │
│  ├─────────────────────┤         ├─────────────────────┤        │
│  │ • Connect to server │         │ • Broadcast pos/rot │        │
│  │ • Send position     │         │ • Player join/leave │        │
│  │ • Receive others    │         │ • Relay messages    │        │
│  └──────────┬──────────┘         └─────────────────────┘        │
│             │                                                    │
│             ▼                                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    avatar.js (GhostAvatar)               │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │  • Procedural splat mesh                                 │   │
│  │  • Dyno shader (color, animation)                        │   │
│  │  • Ethereal undulating blob                              │   │
│  │  • Per-player color based on ID                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  config.js: multiplayer.enabled, multiplayer.serverUrl          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## File Structure

```
protoverse/
├── main.js                 # Entry point
├── config.js               # Central configuration
├── scene.js                # Three.js scene (ProtoScene)
├── proto.js                # Portal/world system (ProtoVerse)
├── controls.js             # Input & animation loop
├── physics.js              # Rapier physics + stopPlayerMovement()
├── physics-config.js       # Physics parameters
├── hud.js                  # UI buttons & display
├── audio.js                # Background audio
├── spatial-audio.js        # Positional audio sources
├── foundry-share.js        # Foundry video/audio streaming client
├── loading.js              # Loading screen
├── multiplayer.js          # WebSocket client
├── avatar.js               # Ghost avatars
├── character-manager.js    # Character lifecycle
├── chat-ui.js              # Desktop chat interface
├── vr-chat.js              # VR chat system orchestrator
├── vr-keyboard.js          # VR virtual keyboard
├── vr-chat-panel.js        # VR chat display panel
├── ai/
│   ├── bt.js               # Braintrust API
│   └── chat-provider.js    # AI chat abstraction
├── characters/
│   ├── index.js            # Character registry
│   ├── old-man.js          # Old man definition
│   ├── timeless.js         # Timeless definition
│   └── amy.js              # Amy definition (waypoint graph + chat)
├── coordinate-transform.js # World ↔ Universe coords
├── world-state.js          # World state tracking
├── verse-dag.js            # World graph structure
├── worldno.js              # World number allocation
├── paths.js                # URL resolution
├── port.js                 # Portal effects
├── sparkdisk.js            # Portal disk animation
├── public/
│   ├── foundry-worker.js   # WebCodecs video decoder worker
│   └── worlds/
│       ├── root/world.json
│       ├── memory/world.json
│       ├── cozyship/world.json
│       └── ...
├── docs/
│   ├── foundry-streaming.md    # Foundry setup guide
│   └── vr-keyboard-debug.md    # VR keyboard troubleshooting
└── server/
    └── server.js           # Multiplayer WebSocket server
```

## Animation Loop

```
┌─────────────────────────────────────────────────────────────────┐
│                    Animation Loop (60fps)                        │
│                     controls.js → main.js                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Each frame:                                                     │
│                                                                  │
│  1. stats.begin()                    ─── FPS counter            │
│  2. sparkXr.updateControllers()      ─── VR controller tracking │
│  3. applyVRRotation()                ─── VR thumbstick rotation │
│  4. controls.update()                ─── SparkControls/movement │
│  5. updatePhysics(deltaTime)         ─── Rapier simulation      │
│  6. updateCharacters(deltaTime)      ─── Animation, state, AI   │
│  7. updateVRChat(renderer)           ─── VR keyboard/panel      │
│  8. updatePortals()                  ─── Portal teleportation   │
│  9. updatePortalDisks(time)          ─── Disk animations        │
│  10. updateMultiplayer(time)         ─── Send/receive positions │
│  11. updateHUD()                     ─── Position display       │
│  12. renderer.render()               ─── Three.js render        │
│  13. stats.end()                                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Key External Dependencies

- **Three.js** - 3D rendering
- **@sparkjsdev/spark** - Gaussian splatting, portals, VR
- **@dimforge/rapier3d-compat** - Physics engine
- **Braintrust** - AI/LLM functions (optional)
- **ws** - WebSocket (server-side)
- **buffer** - Buffer polyfill for Braintrust in browser

## Configuration (config.js)

```javascript
{
  world: { rootWorld, preloadHops, ... },
  urls: { useCdn, cdnBase, localBase },
  portals: { showLabels, animatePortal },
  vr: { enabled, framebufferScale, fullRotation },
  multiplayer: { enabled, wsUrl },
  audio: { enabledByDefault, thrustVolume },
  ai: { enabled, projectName },       // Braintrust AI
  debug: { showFps, physicsEnabled }
}
```
