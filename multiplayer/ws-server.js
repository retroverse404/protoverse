// Protoverse WebSocket relay server with session management
// Usage:
//   npm install ws
//   PORT=8080 node multiplayer/ws-server.js
//
// Environment variables:
//   CONVEX_HTTP_URL - Convex HTTP endpoint for session tracking (optional)
//   FLY_APP_NAME - Name of this Fly.io app (optional, auto-detected)
//   WS_PUBLIC_URL - Public WebSocket URL (optional)
//   FOUNDRY_PUBLIC_URL - Public Foundry URL (optional)

import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 8080;
const PING_INTERVAL_MS = 30_000;
const ROOM_TIMEOUT_MS = 10 * 60_000; // cleanup delay after empty
const SESSION_TIMEOUT_MS = 30 * 60_000; // sessions expire after 30min of no host
const MAX_VIEWERS_DEFAULT = 8;
const CONVEX_HEARTBEAT_MS = 30_000; // Heartbeat to Convex every 30s

// Convex configuration (optional - for session lobby)
const CONVEX_HTTP_URL = process.env.CONVEX_HTTP_URL || null;
const FLY_APP_NAME = process.env.FLY_APP_NAME || process.env.FLY_APP || 'unknown';
const WS_PUBLIC_URL = process.env.WS_PUBLIC_URL || `wss://${FLY_APP_NAME}.fly.dev:8765`;
const FOUNDRY_PUBLIC_URL = process.env.FOUNDRY_PUBLIC_URL || `wss://${FLY_APP_NAME}.fly.dev/ws`;

// Convex heartbeat timer
let convexHeartbeatInterval = null;

// worldId -> Map<clientId, ws>
const rooms = new Map();

// sessionCode -> { worldUrl, hostClientId, foundryUrl, maxViewers, createdAt }
const sessions = new Map();

let nextClientId = 1;

// ============ CONVEX SESSION TRACKING ============

/**
 * Report session to Convex (register, heartbeat, or end)
 */
