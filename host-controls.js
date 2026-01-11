/**
 * Host Controls
 * 
 * UI for creating and managing multiplayer sessions.
 * Only available on desktop (not VR).
 */

import * as SessionManager from './session-manager.js';
import { addLogMessage } from './multiplayer-panel.js';

let controlsContainer = null;
let isInitialized = false;
let currentWorldUrl = null;
let currentFoundryUrl = null;
let unsubscribers = [];

/**
 * Initialize host controls
 * @param {Object} options
 * @param {string} options.worldUrl - Current world URL
 * @param {string} options.foundryUrl - Foundry streaming URL (optional)
 */
export function initHostControls({ worldUrl, foundryUrl } = {}) {
  currentWorldUrl = worldUrl;
  currentFoundryUrl = foundryUrl;
  
  if (isInitialized) {
    updateWorldInfo(worldUrl, foundryUrl);
    return;
  }
  
  isInitialized = true;
  createControls();
  attachEventListeners();
  
  // Check URL for session code
  checkUrlForSession();
}

/**
 * Update world info (when changing worlds)
 */
export function updateWorldInfo(worldUrl, foundryUrl) {
  currentWorldUrl = worldUrl;
  currentFoundryUrl = foundryUrl;
}

/**
 * Check URL for session code to join
 */
function checkUrlForSession() {
  const params = new URLSearchParams(window.location.search);
  const sessionCode = params.get('session');
  
  if (sessionCode) {
    console.log(`[HostControls] Found session code in URL: ${sessionCode}`);
    // Pre-fill the session code but don't auto-join - let user enter name first
    setTimeout(() => {
      const codeInput = document.getElementById('hc-join-code-input');
      if (codeInput) {
        codeInput.value = sessionCode;
      }
      // Hide create section, show join section prominently
      const createBtn = document.getElementById('hc-create-btn');
      if (createBtn) {
        createBtn.style.display = 'none';
      }
      const orDiv = document.querySelector('.hc-or');
      if (orDiv) {
        orDiv.style.display = 'none';
      }
    }, 100);
  }
}

/**
 * Get a default name for the player
 */
