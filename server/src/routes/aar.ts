import { Router, Request, Response } from 'express';
import type { CreateAARRequest } from '../aar/types.js';
import { generateAAR } from '../aar/aarGeneratorService.js';
import { compareOperations } from '../aar/comparisonService.js';
import { deleteOperation, getOperation, listOperations, saveOperation } from '../aar/store.js';

const router = Router();

function unitPerformanceToCsv(operation: ReturnType<typeof getOperation>): string {
  if (!operation) return '';
  const header = [
    'unitId',
    'unitName',
    'affiliation',
    'startingStrength',
    'endingStrength',
    'casualties',
    'casualtyRatePct',
    'engagementsInvolved',
    'combatEffectivenessScore',
    'finalStatus',
  ];
  const rows = operation.unitPerformance.map((u) =>
    [
      u.unitId,
      u.unitName,
      u.affiliation,
      u.startingStrength,
      u.endingStrength,
      u.casualties,
      u.casualtyRatePct,
      u.engagementsInvolved,
      u.combatEffectivenessScore,
      u.finalStatus,
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
  );
  return [header.join(','), ...rows].join('\n');
}

/**
 * GET /api/aar
 * List all generated AAR summaries (most recent first).
 */
router.get('/', (_req: Request, res: Response) => {
  res.json({ operations: listOperations().map((op) => op.summary) });
});

/**
 * POST /api/aar/generate
 * Generate a new AAR from a recorded operation timeline (initial unit
 * states + frame-by-frame event log captured by the tactical simulation).
 */
router.post('/generate', (req: Request, res: Response) => {
  try {
    const body = req.body as CreateAARRequest;
    if (!Array.isArray(body.initialUnits) || !Array.isArray(body.frames)) {
      res.status(400).json({ error: 'initialUnits and frames arrays are required' });
      return;
    }
    const operation = generateAAR(body);
    saveOperation(operation);
    res.status(201).json(operation);
  } catch (error) {
    console.error('AAR generation failed:', error);
    res.status(500).json({ error: 'Failed to generate AAR' });
  }
});

/**
 * GET /api/aar/compare/:opId1/:opId2
 * Compare summary metrics between two previously generated AAR operations.
 */
router.get('/compare/:opId1/:opId2', (req: Request, res: Response) => {
  const a = getOperation(req.params.opId1);
  const b = getOperation(req.params.opId2);
  if (!a || !b) {
    res.status(404).json({ error: 'One or both operations were not found' });
    return;
  }
  res.json(compareOperations(a, b));
});

/**
 * GET /api/aar/:operationId
 * Get the full AAR record (performance analytics, commander evaluation,
 * lessons learned) for a single operation.
 */
router.get('/:operationId', (req: Request, res: Response) => {
  const operation = getOperation(req.params.operationId);
  if (!operation) {
    res.status(404).json({ error: 'Operation not found' });
    return;
  }
  res.json(operation);
});

/**
 * GET /api/aar/:operationId/replay
 * Get the frame-by-frame event log used to drive tactical scenario replay.
 */
router.get('/:operationId/replay', (req: Request, res: Response) => {
  const operation = getOperation(req.params.operationId);
  if (!operation) {
    res.status(404).json({ error: 'Operation not found' });
    return;
  }
  res.json({
    operationId: operation.operationId,
    initialUnits: operation.initialUnits,
    frames: operation.frames,
    events: operation.events,
  });
});

/**
 * GET /api/aar/:operationId/lessons
 * Get the AI-generated lessons learned for the operation.
 */
router.get('/:operationId/lessons', (req: Request, res: Response) => {
  const operation = getOperation(req.params.operationId);
  if (!operation) {
    res.status(404).json({ error: 'Operation not found' });
    return;
  }
  res.json({ operationId: operation.operationId, lessons: operation.lessons });
});

/**
 * GET /api/aar/:operationId/export?format=json|csv
 * Export the AAR report. JSON returns the full record; CSV returns the
 * per-unit performance table for use in spreadsheet tools.
 */
router.get('/:operationId/export', (req: Request, res: Response) => {
  const operation = getOperation(req.params.operationId);
  if (!operation) {
    res.status(404).json({ error: 'Operation not found' });
    return;
  }
  const format = (req.query.format as string) || 'json';
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="aar-${operation.operationId}.csv"`
    );
    res.send(unitPerformanceToCsv(operation));
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="aar-${operation.operationId}.json"`
  );
  res.send(JSON.stringify(operation, null, 2));
});

/**
 * DELETE /api/aar/:operationId
 * Remove a stored AAR operation.
 */
router.delete('/:operationId', (req: Request, res: Response) => {
  const removed = deleteOperation(req.params.operationId);
  if (!removed) {
    res.status(404).json({ error: 'Operation not found' });
    return;
  }
  res.status(204).send();
});

export default router;
