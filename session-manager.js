/**
 * Session Manager
 * 
 * Handles multiplayer session creation, joining, and state synchronization.
 * Host creates a session with a code, viewers join with that code.
 */

// Session state
let ws = null;
let wsUrl = null;
let sessionCode = null;
let isHost = false;
let worldUrl = null;
let foundryUrl = null;
let hostInfo = null;
let viewers = [];
let maxViewers = 8;
let localName = null;
let localColor = null;
let reconnectTimer = null;
let shouldReconnect = true;

// Event listeners
const listeners = {
  onOpen: new Set(),
  onClose: new Set(),
  onSessionCreated: new Set(),
  onSessionJoined: new Set(),
  onSessionEnded: new Set(),
  onSessionInfo: new Set(),
  onSessionError: new Set(),
  onPeers: new Set(),
  onJoin: new Set(),
  onLeave: new Set(),
  onState: new Set(),
  onPlaybackSync: new Set(),
  onCharacterSync: new Set(),
  onFoundrySync: new Set(),
  onChat: new Set(),
};

/**
 * Initialize the session manager
 * @param {string} url - WebSocket server URL
 */
export function initSessionManager(url) {
  wsUrl = url || (import.meta.env?.VITE_WS_URL ?? "ws://localhost:8080");
  connect();
}

/**
 * Connect to WebSocket server
 */
function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    console.log('[SessionManager] Connected to server');
    emit('onOpen');
    
    // Rejoin session if we were in one
    if (sessionCode && isHost && worldUrl) {
      // Re-create session
      ws.send(JSON.stringify({
        type: 'create-session',
        worldUrl,
        foundryUrl,
        name: localName,
        color: localColor,
        maxViewers,
      }));
    } else if (sessionCode && !isHost) {
      // Rejoin as viewer
      ws.send(JSON.stringify({
        type: 'join-session',
        sessionCode,
        name: localName,
        color: localColor,
      }));
    }
  };
  
  ws.onclose = () => {
    console.log('[SessionManager] Disconnected');
    emit('onClose');
    
    if (shouldReconnect) {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 2000);
    }
  };
  
  ws.onerror = (err) => {
    console.error('[SessionManager] WebSocket error:', err);
  };
  
  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    
    handleMessage(msg);
  };
}

/**
 * Handle incoming messages
 */
function handleMessage(msg) {
  switch (msg.type) {
    case 'session-created':
      sessionCode = msg.sessionCode;
      worldUrl = msg.worldUrl;
      foundryUrl = msg.foundryUrl;
      maxViewers = msg.maxViewers;
      isHost = true;
      console.log(`[SessionManager] Created session: ${sessionCode}`);
      emit('onSessionCreated', msg);
      break;
      
    case 'session-joined':
      sessionCode = msg.sessionCode;
      worldUrl = msg.worldUrl;
      foundryUrl = msg.foundryUrl;
      isHost = false;
      console.log(`[SessionManager] Joined session: ${sessionCode}`);
      emit('onSessionJoined', msg);
      break;
      
    case 'session-ended':
      console.log(`[SessionManager] Session ended: ${msg.reason}`);
      const endedCode = sessionCode;
      sessionCode = null;
      isHost = false;
      emit('onSessionEnded', { ...msg, sessionCode: endedCode });
      break;
      
    case 'session-info':
      hostInfo = msg.host;
      viewers = msg.viewers;
      maxViewers = msg.maxViewers;
      emit('onSessionInfo', msg);
      break;
      
    case 'session-error':
      console.error(`[SessionManager] Error: ${msg.error}`);
      emit('onSessionError', msg);
      break;
      
    case 'peers':
      emit('onPeers', msg.peers);
      break;
      
    case 'join':
      emit('onJoin', msg);
      break;
      
    case 'leave':
      emit('onLeave', msg);
      break;
      
    case 'state':
      emit('onState', msg);
      break;
      
    case 'playback-sync':
      emit('onPlaybackSync', msg);
      break;
      
    case 'character-sync':
      emit('onCharacterSync', msg);
      break;
    
    case 'foundry-sync':
      emit('onFoundrySync', msg);
      break;
      
    case 'chat':
      emit('onChat', msg);
      break;
  }
}