function getDefaultName() {
  const storedName = localStorage.getItem('protoverse-name');
  if (storedName) return storedName;
  
  const adjectives = ['Swift', 'Cosmic', 'Stellar', 'Quantum', 'Nebula', 'Solar', 'Lunar', 'Nova'];
  const nouns = ['Traveler', 'Explorer', 'Voyager', 'Pioneer', 'Wanderer', 'Seeker'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}${noun}`;
}

/**
 * Get random avatar color
 */
function getRandomColor() {
  const colors = [0x00d4ff, 0x22c55e, 0xf59e0b, 0xef4444, 0xa855f7, 0x06b6d4, 0xec4899];
  return colors[Math.floor(Math.random() * colors.length)];
}

/**
 * Create the controls DOM structure
 */
function createControls() {
  controlsContainer = document.createElement('div');
  controlsContainer.id = 'host-controls';
  controlsContainer.innerHTML = `
    <style>
      #host-controls {
        position: fixed;
        bottom: 10px;
        right: 10px;
        font-family: 'JetBrains Mono', 'SF Mono', 'Consolas', monospace;
        font-size: 12px;
        z-index: 1000;
        pointer-events: auto;
      }
      
      #host-controls * {
        box-sizing: border-box;
      }
      
      .hc-panel {
        background: linear-gradient(135deg, rgba(30, 30, 40, 0.95) 0%, rgba(20, 20, 30, 0.95) 100%);
        border: 1px solid rgba(100, 150, 255, 0.3);
        border-radius: 8px;
        padding: 12px;
        backdrop-filter: blur(10px);
        min-width: 200px;
      }
      
      .hc-title {
        color: #e0e0e0;
        font-weight: 500;
        margin-bottom: 10px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .hc-title-icon {
        font-size: 14px;
      }
      
      .hc-input-group {
        margin-bottom: 10px;
      }
      
      .hc-label {
        display: block;
        color: #888;
        font-size: 10px;
        margin-bottom: 4px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      
      .hc-input {
        width: 100%;
        background: rgba(30, 30, 45, 0.8);
        border: 1px solid rgba(100, 150, 255, 0.2);
        border-radius: 4px;
        padding: 8px 10px;
        color: #fff;
        font-family: inherit;
        font-size: 12px;
        outline: none;
        transition: border-color 0.2s;
      }
      
      .hc-input:focus {
        border-color: rgba(100, 150, 255, 0.5);
      }
      
      .hc-btn {
        width: 100%;
        padding: 10px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-family: inherit;
        font-size: 12px;
        font-weight: 500;
        transition: all 0.2s;
        margin-bottom: 6px;
      }
      
      .hc-btn:last-child {
        margin-bottom: 0;
      }
      
      .hc-btn-primary {
        background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
        color: white;
      }
      
      .hc-btn-primary:hover {
        background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
      }
      
      .hc-btn-secondary {
        background: rgba(60, 60, 80, 0.8);
        color: #ccc;
        border: 1px solid rgba(100, 150, 255, 0.2);
      }
      
      .hc-btn-secondary:hover {
        background: rgba(80, 80, 100, 0.8);
        border-color: rgba(100, 150, 255, 0.4);
      }
      
      .hc-btn-danger {
        background: rgba(239, 68, 68, 0.3);
        color: #f87171;
        border: 1px solid rgba(239, 68, 68, 0.3);
      }
      
      .hc-btn-danger:hover {
        background: rgba(239, 68, 68, 0.5);
      }
      
      .hc-session-active {
        text-align: center;
      }
      
      .hc-session-code {
        font-size: 24px;
        font-weight: bold;
        color: #3b82f6;
        letter-spacing: 4px;
        margin: 10px 0;
      }
      
      .hc-session-url {
        font-size: 10px;
        color: #666;
        word-break: break-all;
        background: rgba(0, 0, 0, 0.3);
        padding: 6px 8px;
        border-radius: 4px;
        margin-bottom: 10px;
      }
      
      .hc-copy-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        background: rgba(59, 130, 246, 0.2);
        border: 1px solid rgba(59, 130, 246, 0.3);
        border-radius: 4px;
        color: #60a5fa;
        font-size: 10px;
        cursor: pointer;
        transition: all 0.2s;
      }
      
      .hc-copy-btn:hover {
        background: rgba(59, 130, 246, 0.3);
      }
      
      .hc-copy-btn.copied {
        background: rgba(34, 197, 94, 0.2);
        border-color: rgba(34, 197, 94, 0.3);
        color: #22c55e;
      }
      
      .hc-divider {
        height: 1px;
        background: rgba(100, 150, 255, 0.15);
        margin: 10px 0;
      }
      
      .hc-or {
        text-align: center;
        color: #555;
        font-size: 10px;
        margin: 8px 0;
      }
      
      .hc-hidden {
        display: none;
      }
    </style>
    
    <div class="hc-panel" id="hc-panel-idle">
      <div class="hc-title">
        <span class="hc-title-icon">🎬</span>
        <span>Multiplayer</span>
      </div>
      
      <div class="hc-input-group">
        <label class="hc-label">Your Name</label>
        <input type="text" class="hc-input" id="hc-name-input" placeholder="Enter your name...">
      </div>
      
      <button class="hc-btn hc-btn-primary" id="hc-create-btn">
        Create Session
      </button>
      
      <div class="hc-or">— or —</div>
      
      <div class="hc-input-group">
        <label class="hc-label">Session Code</label>
        <input type="text" class="hc-input" id="hc-join-code-input" placeholder="XXXXXX" maxlength="6" style="text-transform: uppercase; letter-spacing: 2px; text-align: center;">
      </div>
      
      <button class="hc-btn hc-btn-secondary" id="hc-join-btn">
        Join Session
      </button>
    </div>
    
    <div class="hc-panel hc-hidden" id="hc-panel-hosting">
      <div class="hc-title">
        <span class="hc-title-icon">📡</span>
        <span>Hosting Session</span>
      </div>
      
      <div class="hc-session-active">
        <div class="hc-session-code" id="hc-active-code"></div>
        <div class="hc-session-url" id="hc-share-url"></div>
        <button class="hc-copy-btn" id="hc-copy-url-btn">
          📋 Copy Link
        </button>
      </div>
      
      <div class="hc-divider"></div>
      
      <button class="hc-btn hc-btn-danger" id="hc-end-session-btn">
        End Session
      </button>
    </div>
    
    <div class="hc-panel hc-hidden" id="hc-panel-viewing">
      <div class="hc-title">
        <span class="hc-title-icon">👁️</span>
        <span>Viewing Session</span>
      </div>
      
      <div class="hc-session-active">
        <div class="hc-session-code" id="hc-viewing-code"></div>
        <div style="color: #888; font-size: 11px; margin-bottom: 10px;">
          Host: <span id="hc-host-name">-</span>
        </div>
      </div>
      
      <button class="hc-btn hc-btn-danger" id="hc-leave-session-btn">
        Leave Session
      </button>
    </div>
  `;
  
  document.body.appendChild(controlsContainer);
  
  // Load saved name
  const savedName = localStorage.getItem('protoverse-name');
  if (savedName) {
    document.getElementById('hc-name-input').value = savedName;
  }
  
  // Save name on change
  document.getElementById('hc-name-input').addEventListener('change', (e) => {
    localStorage.setItem('protoverse-name', e.target.value);
  });
  
  // Create session
  document.getElementById('hc-create-btn').addEventListener('click', createSession);
  
  // Join session
  document.getElementById('hc-join-btn').addEventListener('click', () => {
    const code = document.getElementById('hc-join-code-input').value.trim();
    if (code.length !== 6) {
      alert('Please enter a 6-character session code');
      return;
    }
    joinSession(code);
  });
  
  // Join on Enter key
  document.getElementById('hc-join-code-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('hc-join-btn').click();
    }
  });
  
  // Copy URL
  document.getElementById('hc-copy-url-btn').addEventListener('click', copyShareUrl);
  
  // End session
  document.getElementById('hc-end-session-btn').addEventListener('click', () => {
    SessionManager.leaveSession();
    showIdlePanel();
  });
  
  // Leave session
  document.getElementById('hc-leave-session-btn').addEventListener('click', () => {
    SessionManager.leaveSession();
    showIdlePanel();
    // Remove session from URL
    const url = new URL(window.location.href);
    url.searchParams.delete('session');
    window.history.replaceState({}, '', url);
  });
  
  // Disable keyboard controls when inputs are focused (prevents WASM keys from interfering)
  const inputs = [
    document.getElementById('hc-name-input'),
    document.getElementById('hc-join-code-input')
  ];
  
  for (const input of inputs) {
    input.addEventListener('focus', () => {
      document.body.classList.add('chat-input-focused');
      window.dispatchEvent(new CustomEvent('chat-focus', { detail: { focused: true } }));
    });
    
    input.addEventListener('blur', () => {
      document.body.classList.remove('chat-input-focused');
      window.dispatchEvent(new CustomEvent('chat-focus', { detail: { focused: false } }));
    });
  }
}

/**
 * Attach session manager event listeners
 */
function attachEventListeners() {
  unsubscribers.push(SessionManager.onSessionCreated((data) => {
    showHostingPanel(data.sessionCode);
  }));
  
  unsubscribers.push(SessionManager.onSessionJoined((data) => {
    showViewingPanel(data.sessionCode, data.hostName);
  }));
  
  unsubscribers.push(SessionManager.onSessionEnded(() => {
    showIdlePanel();
  }));
  
  unsubscribers.push(SessionManager.onSessionError((data) => {
    alert(`Session error: ${data.error}`);
  }));
  
  unsubscribers.push(SessionManager.onSessionInfo((data) => {
    if (data.host) {
      document.getElementById('hc-host-name').textContent = data.host.name;
    }
  }));
}

/**
 * Create a new session
 */
function createSession() {
  const nameInput = document.getElementById('hc-name-input');
  const name = nameInput.value.trim() || getDefaultName();
  nameInput.value = name;
  localStorage.setItem('protoverse-name', name);
  
  SessionManager.createSession({
    worldUrl: currentWorldUrl,
    foundryUrl: currentFoundryUrl,
    name,
    color: getRandomColor(),
    maxViewers: 8,
  });
}

/**
 * Join an existing session
 */
function joinSession(code) {
  const nameInput = document.getElementById('hc-name-input');
  const name = nameInput.value.trim() || getDefaultName();
  nameInput.value = name;
  localStorage.setItem('protoverse-name', name);
  
  SessionManager.joinSession({
    sessionCode: code,
    name,
    color: getRandomColor(),
  });
}

/**
 * Show idle panel (no session)
 */
function showIdlePanel() {
  document.getElementById('hc-panel-idle').classList.remove('hc-hidden');
  document.getElementById('hc-panel-hosting').classList.add('hc-hidden');
  document.getElementById('hc-panel-viewing').classList.add('hc-hidden');
}

/**
 * Show hosting panel
 */
function showHostingPanel(code) {
  document.getElementById('hc-panel-idle').classList.add('hc-hidden');
  document.getElementById('hc-panel-hosting').classList.remove('hc-hidden');
  document.getElementById('hc-panel-viewing').classList.add('hc-hidden');
  
  document.getElementById('hc-active-code').textContent = code;
  
  // Generate share URL
  const shareUrl = new URL(window.location.href);
  shareUrl.searchParams.set('session', code);
  document.getElementById('hc-share-url').textContent = shareUrl.toString();
}

/**
 * Show viewing panel
 */
function showViewingPanel(code, hostName) {
  document.getElementById('hc-panel-idle').classList.add('hc-hidden');
  document.getElementById('hc-panel-hosting').classList.add('hc-hidden');
  document.getElementById('hc-panel-viewing').classList.remove('hc-hidden');
  
  document.getElementById('hc-viewing-code').textContent = code;
  document.getElementById('hc-host-name').textContent = hostName || '-';
}

/**
 * Copy share URL to clipboard
 */
async function copyShareUrl() {
  const urlEl = document.getElementById('hc-share-url');
  const btnEl = document.getElementById('hc-copy-url-btn');
  
  try {
    await navigator.clipboard.writeText(urlEl.textContent);
    btnEl.textContent = '✓ Copied!';
    btnEl.classList.add('copied');
    
    setTimeout(() => {
      btnEl.textContent = '📋 Copy Link';
      btnEl.classList.remove('copied');
    }, 2000);
  } catch (err) {
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = urlEl.textContent;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    
    btnEl.textContent = '✓ Copied!';
    setTimeout(() => {
      btnEl.textContent = '📋 Copy Link';
    }, 2000);
  }
}

/**
 * Show the controls
 */
export function showHostControls() {
  if (controlsContainer) {
    controlsContainer.style.display = 'block';
  }
}

/**
 * Hide the controls
 */
export function hideHostControls() {
  if (controlsContainer) {
    controlsContainer.style.display = 'none';
  }
}

/**
 * Check if we're hosting a session
 */
export function isHosting() {
  return SessionManager.isHosting();
}

/**
 * Cleanup
 */
export function destroyHostControls() {
  for (const unsub of unsubscribers) {
    unsub();
  }
  unsubscribers = [];
  
  if (controlsContainer) {
    controlsContainer.remove();
    controlsContainer = null;
  }
  
  isInitialized = false;
}
