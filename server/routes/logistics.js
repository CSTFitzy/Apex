import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { LogisticsRoutes, SupplyInventory, TacticalLocations } from '../db/models.js';
import { forecastConsumption, optimizeRoute } from '../services/logistics.js';
import { getMissingFields, isNonEmptyString } from '../utils/validators.js';
import { logger } from '../utils/logger.js';

const router = Router();
const RESOURCE_TYPES = new Set(['ammo', 'fuel', 'rations']);

function isPositiveNumber(value, allowZero = false) {
  const number = Number(value);
  return Number.isFinite(number) && (allowZero ? number >= 0 : number > 0);
}

router.get('/inventory', requireAuth, async (req, res) => {
  const locationId = req.query.locationId;
  if (locationId !== undefined && (!Number.isInteger(Number(locationId)) || Number(locationId) <= 0)) {
    return res.status(400).json({ error: 'locationId must be a positive integer' });
  }
  try {
    return res.json({ inventory: await SupplyInventory.list(locationId && Number(locationId)) });
  } catch (err) {
    logger.error('Failed to list supply inventory', { error: err.message });
    return res.status(500).json({ error: 'Failed to load supply inventory' });
  }
});

router.put('/inventory', requireAuth, async (req, res) => {
  const missing = getMissingFields(req.body, ['locationId', 'resourceType', 'quantity', 'unit']);
  if (missing.length || !RESOURCE_TYPES.has(req.body?.resourceType) ||
      !isPositiveNumber(req.body?.quantity, true) || !isPositiveNumber(req.body?.reorderPoint ?? 0, true) ||
      !isNonEmptyString(req.body?.unit)) {
    return res.status(400).json({ error: 'Invalid inventory data' });
  }
  try {
    const location = await TacticalLocations.findById(req.body.locationId);
    if (!location) return res.status(404).json({ error: 'Location not found' });
    const inventory = await SupplyInventory.upsert(req.body);
    return res.json({ inventory });
  } catch (err) {
    logger.error('Failed to save supply inventory', { error: err.message });
    return res.status(500).json({ error: 'Failed to save supply inventory' });
  }
});

router.post('/inventory/:id/consumption', requireAuth, async (req, res) => {
  if (!isPositiveNumber(req.body?.quantity)) {
    return res.status(400).json({ error: 'quantity must be a positive number' });
  }
  try {
    const consumption = await SupplyInventory.recordConsumption({
      inventoryId: req.params.id,
      quantity: Number(req.body.quantity),
      recordedBy: req.user.id,
      notes: req.body.notes,
    });
    if (!consumption) return res.status(409).json({ error: 'Insufficient inventory or inventory not found' });
    return res.status(201).json({ consumption });
  } catch (err) {
    logger.error('Failed to record supply consumption', { error: err.message });
    return res.status(500).json({ error: 'Failed to record supply consumption' });
  }
});

router.get('/inventory/:id/forecast', requireAuth, async (req, res) => {
  const forecastDays = Number(req.query.days || 7);
  if (!Number.isInteger(forecastDays) || forecastDays < 1 || forecastDays > 365) {
    return res.status(400).json({ error: 'days must be an integer between 1 and 365' });
  }
  try {
    const inventory = await SupplyInventory.findById(req.params.id);
    if (!inventory) return res.status(404).json({ error: 'Inventory not found' });
    const history = await SupplyInventory.consumptionHistory(
      inventory.id,
      new Date(Date.now() - 30 * 86400000)
    );
    return res.json({ forecast: forecastConsumption(inventory, history, forecastDays) });
  } catch (err) {
    logger.error('Failed to forecast supply consumption', { error: err.message });
    return res.status(500).json({ error: 'Failed to forecast supply consumption' });
  }
});

router.get('/routes', requireAuth, async (_req, res) => {
  try {
    return res.json({ routes: await LogisticsRoutes.list() });
  } catch (err) {
    logger.error('Failed to list logistics routes', { error: err.message });
    return res.status(500).json({ error: 'Failed to load logistics routes' });
  }
});

router.post('/routes', requireAuth, async (req, res) => {
  const { name, originLocationId, destinationLocationId, waypointLocationIds = [], speedKmh = 40 } = req.body || {};
  if (!isNonEmptyString(name) || !Number.isInteger(Number(originLocationId)) ||
      !Number.isInteger(Number(destinationLocationId)) || originLocationId === destinationLocationId ||
      !Array.isArray(waypointLocationIds) || !isPositiveNumber(speedKmh)) {
    return res.status(400).json({ error: 'Invalid route data' });
  }
  try {
    const ids = [Number(originLocationId), Number(destinationLocationId), ...waypointLocationIds.map(Number)];
    if (ids.some((id) => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
      return res.status(400).json({ error: 'Route locations must be unique positive integers' });
    }
    const locations = await Promise.all(ids.map((id) => TacticalLocations.findById(id)));
    if (locations.some((location) => !location)) return res.status(404).json({ error: 'Route location not found' });
    const optimized = optimizeRoute(locations[0], locations[1], locations.slice(2), Number(speedKmh));
    const route = await LogisticsRoutes.create({
      name: name.trim(),
      originLocationId: locations[0].id,
      destinationLocationId: locations[1].id,
      waypoints: optimized.waypoints.map(({ id, name: waypointName, latitude, longitude }) => ({
        id, name: waypointName, latitude, longitude,
      })),
      distanceKm: optimized.distanceKm,
      estimatedDurationMinutes: optimized.estimatedDurationMinutes,
      createdBy: req.user.id,
    });
    return res.status(201).json({ route });
  } catch (err) {
    logger.error('Failed to optimize logistics route', { error: err.message });
    return res.status(500).json({ error: 'Failed to optimize logistics route' });
  }
});

export default router;
