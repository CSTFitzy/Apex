/**
 * Database models / schemas for Apex.
 *
 * Each model exposes:
 *  - a `TABLE` SQL definition (used by `initSchema` to create tables if missing)
 *  - basic CRUD helper functions using the shared connection pool
 *
 * This is intentionally a lightweight data-access layer rather than a full
 * ORM, keeping things simple and dependency-free.
 */
import bcrypt from 'bcryptjs';
import { query, withTransaction } from './connection.js';
import { unitCache } from './cache.js';
import { SUPPLY_TYPES, SUPPLY_DEFAULTS } from '../supply/types.js';
import { classifySupplyStatus } from '../supply/forecast.js';
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
  // Units/forces are read on every simulation tick, so the table carries a few
  // denormalized columns (aggregate supply status, worst remaining percentage)
  // that would otherwise require joining and aggregating `unit_supplies`.
  `CREATE TABLE IF NOT EXISTS units (
    id SERIAL PRIMARY KEY,
    unit_id VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    callsign VARCHAR(64),
    echelon VARCHAR(32) NOT NULL DEFAULT 'squad',
    force VARCHAR(32) NOT NULL DEFAULT 'friendly',
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    personnel INTEGER NOT NULL DEFAULT 0,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    supply_status VARCHAR(16) NOT NULL DEFAULT 'full',
    lowest_supply_pct DOUBLE PRECISION NOT NULL DEFAULT 100,
    last_supply_update TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,
  `CREATE TABLE IF NOT EXISTS unit_supplies (
    id SERIAL PRIMARY KEY,
    unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    supply_type VARCHAR(32) NOT NULL,
    quantity DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    capacity DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (capacity >= 0),
    consumption_rate DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (consumption_rate >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (unit_id, supply_type)
  );`,
  `CREATE TABLE IF NOT EXISTS supply_depots (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'operational',
    stock JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,
  `CREATE TABLE IF NOT EXISTS supply_consumption_events (
    id SERIAL PRIMARY KEY,
    unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    supply_type VARCHAR(32) NOT NULL,
    quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
    reason VARCHAR(128),
    recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,
  `CREATE TABLE IF NOT EXISTS supply_transfers (
    id SERIAL PRIMARY KEY,
    from_unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
    to_unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    from_depot_id INTEGER REFERENCES supply_depots(id) ON DELETE SET NULL,
    supply_type VARCHAR(32) NOT NULL,
    quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
    initiated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,
];

/**
 * Indexes supporting the hot read paths (real-time queries during an active
 * simulation). Kept separate from the table definitions so they can be
 * created idempotently and reviewed as a unit.
 */
const INDEXES = [
  // Unit lookups by tactical designator, status and force are the most common
  // filters on the live map and in the supply panel.
  `CREATE INDEX IF NOT EXISTS idx_units_status ON units (status);`,
  `CREATE INDEX IF NOT EXISTS idx_units_force_status ON units (force, status);`,
  `CREATE INDEX IF NOT EXISTS idx_units_supply_status ON units (supply_status);`,
  // Bounding-box ("units in this map viewport") queries.
  `CREATE INDEX IF NOT EXISTS idx_units_location ON units (latitude, longitude);`,
  `CREATE INDEX IF NOT EXISTS idx_unit_supplies_unit ON unit_supplies (unit_id);`,
  `CREATE INDEX IF NOT EXISTS idx_unit_supplies_type ON unit_supplies (supply_type);`,
  `CREATE INDEX IF NOT EXISTS idx_consumption_unit_time
     ON supply_consumption_events (unit_id, occurred_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_consumption_time ON supply_consumption_events (occurred_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_transfers_to_unit ON supply_transfers (to_unit_id, created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_depots_location ON supply_depots (latitude, longitude);`,
  // Pre-existing tables: index the columns the routes already filter/sort on.
  `CREATE INDEX IF NOT EXISTS idx_tactical_locations_location
     ON tactical_locations (latitude, longitude);`,
  `CREATE INDEX IF NOT EXISTS idx_tactical_locations_category ON tactical_locations (category);`,
  `CREATE INDEX IF NOT EXISTS idx_intel_reports_reported_at
     ON intelligence_reports (reported_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_weather_cache_lookup
     ON weather_cache (latitude, longitude, provider, fetched_at DESC);`,
];

/** Create all tables and indexes if they do not already exist. */
export async function initSchema() {
  for (const statement of SCHEMAS) {
    await query(statement);
  }
  for (const statement of INDEXES) {
    await query(statement);
  }
  logger.info('Database schema initialized');
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

// When PostgreSQL isn't reachable (e.g. running locally without setting up a
// database), fall back to a per-process in-memory user store so that
// register/login - and therefore the rest of the app - still work. This
// only ever kicks in for connection-level failures; genuine query errors
// (bad SQL, constraint violations, etc.) still propagate normally.
const memoryUsers = new Map(); // keyed by email
let memoryUserIdSeq = 1;

const DB_UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  '3D000', // invalid_catalog_name (database does not exist)
  '28P01', // invalid_password
]);

function isDbUnavailableError(err) {
  if (err && DB_UNAVAILABLE_CODES.has(err.code)) return true;
  const message = (err && err.message) || '';
  return /connect|Connection terminated|password authentication/i.test(message);
}

function toPublicUser(user) {
  const { id, username, email, role, created_at } = user;
  return { id, username, email, role, created_at };
}

export const Users = {
  async create({ username, email, password, role = 'analyst' }) {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    try {
      const result = await query(
        `INSERT INTO users (username, email, password_hash, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, username, email, role, created_at`,
        [username, email, passwordHash, role]
      );
      return result.rows[0];
    } catch (err) {
      if (!isDbUnavailableError(err)) throw err;
      logger.warn('Database unavailable; storing new user in memory for this session', {
        error: err.message,
      });
      const user = {
        id: memoryUserIdSeq++,
        username,
        email,
        password_hash: passwordHash,
        role,
        created_at: new Date().toISOString(),
      };
      memoryUsers.set(email, user);
      return toPublicUser(user);
    }
  },

  async findByEmail(email) {
    try {
      const result = await query('SELECT * FROM users WHERE email = $1', [email]);
      return result.rows[0] || null;
    } catch (err) {
      if (!isDbUnavailableError(err)) throw err;
      return memoryUsers.get(email) || null;
    }
  },

  async findById(id) {
    try {
      const result = await query(
        'SELECT id, username, email, role, created_at FROM users WHERE id = $1',
        [id]
      );
      return result.rows[0] || null;
    } catch (err) {
      if (!isDbUnavailableError(err)) throw err;
      const user = [...memoryUsers.values()].find((candidate) => candidate.id === id);
      return user ? toPublicUser(user) : null;
    }
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
/* Units / forces                                                       */
/* ------------------------------------------------------------------ */

/**
 * Columns returned for unit reads. Listing them explicitly (rather than
 * `SELECT *`) keeps the payload small on the hot real-time query path.
 */
const UNIT_COLUMNS = `id, unit_id, name, callsign, echelon, force, status, personnel,
  latitude, longitude, supply_status, lowest_supply_pct, last_supply_update`;

export const Units = {
  async create({
    unitId,
    name,
    callsign,
    echelon = 'squad',
    force = 'friendly',
    status = 'active',
    personnel = 0,
    latitude = null,
    longitude = null,
    metadata = {},
  }) {
    const result = await query(
      `INSERT INTO units
        (unit_id, name, callsign, echelon, force, status, personnel, latitude, longitude, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (unit_id) DO UPDATE SET
         name = EXCLUDED.name,
         callsign = EXCLUDED.callsign,
         echelon = EXCLUDED.echelon,
         force = EXCLUDED.force,
         status = EXCLUDED.status,
         personnel = EXCLUDED.personnel,
         latitude = EXCLUDED.latitude,
         longitude = EXCLUDED.longitude,
         updated_at = NOW()
       RETURNING ${UNIT_COLUMNS}`,
      [unitId, name, callsign || null, echelon, force, status, personnel, latitude, longitude, metadata]
    );
    unitCache.clear();
    return result.rows[0];
  },

  /** List units, optionally filtered by force and/or status (both indexed). */
  async list({ force, status } = {}) {
    const conditions = [];
    const params = [];
    if (force) {
      params.push(force);
      conditions.push(`force = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await query(
      `SELECT ${UNIT_COLUMNS} FROM units ${where} ORDER BY unit_id`,
      params
    );
    return result.rows;
  },

  /** Cached variant of {@link Units.list} for repeated real-time reads. */
  async listCached(filters = {}) {
    const key = `units:${filters.force || '*'}:${filters.status || '*'}`;
    return unitCache.getOrSet(key, () => Units.list(filters));
  },

  async findByUnitId(unitId) {
    const result = await query(
      `SELECT ${UNIT_COLUMNS} FROM units WHERE unit_id = $1`,
      [unitId]
    );
    return result.rows[0] || null;
  },

  /**
   * Find units inside a bounding box. Backed by the (latitude, longitude)
   * index so map viewport queries stay fast as the roster grows.
   */
  async findWithinBounds({ minLatitude, maxLatitude, minLongitude, maxLongitude }) {
    const result = await query(
      `SELECT ${UNIT_COLUMNS} FROM units
       WHERE latitude BETWEEN $1 AND $2
         AND longitude BETWEEN $3 AND $4
       ORDER BY unit_id`,
      [minLatitude, maxLatitude, minLongitude, maxLongitude]
    );
    return result.rows;
  },

  /** Update a unit's position, invalidating the unit cache. */
  async updatePosition(unitId, latitude, longitude) {
    const result = await query(
      `UPDATE units SET latitude = $2, longitude = $3, updated_at = NOW()
       WHERE unit_id = $1 RETURNING ${UNIT_COLUMNS}`,
      [unitId, latitude, longitude]
    );
    unitCache.clear();
    return result.rows[0] || null;
  },

  /**
   * Refresh the denormalized supply columns for a unit from `unit_supplies`.
   * Called after any consumption/transfer so list queries never need to join.
   * @param {number} id - Internal unit primary key.
   * @param {import('pg').PoolClient} [client] - Optional transaction client.
   */
  async refreshSupplyStatus(id, client = null) {
    const run = client ? (text, params) => client.query(text, params) : query;
    const result = await run(
      `SELECT supply_type, quantity, capacity FROM unit_supplies WHERE unit_id = $1`,
      [id]
    );

    const percentages = result.rows
      .filter((row) => Number(row.capacity) > 0)
      .map((row) => (Number(row.quantity) / Number(row.capacity)) * 100);
    const lowest = percentages.length > 0 ? Math.min(...percentages) : 100;
    const status = classifySupplyStatus(lowest, 100);

    await run(
      `UPDATE units
       SET supply_status = $2, lowest_supply_pct = $3, last_supply_update = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [id, status, Math.round(lowest * 10) / 10]
    );
    unitCache.clear();
    return { supplyStatus: status, lowestSupplyPct: Math.round(lowest * 10) / 10 };
  },
};

/* ------------------------------------------------------------------ */
/* Unit supplies                                                        */
/* ------------------------------------------------------------------ */

export const UnitSupplies = {
  /** Ensure a unit has a row for every tracked supply type. */
  async seedDefaults(unitPrimaryKey, overrides = {}) {
    for (const supplyType of SUPPLY_TYPES) {
      const defaults = SUPPLY_DEFAULTS[supplyType];
      const override = overrides[supplyType] || {};
      const capacity = Number(override.capacity ?? defaults.capacity);
      await query(
        `INSERT INTO unit_supplies (unit_id, supply_type, quantity, capacity, consumption_rate)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (unit_id, supply_type) DO NOTHING`,
        [
          unitPrimaryKey,
          supplyType,
          Number(override.quantity ?? capacity),
          capacity,
          Number(override.consumptionRate ?? defaults.consumptionRate),
        ]
      );
    }
    await Units.refreshSupplyStatus(unitPrimaryKey);
  },

  /** All supply lines for every unit, joined with unit identity for display. */
  async listAll() {
    const result = await query(
      `SELECT s.unit_id AS unit_key, s.supply_type, s.quantity, s.capacity, s.consumption_rate,
              s.updated_at, u.unit_id, u.name, u.callsign, u.latitude, u.longitude,
              u.force, u.status
       FROM unit_supplies s
       JOIN units u ON u.id = s.unit_id
       ORDER BY u.unit_id, s.supply_type`
    );
    return result.rows;
  },

  async listForUnit(unitPrimaryKey) {
    const result = await query(
      `SELECT supply_type, quantity, capacity, consumption_rate, updated_at
       FROM unit_supplies WHERE unit_id = $1 ORDER BY supply_type`,
      [unitPrimaryKey]
    );
    return result.rows;
  },
};

/* ------------------------------------------------------------------ */
/* Supply depots                                                        */
/* ------------------------------------------------------------------ */

export const SupplyDepots = {
  async create({ name, latitude, longitude, status = 'operational', stock = {} }) {
    const result = await query(
      `INSERT INTO supply_depots (name, latitude, longitude, status, stock)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, latitude, longitude, status, stock]
    );
    return result.rows[0];
  },

  async list() {
    const result = await query('SELECT * FROM supply_depots ORDER BY name');
    return result.rows;
  },

  async findById(id) {
    const result = await query('SELECT * FROM supply_depots WHERE id = $1', [id]);
    return result.rows[0] || null;
  },
};

/* ------------------------------------------------------------------ */
/* Consumption events and transfers                                     */
/* ------------------------------------------------------------------ */

export const SupplyEvents = {
  /**
   * Record a consumption event and decrement the unit's stock atomically.
   * @returns {Promise<{event: object, supply: object, unit: object}>}
   */
  async recordConsumption({ unitPrimaryKey, supplyType, quantity, reason, recordedBy }) {
    return withTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE unit_supplies
         SET quantity = GREATEST(quantity - $3, 0), updated_at = NOW()
         WHERE unit_id = $1 AND supply_type = $2
         RETURNING supply_type, quantity, capacity, consumption_rate`,
        [unitPrimaryKey, supplyType, quantity]
      );
      if (updated.rowCount === 0) {
        const error = new Error(`Unit has no ${supplyType} supply line`);
        error.status = 404;
        throw error;
      }

      const event = await client.query(
        `INSERT INTO supply_consumption_events (unit_id, supply_type, quantity, reason, recorded_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [unitPrimaryKey, supplyType, quantity, reason || null, recordedBy || null]
      );

      await Units.refreshSupplyStatus(unitPrimaryKey, client);
      const unit = await client.query(
        `SELECT ${UNIT_COLUMNS} FROM units WHERE id = $1`,
        [unitPrimaryKey]
      );

      return { event: event.rows[0], supply: updated.rows[0], unit: unit.rows[0] };
    });
  },

  /**
   * Total quantity consumed per unit/supply type over a recent window.
   * Feeds the forecasting engine's observed-rate blending.
   * @param {number} windowHours
   */
  async consumptionSince(windowHours = 24) {
    const result = await query(
      `SELECT unit_id AS unit_key, supply_type, SUM(quantity) AS total
       FROM supply_consumption_events
       WHERE occurred_at >= NOW() - ($1 || ' hours')::interval
       GROUP BY unit_id, supply_type`,
      [String(windowHours)]
    );
    return result.rows;
  },

  /** Recent consumption events for the consumption-rate graphs. */
  async recentEvents(limit = 200) {
    const result = await query(
      `SELECT e.id, e.supply_type, e.quantity, e.reason, e.occurred_at, u.unit_id, u.name
       FROM supply_consumption_events e
       JOIN units u ON u.id = e.unit_id
       ORDER BY e.occurred_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  },
};

export const SupplyTransfers = {
  /**
   * Move supplies between two units, or from a depot to a unit, atomically.
   * Rejects transfers the source cannot cover or the destination cannot hold.
   */
  async transfer({ fromUnitKey = null, fromDepotId = null, toUnitKey, supplyType, quantity, initiatedBy }) {
    return withTransaction(async (client) => {
      const destination = await client.query(
        `SELECT quantity, capacity FROM unit_supplies
         WHERE unit_id = $1 AND supply_type = $2 FOR UPDATE`,
        [toUnitKey, supplyType]
      );
      if (destination.rowCount === 0) {
        const error = new Error(`Destination unit has no ${supplyType} supply line`);
        error.status = 404;
        throw error;
      }

      const headroom =
        Number(destination.rows[0].capacity) - Number(destination.rows[0].quantity);
      if (quantity > headroom) {
        const error = new Error(
          `Destination unit can only accept ${Math.round(headroom * 10) / 10} more ${supplyType}`
        );
        error.status = 400;
        throw error;
      }

      if (fromUnitKey !== null) {
        const source = await client.query(
          `SELECT quantity FROM unit_supplies
           WHERE unit_id = $1 AND supply_type = $2 FOR UPDATE`,
          [fromUnitKey, supplyType]
        );
        if (source.rowCount === 0) {
          const error = new Error(`Source unit has no ${supplyType} supply line`);
          error.status = 404;
          throw error;
        }
        if (Number(source.rows[0].quantity) < quantity) {
          const error = new Error(`Source unit only holds ${source.rows[0].quantity} ${supplyType}`);
          error.status = 400;
          throw error;
        }
        await client.query(
          `UPDATE unit_supplies SET quantity = quantity - $3, updated_at = NOW()
           WHERE unit_id = $1 AND supply_type = $2`,
          [fromUnitKey, supplyType, quantity]
        );
      } else if (fromDepotId !== null) {
        const depot = await client.query(
          'SELECT stock FROM supply_depots WHERE id = $1 FOR UPDATE',
          [fromDepotId]
        );
        if (depot.rowCount === 0) {
          const error = new Error('Supply depot not found');
          error.status = 404;
          throw error;
        }
        const available = Number((depot.rows[0].stock || {})[supplyType] || 0);
        if (available < quantity) {
          const error = new Error(`Depot only holds ${available} ${supplyType}`);
          error.status = 400;
          throw error;
        }
        await client.query(
          `UPDATE supply_depots
           SET stock = jsonb_set(stock, ARRAY[$2], to_jsonb($3::double precision)),
               updated_at = NOW()
           WHERE id = $1`,
          [fromDepotId, supplyType, available - quantity]
        );
      }

      await client.query(
        `UPDATE unit_supplies SET quantity = quantity + $3, updated_at = NOW()
         WHERE unit_id = $1 AND supply_type = $2`,
        [toUnitKey, supplyType, quantity]
      );

      const record = await client.query(
        `INSERT INTO supply_transfers
          (from_unit_id, to_unit_id, from_depot_id, supply_type, quantity, initiated_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [fromUnitKey, toUnitKey, fromDepotId, supplyType, quantity, initiatedBy || null]
      );

      if (fromUnitKey !== null) await Units.refreshSupplyStatus(fromUnitKey, client);
      await Units.refreshSupplyStatus(toUnitKey, client);

      return record.rows[0];
    });
  },
};
