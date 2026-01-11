/**
 * Chat Provider
 * 
 * Abstraction layer for character chat responses.
 * Uses Braintrust when available, falls back to stock responses.
 */

import { config } from "../config.js";
import { initBT, isBTInitialized, invokeBTStream } from "./bt.js";

// Stock responses for fallback
const STOCK_RESPONSES = [
    "That's interesting!",
    "Oh really? Tell me more.",
    "Hmm, I see what you mean.",
    "That's a great point!",
    "I hadn't thought of it that way.",
    "Fascinating!",
    "You don't say!",
    "How wonderful!",
    "Tell me more about that.",
    "I appreciate you sharing that with me.",
];

let providerReady = false;
let initPromise = null;

/**
 * Initialize the chat provider
 * Call this early in app startup
 */
export async function initChatProvider() {
    if (initPromise) {
        return initPromise;
    }
    
    initPromise = (async () => {
        if (!config.ai?.enabled) {
            console.log("[ChatProvider] AI disabled in config, using stock responses");
            providerReady = true;
            return true;
        }
        
        const projectName = config.ai?.projectName || "protoverse";
        const success = await initBT(projectName);
        
        if (success) {
            console.log("[ChatProvider] Braintrust ready");
        } else {
            console.log("[ChatProvider] Braintrust unavailable, using stock responses");
        }
        
        providerReady = true;
        return success;
    })();
    
    return initPromise;
}

/**
 * Check if chat provider is ready
 */
export function isChatProviderReady() {
    return providerReady;
}

/**
 * Check if AI is available (not just stock responses)
 */
export function isAIAvailable() {
    return config.ai?.enabled && isBTInitialized();
}

/**
 * Get a chat response (streaming)
 * 
 * @param {Object} options
 * @param {string} options.characterName - Name of the character responding
 * @param {string} options.userMessage - What the user said
 * @param {Array} options.conversationHistory - Previous messages [{role: 'user'|'character', content: '...'}]
 * @param {string} options.slug - Braintrust function slug (default: 'amy-chat')
 * @param {Function} options.onToken - Callback for each token (for streaming)
 * @param {Function} options.onComplete - Callback when response is complete
 * @param {Function} options.onError - Callback on error
 */
export async function getChatResponse({
    characterName,
    userMessage,
    conversationHistory = [],
    slug,
    onToken,
    onComplete,
    onError
}) {
    // Ensure provider is initialized
    if (!providerReady) {
        await initChatProvider();
    }
    
    // Use AI if available
    if (isAIAvailable()) {
        console.log("[ChatProvider] Using AI, slug:", slug);
        console.log("[ChatProvider] User message:", userMessage);
        console.log("[ChatProvider] History:", conversationHistory);
        
        try {
            // Format history as a readable string for the prompt
            const historyText = conversationHistory
                .map(msg => `${msg.role === 'user' ? 'Stranger' : characterName}: ${msg.content}`)
                .join('\n');
            
            const stream = await invokeBTStream(slug, {
                input: userMessage,
                history: historyText,
            });
            
            let fullResponse = "";
            
            // BraintrustStream is an async iterator
            for await (const event of stream) {
                console.log("[ChatProvider] Stream event:", event.type, JSON.stringify(event.data));
                
                // Extract text from various event formats
                let token = null;
                
                if (event.type === 'text_delta') {
                    token = event.data;
                } else if (event.type === 'progress' && event.data) {
                    // Progress events from Braintrust
                    const data = event.data;
                    
                    // Check various possible locations for the token
                    if (data.choices?.[0]?.delta?.content) {
                        token = data.choices[0].delta.content;
                    } else if (data.output) {
                        token = data.output;
                    } else if (data.text) {
                        token = data.text;
                    } else if (data.content) {
                        token = data.content;
                    } else if (data.response) {
                        token = data.response;
                    } else if (typeof data === 'string') {
                        token = data;
                    }
                } else if (event.type === 'done' || event.type === 'result') {
                    // Final result event
                    const data = event.data;
                    if (data?.output && !fullResponse) {
                        token = data.output;
                    } else if (data?.result && !fullResponse) {
                        token = data.result;
                    }
                }
                
                if (token) {
                    console.log("[ChatProvider] Token:", token);
                    fullResponse += token;
                    if (onToken) onToken(token);
                }
            }
            
            console.log("[ChatProvider] Complete, full response:", fullResponse);
            if (onComplete) onComplete(fullResponse);
            return fullResponse;
            
        } catch (error) {
            console.error("[ChatProvider] AI error, falling back to stock:", error);
            if (onError) onError(error);
            return useStockResponse({ onToken, onComplete });
        }
    } else {
        console.log("[ChatProvider] AI not available, using stock. Enabled:", config.ai?.enabled, "BT initialized:", isBTInitialized());
    }
    
    // Stock response fallback
    return useStockResponse({ onToken, onComplete });
}

