// Simple per-world WebSocket relay server
// Usage:
//   npm install ws
//   PORT=8080 node tools/ws-server.js

import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 8080;
const PING_INTERVAL_MS = 30_000;
const ROOM_TIMEOUT_MS = 10 * 60_000; // cleanup delay after empty

// worldId -> Map<clientId, ws>
const rooms = new Map();
let nextClientId = 1;

const wss = new WebSocketServer({ port: PORT });
console.log(`WS server listening on :${PORT}`);

wss.on("connection", (ws) => {
  const clientId = String(nextClientId++);
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

    // Join a world/room
    if (msg.type === "join" && msg.world) {
      ws.world = msg.world;
      ws.name = msg.name || `user-${clientId}`;
      ws.color = msg.color ?? null;
      joinRoom(ws, msg.world, clientId);
      return;
    }

    // Broadcast state to peers
    if (msg.type === "state" && ws.world) {
      // Update color if provided in meta
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
  });

  ws.on("close", () => {
    if (ws.world) leaveRoom(ws.world, clientId);
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

function joinRoom(ws, world, clientId) {
  if (!rooms.has(world)) rooms.set(world, new Map());
  const room = rooms.get(world);
  room.set(clientId, ws);

  // send current peers to new client (with their colors)
  const peers = [...room.entries()]
    .filter(([id]) => id !== clientId)
    .map(([id, client]) => ({ id, name: client.name, color: client.color }));
  ws.send(JSON.stringify({ type: "peers", peers }));

  // notify others of join
  broadcast(world, { type: "join", id: clientId, name: ws.name, color: ws.color }, ws);
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

