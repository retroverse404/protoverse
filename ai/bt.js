/**
 * Braintrust Integration
 * 
 * Wrapper for Braintrust function invocation API.
 * Requires VITE_BRAINTRUST_API_KEY environment variable.
 * 
 * To add/edit prompts:
 *   https://www.braintrust.dev/app/casado/p/protoverse/prompts
 */

// Buffer polyfill for browser compatibility (must be before braintrust import)
import { Buffer } from "buffer";
// @ts-ignore
window.Buffer = Buffer;

import { initLogger, BraintrustStream } from "braintrust";

const INVOKE_URL = 'https://api.braintrust.dev/function/invoke';

let apiKey = null;
let projectName = null;
let logData = null;
let initialized = false;

/**
 * Initialize Braintrust connection
 * @param {string} project - Project name in Braintrust
 * @param {string} key - API key (optional, will use env var if not provided)
 */
export async function initBT(project, key = null) {
    if (logData) {
        console.log("[BT] Already initialized");
        return true;
    }
    
    projectName = project;
    apiKey = key || import.meta.env?.VITE_BRAINTRUST_API_KEY;
    
    if (!apiKey) {
        console.warn("[BT] No API key found. Set VITE_BRAINTRUST_API_KEY environment variable.");
        return false;
    }
    
    try {
        const logger = initLogger({
            projectName: projectName,
            apiKey: apiKey
        });
        logData = await logger.export();
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
 * Invoke a Braintrust function (non-streaming)
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
        parent: logData,
        stream: false,
        project_name: projectName,
        slug: slug
    };
    
    console.log("[BT] invokeBT:", slug, input);
    
    const response = await fetch(INVOKE_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
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
 * Invoke a Braintrust function with streaming
 * Returns a BraintrustStream that can be iterated
 * @param {string} slug - Function slug
 * @param {Object} input - Input data for the function
 * @returns {Promise<BraintrustStream>} Streaming response
 */
export async function invokeBTStream(slug, input) {
    if (!initialized) {
        throw new Error("[BT] Not initialized. Call initBT() first.");
    }
    
    const data = {
        input: {
            ...input,
        },
        parent: logData,
        stream: true,
        project_name: projectName,
        slug: slug
    };
    
    console.log("[BT] invokeBTStream:", slug, input);
    
    const response = await fetch(INVOKE_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
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
    
    return new BraintrustStream(response.body);
}
