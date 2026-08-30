/**
 * After-Action Review (AAR) routes: operation recording, tactical replay
 * data, analytics, lessons learned, historical comparison, AI-powered
 * analysis (Claude + GPT-4), training scenario generation, and report
 * export.
 */
import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import {
  startOperation,
  getOperation,
  listOperations,
  summarizeOperation,
  recordFrame,
  recordEvent,
  addBookmark,
  endOperation,
} from '../aar/store.js';
import { buildAnalyticsBundle } from '../aar/analytics.js';
import { getLessonsForOperation, searchLessons } from '../aar/lessons.js';
import { compareOperations } from '../aar/compare.js';
import { generateTrainingScenario, DIFFICULTY_LEVELS } from '../aar/training.js';
import { exportReport } from '../aar/reports.js';
import { generateAIAnalysis, getAIStatus } from '../aar/ai.js';
import { getMissingFields } from '../utils/validators.js';
import { logger } from '../utils/logger.js';

const router = Router();

function notFound(res, message = 'Operation not found') {
  return res.status(404).json({ error: message });
}

/**
 * POST /api/aar/operations
 * Start recording a new operation. Body: { name, commanders, objectives }.
 */
router.post('/operations', requireAuth, (req, res) => {
  try {
    const operation = startOperation(req.body || {});
    return res.status(201).json({ operation: summarizeOperation(operation) });
  } catch (err) {
    logger.error('Failed to start AAR operation', { error: err.message });
    return res.status(500).json({ error: 'Failed to start operation' });
  }
});

/**
 * GET /api/aar/operations
 * List all recorded operations (summaries only).
 */
router.get('/operations', requireAuth, (req, res) => {
  return res.json({ operations: listOperations() });
});

/**
 * GET /api/aar/operations/:id
 * Get full operation detail (frames, events, bookmarks).
 */
router.get('/operations/:id', requireAuth, (req, res) => {
  const operation = getOperation(req.params.id);
  if (!operation) return notFound(res);
  return res.json({ operation });
});

/**
 * POST /api/aar/frame
 * Record a frame of unit state for an in-progress operation.
 * Body: { operationId, timestamp, units }.
 */
router.post('/frame', requireAuth, (req, res) => {
  const missing = getMissingFields(req.body, ['operationId']);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  }
  const frame = recordFrame(req.body.operationId, req.body);
  if (!frame) return notFound(res);
  return res.status(201).json({ frame });
});

/**
 * POST /api/aar/events
 * Record a tactical event for an in-progress operation.
 * Body: { operationId, type, unitId, side, severity, position, details }.
 */
router.post('/events', requireAuth, (req, res) => {
  const missing = getMissingFields(req.body, ['operationId', 'type']);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  }
  const event = recordEvent(req.body.operationId, req.body);
  if (!event) return notFound(res);
  return res.status(201).json({ event });
});

/**
 * POST /api/aar/operations/:id/bookmarks
 * Add a bookmark/note at a point in the operation timeline.
 * Body: { label, note, timestamp }.
 */
router.post('/operations/:id/bookmarks', requireAuth, (req, res) => {
  const bookmark = addBookmark(req.params.id, req.body || {});
  if (!bookmark) return notFound(res);
  return res.status(201).json({ bookmark });
});

/**
 * POST /api/aar/operations/:id/end
 * Mark an operation as complete.
 */
router.post('/operations/:id/end', requireAuth, (req, res) => {
  const operation = endOperation(req.params.id, req.body || {});
  if (!operation) return notFound(res);
  return res.json({ operation: summarizeOperation(operation) });
});

/**
 * GET /api/aar/operations/:id/analytics
 * Per-unit and commander performance analytics.
 */
router.get('/operations/:id/analytics', requireAuth, (req, res) => {
  const operation = getOperation(req.params.id);
  if (!operation) return notFound(res);
  try {
    return res.json({ analytics: buildAnalyticsBundle(operation) });
  } catch (err) {
    logger.error('Failed to compute AAR analytics', { error: err.message });
    return res.status(500).json({ error: 'Failed to compute analytics' });
  }
});

