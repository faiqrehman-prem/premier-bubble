import { Session } from "express-session";

/**
 * User information stored in session
 */
export interface AuthUser {
  email: string;
  name: string;
  role: string;
  id: string;
  permissions?: string[];
}

/**
 * Extended session with authentication data
 */
export interface AuthSession extends Session {
  user?: AuthUser;
  isAuthenticated?: boolean;
  lastVerification?: number;
  originalUrl?: string;
}

/**
 * Token verification response from external API
 */
export interface TokenVerificationResponse {
  success: boolean;
  user?: AuthUser;
  message?: string;
  error?: string;
}

declare module "express-session" {
  interface SessionData {
    user?: AuthUser;
    isAuthenticated?: boolean;
    lastVerification?: number;
    originalUrl?: string;
  }
}
