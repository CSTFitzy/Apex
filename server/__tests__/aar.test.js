import { describe, it, expect, beforeEach } from 'vitest';
import {
  startOperation,
  recordFrame,
  recordEvent,
  addBookmark,
  endOperation,
  getOperation,
  listOperations,
  clearOperations,
} from '../aar/store.js';
import {
  computeUnitAnalytics,
  rankUnitPerformance,
  computeCommanderEffectiveness,
  computeForceMetrics,
} from '../aar/analytics.js';
import { generateLessons, getLessonsForOperation, searchLessons, LESSON_CATEGORIES, clearLessonsCache } from '../aar/lessons.js';
import { compareOperations, computeSimilarityScore } from '../aar/compare.js';
import { generateTrainingScenario, DIFFICULTY_LEVELS } from '../aar/training.js';
import { exportJSON, exportCSV, exportHTML, exportReport } from '../aar/reports.js';

function buildSampleOperation() {
  const operation = startOperation({ name: 'Test Op', commanders: ['Alpha'], objectives: ['Secure the ridge'] });

  recordFrame(operation.id, {
    units: [
      { id: 'f1', side: 'friendly', name: 'Alpha Squad', type: 'infantry', strength: 100, maxStrength: 100, status: 'active' },
      { id: 'f2', side: 'friendly', name: 'Bravo Squad', type: 'infantry', strength: 50, maxStrength: 50, status: 'active' },
      { id: 'e1', side: 'enemy', name: 'Hostile A', type: 'infantry', strength: 80, maxStrength: 80, status: 'active' },
    ],
  });

  recordEvent(operation.id, { type: 'enemy_contact', unitId: 'f1', side: 'friendly', severity: 1, position: { lat: 1, lng: 1 } });
  recordEvent(operation.id, { type: 'casualty', unitId: 'f1', side: 'friendly', severity: 10 });
  recordEvent(operation.id, { type: 'casualty', unitId: 'f2', side: 'friendly', severity: 50 });
  recordEvent(operation.id, { type: 'unit_destroyed', unitId: 'f2', side: 'friendly' });
  recordEvent(operation.id, { type: 'casualty', unitId: 'e1', side: 'enemy', severity: 30 });

  recordFrame(operation.id, {
    units: [
      { id: 'f1', side: 'friendly', name: 'Alpha Squad', type: 'infantry', strength: 90, maxStrength: 100, status: 'active' },
      { id: 'f2', side: 'friendly', name: 'Bravo Squad', type: 'infantry', strength: 0, maxStrength: 50, status: 'destroyed' },
      { id: 'e1', side: 'enemy', name: 'Hostile A', type: 'infantry', strength: 50, maxStrength: 80, status: 'active' },
    ],
  });

  addBookmark(operation.id, { label: 'Contact made', note: 'Initial contact with hostile element' });
  endOperation(operation.id);

  return getOperation(operation.id);
}

describe('AAR operation store', () => {
  beforeEach(() => clearOperations());

  it('records frames, events, and bookmarks for an operation', () => {
    const operation = buildSampleOperation();
    expect(operation.frames).toHaveLength(2);
    expect(operation.events).toHaveLength(5);
    expect(operation.bookmarks).toHaveLength(1);
    expect(operation.status).toBe('complete');
    expect(operation.endedAt).not.toBeNull();
  });

  it('lists operations as summaries', () => {
    buildSampleOperation();
    const operations = listOperations();
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ name: 'Test Op', frameCount: 2, eventCount: 5, bookmarkCount: 1 });
  });

  it('returns null for unknown operations', () => {
    expect(getOperation('missing')).toBeNull();
    expect(recordFrame('missing', { units: [] })).toBeNull();
    expect(recordEvent('missing', { type: 'casualty' })).toBeNull();
    expect(addBookmark('missing', {})).toBeNull();
    expect(endOperation('missing')).toBeNull();
  });
});

describe('AAR analytics', () => {
  beforeEach(() => clearOperations());

  it('computes per-unit casualties, engagements, and effectiveness', () => {
    const operation = buildSampleOperation();
    const analytics = computeUnitAnalytics(operation);

    const f1 = analytics.find((u) => u.unitId === 'f1');
    expect(f1.casualties).toBe(10);
    expect(f1.engagementCount).toBe(1);
    expect(f1.destroyed).toBe(false);

    const f2 = analytics.find((u) => u.unitId === 'f2');
    expect(f2.casualties).toBe(50);
    expect(f2.destroyed).toBe(true);
    expect(f2.effectiveness).toBeLessThan(f1.effectiveness);
  });

  it('ranks units by effectiveness descending', () => {
    const operation = buildSampleOperation();
    const ranked = rankUnitPerformance(operation);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[0].effectiveness).toBeGreaterThanOrEqual(ranked[ranked.length - 1].effectiveness);
  });

  it('scores commander effectiveness for a side', () => {
    const operation = buildSampleOperation();
    const score = computeCommanderEffectiveness(operation, 'friendly');
    expect(score.unitsCommanded).toBe(2);
    expect(score.unitsLost).toBe(1);
    expect(score.overallScore).toBeGreaterThanOrEqual(0);
    expect(score.overallScore).toBeLessThanOrEqual(100);
  });

  it('returns zeroed commander score when a side has no units', () => {
    const operation = buildSampleOperation();
    const score = computeCommanderEffectiveness(operation, 'nonexistent');
    expect(score).toMatchObject({ unitsCommanded: 0, overallScore: 0 });
  });

  it('computes aggregate force metrics', () => {
    const operation = buildSampleOperation();
    const metrics = computeForceMetrics(operation);
    expect(metrics.friendly.unitCount).toBe(2);
    expect(metrics.friendly.casualties).toBe(60);
    expect(metrics.friendly.unitsDestroyed).toBe(1);
    expect(metrics.enemy.casualties).toBe(30);
    expect(metrics.totalEvents).toBe(5);
  });
});

