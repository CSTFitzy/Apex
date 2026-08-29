/**
 * Authentication routes: register, login, logout, current user.
 */
import { Router } from 'express';
import { Users } from '../db/models.js';
import { generateToken } from '../auth/jwt.js';
import { requireAuth } from '../auth/middleware.js';
import { isValidEmail, isValidPassword, getMissingFields } from '../utils/validators.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * POST /api/auth/register
 * Create a new user account.
 */
router.post('/register', async (req, res) => {
  const missing = getMissingFields(req.body, ['username', 'email', 'password']);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  }

  const { username, email, password } = req.body;

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const existing = await Users.findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'A user with that email already exists' });
    }

    const user = await Users.create({ username, email, password });
    const token = generateToken({ id: user.id, username: user.username, role: user.role });

    return res.status(201).json({ user, token });
  } catch (err) {
    logger.error('Registration failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to register user' });
  }
});

/**
 * POST /api/auth/login
 * Authenticate a user and issue a JWT.
 */
router.post('/login', async (req, res) => {
  const missing = getMissingFields(req.body, ['email', 'password']);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  }

  const { email, password } = req.body;

  try {
    const user = await Users.findByEmail(email);
    const valid = user ? await Users.verifyPassword(user, password) : false;

    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken({ id: user.id, username: user.username, role: user.role });
    return res.json({
      user: { id: user.id, username: user.username, email: user.email, role: user.role },
      token,
    });
  } catch (err) {
    logger.error('Login failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to log in' });
  }
});

/**
 * POST /api/auth/logout
 * Stateless JWT logout - the client is responsible for discarding the token.
 * (A token blocklist could be added here backed by Redis if needed.)
 */
router.post('/logout', requireAuth, (req, res) => {
  return res.json({ message: 'Logged out successfully' });
});

/**
 * GET /api/auth/me
 * Return the currently authenticated user.
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await Users.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ user });
  } catch (err) {
    logger.error('Failed to fetch current user', { error: err.message });
    return res.status(500).json({ error: 'Failed to fetch user' });
  }
});

export default router;
