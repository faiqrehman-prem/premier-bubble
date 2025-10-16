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
  // Get the Nova Sonic server URL from where this script was loaded
  const NOVA_SERVER_URL = (() => {
    const scripts = document.getElementsByTagName('script');
    for (let script of scripts) {
      if (script.src && script.src.includes('widget-loader.js')) {
        const url = new URL(script.src);
        return `${url.protocol}//${url.host}`;
      }
    }
    // Fallback (shouldn't happen in normal usage)
    return window.NOVA_AGENT_URL || window.location.origin;
  })();
  
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
      
      const response = await fetch(NOVA_SERVER_URL + '/api/validate-domain', {
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
      // Validate the script URL
      if (!widgetScript) {
        reject(new Error('No widget script URL provided'));
        return;
      }
      
      const script = document.createElement('script');
      script.src = widgetScript; // Use the full URL from API response
      script.async = true;
      script.defer = true;
      
      script.onload = () => {
        console.log('✅ Nova Agent: Widget script loaded successfully');
        
        // Add debugging - check if widget is actually initialized
        setTimeout(() => {
          if (window.NovaAgentWidget) {
            console.log('✅ Nova Agent: Widget object found - widget successfully initialized');
            // Check if bubble element exists
            const bubble = document.getElementById('nova-agent-bubble');
            if (bubble) {
              console.log('✅ Nova Agent: Widget bubble element found in DOM');
            } else {
              console.warn('⚠️  Nova Agent: Widget bubble element not found in DOM');
            }
          } else {
            console.warn('⚠️  Nova Agent: Widget object not found - widget may not have initialized');
          }
        }, 1000);
        
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
    // if (window.confirm) {
    //   setTimeout(() => {
    //     alert('Nova Voice Agent is not authorized for this domain. Contact the site administrator.');
    //   }, 2000);
    // }
  }
  
  /**
   * Main initialization function
   */
  async function initialize() {
    try {
      console.log('🚀 Nova Agent: Starting domain validation...');
      
      // Check if domain is authorized and get script information
      const validationResult = await checkDomainAuthorization();
      
      if (validationResult.authorized) {
        console.log('✅ Nova Agent: Domain authorized, loading widget...');
        
        // Check if this is an external script (like ElevenLabs) or our own widget script
        if (validationResult.scriptType === 'elevenlabs' || !validationResult.widgetScript) {
          // For external scripts, handle dynamic loading properly
          console.log('📄 Nova Agent: Loading external script (ElevenLabs)...');
          
          // Create the custom element first
          const elevenLabsElement = document.createElement('elevenlabs-convai');
          elevenLabsElement.setAttribute('agent-id', 'agent_8501k5f45ttcfzfrzzgsf56tynfa');
          
          // Create and load the script
          const script = document.createElement('script');
          script.src = 'https://unpkg.com/@elevenlabs/convai-widget-embed';
          script.async = true;
          script.type = 'text/javascript';
          
          // Add elements to DOM immediately
          document.body.appendChild(elevenLabsElement);
          document.body.appendChild(script);
          
          script.onload = () => {
            console.log('✅ Nova Agent: ElevenLabs script loaded and widget should be initialized');
          };
          
          script.onerror = () => {
            console.error('❌ Nova Agent: Failed to load ElevenLabs script');
          };
          
          console.log('✅ Nova Agent: ElevenLabs elements injected successfully');
        } else {
          // For our own widget scripts, load the script file
          await loadWidgetScript(validationResult.widgetScript);
        }
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
