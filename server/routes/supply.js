/**
 * Supply chain routes: stock levels, consumption, transfers, depletion
 * forecasting and depot/logistics-route planning.
 */
import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import {
  Units,
  UnitSupplies,
  SupplyDepots,
  SupplyEvents,
  SupplyTransfers,
} from '../db/models.js';
import { broadcastSupplyUpdate } from '../websocket/handlers.js';
import {
  SUPPLY_TYPES,
  SUPPLY_UNITS,
  SUPPLY_THRESHOLDS,
  isSupplyType,
} from '../supply/types.js';
import {
  forecastUnit,
  buildAlerts,
  recommendResupply,
  aggregateBySupplyType,
  worstStatus,
} from '../supply/forecast.js';
import { planResupplyRoutes } from '../supply/routing.js';
import { getMissingFields, isValidLatitude, isValidLongitude } from '../utils/validators.js';
import { logger } from '../utils/logger.js';

const router = Router();

/** Default observation window (hours) used when blending consumption rates. */
const DEFAULT_WINDOW_HOURS = 24;

/**
 * Load every unit with its supply lines and recent observed consumption, and
 * turn them into forecasts. Shared by /status and /forecast.
 * @param {number} windowHours
 */
async function loadUnitForecasts(windowHours) {
  const [rows, consumption] = await Promise.all([
    UnitSupplies.listAll(),
    SupplyEvents.consumptionSince(windowHours),
  ]);

  const observed = new Map(
    consumption.map((row) => [`${row.unit_key}:${row.supply_type}`, Number(row.total)])
  );

  const byUnit = new Map();
  for (const row of rows) {
    if (!byUnit.has(row.unit_key)) {
      byUnit.set(row.unit_key, {
        unit: {
          id: row.unit_key,
          unit_id: row.unit_id,
          name: row.name,
          callsign: row.callsign,
          latitude: row.latitude,
          longitude: row.longitude,
        },
        items: [],
      });
    }
    byUnit.get(row.unit_key).items.push({
      supplyType: row.supply_type,
      quantity: Number(row.quantity),
      capacity: Number(row.capacity),
      consumptionRate: Number(row.consumption_rate),
      observedQuantity: observed.get(`${row.unit_key}:${row.supply_type}`) || 0,
      windowHours,
    });
  }

  const now = new Date();
  return [...byUnit.values()].map(({ unit, items }) => forecastUnit(unit, items, now));
}

/** Parse and clamp the `window` query parameter. */
function parseWindowHours(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0) return DEFAULT_WINDOW_HOURS;
  return Math.min(hours, 24 * 30);
}

/**
 * GET /api/supply/status
 * Current supply levels for every unit plus aggregate totals and alerts.
 */
router.get('/status', requireAuth, async (req, res) => {
  try {
    const windowHours = parseWindowHours(req.query.window);
    const units = await loadUnitForecasts(windowHours);

    return res.json({
      generatedAt: new Date().toISOString(),
      windowHours,
      supplyTypes: SUPPLY_TYPES,
      unitsOfMeasure: SUPPLY_UNITS,
      thresholds: SUPPLY_THRESHOLDS,
      overallStatus: worstStatus(units.map((unit) => unit.status)),
      aggregate: aggregateBySupplyType(units),
      units,
      alerts: buildAlerts(units),
    });
  } catch (err) {
    logger.error('Failed to load supply status', { error: err.message });
    return res.status(500).json({ error: 'Failed to load supply status' });
  }
});

/**
 * GET /api/supply/forecast
 * Predicted time-to-depletion per unit/supply type, with resupply
 * recommendations and optimized logistics routes from the nearest depot.
 */
router.get('/forecast', requireAuth, async (req, res) => {
  try {
    const windowHours = parseWindowHours(req.query.window);
    const [units, depots] = await Promise.all([
      loadUnitForecasts(windowHours),
      SupplyDepots.list(),
    ]);

    const recommendations = recommendResupply(units);
    const routes = planResupplyRoutes(recommendations, depots, {
      terrain: req.query.terrain || undefined,
      threats: [],
    });

    return res.json({
      generatedAt: new Date().toISOString(),
      windowHours,
      units,
      alerts: buildAlerts(units),
      recommendations,
      routes,
    });
  } catch (err) {
    logger.error('Failed to build supply forecast', { error: err.message });
    return res.status(500).json({ error: 'Failed to build supply forecast' });
  }
});

