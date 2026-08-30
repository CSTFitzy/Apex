import type { AAROperation } from './types.js';

export interface OperationComparison {
  operationA: AAROperation['summary'];
  operationB: AAROperation['summary'];
  deltas: {
    durationMs: number;
    friendlyCasualties: number;
    enemyCasualties: number;
    missionSuccessRatingPct: number;
    overallCombatEffectiveness: number;
  };
}

/**
 * ComparisonService: compares the summary metrics of two AAR operations,
 * returning both operations' summaries plus the numeric deltas (B minus A)
 * so the UI can render trend indicators (improving/worsening).
 */
export function compareOperations(a: AAROperation, b: AAROperation): OperationComparison {
  return {
    operationA: a.summary,
    operationB: b.summary,
    deltas: {
      durationMs: b.summary.durationMs - a.summary.durationMs,
      friendlyCasualties: b.summary.friendlyCasualties - a.summary.friendlyCasualties,
      enemyCasualties: b.summary.enemyCasualties - a.summary.enemyCasualties,
      missionSuccessRatingPct: b.summary.missionSuccessRatingPct - a.summary.missionSuccessRatingPct,
      overallCombatEffectiveness:
        b.summary.overallCombatEffectiveness - a.summary.overallCombatEffectiveness,
    },
  };
}
