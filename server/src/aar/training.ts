import { randomUUID } from 'crypto';
import type { Operation, PerformanceAnalytics, TrainingScenario } from './types.js';

/** Generates a replayable training scenario seeded from a past operation. */
export function generateTrainingScenario(
  operation: Operation,
  analytics: PerformanceAnalytics,
  difficulty: TrainingScenario['difficulty'] = 'medium'
): TrainingScenario {
  const firstFrame = operation.frames[0];
  const initialUnits = firstFrame ? firstFrame.units : [];

  const focusAreas: string[] = [];
  if (analytics.commanderEffectiveness.tacticalDecisionQualityScore < 60) {
    focusAreas.push('Tactical decision-making under contact');
  }
  if (analytics.commanderEffectiveness.supplyManagementScore < 60) {
    focusAreas.push('Supply and logistics management');
  }
  const strugglingUnits = analytics.units.filter(
    (u) => u.affiliation === 'friendly' && u.combatEffectivenessScore < 50
  );
  strugglingUnits.forEach((u) => focusAreas.push(`${u.unitName}: combat effectiveness improvement`));
  if (focusAreas.length === 0) {
    focusAreas.push('Sustainment training - maintain current performance level');
  }

  // Difficulty adjusts the enemy's simulated strength for the replay.
  const difficultyMultiplier = difficulty === 'easy' ? 0.75 : difficulty === 'hard' ? 1.35 : 1;
  const adjustedUnits = initialUnits.map((u) =>
    u.affiliation === 'hostile' ? { ...u, strength: Math.round(u.strength * difficultyMultiplier) } : u
  );

  return {
    id: randomUUID(),
    sourceOperationId: operation.id,
    name: `Training: ${operation.name} (${difficulty})`,
    difficulty,
    focusAreas,
    initialUnits: adjustedUnits,
    scoringTargets: analytics.units
      .filter((u) => u.affiliation === 'friendly')
      .map((u) => ({
        unitId: u.unitId,
        unitName: u.unitName,
        historicalCombatEffectivenessScore: u.combatEffectivenessScore,
      })),
  };
}
