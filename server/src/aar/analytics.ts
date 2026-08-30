import type { Operation, PerformanceAnalytics, UnitPerformance } from './types.js';

/** Computes per-unit performance stats, rankings, and commander effectiveness for an operation. */
export function computeAnalytics(operation: Operation): PerformanceAnalytics {
  const firstFrame = operation.frames[0];
  const lastFrame = operation.frames[operation.frames.length - 1];

  const unitIds = new Set<string>();
  operation.frames.forEach((f) => f.units.forEach((u) => unitIds.add(u.id)));

  const units: UnitPerformance[] = [...unitIds].map((unitId) => {
    const start = firstFrame?.units.find((u) => u.id === unitId);
    const end = lastFrame?.units.find((u) => u.id === unitId);
    const startingStrength = start?.strength ?? end?.strength ?? 0;
    const endingStrength = end?.strength ?? startingStrength;
    const casualties = Math.max(0, startingStrength - endingStrength);

    // Damage dealt is approximated from casualties inflicted on opposing-affiliation
    // units during frames where this unit was engaged in the same tick.
    let damageDealt = 0;
    let engagements = 0;
    const affiliation = end?.affiliation ?? start?.affiliation ?? 'unknown';
    for (let i = 1; i < operation.frames.length; i++) {
      const prev = operation.frames[i - 1];
      const curr = operation.frames[i];
      const thisUnitPrev = prev.units.find((u) => u.id === unitId);
      const thisUnitCurr = curr.units.find((u) => u.id === unitId);
      if (!thisUnitPrev || !thisUnitCurr) continue;
      if (thisUnitCurr.status === 'engaged' && thisUnitPrev.status !== 'destroyed') {
        engagements++;
        for (const opponentCurr of curr.units) {
          if (opponentCurr.affiliation === affiliation) continue;
          const opponentPrev = prev.units.find((u) => u.id === opponentCurr.id);
          if (!opponentPrev) continue;
          const opponentLoss = Math.max(0, opponentPrev.strength - opponentCurr.strength);
          damageDealt += opponentLoss;
        }
      }
    }

    const survived = endingStrength > 0 && end?.status !== 'destroyed';
    const survivalFactor = survived ? 40 : 0;
    const combatEffectivenessScore = Math.round(
      Math.max(
        0,
        Math.min(100, survivalFactor + Math.min(40, damageDealt * 2) - Math.min(30, casualties * 0.5) + 20)
      )
    );

    return {
      unitId,
      unitName: end?.name ?? start?.name ?? unitId,
      affiliation,
      startingStrength,
      endingStrength,
      casualties: Math.round(casualties),
      damageDealt: Math.round(damageDealt),
      combatEffectivenessScore,
      survived,
      engagements,
    };
  });

  const byDamage = [...units].sort((a, b) => b.damageDealt - a.damageDealt).map((u) => u.unitId);
  const bySurvival = [...units]
    .sort((a, b) => b.endingStrength / Math.max(1, b.startingStrength) - a.endingStrength / Math.max(1, a.startingStrength))
    .map((u) => u.unitId);
  const byCasualties = [...units].sort((a, b) => b.casualties - a.casualties).map((u) => u.unitId);

  const friendlyUnits = units.filter((u) => u.affiliation === 'friendly');
  const avgCombatEffectiveness = friendlyUnits.length
    ? friendlyUnits.reduce((s, u) => s + u.combatEffectivenessScore, 0) / friendlyUnits.length
    : 50;

  const events = operation.frames.flatMap((f) => f.events);
  const supplyEvents = events.filter((e) => e.type === 'supply').length;
  const contactEvents = events.filter((e) => e.type === 'contact').length;
  const objectiveEvents = events.filter((e) => e.type === 'objective').length;

  const supplyManagementScore = Math.round(Math.max(0, Math.min(100, 50 + supplyEvents * 8)));
  const tacticalDecisionQualityScore = Math.round(
    Math.max(0, Math.min(100, 50 + objectiveEvents * 10 - Math.min(30, contactEvents * 1.5)))
  );
  const overallScore = Math.round(
    (avgCombatEffectiveness + supplyManagementScore + tacticalDecisionQualityScore) / 3
  );

  return {
    operationId: operation.id,
    units,
    rankings: {
      mostDamageDealt: byDamage,
      bestSurvivalRate: bySurvival,
      mostCasualtiesTaken: byCasualties,
    },
    commanderEffectiveness: {
      tacticalDecisionQualityScore,
      supplyManagementScore,
      combatEffectivenessScore: Math.round(avgCombatEffectiveness),
      overallScore,
    },
  };
}
