/**
 * JWT token generation and validation helpers.
 */
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const JWT_EXPIRATION = process.env.JWT_EXPIRATION || '24h';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  // Fail loudly in production if no secret has been configured.
  throw new Error('JWT_SECRET environment variable must be set in production');
}

/**
 * Sign a new JWT for the given user payload.
 * @param {{id: number, username: string, role: string}} payload
 */
export function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRATION });
}

/**
 * Verify a JWT and return its decoded payload.
 * Throws if the token is invalid or expired.
 * @param {string} token
 */
export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/** Safely decode a token without verifying (for debugging only). */
export function decodeToken(token) {
  return jwt.decode(token);
}
