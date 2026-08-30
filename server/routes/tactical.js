/**
 * Tactical management routes: locations/targets and analysis sessions.
 */
import { Router } from 'express';
import { mkdir } from 'fs/promises';
import path from 'path';
import multer from 'multer';
import { isAllowedDocumentType } from '../services/documentParser.js';
import {
  addDocument,
  exportMarkupGeoJson,
  getDocumentPreview,
  listDocuments,
  listMarkupSets,
  listUnits,
  removeDocument,
  removeUnit,
  saveMarkupSet,
  saveUnits,
  searchDocuments,
} from '../services/tacticalService.js';
import { requireAuth } from '../auth/middleware.js';
import { TacticalLocations, AnalysisSessions } from '../db/models.js';
import { isValidLatitude, isValidLongitude, getMissingFields } from '../utils/validators.js';
import { logger } from '../utils/logger.js';

const router = Router();
const UPLOAD_DIR = path.resolve(process.cwd(), 'server/uploads/documents');
await mkdir(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (!isAllowedDocumentType(file.originalname, file.mimetype)) {
      return callback(new Error('Unsupported file type. Upload PDF, DOCX, TXT, JPG or PNG files.'));
    }
    return callback(null, true);
  },
});

function handleDocumentUpload(req, res, next) {
  upload.single('document')(req, res, (err) => {
    if (!err) return next();
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: err.message });
  });
}

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

/**
 * GET /api/tactical/units
 * Retrieve saved NATO/MIL-STD-2525D unit dispositions for a scenario.
 */
router.get('/units', requireAuth, (req, res) => {
  return res.json({ units: listUnits(req.query.scenarioId) });
});

/**
 * POST /api/tactical/units
 * Save one unit or an array of units. Unit type/affiliation/echelon are
 * validated against the supported MIL-STD-2525D picker values.
 */
router.post('/units', requireAuth, (req, res) => {
  try {
    const units = saveUnits(req.body);
    return res.status(201).json({ units });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.delete('/units/:id', requireAuth, (req, res) => {
  removeUnit(req.params.id);
  return res.status(204).send();
});

/**
 * POST /api/tactical/markups
 * Save a timestamped GeoJSON markup version for a scenario.
 */
router.post('/markups', requireAuth, (req, res) => {
  try {
    const markupSet = saveMarkupSet(req.body);
    return res.status(201).json({ markupSet });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get('/markups/:scenarioId', requireAuth, (req, res) => {
  return res.json({ markupSets: listMarkupSets(req.params.scenarioId) });
});

router.get('/markups/:scenarioId/export', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'application/geo+json');
  return res.json(exportMarkupGeoJson(req.params.scenarioId));
});

/**
 * POST /api/tactical/documents/upload
 * Upload an intelligence document, extract searchable text when possible, and
 * retain metadata for scenario planning.
 */
router.post('/documents/upload', requireAuth, handleDocumentUpload, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Document file is required' });
  }

  try {
    const document = await addDocument({
      file: req.file,
      scenarioId: req.body.scenarioId,
      tags: req.body.tags,
      uploadedBy: req.user?.username || req.user?.id || 'unknown',
    });
    return res.status(document.duplicate ? 200 : 201).json({ document });
  } catch (err) {
    logger.error('Failed to process tactical document', { error: err.message });
    return res.status(500).json({ error: 'Failed to process document' });
  }
});

router.get('/documents', requireAuth, (req, res) => {
  return res.json({ documents: listDocuments(req.query.scenarioId) });
});

router.get('/documents/search', requireAuth, (req, res) => {
  return res.json({ documents: searchDocuments({ query: req.query.q, scenarioId: req.query.scenarioId }) });
});

router.get('/documents/:docId/preview', requireAuth, (req, res) => {
  const preview = getDocumentPreview(req.params.docId);
  if (!preview) return res.status(404).json({ error: 'Document not found' });
  return res.json(preview);
});

router.delete('/documents/:docId', requireAuth, (req, res) => {
  removeDocument(req.params.docId);
  return res.status(204).send();
});

export default router;
