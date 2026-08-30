import type pg from 'pg';

export interface DatabaseOptimizationStatus {
  postgis: boolean;
  timescaledb: boolean;
  pgrouting: boolean;
  pgStatStatements: boolean;
  neo4jConfigured: boolean;
  optimizedTables: string[];
  indexes: string[];
  cacheStrategy: Record<string, string>;
}

async function tryQuery(pool: pg.Pool, sql: string): Promise<boolean> {
  try {
    await pool.query(sql);
    return true;
  } catch (error) {
    console.warn('Optional database optimization skipped:', error);
    return false;
  }
}

async function extensionInstalled(pool: pg.Pool, name: string): Promise<boolean> {
  try {
    const result = await pool.query('SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = $1) AS installed', [
      name,
    ]);
    return Boolean(result.rows[0]?.installed);
  } catch {
    return false;
  }
}

export async function initializeOptimizedDatabase(pool: pg.Pool): Promise<void> {
  const postgisReady = await tryQuery(pool, 'CREATE EXTENSION IF NOT EXISTS postgis');
  await tryQuery(pool, 'CREATE EXTENSION IF NOT EXISTS timescaledb');
  await tryQuery(pool, 'CREATE EXTENSION IF NOT EXISTS pgrouting');
  await tryQuery(pool, 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements');

  if (!postgisReady) {
    console.warn('PostGIS extension is unavailable; logistics tables that require GEOMETRY were not created.');
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS supply_depots (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      location GEOMETRY(Point, 4326) NOT NULL,
      total_capacity INT NOT NULL CHECK (total_capacity >= 0),
      security_level INT NOT NULL CHECK (security_level BETWEEN 0 AND 100),
      status VARCHAR(50) NOT NULL DEFAULT 'Operational',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS depot_inventory (
      id SERIAL PRIMARY KEY,
      depot_id INT NOT NULL REFERENCES supply_depots(id) ON DELETE CASCADE,
      supply_type VARCHAR(50) NOT NULL,
      quantity INT NOT NULL CHECK (quantity >= 0),
      max_quantity INT NOT NULL CHECK (max_quantity > 0),
      priority INT NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
      last_updated TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (depot_id, supply_type)
    );

    CREATE TABLE IF NOT EXISTS supply_requests (
      id SERIAL PRIMARY KEY,
      unit_id VARCHAR(100) NOT NULL,
      unit_name VARCHAR(255) NOT NULL,
      supply_type VARCHAR(50) NOT NULL,
      quantity INT NOT NULL CHECK (quantity > 0),
      priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
      status VARCHAR(50) NOT NULL DEFAULT 'Pending',
      location GEOMETRY(Point, 4326) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      fulfilled_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS convoys (
      id SERIAL PRIMARY KEY,
      request_id INT REFERENCES supply_requests(id) ON DELETE SET NULL,
      depot_id INT REFERENCES supply_depots(id) ON DELETE SET NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'Planned',
      route GEOMETRY(LineString, 4326) NOT NULL,
      distance_m INT NOT NULL,
      eta_minutes INT NOT NULL,
      fuel_cost_liters NUMERIC(10, 2) NOT NULL,
      progress_pct INT NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS resource_allocation (
      id SERIAL PRIMARY KEY,
      unit_id VARCHAR(100) NOT NULL,
      supply_type VARCHAR(50) NOT NULL,
      requested_quantity INT NOT NULL,
      allocated_quantity INT NOT NULL,
      priority_score NUMERIC(6, 2) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS supply_lines (
      id SERIAL PRIMARY KEY,
      depot_id INT REFERENCES supply_depots(id) ON DELETE CASCADE,
      unit_id VARCHAR(100) NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'SECURE',
      geometry GEOMETRY(LineString, 4326) NOT NULL,
      threat_score NUMERIC(6, 2) NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS unit_positions (
      time TIMESTAMPTZ NOT NULL,
      unit_id VARCHAR(100) NOT NULL,
      location GEOMETRY(Point, 4326) NOT NULL,
      heading FLOAT,
      speed FLOAT,
      status VARCHAR(50),
      PRIMARY KEY (time, unit_id)
    );

    CREATE TABLE IF NOT EXISTS logistics_metrics (
      time TIMESTAMPTZ NOT NULL,
      entity_id VARCHAR(100) NOT NULL,
      metric_name VARCHAR(100) NOT NULL,
      metric_value NUMERIC NOT NULL,
      PRIMARY KEY (time, entity_id, metric_name)
    );

    CREATE INDEX IF NOT EXISTS idx_supply_depots_location ON supply_depots USING GIST (location);
    CREATE INDEX IF NOT EXISTS idx_supply_requests_location ON supply_requests USING GIST (location);
    CREATE INDEX IF NOT EXISTS idx_convoys_route ON convoys USING GIST (route);
    CREATE INDEX IF NOT EXISTS idx_supply_lines_geometry ON supply_lines USING GIST (geometry);
    CREATE INDEX IF NOT EXISTS idx_unit_positions_location ON unit_positions USING GIST (location);
    CREATE INDEX IF NOT EXISTS idx_unit_positions_time_brin ON unit_positions USING BRIN (time);
    CREATE INDEX IF NOT EXISTS idx_logistics_metrics_time_brin ON logistics_metrics USING BRIN (time);
  `);

  await pool.query(`
    INSERT INTO supply_depots (id, name, location, total_capacity, security_level, status)
    VALUES
      (1, 'Apex Main Logistics Base', ST_SetSRID(ST_MakePoint(151.2093, -33.8688), 4326), 120000, 92, 'Operational'),
      (2, 'Forward Supply Point North', ST_SetSRID(ST_MakePoint(151.2450, -33.8350), 4326), 42000, 76, 'Operational'),
      (3, 'Mobile Medical Cache', ST_SetSRID(ST_MakePoint(151.1750, -33.8950), 4326), 18000, 64, 'Operational')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO depot_inventory (depot_id, supply_type, quantity, max_quantity, priority)
    VALUES
      (1, 'Ammo', 36000, 50000, 95),
      (1, 'Fuel', 42000, 50000, 90),
      (1, 'Medical', 12000, 15000, 85),
      (1, 'Rations', 22000, 25000, 70),
      (1, 'Water', 24000, 25000, 80),
      (2, 'Ammo', 14000, 18000, 90),
      (2, 'Fuel', 11000, 15000, 85),
      (2, 'Medical', 3500, 5000, 80),
      (2, 'Rations', 6000, 8000, 65),
      (2, 'Water', 7000, 8000, 75),
      (3, 'Medical', 9000, 10000, 100),
      (3, 'Water', 3600, 5000, 75),
      (3, 'Rations', 3000, 5000, 65)
    ON CONFLICT (depot_id, supply_type) DO NOTHING;
  `);

  await tryQuery(pool, "SELECT create_hypertable('unit_positions', 'time', if_not_exists => TRUE)");
  await tryQuery(pool, "SELECT create_hypertable('logistics_metrics', 'time', if_not_exists => TRUE)");
  await tryQuery(pool, "ALTER TABLE unit_positions SET (timescaledb.compress, timescaledb.compress_segmentby = 'unit_id')");
  await tryQuery(pool, "SELECT add_compression_policy('unit_positions', INTERVAL '7 days', if_not_exists => TRUE)");
  await tryQuery(pool, "SELECT add_compression_policy('logistics_metrics', INTERVAL '7 days', if_not_exists => TRUE)");
  await tryQuery(pool, `
    CREATE MATERIALIZED VIEW IF NOT EXISTS logistics_supply_rates_30m
    WITH (timescaledb.continuous) AS
    SELECT
      time_bucket('30 minutes', time) AS bucket,
      entity_id,
      metric_name,
      avg(metric_value) AS avg_value,
      min(metric_value) AS min_value,
      max(metric_value) AS max_value
    FROM logistics_metrics
    GROUP BY bucket, entity_id, metric_name
    WITH NO DATA
  `);
}

export async function getDatabaseOptimizationStatus(pool: pg.Pool): Promise<DatabaseOptimizationStatus> {
  const [postgis, timescaledb, pgrouting, pgStatStatements] = await Promise.all([
    extensionInstalled(pool, 'postgis'),
    extensionInstalled(pool, 'timescaledb'),
    extensionInstalled(pool, 'pgrouting'),
    extensionInstalled(pool, 'pg_stat_statements'),
  ]);

  return {
    postgis,
    timescaledb,
    pgrouting,
    pgStatStatements,
    neo4jConfigured: Boolean(process.env.NEO4J_URI),
    optimizedTables: [
      'supply_depots',
      'depot_inventory',
      'supply_requests',
      'convoys',
      'resource_allocation',
      'supply_lines',
      'unit_positions',
      'logistics_metrics',
    ],
    indexes: [
      'GIST spatial indexes on depot locations, convoy routes, supply lines, requests, and unit positions',
      'BRIN time indexes on unit_positions and logistics_metrics',
      'TimescaleDB hypertables and 7-day compression policies when the extension is available',
    ],
    cacheStrategy: {
      unitPositions: '30 seconds',
      commandHierarchy: '5 minutes',
      supplyDepotStatus: '1 minute',
      logisticsForecast: '2 minutes',
    },
  };
}

export function getNeo4jSupplyChainModel() {
  return {
    nodeTypes: ['Unit', 'Commander', 'SupplyDepot', 'Objective'],
    relationships: ['COMMANDS', 'SUPPORTS', 'ASSIGNED_TO', 'REPORTS_TO', 'SUPPLIES'],
    cypherTemplates: {
      unitsUnderCommander:
        'MATCH (c:Commander {name: $commanderName})-[:COMMANDS|REPORTS_TO*]->(u:Unit) RETURN u',
      supplyPath:
        'MATCH p = (d:SupplyDepot {name: $depotName})-[:SUPPLIES|SUPPORTS*]->(u:Unit {name: $unitName}) RETURN p',
      commandChain:
        'MATCH (c:Commander)-[r:COMMANDS]->(u:Unit) WHERE c.unit_id = $unitId RETURN c, r, u',
      keySupplyHubs:
        'MATCH (d:SupplyDepot)-[r:SUPPLIES]->(:Unit) RETURN d, count(r) AS degree ORDER BY degree DESC',
    },
  };
}
