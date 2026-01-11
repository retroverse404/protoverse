/**
 * Multiplayer Manager
 * 
 * Manages peer avatars and state synchronization using the session manager.
 * Uses GhostAvatar (procedural splat blobs) for player representation.
 */

import * as THREE from "three";
import { GhostAvatar } from "./avatar.js";
import * as SessionManager from "./session-manager.js";

function randomColor() {
  const colors = [0x00d4ff, 0x22c55e, 0xf59e0b, 0xef4444, 0xa855f7, 0x06b6d4, 0xec4899];
  return colors[Math.floor(Math.random() * colors.length)];
}

export class ProtoverseMultiplayer {
  constructor(scene, { worldResolver } = {}) {
    this.scene = scene;
    this.worldResolver = worldResolver;
    this.peers = new Map(); // id -> { mesh, color, avatar, name, isHost }
    this.stateSendIntervalMs = 100; // 10 Hz
    this._accum = 0;
    this._lastTime = 0;
    this.localColor = randomColor();
    this.localName = null;
    this._unsubscribers = [];

    this._attachHandlers();
  }

  _attachHandlers() {
    // Existing peers when joining
    this._unsubscribers.push(
      SessionManager.onPeers((peers) => {
        peers.forEach((p) => this._ensurePeer(p.id, p.name, p.color, p.isHost));
      })
    );
    
    // New peer joins
    this._unsubscribers.push(
      SessionManager.onJoin(({ id, name, color, isHost }) => {
        this._ensurePeer(id, name, color, isHost);
      })
    );
    
    // Peer leaves
    this._unsubscribers.push(
      SessionManager.onLeave(({ id }) => {
        this._removePeer(id);
      })
    );
    
    // Peer state updates
    this._unsubscribers.push(
      SessionManager.onState((msg) => {
        const { from, pos, rot, color, name } = msg;
        const peer = this._ensurePeer(from, name, color);
        if (peer && pos && rot) {
          peer.mesh.position.fromArray(pos);
          peer.mesh.quaternion.fromArray(rot);
        }
      })
    );
    
    // Session ended - clear all peers
    this._unsubscribers.push(
      SessionManager.onSessionEnded(() => {
        this._clearAllPeers();
      })
    );
  }

  _ensurePeer(id, name, colorHint, isHost = false) {
    if (this.peers.has(id)) {
      // Update existing peer's color if changed
      const peer = this.peers.get(id);
      if (colorHint && peer.color !== colorHint) {
        peer.color = colorHint;
        // Note: GhostAvatar doesn't support color changes after creation
        // Would need to recreate the avatar for color changes
      }
      return peer;
    }
    
    const color = colorHint ?? randomColor();
    const avatar = new GhostAvatar({ 
      baseColor: color,
      radius: 0.25, // Slightly larger for visibility
      splatCount: 400,
      opacity: 0.9,
    });
    const mesh = avatar.getObject();
    mesh.userData.name = name || id;
    mesh.userData.peerId = id;
    mesh.userData.isHost = isHost;
    this.scene.add(mesh);
    
    const entry = { mesh, color, avatar, name: name || id, isHost };
    this.peers.set(id, entry);
    
    console.log(`[Multiplayer] Added peer: ${name || id} (${isHost ? 'host' : 'viewer'})`);
    
    return entry;
  }

  _removePeer(id) {
    const entry = this.peers.get(id);
    if (!entry) return;
    
    console.log(`[Multiplayer] Removed peer: ${entry.name}`);
    
    this.scene.remove(entry.mesh);
    entry.avatar?.mesh?.dispose?.();
    this.peers.delete(id);
  }

  _clearAllPeers() {
    for (const id of [...this.peers.keys()]) {
      this._removePeer(id);
    }
  }

  /**
   * Join a world (legacy mode - no session required)
   * @param {string} worldUrl - World URL
   * @param {string} displayName - Player display name
   */
  joinWorld(worldUrl, displayName) {
    const resolved = this.worldResolver ? this.worldResolver(worldUrl) : worldUrl;
    this.localName = displayName;
    SessionManager.joinWorld(resolved, displayName, this.localColor);
  }

  /**
   * Set local player name and color
   */
  setLocalIdentity(name, color) {
    this.localName = name;
    if (color) this.localColor = color;
  }

  /**
   * Get local player color
   */
  getLocalColor() {
    return this.localColor;
  }

  /**
   * Get local player name
   */
  getLocalName() {
    return this.localName;
  }

  /**
   * Update - animate avatars and send state
   * @param {number} timeMs - Current time in milliseconds
   * @param {Array} positionArray - Local player position [x, y, z]
   * @param {Array} quaternionArray - Local player rotation [x, y, z, w]
   * @param {Object} meta - Additional metadata
   */
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
      // Send state if in a session or in a world (legacy mode)
      if (SessionManager.inSession()) {
        SessionManager.sendState(positionArray, quaternionArray, { 
          ...meta, 
          color: this.localColor,
          name: this.localName,
        });
      } else if (SessionManager.inWorld()) {
        // Legacy mode - send state without session
        SessionManager.sendStateLegacy(positionArray, quaternionArray, { 
          ...meta, 
          color: this.localColor,
          name: this.localName,
        });
      }
    }
  }

  /**
   * Get all peer entries
   */
  getPeers() {
    return this.peers;
  }

  /**
   * Get peer count
   */
  getPeerCount() {
    return this.peers.size;
  }

  /**
   * Dispose and cleanup
   */
  dispose() {
    for (const unsub of this._unsubscribers) {
      unsub();
    }
    this._unsubscribers = [];
    
    this._clearAllPeers();
  }
}
