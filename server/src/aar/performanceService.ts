import type {
  AARFrame,
  AARUnitSnapshot,
  CommanderPerformance,
  UnitPerformance,
} from './types.js';

/**
 * PerformanceService: computes per-unit and commander-level performance
 * metrics from the recorded operation timeline (initial state vs the last
 * recorded frame, plus how many combat engagements each unit was involved in).
 */

function countEngagements(unitId: string, frames: AARFrame[]): number {
  let count = 0;
  for (const frame of frames) {
    if (frame.event?.eventType === 'combat_action' && frame.event.unitIds?.includes(unitId)) {
      count += 1;
    }
  }
  return count;
}

export function computeUnitPerformance(
  initialUnits: AARUnitSnapshot[],
  frames: AARFrame[]
): UnitPerformance[] {
  const lastFrame = frames.length > 0 ? frames[frames.length - 1] : undefined;
  const finalUnitsById = new Map<string, AARUnitSnapshot>();
  for (const unit of lastFrame?.units ?? initialUnits) {
    finalUnitsById.set(unit.id, unit);
  }

  return initialUnits.map((initial) => {
    const final = finalUnitsById.get(initial.id) ?? initial;
    const startingStrength = Math.max(initial.strength, 1);
    const casualties = Math.max(0, initial.strength - final.strength);
    const casualtyRatePct = Math.round((casualties / startingStrength) * 1000) / 10;
    const engagementsInvolved = countEngagements(initial.id, frames);

    // Combat effectiveness starts at 100 and degrades with casualty rate and
    // prolonged engagement (combat fatigue), floored at 0.
    const fatiguePenalty = Math.min(15, engagementsInvolved * 2);
    const combatEffectivenessScore = Math.max(
      0,
      Math.round(100 - casualtyRatePct - fatiguePenalty)
    );

    return {
      unitId: initial.id,
      unitName: initial.name,
      affiliation: initial.affiliation,
      startingStrength: initial.strength,
      endingStrength: final.strength,
      casualties,
      casualtyRatePct,
      engagementsInvolved,
      combatEffectivenessScore,
      finalStatus: final.status,
    };
  });
}

export function computeCommanderPerformance(
  unitPerformance: UnitPerformance[]
): CommanderPerformance {
  const friendly = unitPerformance.filter((u) => u.affiliation === 'friendly');
  const hostile = unitPerformance.filter((u) => u.affiliation === 'hostile');

  const totalFriendlyCasualties = friendly.reduce((sum, u) => sum + u.casualties, 0);
  const totalEnemyCasualties = hostile.reduce((sum, u) => sum + u.casualties, 0);
  const averageCombatEffectiveness =
    friendly.length > 0
      ? Math.round(
          friendly.reduce((sum, u) => sum + u.combatEffectivenessScore, 0) / friendly.length
        )
      : 100;

  // Decision quality is approximated from the casualty exchange ratio: inflicting
  // more casualties than sustained (favourable exchange) scores higher.
  const exchangeRatio =
    totalFriendlyCasualties === 0
      ? totalEnemyCasualties > 0
        ? 2
        : 1
      : totalEnemyCasualties / totalFriendlyCasualties;
  const decisionQualityScore = Math.max(0, Math.min(100, Math.round(50 + exchangeRatio * 20)));

  return {
    friendlyUnitCount: friendly.length,
    totalFriendlyCasualties,
    totalEnemyCasualties,
    averageCombatEffectiveness,
    decisionQualityScore,
  };
}