/**
 * GET /api/aar/operations/:id/lessons?q=search
 * Rule-based lessons learned (searchable) across 6 categories.
 */
router.get('/operations/:id/lessons', requireAuth, (req, res) => {
  const operation = getOperation(req.params.id);
  if (!operation) return notFound(res);
  const lessons = req.query.q ? searchLessons(operation, String(req.query.q)) : getLessonsForOperation(operation);
  return res.json({ lessons });
});

/**
 * GET /api/aar/operations/:id/comparison?with=<operationId>
 * Compare metrics/trends/similarity against another recorded operation.
 */
router.get('/operations/:id/comparison', requireAuth, (req, res) => {
  const operationA = getOperation(req.params.id);
  if (!operationA) return notFound(res);
  const otherId = req.query.with;
  if (!otherId) {
    return res.status(400).json({ error: 'Missing required query parameter: with' });
  }
  const operationB = getOperation(String(otherId));
  if (!operationB) return notFound(res, 'Comparison operation not found');
  try {
    return res.json({ comparison: compareOperations(operationA, operationB) });
  } catch (err) {
    logger.error('Failed to compare AAR operations', { error: err.message });
    return res.status(500).json({ error: 'Failed to compare operations' });
  }
});

/**
 * POST /api/aar/operations/:id/training
 * Generate a training scenario from a past operation.
 * Body: { difficulty }.
 */
router.post('/operations/:id/training', requireAuth, (req, res) => {
  const operation = getOperation(req.params.id);
  if (!operation) return notFound(res);
  const difficulty = req.body?.difficulty;
  if (difficulty && !DIFFICULTY_LEVELS.includes(difficulty)) {
    return res.status(400).json({ error: `difficulty must be one of: ${DIFFICULTY_LEVELS.join(', ')}` });
  }
  try {
    return res.status(201).json({ scenario: generateTrainingScenario(operation, difficulty) });
  } catch (err) {
    logger.error('Failed to generate training scenario', { error: err.message });
    return res.status(500).json({ error: 'Failed to generate training scenario' });
  }
});

/**
 * POST /api/aar/operations/:id/ai-analysis
 * Generate AI-powered analysis (Claude narrative + GPT-4 threat assessment)
 * for an operation, with graceful rule-based fallback if the APIs are
 * unavailable or fail. Body: { forceRefresh }.
 */
router.post('/operations/:id/ai-analysis', requireAuth, async (req, res) => {
  const operation = getOperation(req.params.id);
  if (!operation) return notFound(res);
  try {
    const analysis = await generateAIAnalysis(operation, { forceRefresh: Boolean(req.body?.forceRefresh) });
    return res.json({ analysis, status: getAIStatus() });
  } catch (err) {
    logger.error('AI analysis failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to generate AI analysis' });
  }
});

/**
 * GET /api/aar/ai-status
 * Report whether Claude/GPT-4 are configured (for UI feature gating).
 */
router.get('/ai-status', requireAuth, (req, res) => {
  return res.json(getAIStatus());
});

/**
 * POST /api/aar/export
 * Export a report for an operation. Body: { operationId, format }.
 * format is one of 'json' | 'csv' | 'html' (default 'json').
 */
router.post('/export', requireAuth, (req, res) => {
  const missing = getMissingFields(req.body, ['operationId']);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  }
  const operation = getOperation(req.body.operationId);
  if (!operation) return notFound(res);
  try {
    const { contentType, body } = exportReport(operation, req.body.format || 'json');
    res.setHeader('Content-Type', contentType);
    return res.status(200).send(body);
  } catch (err) {
    logger.error('Failed to export AAR report', { error: err.message });
    return res.status(500).json({ error: 'Failed to export report' });
  }
});

export default router;
