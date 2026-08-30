/**
 * Sharknet backend entry point.
 *
 * Boots an Express HTTP API alongside a `ws` WebSocket server, sets up
 * PostgreSQL and Redis connections, and wires up authentication, error
 * handling, and the core route modules.
 */
import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createClient as createRedisClient } from 'redis';
import rateLimit from 'express-rate-limit';

import { pool, checkConnection } from './db/connection.js';
import { initSchema } from './db/models.js';
import { registerWebSocketHandlers } from './websocket/handlers.js';
import { logger } from './utils/logger.js';

import authRoutes from './routes/auth.js';
import odinRoutes from './routes/odin.js';
import weatherRoutes from './routes/weather.js';
import tacticalRoutes from './routes/tactical.js';
import supplyRoutes from './routes/supply.js';
import analyticsRoutes from './routes/analytics.js';
import messagesRoutes from './routes/messages.js';
import aarRoutes from './routes/aar.js';

const PORT = Number(process.env.PORT) || 3000;

const app = express();

/* ------------------------------------------------------------------ */
/* Core middleware                                                     */
/* ------------------------------------------------------------------ */

// CORS_ORIGIN should be a comma-separated allowlist of trusted origins in
// production (e.g. "https://app.example.com"). We intentionally avoid
// defaulting to a wildcard ('*') since that would allow any website to
// call authenticated API endpoints from a browser.
const configuredOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. server-to-server, curl, mobile apps).
      if (!origin || configuredOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
  })
);
app.use(express.json());

// Rate limit all API traffic to mitigate brute-force and abuse.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_MAX) || 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

// Simple request logging.
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

/* ------------------------------------------------------------------ */
/* Redis client                                                        */
/* ------------------------------------------------------------------ */

export const redisClient = createRedisClient({
  socket: {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    connectTimeout: 5000,
    // Stop retrying after a few attempts so a missing Redis instance can't
    // block server startup indefinitely; the server still runs in a
    // degraded state (see /api/health) and future commands will simply fail.
    reconnectStrategy: (retries) => (retries >= 3 ? false : Math.min(retries * 200, 1000)),
  },
  password: process.env.REDIS_PASSWORD || undefined,
});

redisClient.on('error', (err) => {
  logger.error('Redis client error', { error: err.message });
});

/* ------------------------------------------------------------------ */
/* Health check                                                         */
/* ------------------------------------------------------------------ */

app.get('/api/health', async (req, res) => {
  const dbHealthy = await checkConnection();
  const redisHealthy = redisClient.isOpen;

  const healthy = dbHealthy && redisHealthy;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    database: dbHealthy ? 'up' : 'down',
    redis: redisHealthy ? 'up' : 'down',
    timestamp: new Date().toISOString(),
  });
});

/* ------------------------------------------------------------------ */
/* API routes                                                           */
/* ------------------------------------------------------------------ */

app.use('/api/auth', authRoutes);
app.use('/api/odin', odinRoutes);
app.use('/api/weather', weatherRoutes);
app.use('/api/tactical', tacticalRoutes);
app.use('/api/supply', supplyRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/aar', aarRoutes);

/* ------------------------------------------------------------------ */
/* 404 + error handling                                                 */
/* ------------------------------------------------------------------ */

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Base error handling middleware (must have 4 args to be recognized by Express).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error('Unhandled request error', { error: err.message, stack: err.stack });
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

/* ------------------------------------------------------------------ */
/* HTTP + WebSocket server bootstrap                                    */
/* ------------------------------------------------------------------ */

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
registerWebSocketHandlers(wss);
// Expose the WebSocket server to route handlers (e.g. so REST-sent chat
// messages/analytics events can also be broadcast to connected WebSocket
// clients).
app.set('wss', wss);

async function start() {
  try {
    await redisClient.connect();
    logger.info('Connected to Redis');
  } catch (err) {
    logger.error('Failed to connect to Redis', { error: err.message });
  }

  try {
    await initSchema();
  } catch (err) {
    logger.error('Failed to initialize database schema', { error: err.message });
  }

  server.listen(PORT, () => {
    logger.info(`Sharknet server listening on port ${PORT}`);
  });
}

// Only auto-start when run directly (not when imported for testing).
if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  start();
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await pool.end();
  if (redisClient.isOpen) await redisClient.quit();
  server.close(() => process.exit(0));
});

export { app, server, wss };