async function convexRequest(endpoint, data) {
  if (!CONVEX_HTTP_URL) return null;
  
  try {
    const url = `${CONVEX_HTTP_URL}${endpoint}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    
    if (!response.ok) {
      console.warn(`[Convex] ${endpoint} failed:`, response.status);
      return null;
    }
    
    return await response.json();
  } catch (error) {
    console.warn(`[Convex] ${endpoint} error:`, error.message);
    return null;
  }
}

/**
 * Register a session with Convex
 */
async function convexRegisterSession(session, code) {
  if (!CONVEX_HTTP_URL) return;
  
  console.log(`[Convex] Registering session ${code}`);
  await convexRequest('/session/register', {
    code,
    hostName: session.hostName,
    hostClientId: session.hostClientId,
    movieTitle: session.movieTitle || 'Watch Party',
    worldUrl: session.worldUrl,
    flyApp: FLY_APP_NAME,
    wsUrl: WS_PUBLIC_URL,
    foundryUrl: session.foundryUrl || FOUNDRY_PUBLIC_URL,
    maxViewers: session.maxViewers,
  });
}

/**
 * Send heartbeat to Convex for all active sessions
 */
async function convexHeartbeat() {
  if (!CONVEX_HTTP_URL || sessions.size === 0) return;
  
  for (const [code, session] of sessions) {
    const room = rooms.get(session.worldUrl);
    const viewerCount = room ? Math.max(0, room.size - 1) : 0;
    
    await convexRequest('/session/heartbeat', {
      code,
      viewerCount,
      isMoviePlaying: session.isMoviePlaying || false,
    });
  }
}

/**
 * End a session in Convex
 */
async function convexEndSession(code) {
  if (!CONVEX_HTTP_URL) return;
  
  console.log(`[Convex] Ending session ${code}`);
  await convexRequest('/session/end', { code });
}

/**
 * Start Convex heartbeat interval
 */
function startConvexHeartbeat() {
  if (!CONVEX_HTTP_URL) return;
  
  if (convexHeartbeatInterval) {
    clearInterval(convexHeartbeatInterval);
  }
  
  console.log(`[Convex] Starting heartbeat to ${CONVEX_HTTP_URL}`);
  convexHeartbeatInterval = setInterval(convexHeartbeat, CONVEX_HEARTBEAT_MS);
}

// Start heartbeat when server starts
if (CONVEX_HTTP_URL) {
  console.log(`[Convex] Session tracking enabled: ${CONVEX_HTTP_URL}`);
  startConvexHeartbeat();
} else {
  console.log('[Convex] Session tracking disabled (no CONVEX_HTTP_URL)');
}

const wss = new WebSocketServer({ host: '0.0.0.0', port: PORT });
console.log(`WS server listening on 0.0.0.0:${PORT} (all interfaces)`);

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

wss.on("connection", (ws, req) => {
  const clientId = String(nextClientId++);
  ws.clientId = clientId;
  ws.isAlive = true;
  
  // Log connection with origin info for debugging
  const origin = req.headers.origin || 'unknown';
  const ip = req.socket.remoteAddress;
  console.log(`[WS] Client ${clientId} connected from ${ip} (origin: ${origin})`);
  console.log(`[WS] Active sessions: ${[...sessions.keys()].join(', ') || '(none)'}`);

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

    // ============ DEBUG ============
    
    // Debug: list active sessions
    if (msg.type === "debug-sessions") {
      const sessionList = [...sessions.entries()].map(([code, s]) => ({
        code,
        hostClientId: s.hostClientId,
        worldUrl: s.worldUrl,
        createdAt: s.createdAt,
        age: Math.round((Date.now() - s.createdAt) / 1000) + 's'
      }));
      ws.send(JSON.stringify({
        type: "debug-sessions-response",
        sessions: sessionList,
        totalSessions: sessions.size
      }));
      console.log(`[Debug] Sessions requested by client ${clientId}:`, sessionList);
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
      console.log(`[Session] Active sessions after create: ${[...sessions.keys()].join(', ')}`);
      
      // Register with Convex for lobby discovery
      convexRegisterSession(session, sessionCode);
      
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
      const upperCode = sessionCode?.toUpperCase();
      
      console.log(`[Session] Join attempt: code="${upperCode}" (original: "${sessionCode}")`);
      console.log(`[Session] Active sessions: ${[...sessions.keys()].join(', ') || '(none)'}`);
      
      const session = sessions.get(upperCode);
      
      if (!session) {
        console.log(`[Session] Session not found: "${upperCode}"`);
        ws.send(JSON.stringify({ 
          type: "session-error", 
          error: `Session not found: ${upperCode}` 
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
      
      // Request full state from host so the new viewer sees current positions
      // (reuse 'room' variable from above - it was updated by joinRoom)
      const updatedRoom = rooms.get(session.worldUrl);
      if (updatedRoom) {
        for (const [, client] of updatedRoom) {
          if (client.sessionCode === ws.sessionCode && client.isHost && client.readyState === 1) {
            client.send(JSON.stringify({
              type: "request-full-state",
              viewerId: clientId,
              viewerName: ws.name,
            }));
            console.log(`[Session] Requested full state from host for new viewer ${ws.name}`);
            break;
          }
        }
      }
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

    // Player position/rotation state - SESSION SCOPED
    if (msg.type === "state" && ws.world) {
      if (msg.meta?.color) ws.color = msg.meta.color;
      
      // Only broadcast to session members (session-scoped visibility)
      if (ws.sessionCode) {
        broadcastToSession(ws.sessionCode, {
          type: "state",
          from: clientId,
          name: ws.name,
          color: ws.color,
          pos: msg.pos,
          rot: msg.rot,
          meta: msg.meta,
          t: Date.now(),
        }, ws);
      }
      // Legacy mode (no session) - no broadcasting to prevent confusion
      return;
    }

    // Playback sync (host only) - session scoped
    if (msg.type === "playback-sync" && ws.isHost && ws.sessionCode) {
      broadcastToSession(ws.sessionCode, {
        type: "playback-sync",
        isPaused: msg.isPaused,
        timestamp: msg.timestamp,
        from: clientId,
        t: Date.now(),
      }, ws);
      return;
    }

    // Foundry connection sync (host only) - session scoped
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
      
      broadcastToSession(ws.sessionCode, {
        type: "foundry-sync",
        isConnected: msg.isConnected,
        foundryUrl: msg.foundryUrl,
        hostName: ws.name,
        from: clientId,
        t: Date.now(),
      }, ws);
      return;
    }

    // Character/AI sync (host only) - session scoped
    if (msg.type === "character-sync" && ws.isHost && ws.sessionCode) {
      broadcastToSession(ws.sessionCode, {
        type: "character-sync",
        characters: msg.characters, // Array of { id, position, rotation, animation, comment }
        from: clientId,
        t: Date.now(),
      }, ws);
      return;
    }

    // ============ CHAT ============

    // Chat is session-scoped - only session members see messages
    if (msg.type === "chat" && ws.sessionCode) {
      const chatMsg = {
        type: "chat",
        from: clientId,
        name: ws.name,
        color: ws.color,
        message: msg.message?.slice(0, 500), // Limit message length
        t: Date.now(),
      };
      
      // Send to all session members INCLUDING sender
      const session = sessions.get(ws.sessionCode);
      if (session) {
        const room = rooms.get(session.worldUrl);
        if (room) {
          const payload = JSON.stringify(chatMsg);
          for (const [, client] of room) {
            if (client.sessionCode === ws.sessionCode && client.readyState === 1) {
              client.send(payload);
            }
          }
        }
      }
      return;
    }
  });

  ws.on("close", () => {
    if (ws.sessionCode) {
      leaveSession(ws, clientId);
    } else if (ws.world) {
      // No session - just leave the room quietly (no one to notify)
      leaveRoom(ws.world, clientId, null);
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
      
      // Remove from Convex
      convexEndSession(code);
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

  // Only send peers who are in the SAME SESSION (session-scoped visibility)
  const peers = [...room.entries()]
    .filter(([id, client]) => {
      if (id === clientId) return false; // exclude self
      // Only include peers in the same session
      return ws.sessionCode && client.sessionCode === ws.sessionCode;
    })
    .map(([id, client]) => ({ 
      id, 
      name: client.name, 
      color: client.color,
      isHost: client.isHost || false,
    }));
  ws.send(JSON.stringify({ type: "peers", peers }));

  // Notify only session members of join (session-scoped)
  if (ws.sessionCode) {
    broadcastToSession(ws.sessionCode, { 
      type: "join", 
      id: clientId, 
      name: ws.name, 
      color: ws.color,
      isHost: ws.isHost || false,
    }, ws);
  }
}

function leaveRoom(world, clientId, sessionCode = null) {
  const room = rooms.get(world);
  if (!room) return;
  
  room.delete(clientId);
  
  // Only notify session members of the leave (session-scoped)
  if (sessionCode) {
    broadcastToSession(sessionCode, { type: "leave", id: clientId });
  }
  
  if (room.size === 0) {
    setTimeout(() => {
      if (room.size === 0) rooms.delete(world);
    }, ROOM_TIMEOUT_MS);
  }
}

function leaveSession(ws, clientId) {
  const sessionCode = ws.sessionCode;
  const session = sessions.get(sessionCode);
  const worldUrl = ws.world;
  
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
    
    // Remove from Convex
    convexEndSession(sessionCode);
    sessions.delete(sessionCode);
  } else if (sessionCode) {
    // Viewer leaving - notify session members
    broadcastToSession(sessionCode, { type: "leave", id: clientId }, ws);
  }
  
  ws.sessionCode = null;
  ws.isHost = false;
  
  if (worldUrl) {
    // Pass sessionCode so leaveRoom knows which session to notify
    // (but since we already notified above, pass null to avoid double-notify)
    leaveRoom(worldUrl, clientId, null);
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

/**
 * Broadcast to only clients in a specific session
 */
function broadcastToSession(sessionCode, msg, except) {
  const session = sessions.get(sessionCode);
  if (!session) return;
  
  const room = rooms.get(session.worldUrl);
  if (!room) return;
  
  const payload = JSON.stringify(msg);
  for (const [, client] of room) {
    if (client !== except && 
        client.sessionCode === sessionCode && 
        client.readyState === 1) {
      client.send(payload);
    }
  }
}
