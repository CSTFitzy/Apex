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

/**
 * Run a set of queries inside a single transaction.
 *
 * The callback receives a dedicated client; the transaction is committed when
 * it resolves and rolled back if it throws. Used for multi-row operations such
 * as supply transfers that must not be partially applied.
 *
 * @param {(client: import('pg').PoolClient) => Promise<*>} callback
 */
export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Verify the database connection is reachable. */export async function checkConnection() {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (err) {
    logger.error('Database connection check failed', { error: err.message });
    return false;
  }
}

export default pool;
