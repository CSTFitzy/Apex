import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import dotenv from 'dotenv';
import pg from 'pg';
import * as redis from 'redis';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import weatherRouter from './routes/weather.js';
import terrainRouter from './routes/terrain.js';
import documentsRouter from './routes/documents.js';
import enemyRouter from './routes/enemy.js';
import analyticsRouter from './routes/analytics.js';
import messagesRouter from './routes/messages.js';
import commsRouter from './routes/comms.js';
import webrtcRouter from './routes/webrtc.js';
import { registerCommsGateway } from './comms/gateway.js';
import { commsStore, type RedisLike } from './comms/store.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: Express = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Database connection
const pool = new pg.Pool({
  user: process.env.DB_USER || 'apex_user',
  password: process.env.DB_PASSWORD || 'apex_password',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'apex',
});

// Redis connection
const redisClient = redis.createClient({
  socket: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));
redisClient.connect().catch(console.error);

// Routes
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Apex server is running' });
});

app.use('/api/weather', weatherRouter);
app.use('/api/terrain', terrainRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/enemy', enemyRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/comms', commsRouter);
app.use('/api/webrtc', webrtcRouter);

app.get('/api/map/data', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, name, latitude, longitude, type, description FROM locations LIMIT 100'
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch map data' });
  }
});

app.post('/api/locations', async (req: Request, res: Response) => {
  try {
    const { name, latitude, longitude, type, description } = req.body;
    const result = await pool.query(
      'INSERT INTO locations (name, latitude, longitude, type, description) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, latitude, longitude, type, description]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create location' });
  }
});

// Serve built frontend (used by the Electron desktop wrapper / production deployments)
const clientDistPath = path.join(__dirname, '../../client/dist');
const staticLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get(/^(?!\/api).*/, staticLimiter, (req: Request, res: Response) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// WebSocket events
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });

  socket.on('location-update', (data) => {
    io.emit('location-update', data);
  });
});

// Tactical comms: WebRTC signalling, radio channels and real-time messaging
registerCommsGateway(io);

// Initialize database
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS locations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        latitude DECIMAL(10, 8) NOT NULL,
        longitude DECIMAL(11, 8) NOT NULL,
        type VARCHAR(50),
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

// Start server
const RETENTION_SWEEP_MS = 60 * 60 * 1000;

httpServer.listen(port, async () => {
  await initializeDatabase();
  // Tactical comms persistence (PostgreSQL archive + Redis queue/presence).
  // Both are optional: the store falls back to in-memory state when absent.
  await commsStore.init(pool, redisClient as unknown as RedisLike);
  // Apply the configured message retention policy hourly (COMMS_RETENTION_DAYS).
  setInterval(() => {
    void commsStore.applyRetentionPolicy();
  }, RETENTION_SWEEP_MS).unref();
  console.log(`Server running on http://localhost:${port}`);
});

process.on('SIGINT', async () => {
  await pool.end();
  await redisClient.quit();
  process.exit(0);
});
