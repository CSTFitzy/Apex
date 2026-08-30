import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import {
  archiveScenario,
  deleteScenario,
  duplicateScenario,
  getScenario,
  listScenarios,
  listScenarioVersions,
  restoreScenarioVersion,
  saveScenario,
  updateScenario,
} from '../services/tacticalService.js';

const router = Router();
router.use(requireAuth);

router.post('/compare', (req, res) => {
  const ids = Array.isArray(req.body.scenarioIds) ? req.body.scenarioIds : [];
  if (ids.length < 2) return res.status(400).json({ error: 'At least two scenarioIds are required' });
  const scenarios = ids.map(getScenario);
  if (scenarios.some((scenario) => !scenario)) return res.status(404).json({ error: 'Scenario not found' });
  return res.json({ scenarios });
});

router.get('/', (req, res) => {
  res.json({ scenarios: listScenarios(req.query) });
});

router.post('/', (req, res) => {
  if (!String(req.body.name || '').trim()) return res.status(400).json({ error: 'Scenario name is required' });
  const scenario = saveScenario({ ...req.body, createdBy: req.user.id, updatedBy: req.user.id });
  return res.status(201).json({ scenario });
});

router.get('/:id', (req, res) => {
  const scenario = getScenario(req.params.id);
  return scenario ? res.json({ scenario }) : res.status(404).json({ error: 'Scenario not found' });
});

router.put('/:id', (req, res) => {
  const scenario = updateScenario(req.params.id, { ...req.body, updatedBy: req.user.id });
  return scenario ? res.json({ scenario }) : res.status(404).json({ error: 'Scenario not found' });
});

router.delete('/:id', (req, res) => {
  return deleteScenario(req.params.id) ? res.status(204).send() : res.status(404).json({ error: 'Scenario not found' });
});

router.post('/:id/duplicate', (req, res) => {
  const scenario = duplicateScenario(req.params.id, { ...req.body, createdBy: req.user.id });
  return scenario ? res.status(201).json({ scenario }) : res.status(404).json({ error: 'Scenario not found' });
});

router.post('/:id/archive', (req, res) => {
  const scenario = archiveScenario(req.params.id, req.user.id);
  return scenario ? res.json({ scenario }) : res.status(404).json({ error: 'Scenario not found' });
});

router.get('/:id/versions', (req, res) => {
  if (!getScenario(req.params.id)) return res.status(404).json({ error: 'Scenario not found' });
  return res.json({ versions: listScenarioVersions(req.params.id) });
});

router.post('/:id/versions/:versionId/restore', (req, res) => {
  const scenario = restoreScenarioVersion(req.params.id, req.params.versionId, req.user.id);
  return scenario ? res.json({ scenario }) : res.status(404).json({ error: 'Scenario version not found' });
});

export default router;
