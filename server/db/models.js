/**
 * Database models / schemas for Sharknet.
 *
 * Each model exposes:
 *  - a `TABLE` SQL definition (used by `initSchema` to create tables if missing)
 *  - basic CRUD helper functions using the shared connection pool
 *
 * This is intentionally a lightweight data-access layer rather than a full
 * ORM, keeping things simple and dependency-free.
 */
import bcrypt from 'bcryptjs';
import { query } from './connection.js';
import { logger } from '../utils/logger.js';

const SALT_ROUNDS = 10;

/* ------------------------------------------------------------------ */
/* Schema definitions                                                  */
/* ------------------------------------------------------------------ */

const SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(64) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'analyst',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,
  `CREATE TABLE IF NOT EXISTS tactical_locations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    sidc VARCHAR(20),
    category VARCHAR(64) DEFAULT 'target',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,
  `CREATE TABLE IF NOT EXISTS intelligence_reports (
    id SERIAL PRIMARY KEY,
    odin_reference VARCHAR(255),
    title VARCHAR(255) NOT NULL,
    summary TEXT,
    source VARCHAR(128),
    location_id INTEGER REFERENCES tactical_locations(id) ON DELETE SET NULL,
    reported_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb
  );`,
  `CREATE TABLE IF NOT EXISTS weather_cache (
    id SERIAL PRIMARY KEY,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    provider VARCHAR(64) NOT NULL,
    data JSONB NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ
  );`,
  `CREATE TABLE IF NOT EXISTS analysis_sessions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    parameters JSONB DEFAULT '{}'::jsonb,
    results JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,
];

/** Create all tables if they do not already exist. */
export async function initSchema() {
  for (const statement of SCHEMAS) {
    await query(statement);
  }
  logger.info('Database schema initialized');
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

export const Users = {
  async create({ username, email, password, role = 'analyst' }) {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await query(
      `INSERT INTO users (username, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, role, created_at`,
      [username, email, passwordHash, role]
    );
    return result.rows[0];
  },

  async findByEmail(email) {
    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0] || null;
  },

  async findById(id) {
    const result = await query(
      'SELECT id, username, email, role, created_at FROM users WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  },

  async verifyPassword(user, password) {
    if (!user || !user.password_hash) return false;
    return bcrypt.compare(password, user.password_hash);
  },
};

/* ------------------------------------------------------------------ */
/* Tactical locations                                                   */
/* ------------------------------------------------------------------ */

export const TacticalLocations = {
  async create({ name, description, latitude, longitude, sidc, category, createdBy }) {
    const result = await query(
      `INSERT INTO tactical_locations
        (name, description, latitude, longitude, sidc, category, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [name, description, latitude, longitude, sidc, category || 'target', createdBy || null]
    );
    return result.rows[0];
  },

  async list() {
    const result = await query('SELECT * FROM tactical_locations ORDER BY created_at DESC');
    return result.rows;
  },

  async findById(id) {
    const result = await query('SELECT * FROM tactical_locations WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async remove(id) {
    await query('DELETE FROM tactical_locations WHERE id = $1', [id]);
  },
};

/* ------------------------------------------------------------------ */
/* Intelligence reports                                                 */
/* ------------------------------------------------------------------ */

export const IntelligenceReports = {
  async create({ odinReference, title, summary, source, locationId, reportedBy, metadata }) {
    const result = await query(
      `INSERT INTO intelligence_reports
        (odin_reference, title, summary, source, location_id, reported_by, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [odinReference, title, summary, source, locationId || null, reportedBy || null, metadata || {}]
    );
    return result.rows[0];
  },

  async list(limit = 100) {
    const result = await query(
      'SELECT * FROM intelligence_reports ORDER BY reported_at DESC LIMIT $1',
      [limit]
    );
    return result.rows;
  },
};

/* ------------------------------------------------------------------ */
/* Weather cache                                                        */
/* ------------------------------------------------------------------ */

export const WeatherCache = {
  async upsert({ latitude, longitude, provider, data, expiresAt }) {
    const result = await query(
      `INSERT INTO weather_cache (latitude, longitude, provider, data, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [latitude, longitude, provider, data, expiresAt || null]
    );
    return result.rows[0];
  },

  async findLatest({ latitude, longitude, provider }) {
    const result = await query(
      `SELECT * FROM weather_cache
       WHERE latitude = $1 AND longitude = $2 AND provider = $3
       ORDER BY fetched_at DESC LIMIT 1`,
      [latitude, longitude, provider]
    );
    return result.rows[0] || null;
  },
};

/* ------------------------------------------------------------------ */
/* Analysis sessions                                                    */
/* ------------------------------------------------------------------ */

export const AnalysisSessions = {
  async create({ name, ownerId, parameters }) {
    const result = await query(
      `INSERT INTO analysis_sessions (name, owner_id, parameters)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name, ownerId || null, parameters || {}]
    );
    return result.rows[0];
  },

  async updateResults(id, results) {
    const result = await query(
      `UPDATE analysis_sessions SET results = $2, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, results]
    );
    return result.rows[0] || null;
  },

  async list() {
    const result = await query('SELECT * FROM analysis_sessions ORDER BY created_at DESC');
    return result.rows;
  },
};
