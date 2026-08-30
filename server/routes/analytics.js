/**
 * Real-time tactical analytics routes.
 *
 * KPI/BDA/heatmap computation is stateless: the client supplies the current
 * `units` and `events` arrays for the active simulation and the server
 * computes results on the fly (see server/analytics/engine.js). The only
 * server-side state is a short rolling buffer of ingested events used to
 * support late-joining dashboards and WebSocket broadcast.
 */
import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { computeKPIs, computeBDA, computeHeatmap, computeAllHeatmaps, HEATMAP_TYPES } from '../analytics/engine.js';
import { recordEvent, getRecentEvents } from '../analytics/store.js';
import { isNonEmptyString, getMissingFields } from '../utils/validators.js';
import { logger } from '../utils/logger.js';
import { broadcastAnalyticsEvent } from '../websocket/handlers.js';

const router = Router();

function parseUnitsAndEvents(body = {}) {
  const units = Array.isArray(body.units) ? body.units : [];
  const events = Array.isArray(body.events) ? body.events : [];
  return { units, events };
}

/**
 * POST /api/analytics/kpis
 * Compute headline KPIs (strength, readiness, morale, effectiveness,
 * casualty rate/trend, mission progress) from client-supplied units/events.
 */
router.post('/kpis', requireAuth, (req, res) => {
  try {
    const { units, events } = parseUnitsAndEvents(req.body);
    return res.json({ kpis: computeKPIs(units, events, { windowMs: req.body.windowMs }) });
  } catch (err) {
    logger.error('Failed to compute KPIs', { error: err.message });
    return res.status(500).json({ error: 'Failed to compute KPIs' });
  }
});

/**
 * POST /api/analytics/bda
 * Compute per-unit battle damage assessment plus friendly/enemy comparison.
 */
router.post('/bda', requireAuth, (req, res) => {
  try {
    const { units, events } = parseUnitsAndEvents(req.body);
    return res.json({ bda: computeBDA(units, events) });
  } catch (err) {
    logger.error('Failed to compute BDA', { error: err.message });
    return res.status(500).json({ error: 'Failed to compute BDA' });
  }
});

/**
 * POST /api/analytics/heatmap
 * Compute a single spatial heatmap grid. Body: { units, events, type, cellSize }.
 * If `type` is omitted, all 7 supported heatmaps are returned keyed by type.
 */
router.post('/heatmap', requireAuth, (req, res) => {
  const { units, events } = parseUnitsAndEvents(req.body);
  const { type, cellSize } = req.body;

  try {
    if (!type) {
      return res.json({ heatmaps: computeAllHeatmaps(units, events, { cellSize }) });
    }

    if (!Object.values(HEATMAP_TYPES).includes(type)) {
      return res.status(400).json({ error: `Unknown heatmap type: ${type}` });
    }

    return res.json({ heatmap: computeHeatmap(units, events, type, { cellSize }) });
  } catch (err) {
    logger.error('Failed to compute heatmap', { error: err.message });
    return res.status(500).json({ error: 'Failed to compute heatmap' });
  }
});

/**
 * GET /api/analytics/events
 * Fetch the recent tactical event log buffer.
 */
router.get('/events', requireAuth, (req, res) => {
  const limit = Number(req.query.limit);
  return res.json({ events: getRecentEvents(Number.isFinite(limit) ? limit : undefined) });
});

/**
 * POST /api/analytics/events
 * Ingest a tactical event (casualty report, enemy contact, unit destroyed,
 * etc). Buffers the event and broadcasts it to subscribed WebSocket clients
 * for live dashboards.
 */
router.post('/events', requireAuth, (req, res) => {
  const missing = getMissingFields(req.body, ['type']);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  }
  if (!isNonEmptyString(req.body.type)) {
    return res.status(400).json({ error: 'Invalid event type' });
  }

  const event = {
    ...req.body,
    id: req.body.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: req.body.timestamp || new Date().toISOString(),
    recordedBy: req.user?.id,
  };

  recordEvent(event);

  const wss = req.app.get('wss');
  if (wss) {
    try {
      broadcastAnalyticsEvent(wss, event);
    } catch (err) {
      logger.warn('Failed to broadcast analytics event', { error: err.message });
    }
  }

  return res.status(201).json({ event });
});

export default router;
