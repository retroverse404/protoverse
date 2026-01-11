# ProtoVerse

A WebXR-enabled 3D metaverse built with Three.js and Gaussian Splatting. Explore interconnected worlds through portals, interact with AI-powered characters, and share your screen in immersive 3D.

## Features

- **Gaussian Splatting** - High-fidelity 3D scenes using SparkJS
- **Portal System** - Seamless travel between interconnected worlds  
- **WebXR/VR Support** - Full Quest 3 compatibility with physics-based movement
- **AI Characters** - NPCs with Braintrust-powered conversations
- **VR Chat** - Virtual keyboard and chat panel for VR interactions
- **Screen Streaming** - Share your desktop via Foundry (custom H.264 streaming)
- **Spatial Audio** - Positional audio sources in the world
- **Multiplayer** - See other players as ghost avatars (optional)

## Quick Start

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Open http://localhost:5173
```

## VR Setup

1. Connect Quest 3 to same network as dev machine
2. Open Quest browser and navigate to `http://<your-ip>:5173`
3. Click "Enter VR" button

## Screen Streaming (Foundry)

See [docs/foundry-streaming.md](docs/foundry-streaming.md) for setup instructions.

Requires:
- Foundry server (`~/projects/foundry/`)
- BlackHole audio driver (for system audio)
- macOS Screen Recording permission

## AI Chat

Characters can have AI conversations via [Braintrust](https://braintrust.dev).

1. Set `VITE_BRAINTRUST_API_KEY` in `.env`
2. Create prompts at braintrust.dev
3. Configure `CHAT.promptSlug` in character files

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed system diagrams.
See [AICodeGuide.md](AICodeGuide.md) for AI assistant guidance.

## World Configuration

Worlds are defined in `public/worlds/<name>/world.json`:

```json
{
  "name": "My World",
  "splatUrl": "/myworld/splats/world.spz",
  "collisionUrl": "/myworld/collision.glb",
  "position": [0, 0, 0],
  "portals": [...],
  "characters": [...],
  "audioSources": [...],
  "foundryDisplays": [...]
}
```

## Controls

### Desktop
- **WASD/Arrows** - Thrust movement
- **Mouse** - Look around
- **Click** - Lock pointer

### VR (Quest 3)
- **Left Thumbstick** - Movement thrust
- **Right Thumbstick** - Rotation
- **Grip** - (reserved)
- **Trigger** - VR keyboard typing

## DAG Creation

The protoverse is dynamically constructed in the browser starting with a world.json that contains the URL to the splats for that world and a list of portals to other worlds. Portals are all bidirectional. The loading logic will load in all worlds and portals up to N hops away from the root world. As the viewer moves to another world the same traversal is applied and anything beyond the N hops is flushed.

## License

Private project