/**
 * Emit event to listeners
 */
function emit(event, data) {
  for (const fn of listeners[event] || []) {
    try {
      fn(data);
    } catch (e) {
      console.error(`[SessionManager] Error in ${event} listener:`, e);
    }
  }
}

// ============ PUBLIC API ============

/**
 * Join a world directly (legacy mode, no session required)
 * Players in the same world will see each other's avatars
 * @param {string} world - World URL
 * @param {string} name - Display name
 * @param {number} color - Avatar color
 */
export function joinWorld(world, name, color) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error('[SessionManager] Not connected');
    return false;
  }
  
  localName = name;
  localColor = color;
  worldUrl = world;
  
  ws.send(JSON.stringify({
    type: 'join',
    world,
    name,
    color,
  }));
  
  console.log(`[SessionManager] Joined world: ${world}`);
  return true;
}

/**
 * Send state in legacy mode (no session)
 */
export function sendStateLegacy(pos, rot, meta) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !worldUrl) return;
  
  ws.send(JSON.stringify({
    type: 'state',
    pos,
    rot,
    meta: { ...meta, color: localColor },
  }));
}

/**
 * Check if in a world (legacy or session)
 */
export function inWorld() {
  return !!worldUrl;
}

/**
 * Create a new session as host
 * @param {Object} options
 * @param {string} options.worldUrl - World URL
 * @param {string} options.foundryUrl - Foundry streaming URL (optional)
 * @param {string} options.name - Host display name
 * @param {number} options.color - Host color
 * @param {number} options.maxViewers - Max viewers (default 8)
 */
export function createSession({ worldUrl: world, foundryUrl: foundry, name, color, maxViewers: max }) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error('[SessionManager] Not connected');
    return false;
  }
  
  localName = name;
  localColor = color;
  worldUrl = world;
  foundryUrl = foundry;
  maxViewers = max || 8;
  
  ws.send(JSON.stringify({
    type: 'create-session',
    worldUrl: world,
    foundryUrl: foundry,
    name,
    color,
    maxViewers,
  }));
  
  return true;
}

/**
 * Join an existing session as viewer
 * @param {Object} options
 * @param {string} options.sessionCode - Session code to join
 * @param {string} options.name - Viewer display name
 * @param {number} options.color - Viewer color
 */
export function joinSession({ sessionCode: code, name, color }) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error('[SessionManager] Not connected');
    return false;
  }
  
  localName = name;
  localColor = color;
  sessionCode = code?.toUpperCase();
  
  ws.send(JSON.stringify({
    type: 'join-session',
    sessionCode,
    name,
    color,
  }));
  
  return true;
}

/**
 * Leave the current session
 */
export function leaveSession() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  
  ws.send(JSON.stringify({ type: 'leave-session' }));
  sessionCode = null;
  isHost = false;
  hostInfo = null;
  viewers = [];
}

/**
 * Send player state (position, rotation)
 */
export function sendState(pos, rot, meta) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !sessionCode) return;
  
  ws.send(JSON.stringify({
    type: 'state',
    pos,
    rot,
    meta: { ...meta, color: localColor },
  }));
}

/**
 * Send playback sync (host only)
 */
export function sendPlaybackSync(isPaused, timestamp) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !isHost) return;
  
  ws.send(JSON.stringify({
    type: 'playback-sync',
    isPaused,
    timestamp,
  }));
}

/**
 * Send character/AI sync (host only)
 * @param {Array} characters - Array of { id, position, rotation, animation, comment }
 */
export function sendCharacterSync(characters) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !isHost) return;
  
  ws.send(JSON.stringify({
    type: 'character-sync',
    characters,
  }));
}