describe('AAR lessons learned', () => {
  beforeEach(() => {
    clearOperations();
    clearLessonsCache();
  });

  it('generates lessons across all six categories', () => {
    const operation = buildSampleOperation();
    const lessons = generateLessons(operation);
    const categories = new Set(lessons.map((l) => l.category));
    expect(categories).toEqual(new Set(Object.values(LESSON_CATEGORIES)));
  });

  it('caches lessons per operation', () => {
    const operation = buildSampleOperation();
    const first = getLessonsForOperation(operation);
    const second = getLessonsForOperation(operation);
    expect(second).toBe(first);
  });

  it('searches lessons by keyword', () => {
    const operation = buildSampleOperation();
    const results = searchLessons(operation, 'lost');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((l) => l.title.toLowerCase().includes('lost') || l.detail.toLowerCase().includes('lost'))).toBe(true);
  });
});

describe('AAR historical comparison', () => {
  beforeEach(() => clearOperations());

  it('compares two operations with a metrics diff, trends, and similarity score', () => {
    const operationA = buildSampleOperation();
    const operationB = buildSampleOperation();
    const comparison = compareOperations(operationA, operationB);

    expect(comparison.metricsDiff).toHaveProperty('friendlyCasualties');
    expect(comparison.trends).toHaveProperty('friendlyCasualties');
    expect(comparison.similarityScore).toBe(100);
  });

  it('scores similarity lower for divergent operations', () => {
    const metricsA = { friendly: { unitCount: 2, casualties: 10 }, enemy: { unitCount: 1, casualties: 5 }, totalEvents: 5 };
    const metricsB = { friendly: { unitCount: 10, casualties: 100 }, enemy: { unitCount: 8, casualties: 90 }, totalEvents: 50 };
    expect(computeSimilarityScore(metricsA, metricsB)).toBeLessThan(100);
  });
});

describe('AAR training scenario generation', () => {
  beforeEach(() => {
    clearOperations();
    clearLessonsCache();
  });

  it('generates a scenario scaled by difficulty', () => {
    const operation = buildSampleOperation();
    const moderate = generateTrainingScenario(operation, 'moderate');
    const hard = generateTrainingScenario(operation, 'hard');

    expect(DIFFICULTY_LEVELS).toContain(moderate.difficulty);
    const enemyModerate = moderate.initialUnits.find((u) => u.side === 'enemy');
    const enemyHard = hard.initialUnits.find((u) => u.side === 'enemy');
    expect(enemyHard.strength).toBeGreaterThan(enemyModerate.strength);
    expect(moderate.objectives.length).toBeGreaterThan(0);
  });

  it('falls back to moderate difficulty for an invalid value', () => {
    const operation = buildSampleOperation();
    const scenario = generateTrainingScenario(operation, 'invalid');
    expect(scenario.difficulty).toBe('moderate');
  });
});

describe('AAR report export', () => {
  beforeEach(() => {
    clearOperations();
    clearLessonsCache();
  });

  it('exports JSON with full operation data', () => {
    const operation = buildSampleOperation();
    const json = JSON.parse(exportJSON(operation));
    expect(json.operation.name).toBe('Test Op');
    expect(json.analytics.unitAnalytics.length).toBeGreaterThan(0);
    expect(json.lessons.length).toBeGreaterThan(0);
  });

  it('exports CSV with a header row and one row per unit', () => {
    const operation = buildSampleOperation();
    const csv = exportCSV(operation);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('unitId');
    expect(lines.length).toBe(4); // header + 3 units
  });

  it('exports an HTML document with the operation name', () => {
    const operation = buildSampleOperation();
    const html = exportHTML(operation);
    expect(html).toContain('<html');
    expect(html).toContain('Test Op');
  });

  it('exportReport dispatches by format and defaults to json', () => {
    const operation = buildSampleOperation();
    expect(exportReport(operation, 'csv').contentType).toBe('text/csv');
    expect(exportReport(operation, 'html').contentType).toBe('text/html');
    expect(exportReport(operation).contentType).toBe('application/json');
  });
});
