// Loading overlay controller

let overlay = null;
let textEl = null;
let barEl = null;

function getElements() {
    if (!overlay) {
        overlay = document.getElementById('loading-overlay');
        textEl = document.getElementById('loading-text');
        barEl = document.getElementById('loading-bar');
    }
}

/**
 * Show the loading overlay
 * @param {string} message - Initial loading message
 */
export function showLoading(message = 'Loading...') {
    getElements();
    if (overlay) {
        overlay.classList.remove('hidden');
        if (textEl) textEl.textContent = message;
        if (barEl) barEl.style.width = '0%';
    }
}

/**
 * Update loading progress
 * @param {number|null} progress - Progress from 0 to 100, or null to keep current progress
 * @param {string} [message] - Optional message to update
 */
export function updateLoading(progress, message) {
    getElements();
    if (barEl && progress !== null && progress !== undefined) {
        barEl.style.width = `${Math.min(100, Math.max(0, progress))}%`;
    }
    if (message && textEl) {
        textEl.textContent = message;
    }
}

/**
 * Hide the loading overlay
 */
export function hideLoading() {
    getElements();
    if (overlay) {
        // Set to 100% briefly before hiding for visual completeness
        if (barEl) barEl.style.width = '100%';
        setTimeout(() => {
            overlay.classList.add('hidden');
        }, 300);
    }
}

/**
 * Check if loading is currently shown
 */
export function isLoadingVisible() {
    getElements();
    return overlay && !overlay.classList.contains('hidden');
}