/**
 * GET /api/supply/depots
 * Supply depot locations and on-hand stock.
 */
router.get('/depots', requireAuth, async (req, res) => {
  try {
    const depots = await SupplyDepots.list();
    return res.json({ depots });
  } catch (err) {
    logger.error('Failed to list supply depots', { error: err.message });
    return res.status(500).json({ error: 'Failed to load supply depots' });
  }
});

/**
 * POST /api/supply/depots
 * Register a new supply depot.
 */
router.post('/depots', requireAuth, async (req, res) => {
  const missing = getMissingFields(req.body, ['name', 'latitude', 'longitude']);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  }
  if (!isValidLatitude(req.body.latitude) || !isValidLongitude(req.body.longitude)) {
    return res.status(400).json({ error: 'Invalid latitude or longitude' });
  }

  const stock = {};
  for (const [type, quantity] of Object.entries(req.body.stock || {})) {
    if (!isSupplyType(type)) {
      return res.status(400).json({ error: `Unknown supply type: ${type}` });
    }
    if (!Number.isFinite(Number(quantity)) || Number(quantity) < 0) {
      return res.status(400).json({ error: `Invalid stock quantity for ${type}` });
    }
    stock[type] = Number(quantity);
  }

  try {
    const depot = await SupplyDepots.create({
      name: req.body.name,
      latitude: Number(req.body.latitude),
      longitude: Number(req.body.longitude),
      status: req.body.status || 'operational',
      stock,
    });
    return res.status(201).json({ depot });
  } catch (err) {
    logger.error('Failed to create supply depot', { error: err.message });
    return res.status(500).json({ error: 'Failed to create supply depot' });
  }
});

/**
 * POST /api/supply/units
 * Register (or update) a unit and seed its supply lines. Units must exist
 * before consumption or transfers can be recorded against them.
 */
router.post('/units', requireAuth, async (req, res) => {
  const missing = getMissingFields(req.body, ['unitId', 'name']);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  }

  const { latitude, longitude } = req.body;
  if (latitude !== undefined && latitude !== null && !isValidLatitude(latitude)) {
    return res.status(400).json({ error: 'Invalid latitude' });
  }
  if (longitude !== undefined && longitude !== null && !isValidLongitude(longitude)) {
    return res.status(400).json({ error: 'Invalid longitude' });
  }

  try {
    const unit = await Units.create({
      unitId: String(req.body.unitId),
      name: req.body.name,
      callsign: req.body.callsign,
      echelon: req.body.echelon,
      force: req.body.force,
      status: req.body.status,
      personnel: Number(req.body.personnel) || 0,
      latitude: latitude === undefined ? null : Number(latitude),
      longitude: longitude === undefined ? null : Number(longitude),
      metadata: req.body.metadata || {},
    });
    await UnitSupplies.seedDefaults(unit.id, req.body.supplies || {});
    const supplies = await UnitSupplies.listForUnit(unit.id);
    return res.status(201).json({ unit, supplies });
  } catch (err) {
    logger.error('Failed to register unit', { error: err.message });
    return res.status(500).json({ error: 'Failed to register unit' });
  }
});

/**
 * GET /api/supply/units
 * Optimized unit roster. Supports bounding-box filtering for map viewports
 * and force/status filters, served from the unit cache where possible.
 */
router.get('/units', requireAuth, async (req, res) => {
  const { minLat, maxLat, minLon, maxLon, force, status } = req.query;

  try {
    if (minLat !== undefined || maxLat !== undefined || minLon !== undefined || maxLon !== undefined) {
      if (
        !isValidLatitude(minLat) ||
        !isValidLatitude(maxLat) ||
        !isValidLongitude(minLon) ||
        !isValidLongitude(maxLon)
      ) {
        return res.status(400).json({ error: 'Invalid bounding box' });
      }
      const units = await Units.findWithinBounds({
        minLatitude: Number(minLat),
        maxLatitude: Number(maxLat),
        minLongitude: Number(minLon),
        maxLongitude: Number(maxLon),
      });
      return res.json({ units });
    }

    const units = await Units.listCached({ force, status });
    return res.json({ units });
  } catch (err) {
    logger.error('Failed to list units', { error: err.message });
    return res.status(500).json({ error: 'Failed to load units' });
  }
});

