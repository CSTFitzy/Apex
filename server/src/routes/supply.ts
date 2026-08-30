import { Router, Request, Response } from 'express';
import type pg from 'pg';
import type { RedisClientType } from 'redis';
import {
  allocateResources,
  buildSupplyLines,
  calculateConvoyRoute,
  createResupplyPlan,
  forecastSupply,
  listSupplyDepots,
  type SupplyDepot,
} from '../services/logistics.js';

type CacheClient = Pick<RedisClientType, 'get' | 'setEx'> & { isReady?: boolean };

async function readCache<T>(client: CacheClient | undefined, key: string): Promise<T | null> {
  if (!client?.isReady) return null;
  const cached = await client.get(key);
  return cached ? (JSON.parse(cached) as T) : null;
}

async function writeCache(client: CacheClient | undefined, key: string, ttlSeconds: number, value: unknown) {
  if (!client?.isReady) return;
  await client.setEx(key, ttlSeconds, JSON.stringify(value));
}

export default function createSupplyRouter(pool: pg.Pool, redisClient?: CacheClient) {
  const router = Router();

  router.get('/depots', async (_req: Request, res: Response) => {
    try {
      const cacheKey = 'supply:depots';
      const cached = await readCache<SupplyDepot[]>(redisClient, cacheKey);
      if (cached) {
        res.json({ depots: cached, source: 'cache' });
        return;
      }

      const depots = await listSupplyDepots(pool);
      await writeCache(redisClient, cacheKey, 60, depots);
      res.json({ depots, source: 'database' });
    } catch (error) {
      console.error('Failed to list supply depots:', error);
      res.status(500).json({ error: 'Failed to list supply depots' });
    }
  });

  router.post('/request', async (req: Request, res: Response) => {
    try {
      const plan = await createResupplyPlan(pool, req.body);
      res.status(201).json(plan);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create resupply request';
      res.status(400).json({ error: message });
    }
  });

  router.get('/routes', async (req: Request, res: Response) => {
    try {
      const destination = {
        lat: Number(req.query.endLat ?? req.query.lat),
        lon: Number(req.query.endLon ?? req.query.lon),
      };
      const depots = await listSupplyDepots(pool);
      const depot =
        depots.find((candidate) => candidate.id === Number(req.query.depotId)) ??
        depots.sort(
          (a, b) =>
            Math.hypot(a.location.lat - destination.lat, a.location.lon - destination.lon) -
            Math.hypot(b.location.lat - destination.lat, b.location.lon - destination.lon)
        )[0];

      if (!depot || Number.isNaN(destination.lat) || Number.isNaN(destination.lon)) {
        res.status(400).json({ error: 'depotId or destination lat/lon are required' });
        return;
      }

      res.json({ route: calculateConvoyRoute(depot, destination) });
    } catch (error) {
      console.error('Failed to calculate convoy route:', error);
      res.status(500).json({ error: 'Failed to calculate convoy route' });
    }
  });

  router.get('/forecast', (req: Request, res: Response) => {
    try {
      const forecast = forecastSupply({
        unitId: 'demo-unit',
        unitName: 'Demonstration Unit',
        hours: 8,
        combatIntensity: 1,
        currentInventory: {
          Ammo: 1500,
          Fuel: 900,
          Medical: 250,
          Rations: 1200,
          Water: 1400,
        },
        consumptionRates: {
          Ammo: 420,
          Fuel: 140,
          Medical: 50,
          Rations: 90,
          Water: 110,
        },
      });
      res.json(forecast);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to calculate forecast';
      res.status(400).json({ error: message });
    }
  });

  router.post('/forecast', (req: Request, res: Response) => {
    try {
      res.json(forecastSupply(req.body));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to calculate forecast';
      res.status(400).json({ error: message });
    }
  });

  router.post('/allocate', (req: Request, res: Response) => {
    try {
      res.json(allocateResources(req.body));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to allocate resources';
      res.status(400).json({ error: message });
    }
  });

  router.post('/lines', async (req: Request, res: Response) => {
    try {
      const depots = await listSupplyDepots(pool);
      res.json({ supplyLines: buildSupplyLines(depots, req.body.units ?? []) });
    } catch (error) {
      console.error('Failed to assess supply lines:', error);
      res.status(500).json({ error: 'Failed to assess supply lines' });
    }
  });

  return router;
}
