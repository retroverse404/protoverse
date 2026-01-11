// Protoverse WebSocket relay server with session management
// Usage:
//   npm install ws
//   PORT=8080 node tools/ws-server.js

import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 8080;
const PING_INTERVAL_MS = 30_000;
const ROOM_TIMEOUT_MS = 10 * 60_000; // cleanup delay after empty
const SESSION_TIMEOUT_MS = 30 * 60_000; // sessions expire after 30min of no host
const MAX_VIEWERS_DEFAULT = 8;

// worldId -> Map<clientId, ws>
const rooms = new Map();

// sessionCode -> { worldUrl, hostClientId, foundryUrl, maxViewers, createdAt }
const sessions = new Map();

let nextClientId = 1;

const wss = new WebSocketServer({ port: PORT });
console.log(`WS server listening on :${PORT}`);

// Generate a random 6-character session code
function generateSessionCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid confusing chars: I, O, 0, 1
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  // Ensure uniqueness
  if (sessions.has(code)) return generateSessionCode();
  return code;
}

wss.on("connection", (ws) => {
  const clientId = String(nextClientId++);
  ws.clientId = clientId;
  ws.isAlive = true;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    // ============ SESSION MANAGEMENT ============

    // Host creates a new session
    if (msg.type === "create-session") {
      const { worldUrl, foundryUrl, name, color, maxViewers } = msg;
      
      // Check if already hosting
      for (const [code, session] of sessions) {
        if (session.hostClientId === clientId) {
          ws.send(JSON.stringify({ 
            type: "session-error", 
            error: "Already hosting a session",
            existingCode: code
          }));
          return;
        }
      }
      
      const sessionCode = generateSessionCode();
      const session = {
        worldUrl,
        hostClientId: clientId,
        hostName: name || `Host-${clientId}`,
        foundryUrl: foundryUrl || null,
        maxViewers: maxViewers || MAX_VIEWERS_DEFAULT,
        createdAt: Date.now(),
        isMoviePlaying: false, // Track whether host has started the movie
      };
      
      sessions.set(sessionCode, session);
      ws.sessionCode = sessionCode;
      ws.isHost = true;
      ws.world = worldUrl;
      ws.name = session.hostName;
      ws.color = color ?? 0x00d4ff;
      
      // Join the world room
      joinRoom(ws, worldUrl, clientId);
      
      console.log(`[Session] Created ${sessionCode} for world ${worldUrl} by ${session.hostName}`);
      
      ws.send(JSON.stringify({
        type: "session-created",
        sessionCode,
        worldUrl,
        foundryUrl: session.foundryUrl,
        maxViewers: session.maxViewers,
      }));
      
      // Broadcast session info to room
      broadcastSessionInfo(sessionCode);
      return;
    }

    // Viewer joins an existing session
    if (msg.type === "join-session") {
      const { sessionCode, name, color } = msg;
      const session = sessions.get(sessionCode?.toUpperCase());
      
      if (!session) {
        ws.send(JSON.stringify({ 
          type: "session-error", 
          error: "Session not found" 
        }));
        return;
      }
      
      // Count current viewers (excluding host)
      const room = rooms.get(session.worldUrl);
      const viewerCount = room ? room.size - 1 : 0;
      
      if (viewerCount >= session.maxViewers) {
        ws.send(JSON.stringify({ 
          type: "session-error", 
          error: "Session is full" 
        }));
        return;
      }
      
      ws.sessionCode = sessionCode.toUpperCase();
      ws.isHost = false;
      ws.world = session.worldUrl;
      ws.name = name || `Viewer-${clientId}`;
      ws.color = color ?? randomColor();
      
      // Join the world room
      joinRoom(ws, session.worldUrl, clientId);
      
      console.log(`[Session] ${ws.name} joined session ${sessionCode}`);
      console.log(`[Session] Session state at join: isMoviePlaying=${session.isMoviePlaying}, foundryUrl=${session.foundryUrl}`);
      
      ws.send(JSON.stringify({
        type: "session-joined",
        sessionCode: ws.sessionCode,
        worldUrl: session.worldUrl,
        foundryUrl: session.foundryUrl,
        hostName: session.hostName,
        isHost: false,
        isMoviePlaying: session.isMoviePlaying, // Tell late joiners if movie is already playing
      }));
      
      // Broadcast updated session info
      broadcastSessionInfo(ws.sessionCode);
      return;
    }

    // Leave session (explicit)
    if (msg.type === "leave-session") {
      if (ws.sessionCode) {
        leaveSession(ws, clientId);
      }
      return;
    }

    // ============ LEGACY: Direct world join (no session) ============

    if (msg.type === "join" && msg.world) {
      ws.world = msg.world;
      ws.name = msg.name || `user-${clientId}`;
      ws.color = msg.color ?? null;
      joinRoom(ws, msg.world, clientId);
      return;
    }

    // ============ STATE SYNC ============

    // Player position/rotation state
    if (msg.type === "state" && ws.world) {
      if (msg.meta?.color) ws.color = msg.meta.color;
      broadcast(ws.world, {
        type: "state",
        from: clientId,
        name: ws.name,
        color: ws.color,
        pos: msg.pos,
        rot: msg.rot,
        meta: msg.meta,
        t: Date.now(),
      }, ws);
      return;
    }

    // Playback sync (host only)
    if (msg.type === "playback-sync" && ws.isHost && ws.sessionCode) {
      const session = sessions.get(ws.sessionCode);
      if (session) {
        broadcast(ws.world, {
          type: "playback-sync",
          isPaused: msg.isPaused,
          timestamp: msg.timestamp,
          from: clientId,
          t: Date.now(),
        }, ws);
      }
      return;
    }

    // Foundry connection sync (host only)
    if (msg.type === "foundry-sync") {
      console.log(`[Session] Received foundry-sync: isHost=${ws.isHost}, sessionCode=${ws.sessionCode}, isConnected=${msg.isConnected}`);
      
      if (!ws.isHost || !ws.sessionCode) {
        console.warn(`[Session] Ignoring foundry-sync: isHost=${ws.isHost}, sessionCode=${ws.sessionCode}`);
        return;
      }
      
      // Update session state so late joiners know the movie status
      const session = sessions.get(ws.sessionCode);
      if (session) {
        session.isMoviePlaying = msg.isConnected;
        console.log(`[Session] ${ws.sessionCode} movie status updated: isMoviePlaying=${msg.isConnected}`);
      } else {
        console.warn(`[Session] Session not found for code: ${ws.sessionCode}`);
      }
      
      broadcast(ws.world, {
        type: "foundry-sync",
        isConnected: msg.isConnected,
        foundryUrl: msg.foundryUrl,
        hostName: ws.name,
        from: clientId,
        t: Date.now(),
      }, ws);
      return;
    }

    // Character/AI sync (host only)
    if (msg.type === "character-sync" && ws.isHost && ws.sessionCode) {
      broadcast(ws.world, {
        type: "character-sync",
        characters: msg.characters, // Array of { id, position, rotation, animation, comment }
        from: clientId,
        t: Date.now(),
      }, ws);
      return;
    }

    // ============ CHAT ============

    if (msg.type === "chat" && ws.world) {
      broadcast(ws.world, {
        type: "chat",
        from: clientId,
        name: ws.name,
        color: ws.color,
        message: msg.message?.slice(0, 500), // Limit message length
        t: Date.now(),
      }); // Include sender so they see their own message
      return;
    }
  });

  ws.on("close", () => {
    if (ws.sessionCode) {
      leaveSession(ws, clientId);
    } else if (ws.world) {
      leaveRoom(ws.world, clientId);
    }
  });
});

