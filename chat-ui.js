/**
 * Chat UI System
 * 
 * Provides a simple chat interface for character conversations.
 * Only works in non-VR mode.
 */

let chatContainer = null;
let chatInput = null;
let chatMessages = null;
let chatExitButton = null;
let isVisible = false;
let currentCallback = null;  // Called when user sends a message
let exitCallback = null;     // Called when user exits chat

// Chat toggle button state
let chatToggleButton = null;
let isToggleVisible = false;
let toggleClickCallback = null;  // Called when toggle is clicked

/**
 * Initialize the chat UI (creates DOM elements)
 */
export function initChatUI() {
    if (chatContainer) return; // Already initialized
    
    // Create container
    chatContainer = document.createElement('div');
    chatContainer.id = 'chat-container';
    chatContainer.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        width: 500px;
        max-width: 90vw;
        background: rgba(0, 0, 0, 0.85);
        border: 1px solid rgba(255, 255, 255, 0.3);
        border-radius: 12px;
        padding: 16px;
        z-index: 2000;
        display: none;
        flex-direction: column;
        gap: 12px;
        font-family: system-ui, -apple-system, sans-serif;
        backdrop-filter: blur(10px);
    `;
    
    // Create header with character name and exit button
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    `;
    
    const characterName = document.createElement('span');
    characterName.id = 'chat-character-name';
    characterName.style.cssText = `
        color: #4fc3f7;
        font-weight: 600;
        font-size: 14px;
    `;
    characterName.textContent = 'Y-Bot';
    
    chatExitButton = document.createElement('button');
    chatExitButton.innerHTML = '✕';
    chatExitButton.style.cssText = `
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.6);
        font-size: 18px;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
        transition: all 0.2s;
    `;
    chatExitButton.addEventListener('mouseenter', () => {
        chatExitButton.style.background = 'rgba(255, 255, 255, 0.1)';
        chatExitButton.style.color = 'white';
    });
    chatExitButton.addEventListener('mouseleave', () => {
        chatExitButton.style.background = 'none';
        chatExitButton.style.color = 'rgba(255, 255, 255, 0.6)';
    });
    chatExitButton.addEventListener('click', () => {
        hideChat();
        if (exitCallback) {
            exitCallback();
        }
    });
    
    header.appendChild(characterName);
    header.appendChild(chatExitButton);
    
    // Create messages area
    chatMessages = document.createElement('div');
    chatMessages.id = 'chat-messages';
    chatMessages.style.cssText = `
        max-height: 200px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 8px;
    `;
    
    // Create input area
    const inputArea = document.createElement('div');
    inputArea.style.cssText = `
        display: flex;
        gap: 8px;
    `;
    
    chatInput = document.createElement('input');
    chatInput.type = 'text';
    chatInput.placeholder = 'Type a message...';
    chatInput.style.cssText = `
        flex: 1;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px;
        padding: 10px 14px;
        color: white;
        font-size: 14px;
        outline: none;
        transition: border-color 0.2s;
    `;
    chatInput.addEventListener('focus', () => {
        chatInput.style.borderColor = 'rgba(79, 195, 247, 0.5)';
    });
    chatInput.addEventListener('blur', () => {
        chatInput.style.borderColor = 'rgba(255, 255, 255, 0.2)';
    });
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && chatInput.value.trim()) {
            sendMessage(chatInput.value.trim());
            chatInput.value = '';
        }
        // Prevent game controls from triggering
        e.stopPropagation();
    });
    // Prevent keyup from triggering game controls too
    chatInput.addEventListener('keyup', (e) => e.stopPropagation());
    chatInput.addEventListener('keypress', (e) => e.stopPropagation());
    
    const sendButton = document.createElement('button');
    sendButton.textContent = 'Send';
    sendButton.style.cssText = `
        background: #4fc3f7;
        border: none;
        border-radius: 8px;
        padding: 10px 20px;
        color: black;
        font-weight: 600;
        font-size: 14px;
        cursor: pointer;
        transition: background 0.2s;
    `;
    sendButton.addEventListener('mouseenter', () => {
        sendButton.style.background = '#81d4fa';
    });
    sendButton.addEventListener('mouseleave', () => {
        sendButton.style.background = '#4fc3f7';
    });
    sendButton.addEventListener('click', () => {
        if (chatInput.value.trim()) {
            sendMessage(chatInput.value.trim());
            chatInput.value = '';
        }
    });
    
    inputArea.appendChild(chatInput);
    inputArea.appendChild(sendButton);
    
    // Assemble container
    chatContainer.appendChild(header);
    chatContainer.appendChild(chatMessages);
    chatContainer.appendChild(inputArea);
    
    document.body.appendChild(chatContainer);
    
    console.log('[ChatUI] Initialized');
}

/**
 * Send a message and trigger callback
 */
function sendMessage(text) {
    // Add user message to chat
    addMessage(text, 'user');
    
    // Trigger callback for character response
    if (currentCallback) {
        currentCallback(text);
    }
}

// Track current streaming message element
let currentStreamingMessage = null;

/**
 * Add a message to the chat display
 * @param {string} text - Message text
 * @param {string} sender - 'user' or 'character'
 * @returns {HTMLElement} The message element (for streaming updates)
 */
export function addMessage(text, sender = 'character') {
    if (!chatMessages) return null;
    
    const message = document.createElement('div');
    message.style.cssText = `
        padding: 8px 12px;
        border-radius: 8px;
        max-width: 80%;
        word-wrap: break-word;
        ${sender === 'user' 
            ? 'background: rgba(79, 195, 247, 0.3); align-self: flex-end; color: white;'
            : 'background: rgba(255, 255, 255, 0.1); align-self: flex-start; color: rgba(255, 255, 255, 0.9);'
        }
    `;
    message.textContent = text;
    
    chatMessages.appendChild(message);
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    return message;
}

