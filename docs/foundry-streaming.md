# Foundry Screen & Audio Streaming

Foundry is a custom screen and audio streaming solution that enables real-time desktop sharing into the Protoverse 3D environment. It's particularly useful for viewing content on VR headsets like Quest 3.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           macOS Host                                     │
│  ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐ │
│  │   Screen Capture │     │   Audio Capture  │     │    Foundry       │ │
│  │   (xcap crate)   │     │   (cpal crate)   │     │    Server        │ │
│  │                  │     │                  │     │    (axum)        │ │
│  │  Primary Monitor │     │  BlackHole 2ch   │     │                  │ │
│  └────────┬─────────┘     └────────┬─────────┘     │   Port 23646     │ │
│           │                        │               │                  │ │
│           ▼                        ▼               │                  │ │
│  ┌──────────────────┐     ┌──────────────────┐     │                  │ │
│  │  H.264 Encoder   │     │  PCM i16 Stereo  │     │                  │ │
│  │  (OpenH264)      │     │  48kHz           │     │                  │ │
│  └────────┬─────────┘     └────────┬─────────┘     │                  │ │
│           │                        │               │                  │ │
│           └────────────┬───────────┘               │                  │ │
│                        ▼                           │                  │ │
│               ┌──────────────────┐                 │                  │ │
│               │    WebSocket     │◄────────────────┤                  │ │
│               │    /ws endpoint  │                 │                  │ │
│               └────────┬─────────┘                 └──────────────────┘ │
└────────────────────────┼────────────────────────────────────────────────┘
                         │
                         │ WebSocket (ws://host:23646/ws)
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Browser / Quest 3                                 │
│  ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐ │
│  │  WebSocket       │     │  Video Worker    │     │  Audio Context   │ │
│  │  Client          │────▶│  (WebCodecs)     │     │  (Web Audio API) │ │
│  │                  │     │                  │     │                  │ │
│  │  foundry-share.js│     │  H.264 Decode    │     │  PCM Playback    │ │
│  └──────────────────┘     └────────┬─────────┘     └────────┬─────────┘ │
│                                    │                        │           │
│                                    ▼                        ▼           │
│                           ┌──────────────────────────────────┐          │
│                           │     Three.js CanvasTexture       │          │
│                           │     + Spatial Audio              │          │
│                           │                                  │          │
│                           │     Rendered in 3D World         │          │
│                           └──────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Components

### Foundry Server (Rust)

Location: `/Users/martin/projects/foundry/`

| File | Purpose |
|------|---------|
| `src/main.rs` | Axum web server, WebSocket handling |
| `src/recording.rs` | Screen capture using `xcap` crate |
| `src/video_pipeline.rs` | H.264 encoding with OpenH264 |
| `src/audio_capture.rs` | System audio capture via `cpal` |
| `src/audio_mixer.rs` | Audio mixing (for multi-user voice chat) |
| `src/session.rs` | WebSocket session management |

### Protoverse Client (JavaScript)

| File | Purpose |
|------|---------|
| `foundry-share.js` | Main integration, WebSocket client, Three.js texture |
| `public/foundry-worker.js` | Web Worker for H.264 decoding (WebCodecs API) |

## Setup Instructions

### Prerequisites

1. **macOS** (currently the only supported platform for screen capture)
2. **Rust** toolchain (`rustup`)
3. **BlackHole** virtual audio driver (for system audio capture)

### Step 1: Build Foundry

```bash
cd /Users/martin/projects/foundry
cargo build --release
```

The binary will be at `./target/release/foundry`

### Step 2: Grant Screen Recording Permission

1. Run Foundry once: `./target/release/foundry`
2. macOS will prompt for Screen Recording permission
3. Go to **System Settings → Privacy & Security → Screen Recording**
4. Enable permission for `foundry` (or Terminal if running from there)
5. Restart Foundry

### Step 3: Set Up Audio Capture (Optional)

To stream system audio (e.g., YouTube sound):

#### Install BlackHole
```bash
brew install blackhole-2ch
```

#### Create Multi-Output Device
1. Open **Audio MIDI Setup** (Spotlight: "Audio MIDI Setup")
2. Click **+** in bottom left → **Create Multi-Output Device**
3. Check both:
   - ✅ Your speakers/headphones
   - ✅ **BlackHole 2ch**
4. Right-click the Multi-Output Device → **Use This Device For Sound Output**

This routes audio to both your speakers AND BlackHole (which Foundry captures).

#### Volume Control Note
When using Multi-Output Device, system volume doesn't work. Use:
- In-app volume controls (e.g., YouTube slider)
- Or switch back to regular speakers when done streaming

### Step 4: Run Foundry

```bash
cd /Users/martin/projects/foundry
./target/release/foundry
```

You should see:
```
[Audio] Using input device: BlackHole 2ch
[Audio] Sample rate: 48000, Channels: 2
[Audio] Capture started (low-latency direct mode)
System audio capture enabled
Open http://localhost:23646/
```

### Step 5: Configure Protoverse World

Add a Foundry display to your world's `world.json`:

```json
{
  "foundryDisplays": [
    {
      "name": "Main Screen",
      "url": "ws://localhost:23646/ws",
      "position": [0, 2, -3],
      "rotation": [0, 0, 0],
      "scale": [3.2, 1.8, 1]
    }
  ]
}
```

### Step 6: Connect in Protoverse

1. Start Protoverse dev server: `npm run dev`
2. Open in browser / Quest
3. Click the **Foundry** button in the HUD to connect

## Protocol Details

### WebSocket Messages

#### Text Messages (JSON)

| Type | Direction | Purpose |
|------|-----------|---------|
| `mode-select` | Server→Client | Offers video codec options |
| `mode-ack` | Server→Client | Confirms selected codec |
| `video-config` | Server→Client | H.264 decoder configuration (SPS/PPS) |
| `force-keyframe` | Client→Server | Request IDR frame |

#### Binary Messages

**Video frames**: Raw H.264 NAL units (no container)

**Audio chunks**: Custom binary format:
```
Offset  Size  Field
0       4     Magic "AUD0"
4       8     Start timestamp (f64, unused for direct capture)
12      4     Sample rate (u32, typically 48000)
16      4     Channels (u32, 1=mono, 2=stereo)
20      4     Sample count (u32)
24      N*2   Samples (i16 little-endian, interleaved if stereo)
```

### Video Encoding Settings

| Setting | Value | Notes |
|---------|-------|-------|
| Codec | H.264 Baseline | WebCodecs compatible |
| Max resolution | 1920×1080 | Downsampled if larger |
| Target bitrate | 5-15 Mbps | Adaptive based on resolution |
| Frame rate | Up to 60 FPS | Follows screen capture rate |

## Performance Characteristics

### Latency Budget

| Stage | Latency |
|-------|---------|
| Screen capture | ~16ms (60 FPS) |
| H.264 encoding | ~10-30ms |
| Network (localhost) | ~1ms |
| WebSocket framing | ~5ms |
| H.264 decoding | ~5-10ms |
| Audio scheduling | ~20ms |
| **Total** | **~60-100ms** |

### Bandwidth Usage

- **Video**: 5-15 Mbps depending on screen content
- **Audio**: ~1.5 Mbps (48kHz stereo 16-bit PCM, uncompressed)

## Troubleshooting

### Black Screen
- Check Screen Recording permission in System Settings
- Restart Foundry after granting permission

### No Audio
- Verify BlackHole is installed: `brew list blackhole-2ch`
- Check Multi-Output Device is set as system output
- Look for `[Audio] Using input device: BlackHole 2ch` in Foundry logs

### High Latency / Stuttering
- Ensure running release build (`cargo build --release`)
- Check CPU usage - encoding is CPU-intensive
- Try reducing source resolution

### "listener full" Messages
- The encoder can't keep up with capture rate
- Usually happens with very high resolution displays
- Foundry auto-downsamples to 1080p to mitigate

## Future Improvements

### Short Term (Easy Wins)

1. **Opus Audio Compression**
   - Replace raw PCM with Opus codec
   - Reduce audio bandwidth from ~1.5 Mbps to ~64 Kbps
   - Web Audio API supports Opus decoding

2. **Hardware Video Encoding**
   - Use VideoToolbox on macOS for hardware H.264/HEVC
   - Would dramatically reduce CPU usage and latency
   - The `xcap` crate may support this

3. **Adaptive Bitrate**
   - Monitor WebSocket backpressure
   - Dynamically adjust quality based on network conditions

### Medium Term

4. **Audio/Video Synchronization**
   - Add presentation timestamps to both streams
   - Implement A/V sync on client side
   - Currently they're independent streams

5. **Region of Interest**
   - Only capture/encode changed regions
   - Significant bandwidth savings for static content

6. **HEVC/AV1 Support**
   - Better compression than H.264
   - WebCodecs supports HEVC on some platforms

### Long Term (Architecture Changes)

7. **WebRTC Integration**
   - Industry standard for real-time streaming
   - Built-in A/V sync, adaptive bitrate, jitter buffers
   - ~50ms end-to-end latency possible
   - Would require significant rewrite

8. **Multi-Monitor Support**
   - Allow selecting which monitor to stream
   - Or stream multiple monitors to different displays

9. **Remote Streaming**
   - Currently localhost only
   - Add TLS/authentication for remote access
   - NAT traversal (STUN/TURN)

10. **Input Forwarding**
    - Send mouse/keyboard events back to host
    - Enable full remote desktop functionality

## Related Files

- Foundry repo: `/Users/martin/projects/foundry/`
- Protoverse integration: `/Users/martin/projects/protoverse/foundry-share.js`
- World config example: `/Users/martin/projects/protoverse/public/worlds/cozyship/world.json`

