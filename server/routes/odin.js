/**
 * ODIN (Open Data Integration Network / C2IS) intelligence routes.
 *
 * These endpoints are stubs intended to be filled in with a real ODIN
 * integration (see API_INTEGRATIONS.md for connection examples). For now
 * they return mock data so the frontend has a stable contract to build
 * against.
 */
import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { IntelligenceReports } from '../db/models.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * GET /api/odin/status
 * Report the connection status of the ODIN integration.
 */
router.get('/status', requireAuth, (req, res) => {
  return res.json({
    connected: false,
    url: process.env.ODIN_URL || 'wss://odin.syncpoint.io',
    message: 'ODIN integration not yet configured. See API_INTEGRATIONS.md.',
  });
});

/**
 * GET /api/odin/symbols
 * Stub: return military symbology (MIL-STD-2525C) currently tracked.
 * TODO: replace with live data pulled from the ODIN WebSocket feed.
 */
router.get('/symbols', requireAuth, (req, res) => {
  return res.json({ symbols: [] });
});

/**
 * GET /api/odin/reports
 * List intelligence reports stored locally (linked to ODIN references).
 */
router.get('/reports', requireAuth, async (req, res) => {
  try {
    const reports = await IntelligenceReports.list();
    return res.json({ reports });
  } catch (err) {
    logger.error('Failed to list intelligence reports', { error: err.message });
    return res.status(500).json({ error: 'Failed to load intelligence reports' });
  }
});

/**
 * POST /api/odin/reports
 * Create a new intelligence report.
 */
router.post('/reports', requireAuth, async (req, res) => {
  const { title, summary, source, odinReference, locationId, metadata } = req.body || {};

  if (!title) {
    return res.status(400).json({ error: 'title is required' });
  }

  try {
    const report = await IntelligenceReports.create({
      title,
      summary,
      source,
      odinReference,
      locationId,
      reportedBy: req.user.id,
      metadata,
    });
    return res.status(201).json({ report });
  } catch (err) {
    logger.error('Failed to create intelligence report', { error: err.message });
    return res.status(500).json({ error: 'Failed to create intelligence report' });
  }
});

export default router;