/**
 * Send Foundry connection sync (host only)
 * @param {boolean} isConnected - Whether Foundry is connected
 * @param {string} foundryUrlToShare - Foundry URL for viewers to connect to
 */
export function sendFoundrySync(isConnected, foundryUrlToShare = null) {
  console.log(`[SessionManager] sendFoundrySync called: isConnected=${isConnected}, ws=${!!ws}, wsReady=${ws?.readyState === WebSocket.OPEN}, isHost=${isHost}`);
  
  if (!ws || ws.readyState !== WebSocket.OPEN || !isHost) {
    console.warn(`[SessionManager] sendFoundrySync aborted: ws=${!!ws}, wsReady=${ws?.readyState === WebSocket.OPEN}, isHost=${isHost}`);
    return;
  }
  
  const msg = {
    type: 'foundry-sync',
    isConnected,
    foundryUrl: foundryUrlToShare,
  };
  console.log(`[SessionManager] Sending foundry-sync:`, msg);
  ws.send(JSON.stringify(msg));
}

/**
 * Send chat message
 */
export function sendChat(message) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  
  ws.send(JSON.stringify({
    type: 'chat',
    message,
  }));
}

/**
 * Disconnect and cleanup
 */
export function disconnect() {
  shouldReconnect = false;
  clearTimeout(reconnectTimer);
  if (ws) {
    ws.close();
    ws = null;
  }
  sessionCode = null;
  isHost = false;
}

// ============ EVENT SUBSCRIPTION ============

export function onOpen(fn) { listeners.onOpen.add(fn); return () => listeners.onOpen.delete(fn); }
export function onClose(fn) { listeners.onClose.add(fn); return () => listeners.onClose.delete(fn); }
export function onSessionCreated(fn) { listeners.onSessionCreated.add(fn); return () => listeners.onSessionCreated.delete(fn); }
export function onSessionJoined(fn) { listeners.onSessionJoined.add(fn); return () => listeners.onSessionJoined.delete(fn); }
export function onSessionEnded(fn) { listeners.onSessionEnded.add(fn); return () => listeners.onSessionEnded.delete(fn); }
export function onSessionInfo(fn) { listeners.onSessionInfo.add(fn); return () => listeners.onSessionInfo.delete(fn); }
export function onSessionError(fn) { listeners.onSessionError.add(fn); return () => listeners.onSessionError.delete(fn); }
export function onPeers(fn) { listeners.onPeers.add(fn); return () => listeners.onPeers.delete(fn); }
export function onJoin(fn) { listeners.onJoin.add(fn); return () => listeners.onJoin.delete(fn); }
export function onLeave(fn) { listeners.onLeave.add(fn); return () => listeners.onLeave.delete(fn); }
export function onState(fn) { listeners.onState.add(fn); return () => listeners.onState.delete(fn); }
export function onPlaybackSync(fn) { listeners.onPlaybackSync.add(fn); return () => listeners.onPlaybackSync.delete(fn); }
export function onCharacterSync(fn) { listeners.onCharacterSync.add(fn); return () => listeners.onCharacterSync.delete(fn); }
export function onFoundrySync(fn) { listeners.onFoundrySync.add(fn); return () => listeners.onFoundrySync.delete(fn); }
export function onChat(fn) { listeners.onChat.add(fn); return () => listeners.onChat.delete(fn); }

// ============ GETTERS ============

export function getSessionCode() { return sessionCode; }
export function isHosting() { return isHost; }
export function inSession() { return !!sessionCode; }
export function getWorldUrl() { return worldUrl; }
export function getFoundryUrl() { return foundryUrl; }
export function getHostInfo() { return hostInfo; }
export function getViewers() { return viewers; }
export function getMaxViewers() { return maxViewers; }
export function getLocalName() { return localName; }
export function getLocalColor() { return localColor; }
export function isConnected() { return ws && ws.readyState === WebSocket.OPEN; }
