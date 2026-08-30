/**
 * Historical comparison between two recorded operations.
 *
 * Produces a metrics diff, trend analysis, similarity score, and a
 * performance comparison summary.
 */

import { computeForceMetrics, computeCommanderEffectiveness } from './analytics.js';

function diff(a, b) {
  return Math.round((b - a) * 100) / 100;
}

function trendLabel(delta) {
  if (delta > 0) return 'improved';
  if (delta < 0) return 'declined';
  return 'unchanged';
}

/** Compare two operations, returning a metrics diff and trend analysis. */
export function compareOperations(operationA, operationB) {
  const metricsA = computeForceMetrics(operationA);
  const metricsB = computeForceMetrics(operationB);
  const commanderA = computeCommanderEffectiveness(operationA, 'friendly');
  const commanderB = computeCommanderEffectiveness(operationB, 'friendly');

  const metricsDiff = {
    friendlyCasualties: diff(metricsA.friendly.casualties, metricsB.friendly.casualties),
    friendlyUnitsDestroyed: diff(metricsA.friendly.unitsDestroyed, metricsB.friendly.unitsDestroyed),
    enemyCasualties: diff(metricsA.enemy.casualties, metricsB.enemy.casualties),
    enemyUnitsDestroyed: diff(metricsA.enemy.unitsDestroyed, metricsB.enemy.unitsDestroyed),
    exchangeRatio: diff(
      Number.isFinite(metricsA.exchangeRatio) ? metricsA.exchangeRatio : 0,
      Number.isFinite(metricsB.exchangeRatio) ? metricsB.exchangeRatio : 0
    ),
    durationMs: diff(metricsA.durationMs, metricsB.durationMs),
    commanderOverallScore: diff(commanderA.overallScore, commanderB.overallScore),
  };

  const trends = {
    friendlyCasualties: trendLabel(-metricsDiff.friendlyCasualties),
    exchangeRatio: trendLabel(metricsDiff.exchangeRatio),
    commanderEffectiveness: trendLabel(metricsDiff.commanderOverallScore),
  };

  return {
    operationA: { id: operationA.id, name: operationA.name },
    operationB: { id: operationB.id, name: operationB.name },
    metricsA,
    metricsB,
    metricsDiff,
    trends,
    similarityScore: computeSimilarityScore(metricsA, metricsB),
    performanceComparison: {
      friendly: { operationA: commanderA, operationB: commanderB },
    },
  };
}

/**
 * Similarity score (0-100) between two operations' force metrics, based on
 * normalized differences across a handful of comparable dimensions.
 */
export function computeSimilarityScore(metricsA, metricsB) {
  const dims = [
    [metricsA.friendly.unitCount, metricsB.friendly.unitCount],
    [metricsA.enemy.unitCount, metricsB.enemy.unitCount],
    [metricsA.friendly.casualties, metricsB.friendly.casualties],
    [metricsA.enemy.casualties, metricsB.enemy.casualties],
    [metricsA.totalEvents, metricsB.totalEvents],
  ];

  const scores = dims.map(([a, b]) => {
    const max = Math.max(Math.abs(a), Math.abs(b), 1);
    return 1 - Math.min(1, Math.abs(a - b) / max);
  });

  const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  return Math.round(avg * 100);
}
