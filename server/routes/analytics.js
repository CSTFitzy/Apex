/**
 * Live tactical analytics routes: real-time KPIs, Battle Damage Assessment
 * (BDA), and tactical heatmaps derived from the live simulation engine.
 */
import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { simulationEngine } from '../simulation/engine.js';
import { computeKpis, computeBda, summarizeBda, computeHeatmap, computeHeatmaps, HEATMAP_TYPES } from '../analytics/tactical.js';
import { logger } from '../utils/logger.js';

const router = Router();

function currentState() {
  return { units: simulationEngine.getUnits(), events: simulationEngine.getEvents() };
}

/**
 * GET /api/analytics/kpis
 * Real-time key performance indicators for the current operation.
 */
router.get('/kpis', requireAuth, (req, res) => {
  try {
    return res.json({ kpis: computeKpis(currentState()) });
  } catch (err) {
    logger.error('Failed to compute KPIs', { error: err.message });
    return res.status(500).json({ error: 'Failed to compute KPIs' });
  }
});

/**
 * GET /api/analytics/bda
 * Battle Damage Assessment table rows, most recent first.
 */
router.get('/bda', requireAuth, (req, res) => {
  try {
    const bda = computeBda(currentState());
    return res.json({ bda, summary: summarizeBda(bda) });
  } catch (err) {
    logger.error('Failed to compute BDA', { error: err.message });
    return res.status(500).json({ error: 'Failed to compute BDA' });
  }
});

/**
 * GET /api/analytics/heatmaps
 * All 7 tactical heatmap layers keyed by type.
 */
router.get('/heatmaps', requireAuth, (req, res) => {
  try {
    return res.json({ types: HEATMAP_TYPES, heatmaps: computeHeatmaps(currentState()) });
  } catch (err) {
    logger.error('Failed to compute heatmaps', { error: err.message });
    return res.status(500).json({ error: 'Failed to compute heatmaps' });
  }
});

/**
 * GET /api/analytics/heatmaps/:type
 * A single named heatmap layer (see HEATMAP_TYPES).
 */
router.get('/heatmaps/:type', requireAuth, (req, res) => {
  const { type } = req.params;
  const points = computeHeatmap(type, currentState());
  if (points === null) {
    return res.status(404).json({ error: `Unknown heatmap type: ${type}`, types: HEATMAP_TYPES });
  }
  return res.json({ type, points });
});

/**
 * GET /api/analytics/units
 * Current raw unit roster (for map overlays / debugging).
 */
router.get('/units', requireAuth, (req, res) => {
  return res.json({ units: simulationEngine.getUnits() });
});

export default router;