/**
 * Start a streaming message (character typing)
 * @returns {HTMLElement} The message element to append to
 */
export function startStreamingMessage() {
    if (!chatMessages) return null;
    
    const message = document.createElement('div');
    message.style.cssText = `
        padding: 8px 12px;
        border-radius: 8px;
        max-width: 80%;
        word-wrap: break-word;
        background: rgba(255, 255, 255, 0.1);
        align-self: flex-start;
        color: rgba(255, 255, 255, 0.9);
    `;
    message.textContent = '';
    
    chatMessages.appendChild(message);
    currentStreamingMessage = message;
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    return message;
}

/**
 * Append text to the current streaming message
 * @param {string} token - Text to append
 */
export function appendToStreamingMessage(token) {
    if (currentStreamingMessage) {
        currentStreamingMessage.textContent += token;
        // Keep scrolled to bottom
        if (chatMessages) {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }
}

/**
 * End the current streaming message
 */
export function endStreamingMessage() {
    currentStreamingMessage = null;
}

/**
 * Show the chat UI
 * @param {string} characterName - Name to display in header
 * @param {Function} onMessage - Callback when user sends a message (receives message text)
 * @param {Function} onExit - Callback when user exits chat
 */
export function showChat(characterName, onMessage, onExit) {
    if (!chatContainer) {
        initChatUI();
    }
    
    // Set character name
    const nameEl = document.getElementById('chat-character-name');
    if (nameEl) {
        nameEl.textContent = characterName;
    }
    
    // Clear previous messages
    chatMessages.innerHTML = '';
    
    // Set callbacks
    currentCallback = onMessage;
    exitCallback = onExit;
    
    // Show container
    chatContainer.style.display = 'flex';
    isVisible = true;
    
    // Focus input
    setTimeout(() => chatInput?.focus(), 100);
    
    console.log(`[ChatUI] Opened chat with ${characterName}`);
}

/**
 * Hide the chat UI
 */
export function hideChat() {
    if (chatContainer) {
        chatContainer.style.display = 'none';
    }
    isVisible = false;
    currentCallback = null;
    exitCallback = null;
    
    console.log('[ChatUI] Closed chat');
}

/**
 * Check if chat is currently visible
 */
export function isChatVisible() {
    return isVisible;
}

/**
 * Set the character name displayed in the header
 */
export function setCharacterName(name) {
    const nameEl = document.getElementById('chat-character-name');
    if (nameEl) {
        nameEl.textContent = name;
    }
}

/**
 * Initialize the chat toggle button (creates DOM element if needed)
 */
function initChatToggle() {
    if (chatToggleButton) return;
    
    chatToggleButton = document.createElement('button');
    chatToggleButton.id = 'chat-toggle';
    chatToggleButton.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
        </svg>
    `;
    chatToggleButton.style.cssText = `
        position: fixed;
        bottom: 100px;
        right: 30px;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: linear-gradient(135deg, #4fc3f7 0%, #29b6f6 100%);
        border: none;
        box-shadow: 0 4px 20px rgba(79, 195, 247, 0.4), 0 2px 8px rgba(0, 0, 0, 0.2);
        cursor: pointer;
        display: none;
        align-items: center;
        justify-content: center;
        color: white;
        z-index: 1999;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        animation: chatTogglePulse 2s ease-in-out infinite;
    `;
    
    // Add pulse animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes chatTogglePulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
        }
        @keyframes chatToggleBounceIn {
            0% { transform: scale(0); opacity: 0; }
            50% { transform: scale(1.1); }
            100% { transform: scale(1); opacity: 1; }
        }
        #chat-toggle:hover {
            transform: scale(1.1) !important;
            box-shadow: 0 6px 25px rgba(79, 195, 247, 0.5), 0 4px 12px rgba(0, 0, 0, 0.3);
            animation: none;
        }
        #chat-toggle:active {
            transform: scale(0.95) !important;
        }
    `;
    document.head.appendChild(style);
    
    chatToggleButton.addEventListener('click', () => {
        if (toggleClickCallback) {
            toggleClickCallback();
        }
        hideChatToggle();
    });
    
    document.body.appendChild(chatToggleButton);
    console.log('[ChatUI] Chat toggle button initialized');
}

/**
 * Show the chat toggle button
 * @param {string} characterName - Name of the character (for tooltip)
 * @param {Function} onClick - Callback when toggle is clicked
 */
export function showChatToggle(characterName, onClick) {
    initChatToggle();
    
    toggleClickCallback = onClick;
    chatToggleButton.title = `Chat with ${characterName}`;
    chatToggleButton.style.display = 'flex';
    chatToggleButton.style.animation = 'chatToggleBounceIn 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards, chatTogglePulse 2s ease-in-out 0.4s infinite';
    isToggleVisible = true;
    
    console.log(`[ChatUI] Showing chat toggle for ${characterName}`);
}

/**
 * Hide the chat toggle button
 */
export function hideChatToggle() {
    if (chatToggleButton) {
        chatToggleButton.style.display = 'none';
    }
    isToggleVisible = false;
    toggleClickCallback = null;
    
    console.log('[ChatUI] Hidden chat toggle');
}

/**
 * Check if chat toggle is currently visible
 */
export function isChatToggleVisible() {
    return isToggleVisible;
}
