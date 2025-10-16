/**
 * Nova Agent Widget Loader
 * Pre-loader script that validates domain authorization before loading the actual widget
 * 
 * Usage: <script src="https://your-domain.com/widget-loader.js"></script>
 */

(function() {
  'use strict';
  
  // Prevent multiple loading
  if (window.NovaAgentLoaderExecuted) {
    return;
  }
  window.NovaAgentLoaderExecuted = true;
  
  // Configuration
  const CONFIG = {
    SERVER_URL: window.NOVA_AGENT_URL || window.location.origin
    // Removed WIDGET_SCRIPT - this will come from API response
  };
  
  /**
   * Generate secure request headers with anti-CSRF measures
   */
  function generateSecureHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest', // CSRF protection
      'X-Nova-Agent': 'widget-loader', // Custom identifier
    };
    
    // Add origin validation
    headers['X-Origin-Domain'] = window.location.hostname;
    
    return headers;
  }
  
  /**
   * Sanitize and validate domain data
   */
  function sanitizeRequestData() {
    const currentDomain = window.location.hostname;
    const origin = window.location.origin;
    const referer = document.referrer;
    
    // Validate domain format (basic check)
    if (!/^[a-zA-Z0-9.-]+$/.test(currentDomain)) {
      throw new Error('Invalid domain format');
    }
    
    // Validate origin format
    if (!/^https?:\/\/[a-zA-Z0-9.-]+(:[0-9]+)?$/.test(origin)) {
      throw new Error('Invalid origin format');
    }
    
    return {
      domain: currentDomain,
      origin: origin,
      referer: referer || ''
    };
  }
  
  /**
   * Check domain authorization with enhanced security
   */
  async function checkDomainAuthorization() {
    try {
      console.log('🔍 Nova Agent: Checking domain authorization...');
      
      // Generate secure headers and sanitized data
      const headers = generateSecureHeaders();
      const requestData = sanitizeRequestData();
      
      const response = await fetch(CONFIG.SERVER_URL + '/api/validate-domain', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestData),
        credentials: 'same-origin', // CSRF protection
        cache: 'no-cache', // Prevent caching
        referrerPolicy: 'strict-origin-when-cross-origin'
      });

      // Validate response
      if (!response.ok) {
        throw new Error(`Domain validation failed: ${response.status}`);
      }
      
      // Ensure response is JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Invalid response format');
      }

      const result = await response.json();
      
      // Validate response structure
      if (typeof result !== 'object' || result === null) {
        throw new Error('Invalid response structure');
      }
      
      return result; // Return the full result object with scriptTag/widgetScript
    } catch (error) {
      console.warn('Nova Agent: Domain authorization check failed:', error.message);
      return { authorized: false }; // Default to unauthorized if check fails
    }
  }
  
  /**
   * Dynamically load the widget script
   */
  function loadWidgetScript(widgetScript) {
    return new Promise((resolve, reject) => {
      // Validate the script path
      if (!widgetScript) {
        reject(new Error('No widget script provided'));
        return;
      }
      
      // Set flag to skip domain check in widget
      window.NOVA_AGENT_PRE_AUTHORIZED = true;
      
      const script = document.createElement('script');
      script.src = CONFIG.SERVER_URL + widgetScript;
      script.async = true;
      script.defer = true;
      
      script.onload = () => {
        console.log('✅ Nova Agent: Widget script loaded successfully');
        resolve();
      };
      
      script.onerror = () => {
        console.error('❌ Nova Agent: Failed to load widget script');
        reject(new Error('Failed to load widget script'));
      };
      
      document.head.appendChild(script);
    });
  }
  
  /**
   * Show unauthorized message
   */
  function showUnauthorizedMessage() {
    console.warn('🚫 Nova Agent: Domain not authorized. Contact the site administrator.');
    
    // Optional: Show a subtle notification
    if (window.confirm) {
      setTimeout(() => {
        alert('Nova Voice Agent is not authorized for this domain. Contact the site administrator.');
      }, 2000);
    }
  }
  
  /**
   * Main initialization function
   */
  async function initialize() {
    try {
      console.log('🚀 Nova Agent: Starting domain validation...');
      
      // Check if domain is authorized and get script information
      const validationResult = await checkDomainAuthorization();
      
      if (validationResult.authorized && validationResult.widgetScript) {
        console.log('✅ Nova Agent: Domain authorized, loading widget...');
        await loadWidgetScript(validationResult.widgetScript);
      } else {
        console.log('🚫 Nova Agent: Domain not authorized');
        showUnauthorizedMessage();
      }
    } catch (error) {
      console.error('💥 Nova Agent: Initialization error:', error);
    }
  }
  
  /**
   * Start the loading process
   */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }
  
  // Add responsive handling
  function handleResize() {
    // Widget will handle its own responsive behavior once loaded
  }
  
  window.addEventListener('resize', handleResize);
  
})();
