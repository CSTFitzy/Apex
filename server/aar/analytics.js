/**
 * AAR performance analytics.
 *
 * Computes per-unit casualties/damage/effectiveness, unit performance
 * rankings, commander effectiveness scoring, and aggregate force metrics
 * from a recorded operation (see server/aar/store.js).
 */

import { operationDurationMs } from './store.js';

function initialUnitState(unitId, frames) {
  for (const frame of frames) {
    const unit = frame.units.find((u) => u.id === unitId);
    if (unit) return unit;
  }
  return null;
}

function finalUnitState(unitId, frames) {
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const unit = frames[i].units.find((u) => u.id === unitId);
    if (unit) return unit;
  }
  return null;
}

/** Collect the set of unit ids seen across frames and events. */
function collectUnitIds(operation) {
  const ids = new Set();
  for (const frame of operation.frames) {
    for (const unit of frame.units) ids.add(unit.id);
  }
  for (const event of operation.events) {
    if (event.unitId) ids.add(event.unitId);
  }
  return [...ids];
}

/**
 * Compute per-unit analytics: casualties suffered, damage dealt (best
 * effort, inferred from events with a "cause" reference), engagement
 * count, and an overall effectiveness score (0-100).
 */
export function computeUnitAnalytics(operation) {
  const unitIds = collectUnitIds(operation);

  return unitIds.map((unitId) => {
    const start = initialUnitState(unitId, operation.frames);
    const end = finalUnitState(unitId, operation.frames);
    const unitEvents = operation.events.filter((e) => e.unitId === unitId);

    const casualtyEvents = unitEvents.filter((e) => e.type === 'casualty');
    const engagementEvents = unitEvents.filter(
      (e) => e.type === 'enemy_contact' || e.type === 'engagement'
    );
    const destroyed = unitEvents.some((e) => e.type === 'unit_destroyed') || end?.status === 'destroyed';
    const supplyConsumedEvents = unitEvents.filter((e) => e.type === 'supply_consumed');

    const casualties = casualtyEvents.reduce((sum, e) => sum + (Number(e.severity) || 0), 0);
    const startStrength = start?.strength ?? start?.maxStrength ?? 100;
    const endStrength = end?.strength ?? Math.max(0, startStrength - casualties);
    const maxStrength = start?.maxStrength ?? end?.maxStrength ?? startStrength ?? 100;

    const survivalRate = maxStrength > 0 ? Math.max(0, endStrength) / maxStrength : 0;
    const engagementCount = engagementEvents.length;
    // Effectiveness rewards survival and combat engagement while penalizing
    // casualties taken relative to max strength.
    const casualtyRatio = maxStrength > 0 ? Math.min(1, casualties / maxStrength) : 0;
    const effectiveness = Math.round(
      Math.max(
        0,
        Math.min(
          100,
          survivalRate * 60 + Math.min(engagementCount, 10) * 3 - casualtyRatio * 40 - (destroyed ? 20 : 0)
        )
      )
    );

    return {
      unitId,
      side: start?.side ?? end?.side ?? null,
      name: start?.name ?? end?.name ?? unitId,
      type: start?.type ?? end?.type ?? null,
      startStrength,
      endStrength,
      maxStrength,
      casualties,
      engagementCount,
      supplyConsumed: supplyConsumedEvents.reduce((sum, e) => sum + (Number(e.severity) || 0), 0),
      destroyed,
      survivalRate: Math.round(survivalRate * 100) / 100,
      effectiveness,
    };
  });
}

/** Rank units by effectiveness score, descending. */
export function rankUnitPerformance(operation) {
  return computeUnitAnalytics(operation)
    .slice()
    .sort((a, b) => b.effectiveness - a.effectiveness)
    .map((unit, index) => ({ ...unit, rank: index + 1 }));
}

/**
 * Score commander effectiveness for a side based on tactical decision
 * quality (casualty avoidance), supply management, and combat
 * effectiveness (engagements initiated vs. losses sustained).
 */
