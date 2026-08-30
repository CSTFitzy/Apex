/**
 * Authentication and authorization middleware.
 */
import { verifyToken } from './jwt.js';
import { logger } from '../utils/logger.js';

/** Identity attached to requests when authentication is disabled. */
const DEV_USER = Object.freeze({
  id: 0,
  username: 'operator',
  email: 'operator@apex.local',
  role: 'admin',
});

/**
 * Whether authentication is bypassed for this process.
 *
 * Controlled by `DISABLE_AUTH` ('true'/'false'). When unset, auth is
 * disabled outside of production so the app can be run locally without a
 * database or user accounts, and enforced in production.
 */
export function isAuthDisabled() {
  const flag = process.env.DISABLE_AUTH;
  if (flag) return flag === 'true' || flag === '1';
  return process.env.NODE_ENV !== 'production';
}

/** The stand-in user used for requests when authentication is disabled. */
export function getDevUser() {
  return { ...DEV_USER };
}

/**
 * Require a valid JWT supplied via the standard Authorization header.
 * Attaches the decoded payload to `req.user` on success.
 */
export function requireAuth(req, res, next) {
  if (isAuthDisabled()) {
    // Still honour a valid token if one was supplied, so a real logged-in
    // user keeps their own identity; otherwise fall back to the dev user.
    const [devScheme, devToken] = (req.headers.authorization || '').split(' ');
    if (devScheme === 'Bearer' && devToken) {
      try {
        req.user = verifyToken(devToken);
      } catch {
        // Ignore invalid tokens while auth is disabled.
      }
    }
    req.user = req.user || getDevUser();
    return next();
  }

  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  try {
    req.user = verifyToken(token);
    return next();
  } catch (err) {
    logger.warn('JWT verification failed', { error: err.message });
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Require the authenticated user to have one of the allowed roles.
 * Must be used after `requireAuth`.
 * @param {string[]} allowedRoles
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (isAuthDisabled()) {
      req.user = req.user || getDevUser();
      return next();
    }
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    return next();
  };
}
