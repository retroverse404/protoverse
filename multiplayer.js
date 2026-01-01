import * as THREE from "three";
import { createProtoverseWs } from "./multiplayer-client.js";
import { GhostAvatar } from "./avatar.js";

function randomColor() {
  const colors = [0x00d4ff, 0x22c55e, 0xf59e0b, 0xef4444, 0xa855f7, 0x06b6d4, 0xec4899];
  return colors[Math.floor(Math.random() * colors.length)];
}

export class ProtoverseMultiplayer {
  constructor(scene, { wsUrl, worldResolver }) {
    this.scene = scene;
    this.wsUrl = wsUrl || (import.meta.env?.VITE_WS_URL ?? "ws://localhost:8080");
    this.worldResolver = worldResolver;
    this.ws = createProtoverseWs(this.wsUrl);
    this.peers = new Map(); // id -> { mesh, color, avatar }
    this.stateSendIntervalMs = 100; // 10 Hz
    this._accum = 0;
    this._lastTime = 0;
    this.localColor = randomColor();

    this._attachHandlers();
  }

  _attachHandlers() {
    this.ws.onPeers = (peers) => {
      // Peers: array of {id, name, color}
      peers.forEach((p) => this._ensurePeer(p.id, p.name, p.color));
    };
    this.ws.onJoin = ({ id, name, color }) => {
      this._ensurePeer(id, name, color);
    };
    this.ws.onLeave = ({ id }) => {
      this._removePeer(id);
    };
    this.ws.onState = (msg) => {
      const { from, pos, rot, color } = msg;
      const peer = this._ensurePeer(from, msg.name, color);
      if (peer && pos && rot) {
        peer.mesh.position.fromArray(pos);
        peer.mesh.quaternion.fromArray(rot);
      }
    };
  }

  _ensurePeer(id, name, colorHint) {
    if (this.peers.has(id)) return this.peers.get(id);
    const color = colorHint ?? randomColor();
    const avatar = new GhostAvatar({ baseColor: color });
    const mesh = avatar.getObject();
    mesh.userData.name = name || id;
    this.scene.add(mesh);
    const entry = { mesh, color, avatar };
    this.peers.set(id, entry);
    return entry;
  }

  _removePeer(id) {
    const entry = this.peers.get(id);
    if (!entry) return;
    this.scene.remove(entry.mesh);
    entry.avatar?.mesh?.dispose?.();
    this.peers.delete(id);
  }

  joinWorld(worldUrl, displayName) {
    const resolved = this.worldResolver ? this.worldResolver(worldUrl) : worldUrl;
    this.ws.join(resolved, displayName, this.localColor);
  }

  update(timeMs, positionArray, quaternionArray, meta) {
    const deltaMs = timeMs - this._lastTime;
    this._lastTime = timeMs;

    // Animate all peer avatars every frame
    for (const entry of this.peers.values()) {
      entry.avatar?.update(timeMs);
    }

    // Throttle network sends
    this._accum += deltaMs;
    if (this._accum >= this.stateSendIntervalMs) {
      this._accum = 0;
      this.ws.sendState(positionArray, quaternionArray, { ...meta, color: this.localColor });
    }
  }

  dispose() {
    this.ws.close();
    for (const id of [...this.peers.keys()]) {
      this._removePeer(id);
    }
  }
}

