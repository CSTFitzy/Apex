/**
 * Tactical management routes: locations/targets and analysis sessions.
 */
import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { TacticalLocations, AnalysisSessions } from '../db/models.js';
import { isValidLatitude, isValidLongitude, getMissingFields } from '../utils/validators.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * GET /api/tactical/locations
 * List all tracked tactical locations/targets.
 */
router.get('/locations', requireAuth, async (req, res) => {
  try {
    const locations = await TacticalLocations.list();
    return res.json({ locations });
  } catch (err) {
    logger.error('Failed to list tactical locations', { error: err.message });
    return res.status(500).json({ error: 'Failed to load tactical locations' });
  }
});

/**
 * POST /api/tactical/locations
 * Create a new tactical location/target.
 */
router.post('/locations', requireAuth, async (req, res) => {
  const missing = getMissingFields(req.body, ['name', 'latitude', 'longitude']);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  }

  const { name, description, latitude, longitude, sidc, category } = req.body;

  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) {
    return res.status(400).json({ error: 'Invalid latitude or longitude' });
  }

  try {
    const location = await TacticalLocations.create({
      name,
      description,
      latitude,
      longitude,
      sidc,
      category,
      createdBy: req.user.id,
    });
    return res.status(201).json({ location });
  } catch (err) {
    logger.error('Failed to create tactical location', { error: err.message });
    return res.status(500).json({ error: 'Failed to create tactical location' });
  }
});

/**
 * GET /api/tactical/locations/:id
 */
router.get('/locations/:id', requireAuth, async (req, res) => {
  try {
    const location = await TacticalLocations.findById(req.params.id);
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }
    return res.json({ location });
  } catch (err) {
    logger.error('Failed to fetch tactical location', { error: err.message });
    return res.status(500).json({ error: 'Failed to fetch tactical location' });
  }
});

/**
 * DELETE /api/tactical/locations/:id
 */
router.delete('/locations/:id', requireAuth, async (req, res) => {
  try {
    await TacticalLocations.remove(req.params.id);
    return res.status(204).send();
  } catch (err) {
    logger.error('Failed to delete tactical location', { error: err.message });
    return res.status(500).json({ error: 'Failed to delete tactical location' });
  }
});

/**
 * GET /api/tactical/analysis
 * List analysis sessions (terrain analysis, threat assessments, etc).
 */
router.get('/analysis', requireAuth, async (req, res) => {
  try {
    const sessions = await AnalysisSessions.list();
    return res.json({ sessions });
  } catch (err) {
    logger.error('Failed to list analysis sessions', { error: err.message });
    return res.status(500).json({ error: 'Failed to load analysis sessions' });
  }
});

/**
 * POST /api/tactical/analysis
 * Start a new analysis session.
 */
router.post('/analysis', requireAuth, async (req, res) => {
  const missing = getMissingFields(req.body, ['name']);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  }

  try {
    const session = await AnalysisSessions.create({
      name: req.body.name,
      ownerId: req.user.id,
      parameters: req.body.parameters,
    });
    return res.status(201).json({ session });
  } catch (err) {
    logger.error('Failed to create analysis session', { error: err.message });
    return res.status(500).json({ error: 'Failed to create analysis session' });
  }
});

export default router;
