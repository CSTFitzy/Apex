import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { buildReview, compareOperations, createOperation, createTrainingScenario, exportReview, getOperation, listOperations } from '../services/aar.js';

const router = Router();
router.use(requireAuth);

router.get('/status', (_req, res) => res.json({ claude: Boolean(process.env.ANTHROPIC_API_KEY), gpt4: Boolean(process.env.OPENAI_API_KEY) }));
router.get('/operations', (req, res) => res.json({ operations: listOperations(req.user.id).map(({ events, units, ...operation }) => ({ ...operation, eventCount: events.length, unitCount: units.length })) }));
router.post('/operations', (req, res) => res.status(201).json({ operation: createOperation(req.body || {}, req.user.id) }));
router.get('/operations/:id', (req, res) => {
  const operation = getOperation(req.params.id, req.user.id);
  return operation ? res.json({ operation }) : res.status(404).json({ error: 'Operation not found' });
});
router.post('/operations/:id/review', async (req, res) => {
  const operation = getOperation(req.params.id, req.user.id);
  if (!operation) return res.status(404).json({ error: 'Operation not found' });
  return res.json({ review: await buildReview(operation) });
});
router.get('/operations/:id/replay', (req, res) => {
  const operation = getOperation(req.params.id, req.user.id);
  if (!operation) return res.status(404).json({ error: 'Operation not found' });
  return res.json({ frames: [...operation.events].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)) });
});
router.get('/operations/:id/compare', (req, res) => {
  const operation = getOperation(req.params.id, req.user.id);
  if (!operation) return res.status(404).json({ error: 'Operation not found' });
  return res.json({ comparisons: compareOperations(operation, listOperations(req.user.id).filter((item) => item.id !== operation.id)) });
});
router.post('/operations/:id/training-scenario', async (req, res) => {
  const operation = getOperation(req.params.id, req.user.id);
  if (!operation) return res.status(404).json({ error: 'Operation not found' });
  return res.json({ scenario: createTrainingScenario(await buildReview(operation)) });
});
router.get('/operations/:id/export/:format', async (req, res) => {
  const operation = getOperation(req.params.id, req.user.id);
  if (!operation) return res.status(404).json({ error: 'Operation not found' });
  if (!['json', 'csv', 'html'].includes(req.params.format)) return res.status(400).json({ error: 'Unsupported report format' });
  const report = exportReview(await buildReview(operation), req.params.format);
  res.type(report.contentType).attachment(`aar-${operation.id}.${report.extension}`).send(report.body);
});

export default router;
