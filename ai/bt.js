/**
 * Braintrust Integration
 * 
 * Wrapper for Braintrust function invocation via Convex proxy.
 * API key is stored server-side in Convex for security.
 * 
 * To add/edit prompts:
 *   https://www.braintrust.dev/app/casado/p/protoverse/prompts
 */

import { config } from "../config.js";

// Convex proxy URL (set in config.js via VITE_CONVEX_URL)
let convexUrl = null;
let projectName = null;
let initialized = false;

/**
 * Initialize Braintrust connection via Convex proxy
 * @param {string} project - Project name in Braintrust
 */
export async function initBT(project) {
    if (initialized) {
        console.log("[BT] Already initialized");
        return true;
    }
    
    projectName = project;
    convexUrl = config.lobby.convexUrl;
    
    if (!convexUrl) {
        console.warn("[BT] No Convex URL configured. Set VITE_CONVEX_URL in .env");
        return false;
    }
    
    // Test the connection
    try {
        console.log(`[BT] Using Convex proxy at: ${convexUrl}`);
        initialized = true;
        console.log(`[BT] Initialized for project: ${projectName}`);
        return true;
    } catch (error) {
        console.error("[BT] Failed to initialize:", error);
        return false;
    }
}

/**
 * Check if Braintrust is initialized
 */
export function isBTInitialized() {
    return initialized;
}

/**
 * Invoke a Braintrust function (non-streaming) via Convex proxy
 * @param {string} slug - Function slug
 * @param {Object} input - Input data for the function
 * @returns {Promise<Object>} Response data
 */
export async function invokeBT(slug, input) {
    if (!initialized) {
        throw new Error("[BT] Not initialized. Call initBT() first.");
    }
    
    const data = {
        input: input,
        projectName: projectName,
        slug: slug
    };
    
    console.log("[BT] invokeBT via Convex:", slug, input);
    
    const response = await fetch(`${convexUrl}/ai/invoke`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
    });
    
    console.log('[BT] Status:', response.status, response.statusText);
    
    const text = await response.text();
    
    try {
        const result = JSON.parse(text);
        console.log('[BT] Response:', result);
        return result;
    } catch (e) {
        console.error("[BT] Failed to parse response:", text);
        throw new Error("[BT] Invalid JSON response");
    }
}

/**
 * Invoke a Braintrust function with streaming via Convex proxy
 * Returns a stream that can be iterated
 * @param {string} slug - Function slug
 * @param {Object} input - Input data for the function
 * @returns {Promise<ConvexBTStream>} Streaming response
 */
export async function invokeBTStream(slug, input) {
    if (!initialized) {
        throw new Error("[BT] Not initialized. Call initBT() first.");
    }
    
    const data = {
        input: input,
        projectName: projectName,
        slug: slug
    };
    
    console.log("[BT] invokeBTStream via Convex:", slug, input);
    
    const response = await fetch(`${convexUrl}/ai/stream`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
    });
    
    console.log('[BT] Stream status:', response.status, response.statusText);
    
    if (!response.ok) {
        const errorText = await response.text();
        console.error('[BT] Stream error:', errorText);
        throw new Error(`[BT] Stream request failed: ${response.status} - ${errorText}`);
    }
    
    // Wrap in a compatible stream interface
    return new ConvexBTStream(response.body);
}

/**
 * Stream wrapper compatible with Braintrust SDK streaming interface
 */
class ConvexBTStream {
    constructor(body) {
        this.body = body;
        this.reader = body.getReader();
        this.decoder = new TextDecoder();
        this.buffer = '';
    }

    async *[Symbol.asyncIterator]() {
        try {
            while (true) {
                const { done, value } = await this.reader.read();
                if (done) break;
                
                this.buffer += this.decoder.decode(value, { stream: true });
                
                // Parse SSE events
                const lines = this.buffer.split('\n');
                this.buffer = lines.pop() || ''; // Keep incomplete line in buffer
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;
                        try {
                            const parsed = JSON.parse(data);
                            yield parsed;
                        } catch (e) {
                            // Not JSON, might be raw text
                            yield { type: 'text_delta', data };
                        }
                    }
                }
            }
        } finally {
            this.reader.releaseLock();
        }
    }
}
