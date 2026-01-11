/**
 * Create a URL resolver function
 * @param {Object} options - Configuration options
 * @param {boolean} options.useCdn - Whether to use CDN
 * @param {string} options.urlBase - Base URL for CDN or local paths
 * @returns {Function} A function that resolves relative paths to full URLs
 */
export function createUrlResolver(options = {}) {
    const { useCdn = false, urlBase = "/worlds" } = options;
    
    // Paths that should resolve from root, not from urlBase
    const rootPaths = ['/characters/'];
    
    /**
     * Resolve a relative path to a full URL based on URL_BASE
     * @param {string} relativePath - Path like "/cozyship/world.json"
     * @returns {string} Full URL
     */
    function resolveUrl(relativePath) {
        // If already an absolute URL, return as-is
        if (relativePath.startsWith('http')) {
            return relativePath;
        }
        
        // Check if this path should resolve from root (e.g., /characters/)
        for (const rootPath of rootPaths) {
            if (relativePath.startsWith(rootPath)) {
                return relativePath; // Return as-is, it's already a valid path from root
            }
        }
        
        // Remove leading slash if present (we'll add it back)
        const cleanPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
        
        // Ensure URL_BASE ends without slash
        const base = urlBase.endsWith('/') ? urlBase.slice(0, -1) : urlBase;
        
        return `${base}/${cleanPath}`;
    }
    
    return resolveUrl;
}

