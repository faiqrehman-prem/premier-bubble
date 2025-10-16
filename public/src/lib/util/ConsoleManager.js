/**
 * Console Manager - Handles browser console suppression based on server configuration
 * This ensures that console logs can be controlled via environment variables
 */
class ConsoleManager {
    static async initialize() {
        try {
            // Only suppress console if we're not in development mode
            const isLocalhost = window.location.hostname.includes('localhost') || 
                              window.location.hostname.includes('127.0.0.1');
            
            // For localhost, always allow console logs for development
            if (isLocalhost) {
                console.log('[CONSOLE] Development mode detected - browser console enabled');
                return;
            }
            
            // Load configuration from server
            const configResponse = await fetch('/api/config');
            if (configResponse.ok) {
                const config = await configResponse.json();
                
                // Suppress browser console if disabled in environment
                if (!config.enableBrowserConsole) {
                    ConsoleManager.suppressConsole();
                    console.log('[CONSOLE] Browser console suppressed - check server terminal for logs');
                } else {
                    console.log('[CONSOLE] Browser console enabled via configuration');
                }
            } else {
                // If config loading fails, default to allowing console logs for safety
                console.log('[CONSOLE] Config load failed - defaulting to enabled console');
            }
        } catch (error) {
            // If anything fails, default to allowing console logs
            console.log('[CONSOLE] Console manager initialization failed - defaulting to enabled console');
        }
    }
    
    static suppressConsole() {
        // Store original console methods in case we need to restore them
        const originalConsole = {
            log: console.log,
            warn: console.warn,
            info: console.info,
            error: console.error,
            debug: console.debug,
            trace: console.trace,
            group: console.group,
            groupEnd: console.groupEnd,
            groupCollapsed: console.groupCollapsed,
            table: console.table,
            time: console.time,
            timeEnd: console.timeEnd,
            count: console.count,
            assert: console.assert
        };
        
        // Store original methods for potential restoration
        window._originalConsole = originalConsole;
        
        // Replace all console methods with no-ops
        const noop = () => {};
        console.log = noop;
        console.warn = noop;
        console.info = noop;
        console.error = noop;
        console.debug = noop;
        console.trace = noop;
        console.group = noop;
        console.groupEnd = noop;
        console.groupCollapsed = noop;
        console.table = noop;
        console.time = noop;
        console.timeEnd = noop;
        console.count = noop;
        console.assert = noop;
    }
    
    static restoreConsole() {
        // Restore original console methods
        if (window._originalConsole) {
            Object.assign(console, window._originalConsole);
            delete window._originalConsole;
            console.log('[CONSOLE] Browser console restored');
        }
    }
    
    // Emergency console restore function (can be called from browser dev tools)
    static enableDebugMode() {
        ConsoleManager.restoreConsole();
        console.log('[CONSOLE] Debug mode enabled - console logs restored');
        console.log('[CONSOLE] To suppress again, reload the page');
    }
}

// Make available globally for emergency debugging
window.ConsoleManager = ConsoleManager;

// Auto-initialize on script load
ConsoleManager.initialize();

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConsoleManager;
}