export function computeCommanderEffectiveness(operation, side = 'friendly') {
  const unitAnalytics = computeUnitAnalytics(operation).filter((u) => u.side === side);
  if (unitAnalytics.length === 0) {
    return {
      side,
      tacticalDecisionScore: 0,
      supplyManagementScore: 0,
      combatEffectivenessScore: 0,
      overallScore: 0,
      unitsCommanded: 0,
      unitsLost: 0,
    };
  }

  const unitsLost = unitAnalytics.filter((u) => u.destroyed).length;
  const totalCasualties = unitAnalytics.reduce((sum, u) => sum + u.casualties, 0);
  const totalMax = unitAnalytics.reduce((sum, u) => sum + u.maxStrength, 0);
  const totalSupplyConsumed = unitAnalytics.reduce((sum, u) => sum + u.supplyConsumed, 0);
  const totalEngagements = unitAnalytics.reduce((sum, u) => sum + u.engagementCount, 0);

  const casualtyRatio = totalMax > 0 ? totalCasualties / totalMax : 0;
  const lossRatio = unitAnalytics.length > 0 ? unitsLost / unitAnalytics.length : 0;

  const tacticalDecisionScore = Math.round(Math.max(0, 100 - casualtyRatio * 60 - lossRatio * 40));
  const supplyManagementScore = Math.round(
    Math.max(0, 100 - Math.min(100, (totalSupplyConsumed / Math.max(1, unitAnalytics.length)) * 2))
  );
  const combatEffectivenessScore = Math.round(
    Math.min(100, (totalEngagements / Math.max(1, unitAnalytics.length)) * 15 + (1 - lossRatio) * 40)
  );

  const overallScore = Math.round(
    tacticalDecisionScore * 0.4 + supplyManagementScore * 0.25 + combatEffectivenessScore * 0.35
  );

  return {
    side,
    tacticalDecisionScore,
    supplyManagementScore,
    combatEffectivenessScore,
    overallScore,
    unitsCommanded: unitAnalytics.length,
    unitsLost,
  };
}

/** Aggregate force-wide metrics and trend indicators for an operation. */
export function computeForceMetrics(operation) {
  const unitAnalytics = computeUnitAnalytics(operation);
  const friendly = unitAnalytics.filter((u) => u.side === 'friendly');
  const enemy = unitAnalytics.filter((u) => u.side === 'enemy');

  const sumCasualties = (list) => list.reduce((sum, u) => sum + u.casualties, 0);
  const sumDestroyed = (list) => list.filter((u) => u.destroyed).length;

  return {
    durationMs: operationDurationMs(operation),
    totalEvents: operation.events.length,
    totalFrames: operation.frames.length,
    friendly: {
      unitCount: friendly.length,
      casualties: sumCasualties(friendly),
      unitsDestroyed: sumDestroyed(friendly),
      avgEffectiveness: average(friendly.map((u) => u.effectiveness)),
    },
    enemy: {
      unitCount: enemy.length,
      casualties: sumCasualties(enemy),
      unitsDestroyed: sumDestroyed(enemy),
      avgEffectiveness: average(enemy.map((u) => u.effectiveness)),
    },
    exchangeRatio:
      sumCasualties(friendly) > 0
        ? Math.round((sumCasualties(enemy) / sumCasualties(friendly)) * 100) / 100
        : sumCasualties(enemy) > 0
          ? Infinity
          : 0,
  };
}

function average(values) {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10;
}

/** Build the full analytics bundle returned by the API for an operation. */
export function buildAnalyticsBundle(operation) {
  return {
    unitAnalytics: computeUnitAnalytics(operation),
    rankings: rankUnitPerformance(operation),
    commanderEffectiveness: {
      friendly: computeCommanderEffectiveness(operation, 'friendly'),
      enemy: computeCommanderEffectiveness(operation, 'enemy'),
    },
    forceMetrics: computeForceMetrics(operation),
  };
}
