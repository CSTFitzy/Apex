import type { ComparisonResult, Operation, OperationSummary } from './types.js';
import { aarStore } from './store.js';

/** Compares two or more historical operations side-by-side. */
export function compareOperations(operations: Operation[]): ComparisonResult {
  const metrics: OperationSummary[] = operations.map((op) => aarStore.summarize(op));

  const trend: ComparisonResult['trend'] = [];
  if (metrics.length >= 2) {
    const sorted = [...metrics].sort((a, b) => a.startedAt - b.startedAt);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];

    const casualtyDelta = last.casualties - first.casualties;
    trend.push({
      metric: 'casualties',
      direction: casualtyDelta < 0 ? 'improving' : casualtyDelta > 0 ? 'worsening' : 'stable',
      detail: `Casualties ${casualtyDelta <= 0 ? 'decreased' : 'increased'} from ${first.casualties} in "${first.name}" to ${last.casualties} in "${last.name}".`,
    });

    const successDelta = last.successRating - first.successRating;
    trend.push({
      metric: 'successRating',
      direction: successDelta > 0 ? 'improving' : successDelta < 0 ? 'worsening' : 'stable',
      detail: `Success rating moved from ${first.successRating} to ${last.successRating} between "${first.name}" and "${last.name}".`,
    });

    const objectivesDelta = last.objectivesAchieved - first.objectivesAchieved;
    trend.push({
      metric: 'objectivesAchieved',
      direction: objectivesDelta > 0 ? 'improving' : objectivesDelta < 0 ? 'worsening' : 'stable',
      detail: `Objectives achieved moved from ${first.objectivesAchieved} to ${last.objectivesAchieved}.`,
    });
  }

  // Similarity is approximated from how close casualty counts and event counts are,
  // as a proxy for operations that occurred under similar conditions.
  let similarityScorePct = 100;
  if (metrics.length >= 2) {
    const avgCasualties = metrics.reduce((s, m) => s + m.casualties, 0) / metrics.length;
    const avgEvents = metrics.reduce((s, m) => s + m.eventCount, 0) / metrics.length;
    const casualtyVariance =
      metrics.reduce((s, m) => s + Math.abs(m.casualties - avgCasualties), 0) / metrics.length;
    const eventVariance = metrics.reduce((s, m) => s + Math.abs(m.eventCount - avgEvents), 0) / metrics.length;
    similarityScorePct = Math.round(
      Math.max(0, 100 - casualtyVariance * 1.5 - eventVariance * 2)
    );
  }

  return {
    operationIds: operations.map((o) => o.id),
    metrics,
    trend,
    similarityScorePct,
  };
}
