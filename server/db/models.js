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
  `CREATE TABLE IF NOT EXISTS supply_inventory (
    id SERIAL PRIMARY KEY,
    location_id INTEGER NOT NULL REFERENCES tactical_locations(id) ON DELETE CASCADE,
    resource_type VARCHAR(16) NOT NULL CHECK (resource_type IN ('ammo', 'fuel', 'rations')),
    quantity NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    unit VARCHAR(24) NOT NULL,
    reorder_point NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (reorder_point >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (location_id, resource_type)
  );`,
  `CREATE TABLE IF NOT EXISTS supply_consumption (
    id BIGSERIAL PRIMARY KEY,
    inventory_id INTEGER NOT NULL REFERENCES supply_inventory(id) ON DELETE CASCADE,
    quantity NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
    consumed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS logistics_routes (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    origin_location_id INTEGER NOT NULL REFERENCES tactical_locations(id) ON DELETE RESTRICT,
    destination_location_id INTEGER NOT NULL REFERENCES tactical_locations(id) ON DELETE RESTRICT,
    waypoints JSONB NOT NULL DEFAULT '[]'::jsonb,
    distance_km NUMERIC(10, 3) NOT NULL CHECK (distance_km >= 0),
    estimated_duration_minutes INTEGER NOT NULL CHECK (estimated_duration_minutes >= 0),
    status VARCHAR(16) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed', 'cancelled')),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,
  'CREATE INDEX IF NOT EXISTS supply_inventory_location_type_idx ON supply_inventory (location_id, resource_type);',
  'CREATE INDEX IF NOT EXISTS supply_consumption_inventory_time_idx ON supply_consumption (inventory_id, consumed_at DESC);',
  'CREATE INDEX IF NOT EXISTS logistics_routes_endpoints_idx ON logistics_routes (origin_location_id, destination_location_id);',
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

/* ------------------------------------------------------------------ */
/* Supply chain                                                         */
/* ------------------------------------------------------------------ */

export const SupplyInventory = {
  async upsert({ locationId, resourceType, quantity, unit, reorderPoint = 0 }) {
    const result = await query(
      `INSERT INTO supply_inventory (location_id, resource_type, quantity, unit, reorder_point)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (location_id, resource_type) DO UPDATE
       SET quantity = EXCLUDED.quantity, unit = EXCLUDED.unit,
           reorder_point = EXCLUDED.reorder_point, updated_at = NOW()
       RETURNING *`,
      [locationId, resourceType, quantity, unit, reorderPoint]
    );
    return result.rows[0];
  },

  async list(locationId) {
    const result = await query(
      `SELECT inventory.*, locations.name AS location_name
       FROM supply_inventory AS inventory
       JOIN tactical_locations AS locations ON locations.id = inventory.location_id
       WHERE ($1::integer IS NULL OR inventory.location_id = $1)
       ORDER BY locations.name, inventory.resource_type`,
      [locationId || null]
    );
    return result.rows;
  },

  async findById(id) {
    const result = await query('SELECT * FROM supply_inventory WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async recordConsumption({ inventoryId, quantity, recordedBy, notes }) {
    const result = await query(
      `WITH updated_inventory AS (
         UPDATE supply_inventory
         SET quantity = quantity - $2, updated_at = NOW()
         WHERE id = $1 AND quantity >= $2
         RETURNING id
       )
       INSERT INTO supply_consumption (inventory_id, quantity, recorded_by, notes)
       SELECT id, $2, $3, $4 FROM updated_inventory
       RETURNING *`,
      [inventoryId, quantity, recordedBy || null, notes || null]
    );
    return result.rows[0] || null;
  },

  async consumptionHistory(inventoryId, since) {
    const result = await query(
      `SELECT quantity, consumed_at FROM supply_consumption
       WHERE inventory_id = $1 AND consumed_at >= $2
       ORDER BY consumed_at ASC`,
      [inventoryId, since]
    );
    return result.rows;
  },
};

export const LogisticsRoutes = {
  async create({
    name, originLocationId, destinationLocationId, waypoints, distanceKm, estimatedDurationMinutes, createdBy,
  }) {
    const result = await query(
      `INSERT INTO logistics_routes
       (name, origin_location_id, destination_location_id, waypoints, distance_km, estimated_duration_minutes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [name, originLocationId, destinationLocationId, waypoints || [], distanceKm, estimatedDurationMinutes, createdBy || null]
    );
    return result.rows[0];
  },

  async list() {
    const result = await query(
      `SELECT routes.*, origin.name AS origin_name, destination.name AS destination_name
       FROM logistics_routes AS routes
       JOIN tactical_locations AS origin ON origin.id = routes.origin_location_id
       JOIN tactical_locations AS destination ON destination.id = routes.destination_location_id
       ORDER BY routes.created_at DESC`
    );
    return result.rows;
  },
};