/**
 * Get a stock response with simulated streaming
 */
async function useStockResponse({ onToken, onComplete }) {
    const response = STOCK_RESPONSES[Math.floor(Math.random() * STOCK_RESPONSES.length)];
    
    // Simulate streaming by sending tokens with delays
    if (onToken) {
        const words = response.split(' ');
        for (let i = 0; i < words.length; i++) {
            const word = words[i] + (i < words.length - 1 ? ' ' : '');
            await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
            onToken(word);
        }
    }
    
    if (onComplete) {
        onComplete(response);
    }
    
    return response;
}

/**
 * Get a non-streaming response (simpler API)
 */
export async function getChatResponseSimple({
    characterName,
    userMessage,
    conversationHistory,
    slug
}) {
    return new Promise((resolve, reject) => {
        let response = "";
        getChatResponse({
            characterName,
            userMessage,
            conversationHistory,
            slug,
            onToken: (token) => { response += token; },
            onComplete: () => resolve(response),
            onError: reject
        });
    });
}

// Stock commentary responses for fallback
const STOCK_COMMENTARY = [
    "Oh wow, look at that!",
    "This part always gets me.",
    "I wonder what's going to happen next...",
    "The colors in this scene are amazing.",
    "This reminds me of something...",
    "Do you see what I see?",
    "I love the way they framed this shot.",
    "The music here is perfect.",
    "This is a good part!",
    "Ooh, I love this scene.",
];

/**
 * Get vision-based commentary for a movie frame
 * 
 * @param {Object} options
 * @param {string} options.characterName - Name of the character commenting
 * @param {string} options.imageDataUrl - Base64 data URL of the frame (e.g., "data:image/jpeg;base64,...")
 * @param {string} options.slug - Braintrust function slug for commentary
 * @param {string} options.movieTitle - Title of the movie being watched
 * @param {string} options.botPrompt - Custom prompt/instructions for the bot
 * @returns {Promise<string>} Commentary text
 */
export async function getVisionCommentary({
    characterName,
    imageDataUrl,
    slug,
    movieTitle = null,
    botPrompt = null
}) {
    // Ensure provider is initialized
    if (!providerReady) {
        await initChatProvider();
    }
    
    // Use AI if available
    if (isAIAvailable() && imageDataUrl) {
        console.log("[ChatProvider] Getting vision commentary, slug:", slug);
        
        try {
            // For vision, we pass the image as part of the input
            // BrainTrust prompts can handle this if configured for a vision model
            const stream = await invokeBTStream(slug, {
                image: imageDataUrl,
                character_name: characterName,
                movie_title: movieTitle || "Unknown Movie",
                bot_prompt: botPrompt || "",
                request_id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,  // Unique per request
            });
            
            let fullResponse = "";
            
            for await (const event of stream) {
                let token = null;
                
                if (event.type === 'text_delta') {
                    token = event.data;
                } else if (event.type === 'progress' && event.data) {
                    const data = event.data;
                    if (data.choices?.[0]?.delta?.content) {
                        token = data.choices[0].delta.content;
                    } else if (data.output) {
                        token = data.output;
                    } else if (data.text) {
                        token = data.text;
                    } else if (data.content) {
                        token = data.content;
                    } else if (typeof data === 'string') {
                        token = data;
                    }
                } else if (event.type === 'done' || event.type === 'result') {
                    const data = event.data;
                    if (data?.output && !fullResponse) {
                        token = data.output;
                    } else if (data?.result && !fullResponse) {
                        token = data.result;
                    }
                }
                
                if (token) {
                    fullResponse += token;
                }
            }
            
            console.log("[ChatProvider] Vision commentary:", fullResponse);
            return fullResponse || getStockCommentary();
            
        } catch (error) {
            console.error("[ChatProvider] Vision error, using stock:", error);
            return getStockCommentary();
        }
    }
    
    // Fallback to stock commentary
    console.log("[ChatProvider] Vision AI not available, using stock commentary");
    return getStockCommentary();
}

/**
 * Get a random stock commentary
 */
function getStockCommentary() {
    return STOCK_COMMENTARY[Math.floor(Math.random() * STOCK_COMMENTARY.length)];
}