// Heartbeat to drop dead connections
setInterval(() => {
  for (const client of wss.clients) {
    if (!client.isAlive) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, PING_INTERVAL_MS);

// Clean up expired sessions
setInterval(() => {
  const now = Date.now();
  for (const [code, session] of sessions) {
    const room = rooms.get(session.worldUrl);
    const hostPresent = room && [...room.values()].some(ws => ws.clientId === session.hostClientId);
    
    if (!hostPresent && (now - session.createdAt) > SESSION_TIMEOUT_MS) {
      console.log(`[Session] Cleaning up expired session ${code}`);
      
      // Notify remaining viewers
      if (room) {
        for (const [, client] of room) {
          if (client.sessionCode === code) {
            client.send(JSON.stringify({ 
              type: "session-ended", 
              reason: "Host disconnected" 
            }));
          }
        }
      }
      
      sessions.delete(code);
    }
  }
}, 60_000); // Check every minute

function randomColor() {
  const colors = [0x00d4ff, 0x22c55e, 0xf59e0b, 0xef4444, 0xa855f7, 0x06b6d4, 0xec4899];
  return colors[Math.floor(Math.random() * colors.length)];
}

function joinRoom(ws, world, clientId) {
  if (!rooms.has(world)) rooms.set(world, new Map());
  const room = rooms.get(world);
  room.set(clientId, ws);

  // Send current peers to new client
  const peers = [...room.entries()]
    .filter(([id]) => id !== clientId)
    .map(([id, client]) => ({ 
      id, 
      name: client.name, 
      color: client.color,
      isHost: client.isHost || false,
    }));
  ws.send(JSON.stringify({ type: "peers", peers }));

  // Notify others of join
  broadcast(world, { 
    type: "join", 
    id: clientId, 
    name: ws.name, 
    color: ws.color,
    isHost: ws.isHost || false,
  }, ws);
}

function leaveRoom(world, clientId) {
  const room = rooms.get(world);
  if (!room) return;
  room.delete(clientId);
  broadcast(world, { type: "leave", id: clientId });
  if (room.size === 0) {
    setTimeout(() => {
      if (room.size === 0) rooms.delete(world);
    }, ROOM_TIMEOUT_MS);
  }
}

function leaveSession(ws, clientId) {
  const sessionCode = ws.sessionCode;
  const session = sessions.get(sessionCode);
  
  if (session && ws.isHost) {
    // Host leaving ends the session
    console.log(`[Session] Host left, ending session ${sessionCode}`);
    
    // Notify all viewers
    const room = rooms.get(session.worldUrl);
    if (room) {
      for (const [, client] of room) {
        if (client.sessionCode === sessionCode && client !== ws) {
          client.send(JSON.stringify({ 
            type: "session-ended", 
            reason: "Host left the session" 
          }));
          client.sessionCode = null;
          client.isHost = false;
        }
      }
    }
    
    sessions.delete(sessionCode);
  }
  
  ws.sessionCode = null;
  ws.isHost = false;
  
  if (ws.world) {
    leaveRoom(ws.world, clientId);
  }
  
  // Broadcast updated session info if session still exists
  if (session && sessions.has(sessionCode)) {
    broadcastSessionInfo(sessionCode);
  }
}

function broadcastSessionInfo(sessionCode) {
  const session = sessions.get(sessionCode);
  if (!session) return;
  
  const room = rooms.get(session.worldUrl);
  if (!room) return;
  
  // Gather viewer info
  const viewers = [];
  let hostInfo = null;
  
  for (const [id, client] of room) {
    if (client.sessionCode === sessionCode) {
      const info = { id, name: client.name, color: client.color };
      if (client.isHost) {
        hostInfo = info;
      } else {
        viewers.push(info);
      }
    }
  }
  
  const payload = JSON.stringify({
    type: "session-info",
    sessionCode,
    host: hostInfo,
    viewers,
    viewerCount: viewers.length,
    maxViewers: session.maxViewers,
    foundryUrl: session.foundryUrl,
  });
  
  // Send to all session participants
  for (const [, client] of room) {
    if (client.sessionCode === sessionCode && client.readyState === 1) {
      client.send(payload);
    }
  }
}

function broadcast(world, msg, except) {
  const room = rooms.get(world);
  if (!room) return;
  const payload = JSON.stringify(msg);
  for (const [, client] of room) {
    if (client !== except && client.readyState === 1) {
      client.send(payload);
    }
  }
}
