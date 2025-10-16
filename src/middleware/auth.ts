import { Request, Response, NextFunction } from "express";
import fetch from "node-fetch";
import { AuthUser, TokenVerificationResponse } from "../types/session";

const LOGIN_PORTAL_URL = process.env.LOGIN_PORTAL_URL || "https://portal.premiernx.com/login";
const VERIFY_TOKEN_URL = process.env.VERIFY_TOKEN_URL || "https://login-app-apis.azurewebsites.net/api/verify_token";
const LOGOUT_URL = process.env.LOGOUT_URL || "https://login-app-apis.azurewebsites.net/api/logout";
const APP_URL = process.env.APP_URL || "http://localhost:3002";

// Helper function to build redirect URL - simplified for both local and production
function buildLoginUrl(returnUrl: string): string {
  // Use direct redirect approach for both localhost and production
  const targetUrl = `${APP_URL}${returnUrl.startsWith('/') ? returnUrl : '/' + returnUrl}`;
  return `${LOGIN_PORTAL_URL}?redirect_url=${encodeURIComponent(targetUrl)}`;
}

// 12 hours in milliseconds (as requested)
const VERIFICATION_INTERVAL = 12 * 60 * 60 * 1000;

/**
 * Verify token with external API
 */
async function verifyToken(token: string): Promise<TokenVerificationResponse> {
  try {
    console.log(`[AUTH] Verifying token with URL: ${VERIFY_TOKEN_URL}`);
    console.log(`[AUTH] Token length: ${token.length}`);
    
    const response = await fetch(VERIFY_TOKEN_URL, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${token}`,
      },
    });

    console.log(`[AUTH] Verification response status: ${response.status}`);

    if (response.status === 200) {
      const data = await response.json() as any;
      console.log(`[AUTH] Verification response data:`, JSON.stringify(data, null, 2));
      
      // Handle the actual API response format: { "status": "Valid" }
      if (data.status === "Valid") {
        console.log(`[AUTH] Token verification successful - valid token`);
        
        // Since the API doesn't return user info, we'll extract it from the JWT token
        try {
          const tokenPayload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
          console.log(`[AUTH] JWT payload:`, JSON.stringify(tokenPayload, null, 2));         
          const userEmail = tokenPayload.email || tokenPayload.sub || "unknown@example.com";
          const userId = tokenPayload.sub || tokenPayload.email || "unknown";
          
          console.log(`[AUTH] Extracted user info from JWT - Email: ${userEmail}, ID: ${userId}`);
          
          return {
            success: true,
            user: {
              email: userEmail,
              name: userEmail.split('@')[0] || "Unknown User",
              role: tokenPayload.isAdmin === "y" ? "admin" : "user",
              id: userId,
              permissions: tokenPayload.application_ids || []
            }
          };
        } catch (jwtError) {
          console.error("[AUTH] Failed to decode JWT payload:", jwtError);
          return {
            success: true,
            user: {
              email: "unknown@example.com",
              name: "Unknown User",
              role: "user",
              id: "unknown",
              permissions: []
            }
          };
        }
      }
    }

    if (response.status === 401) {
      const data = await response.json().catch(() => ({})) as any;
      console.log(`[AUTH] Token verification failed (401): ${data.error || 'Invalid token'}`);
      return { success: false, error: data.error || "Token is invalid" };
    }

    console.log(`[AUTH] Token verification failed: HTTP ${response.status}`);
    return { success: false, error: `HTTP ${response.status}` };
  } catch (error) {
    console.error("[AUTH] Token verification network error:", error);
    return { success: false, error: "Network error during verification" };
  }
}

/**
 * Check if user needs re-verification (every 12 hours)
 */
function needsReVerification(session: any): boolean {
  if (!session.lastVerification) return true;
  const now = Date.now();
  return (now - session.lastVerification) > VERIFICATION_INTERVAL;
}

/**
 * Authentication middleware for HTML pages (redirects to login)
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  return handleAuth(req, res, next, true, false);
}

/**
 * Authentication middleware for API endpoints (returns JSON error)
 */
export function requireAuthAPI(req: Request, res: Response, next: NextFunction) {
  return handleAuth(req, res, next, true, true);
}

/**
 * Optional authentication middleware (doesn't redirect, just sets user info)
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  return handleAuth(req, res, next, false, false);
}

/**
 * Main authentication handler
 */
async function handleAuth(req: Request, res: Response, next: NextFunction, required: boolean = true, isAPI: boolean = false) {
  try {
    // Check if authentication is disabled for development
    if (process.env.DISABLE_AUTH === 'true') {
      console.log(`[AUTH] Authentication disabled via DISABLE_AUTH flag`);
      return next();
    }

    const session = req.session;
    const token = req.query.token as string;

    console.log(`[AUTH] handleAuth called - URL: ${req.originalUrl}, Token: ${token ? 'present' : 'none'}, Authenticated: ${session.isAuthenticated}, SessionID: ${session.id || 'none'}`);
    console.log(`[AUTH] Query params:`, JSON.stringify(req.query));
    console.log(`[AUTH] Full URL for debugging: ${req.protocol}://${req.get('host')}${req.originalUrl}`);
    console.log(`[AUTH] Session debug - User: ${session.user?.name || 'none'}, LastVerification: ${session.lastVerification || 'none'}`);
    
    // Enhanced HTTPS detection through proxy headers
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const actualProtocol = isSecure ? 'https' : 'http';
    
    console.log(`[AUTH] Cookie debug - Secure: ${isSecure}, Protocol: ${actualProtocol} (req.protocol: ${req.protocol}), Headers: ${JSON.stringify(req.headers.cookie || 'none')}`);
    console.log(`[AUTH] Proxy headers - X-Forwarded-Proto: ${req.headers['x-forwarded-proto']}, Trust-Proxy: ${req.app.get('trust proxy')}`);
    console.log(`[AUTH] All headers: ${JSON.stringify(req.headers)}`);
    console.log(`[AUTH] Request URL: ${req.url}, Method: ${req.method}, Origin: ${req.get('Origin')}`);
    console.log(`[AUTH] Referer: ${req.get('Referer')}`);
    console.log(`[AUTH] User-Agent: ${req.get('User-Agent')}`);
    console.log(`[AUTH] Session object: ${JSON.stringify(session, null, 2)}`);

    // If token in URL, verify it and clean the URL
    if (token) {
      console.log(`[AUTH] Processing token for verification`);
      const verification = await verifyToken(token);
      
      if (verification.success && verification.user) {
        console.log(`[AUTH] Token verification successful for user: ${verification.user.name}`);
        session.user = verification.user;
        session.isAuthenticated = true;
        session.lastVerification = Date.now();
        
        console.log(`[AUTH] Session data set:`, {
          user: session.user.name,
          isAuthenticated: session.isAuthenticated,
          sessionId: session.id
        });
        
        // Force session save with explicit callback
        return new Promise((resolve, reject) => {
          session.save((err) => {
            if (err) {
              console.error("[AUTH] CRITICAL: Session save failed:", err);
              reject(err);
            } else {
              console.log("[AUTH] ✅ Session saved successfully, sessionId:", session.id);
              
              // Double-check session persistence
              console.log(`[AUTH] Session after save:`, {
                user: session.user?.name,
                isAuthenticated: session.isAuthenticated,
                sessionId: session.id
              });
              
              // Redirect to clean URL (remove token)
              let cleanUrl = req.originalUrl.replace(/[?&]token=[^&]*/, '').replace(/\?$/, '');
              if (!cleanUrl || cleanUrl === '/') {
                cleanUrl = '/control-panel.html';
              }
              console.log(`[AUTH] 🚀 Redirecting to clean URL: ${cleanUrl}`);
              res.redirect(cleanUrl);
              resolve(undefined);
            }
          });
        });
      } else {
        console.error("[AUTH] Token verification failed:", verification.error || verification.message);
        // Clear any existing session
        session.destroy((err) => {
          if (err) console.error("Session destruction error:", err);
        });
        
        if (required) {
          if (isAPI) {
            return res.status(401).json({ 
              authenticated: false, 
              error: "Invalid token",
              loginUrl: buildLoginUrl('/control-panel.html')
            });
          } else {
            const loginUrl = buildLoginUrl('/control-panel.html');
            console.log(`[AUTH] 🔄 Token invalid, redirecting to login: ${loginUrl}`);
            return res.redirect(loginUrl);
          }
        }
      }
    }

    // Check existing session
    if (session.isAuthenticated && session.user) {
      console.log(`[AUTH] Session authenticated for user: ${session.user.name}`);
      // Check if re-verification is needed
      if (needsReVerification(session)) {
        console.log("[AUTH] Session expired, requires re-authentication");
        session.destroy((err) => {
          if (err) console.error("Session destruction error:", err);
        });
        
        if (required) {
          if (isAPI) {
            return res.status(401).json({ 
              authenticated: false, 
              error: "Session expired", 
              loginUrl: buildLoginUrl('/control-panel.html')
            });
          } else {
            const loginUrl = buildLoginUrl(req.originalUrl);
            console.log(`[AUTH] ⚠️ Session expired - Redirecting to login: ${loginUrl}`);
            return res.redirect(loginUrl);
          }
        }
      } else {
        // Valid session, continue
        console.log(`[AUTH] Valid session, proceeding to next middleware`);
        return next();
      }
    }

    // No valid authentication
    console.log(`[AUTH] No valid authentication found, required: ${required}`);
    if (required) {
      if (isAPI) {
        return res.status(401).json({ 
          authenticated: false, 
          error: "Authentication required", 
          loginUrl: buildLoginUrl('/control-panel.html')
        });
      } else {
        const loginUrl = buildLoginUrl(req.originalUrl);
        console.log(`[AUTH] 🔄 No authentication - Redirecting to login: ${loginUrl}`);
        return res.redirect(loginUrl);
      }
    } else {
      console.log(`[AUTH] Authentication not required, proceeding`);
      return next();
    }
  } catch (error) {
    console.error("Authentication error:", error);
    if (required) {
      return res.status(500).json({ error: "Authentication system error" });
    } else {
      return next();
    }
  }
}

/**
 * Logout handler
 */
export async function handleLogout(req: Request, res: Response) {
  try {
    const session = req.session;
    
    // Destroy local session
    session.destroy((err) => {
      if (err) {
        console.error("Session destruction error:", err);
        return res.status(500).json({ error: "Logout failed" });
      }
      
      // Redirect to external logout with return URL
      const returnUrl = `${APP_URL}/control-panel.html`;
      res.redirect(`${LOGOUT_URL}?returnUrl=${encodeURIComponent(returnUrl)}`);
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ error: "Logout failed" });
  }
}

/**
 * Get current user info
 */
export function getCurrentUser(req: Request, res: Response) {
  const session = req.session;
  
  if (session.isAuthenticated && session.user) {
    res.json({
      authenticated: true,
      user: session.user,
      lastVerification: session.lastVerification
    });
  } else {
    res.json({ authenticated: false });
  }
}
