import { Router, Request, Response } from 'express';
import type pg from 'pg';
import {
  getDatabaseOptimizationStatus,
  getNeo4jSupplyChainModel,
} from '../services/databaseOptimization.js';

export default function createDatabaseRouter(pool: pg.Pool) {
  const router = Router();

  router.get('/optimization/status', async (_req: Request, res: Response) => {
    try {
      res.json(await getDatabaseOptimizationStatus(pool));
    } catch (error) {
      console.error('Failed to inspect database optimization status:', error);
      res.status(500).json({ error: 'Failed to inspect database optimization status' });
    }
  });

  router.get('/optimization/queries', (_req: Request, res: Response) => {
    res.json({
      postgis: {
        proximity: 'SELECT * FROM units WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326), $3)',
        containment:
          'SELECT units.* FROM units JOIN operating_areas ON ST_Contains(operating_areas.geometry, units.location)',
        intersections:
          'SELECT * FROM supply_lines JOIN threat_zones ON ST_Intersects(supply_lines.geometry, threat_zones.geometry)',
        nearestDepot:
          'SELECT d.*, ST_Distance(d.location::geography, $1::geography) AS distance FROM supply_depots d ORDER BY distance',
        area: 'SELECT ST_Area(geometry::geography) AS area_m2 FROM contested_zones',
      },
      timescaledb: {
        currentPosition: "SELECT * FROM unit_positions WHERE unit_id = $1 AND time = $2",
        lastHour: "SELECT * FROM unit_positions WHERE unit_id = $1 AND time > now() - interval '1 hour'",
        distanceMoved:
          'SELECT time, ST_Distance(LAG(location) OVER (ORDER BY time)::geography, location::geography) AS distance_moved FROM unit_positions WHERE unit_id = $1',
      },
      pgrouting:
        "SELECT * FROM pgr_dijkstra('SELECT id, source, target, cost FROM road_network', $1, $2, directed := false)",
      neo4j: getNeo4jSupplyChainModel(),
    });
  });

  return router;
}
