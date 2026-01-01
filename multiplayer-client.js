// Tiny WebSocket client helper with optional reconnect
export function createProtoverseWs(url, { reconnect = true } = {}) {
  let ws;
  let joinedWorld = null;
  let name = null;
  let color = null;
  let reconnectTimeout = null;
  let shouldReconnect = reconnect;

  const listeners = {
    onOpen: () => {},
    onClose: () => {},
    onPeers: () => {},
    onJoin: () => {},
    onLeave: () => {},
    onState: () => {},
    onError: () => {},
  };

  function connect() {
    ws = new WebSocket(url);

    ws.onopen = () => {
      if (joinedWorld) {
        ws.send(JSON.stringify({ type: "join", world: joinedWorld, name, color }));
      }
      listeners.onOpen();
    };

    ws.onclose = () => {
      listeners.onClose();
      if (shouldReconnect) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(connect, 1000);
      }
    };

    ws.onerror = (err) => listeners.onError(err);

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case "peers":
          listeners.onPeers(msg.peers || []);
          break;
        case "join":
          listeners.onJoin(msg);
          break;
        case "leave":
          listeners.onLeave(msg);
          break;
        case "state":
          listeners.onState(msg);
          break;
        default:
          break;
      }
    };
  }

  connect();

  return {
    join(world, displayName, displayColor) {
      joinedWorld = world;
      name = displayName || name;
      color = displayColor || color;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "join", world, name, color }));
      }
    },
    sendState(pos, rot, meta) {
      if (!joinedWorld || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "state", pos, rot, meta }));
    },
    close() {
      shouldReconnect = false;
      clearTimeout(reconnectTimeout);
      ws?.close();
    },
    // Event hooks
    set onOpen(fn) { listeners.onOpen = fn; },
    set onClose(fn) { listeners.onClose = fn; },
    set onPeers(fn) { listeners.onPeers = fn; },
    set onJoin(fn) { listeners.onJoin = fn; },
    set onLeave(fn) { listeners.onLeave = fn; },
    set onState(fn) { listeners.onState = fn; },
    set onError(fn) { listeners.onError = fn; },
  };
}

