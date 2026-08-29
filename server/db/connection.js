/**
 * PostgreSQL connection pool setup.
 *
 * Exposes a shared `pg` Pool instance configured from environment
 * variables, plus a small `query` helper for convenience/logging.
 */
import pg from 'pg';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'sharknet',
  user: process.env.DB_USER || 'sharknet_user',
  password: process.env.DB_PASSWORD || '',
  max: Number(process.env.DB_POOL_MAX) || 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  logger.error('Unexpected PostgreSQL pool error', { error: err.message });
});

/**
 * Run a parameterized query against the pool.
 * @param {string} text - SQL query text with $1, $2... placeholders.
 * @param {Array} params - Query parameters.
 */
export async function query(text, params = []) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  logger.debug('Executed query', { text, duration, rows: result.rowCount });
  return result;
}

/** Verify the database connection is reachable. */
export async function checkConnection() {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (err) {
    logger.error('Database connection check failed', { error: err.message });
    return false;
  }
}

export default pool;