/**
 * POST /api/supply/consume
 * Record a consumption event against a unit's stock.
 */
router.post('/consume', requireAuth, async (req, res) => {
  const missing = getMissingFields(req.body, ['unitId', 'supplyType', 'quantity']);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  }

  const { unitId, supplyType, quantity, reason } = req.body;
  if (!isSupplyType(supplyType)) {
    return res.status(400).json({ error: `Unknown supply type: ${supplyType}` });
  }
  const amount = Number(quantity);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Quantity must be a positive number' });
  }

  try {
    const unit = await Units.findByUnitId(String(unitId));
    if (!unit) return res.status(404).json({ error: 'Unit not found' });

    const result = await SupplyEvents.recordConsumption({
      unitPrimaryKey: unit.id,
      supplyType,
      quantity: amount,
      reason,
      recordedBy: req.user.id,
    });

    broadcastSupplyUpdate({
      kind: 'consumption',
      unitId: unit.unit_id,
      supplyType,
      quantity: amount,
      remaining: Number(result.supply.quantity),
      supplyStatus: result.unit.supply_status,
    });

    return res.status(201).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    logger.error('Failed to record supply consumption', { error: err.message });
    return res.status(500).json({ error: 'Failed to record supply consumption' });
  }
});

/**
 * POST /api/supply/transfer
 * Transfer supplies between two units, or from a depot to a unit.
 */
router.post('/transfer', requireAuth, async (req, res) => {
  const missing = getMissingFields(req.body, ['toUnitId', 'supplyType', 'quantity']);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  }

  const { fromUnitId, fromDepotId, toUnitId, supplyType, quantity } = req.body;
  if (!isSupplyType(supplyType)) {
    return res.status(400).json({ error: `Unknown supply type: ${supplyType}` });
  }
  const amount = Number(quantity);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Quantity must be a positive number' });
  }
  if (!fromUnitId && !fromDepotId) {
    return res.status(400).json({ error: 'A source unit (fromUnitId) or depot (fromDepotId) is required' });
  }
  if (fromUnitId && String(fromUnitId) === String(toUnitId)) {
    return res.status(400).json({ error: 'Source and destination units must differ' });
  }

  try {
    const destination = await Units.findByUnitId(String(toUnitId));
    if (!destination) return res.status(404).json({ error: 'Destination unit not found' });

    let source = null;
    if (fromUnitId) {
      source = await Units.findByUnitId(String(fromUnitId));
      if (!source) return res.status(404).json({ error: 'Source unit not found' });
    }

    let depotId = null;
    if (!source && fromDepotId) {
      const depot = await SupplyDepots.findById(fromDepotId);
      if (!depot) return res.status(404).json({ error: 'Supply depot not found' });
      depotId = depot.id;
    }

    const transfer = await SupplyTransfers.transfer({
      fromUnitKey: source ? source.id : null,
      fromDepotId: depotId,
      toUnitKey: destination.id,
      supplyType,
      quantity: amount,
      initiatedBy: req.user.id,
    });

    broadcastSupplyUpdate({
      kind: 'transfer',
      fromUnitId: source ? source.unit_id : null,
      fromDepotId: depotId,
      toUnitId: destination.unit_id,
      supplyType,
      quantity: amount,
    });

    return res.status(201).json({ transfer });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    logger.error('Failed to transfer supplies', { error: err.message });
    return res.status(500).json({ error: 'Failed to transfer supplies' });
  }
});

/**
 * GET /api/supply/consumption
 * Recent consumption events, used for the consumption rate graphs.
 */
router.get('/consumption', requireAuth, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
  try {
    const events = await SupplyEvents.recentEvents(limit);
    return res.json({ events });
  } catch (err) {
    logger.error('Failed to load consumption events', { error: err.message });
    return res.status(500).json({ error: 'Failed to load consumption events' });
  }
});

export default router;
