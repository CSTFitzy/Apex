import { Router, Request, Response } from 'express';
import { aarStore } from '../aar/store.js';
import { computeAnalytics } from '../aar/analytics.js';
import { getLessonsForOperation, searchLessons } from '../aar/lessons.js';
import { compareOperations } from '../aar/compare.js';
import { generateTrainingScenario } from '../aar/training.js';
import { buildReportBundle, toCsvReport, toHtmlReport, toJsonReport } from '../aar/reports.js';
import { generateNarrativeReport, isClaudeConfigured } from '../aar/claudeService.js';
import type { AARUnit, OperationEvent, TrainingScenario } from '../aar/types.js';

const router = Router();

// --- Operations (recording + replay) ---------------------------------------

router.post('/operations', (req: Request, res: Response) => {
  const { name, units } = req.body as { name?: string; units?: AARUnit[] };
  const operation = aarStore.startOperation(name ?? '', units ?? []);
  res.status(201).json(operation);
});

router.get('/operations', (_req: Request, res: Response) => {
  const summaries = aarStore.listOperations().map((op) => aarStore.summarize(op));
  res.json(summaries);
});

router.get('/operations/:id', (req: Request, res: Response) => {
  const operation = aarStore.getOperation(req.params.id);
  if (!operation) return res.status(404).json({ error: 'Operation not found' });
  res.json(operation);
});

router.post('/operations/:id/frames', (req: Request, res: Response) => {
  const { units, events, timestamp } = req.body as {
    units?: AARUnit[];
    events?: OperationEvent[];
    timestamp?: number;
  };
  const frame = aarStore.recordFrame(req.params.id, units ?? [], events ?? [], timestamp);
  if (!frame) return res.status(404).json({ error: 'Operation not found' });
  res.status(201).json(frame);
});

router.post('/operations/:id/end', (req: Request, res: Response) => {
  const operation = aarStore.endOperation(req.params.id);
  if (!operation) return res.status(404).json({ error: 'Operation not found' });
  res.json(operation);
});

router.post('/operations/:id/bookmarks', (req: Request, res: Response) => {
  const { timestamp, label } = req.body as { timestamp?: number; label?: string };
  if (typeof timestamp !== 'number' || !label) {
    return res.status(400).json({ error: 'timestamp (number) and label (string) are required' });
  }
  const bookmark = aarStore.addBookmark(req.params.id, timestamp, label);
  if (!bookmark) return res.status(404).json({ error: 'Operation not found' });
  res.status(201).json(bookmark);
});

// --- Analytics ---------------------------------------------------------------

router.get('/operations/:id/analytics', (req: Request, res: Response) => {
  const operation = aarStore.getOperation(req.params.id);
  if (!operation) return res.status(404).json({ error: 'Operation not found' });
  res.json(computeAnalytics(operation));
});

// --- Lessons learned -----------------------------------------------------------

router.get('/operations/:id/lessons', async (req: Request, res: Response) => {
  const operation = aarStore.getOperation(req.params.id);
  if (!operation) return res.status(404).json({ error: 'Operation not found' });
  const analytics = computeAnalytics(operation);
  try {
    const lessons = await getLessonsForOperation(operation, analytics);
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    res.json(query ? searchLessons(lessons, query) : lessons);
  } catch (error) {
    console.error(`Failed to generate lessons for operation ${operation.id}:`, error);
    res.status(500).json({ error: 'Failed to generate lessons learned' });
  }
});

router.get('/lessons/search', async (req: Request, res: Response) => {
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  const operations = aarStore.listOperations();
  const lessonsByOperation = await Promise.all(
    operations.map((op) => getLessonsForOperation(op, computeAnalytics(op)))
  );
  const allLessons = lessonsByOperation.flat();
  res.json(searchLessons(allLessons, query));
});

// --- AI status -----------------------------------------------------------------

router.get('/ai/status', (_req: Request, res: Response) => {
  res.json({ claudeConfigured: isClaudeConfigured() });
});

// --- Historical comparison ------------------------------------------------------

router.get('/compare', (req: Request, res: Response) => {
  const idsParam = typeof req.query.ids === 'string' ? req.query.ids : '';
  const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length < 2) {
    return res.status(400).json({ error: 'Provide at least two operation ids via ?ids=a,b' });
  }
  const operations = ids.map((id) => aarStore.getOperation(id)).filter((op): op is NonNullable<typeof op> => !!op);
  if (operations.length < 2) {
    return res.status(404).json({ error: 'One or more operations not found' });
  }
  res.json(compareOperations(operations));
});

// --- Training scenario generation -----------------------------------------------

router.post('/operations/:id/training', (req: Request, res: Response) => {
  const operation = aarStore.getOperation(req.params.id);
  if (!operation) return res.status(404).json({ error: 'Operation not found' });
  const difficulty = (req.body?.difficulty as TrainingScenario['difficulty']) ?? 'medium';
  const analytics = computeAnalytics(operation);
  res.json(generateTrainingScenario(operation, analytics, difficulty));
});

// --- Report export ------------------------------------------------------------

router.get('/operations/:id/narrative', async (req: Request, res: Response) => {
  const operation = aarStore.getOperation(req.params.id);
  if (!operation) return res.status(404).json({ error: 'Operation not found' });
  const analytics = computeAnalytics(operation);
  try {
    const lessons = await getLessonsForOperation(operation, analytics);
    if (!isClaudeConfigured()) {
      return res.status(503).json({ error: 'Claude API is not configured (set CLAUDE_API_KEY)' });
    }
    const narrative = await generateNarrativeReport(operation, analytics, lessons);
    res.json({ narrative, source: 'claude' });
  } catch (error) {
    console.error(`Failed to generate narrative for operation ${operation.id}:`, error);
    res.status(502).json({ error: 'Claude narrative generation failed' });
  }
});

router.get('/operations/:id/report', async (req: Request, res: Response) => {
  const operation = aarStore.getOperation(req.params.id);
  if (!operation) return res.status(404).json({ error: 'Operation not found' });
  const analytics = computeAnalytics(operation);
  const lessons = await getLessonsForOperation(operation, analytics);
  const bundle = await buildReportBundle(operation, analytics, lessons);
  const format = typeof req.query.format === 'string' ? req.query.format : 'json';

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="aar-${operation.id}.csv"`);
    return res.send(toCsvReport(bundle));
  }
  if (format === 'html') {
    res.setHeader('Content-Type', 'text/html');
    return res.send(toHtmlReport(bundle));
  }
  res.setHeader('Content-Type', 'application/json');
  res.send(toJsonReport(bundle));
});

export default router;
