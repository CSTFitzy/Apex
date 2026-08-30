/**
 * Training scenario generation from past operations.
 *
 * Builds a rule-based training scenario seeded from a recorded operation's
 * initial unit layout, key tactical events, and lessons-learned objectives,
 * with an adjustable difficulty level.
 */

import { getLessonsForOperation } from './lessons.js';

export const DIFFICULTY_LEVELS = ['easy', 'moderate', 'hard', 'extreme'];

const DIFFICULTY_MULTIPLIERS = {
  easy: 0.75,
  moderate: 1,
  hard: 1.35,
  extreme: 1.75,
};

function scaleUnit(unit, multiplier) {
  return {
    ...unit,
    strength: Math.max(1, Math.round((unit.strength ?? unit.maxStrength ?? 100) * multiplier)),
  };
}

/**
 * Generate a training scenario derived from a past operation.
 * @param {object} operation
 * @param {'easy'|'moderate'|'hard'|'extreme'} difficulty
 */
export function generateTrainingScenario(operation, difficulty = 'moderate') {
  const level = DIFFICULTY_LEVELS.includes(difficulty) ? difficulty : 'moderate';
  const multiplier = DIFFICULTY_MULTIPLIERS[level];

  const initialFrame = operation.frames[0] || { units: [] };
  const enemyUnits = initialFrame.units
    .filter((u) => u.side === 'enemy')
    .map((u) => scaleUnit(u, multiplier));
  const friendlyUnits = initialFrame.units.filter((u) => u.side === 'friendly');

  const lessons = getLessonsForOperation(operation);
  const objectives = lessons
    .filter((l) => l.severity === 'action' || l.severity === 'warning' || l.severity === 'critical')
    .map((l) => l.title);

  const keyEvents = operation.events
    .filter((e) => e.type === 'unit_destroyed' || e.type === 'enemy_contact')
    .slice(0, 10)
    .map((e) => ({ type: e.type, timestamp: e.timestamp, details: e.details }));

  return {
    id: `${operation.id}-training-${level}`,
    sourceOperationId: operation.id,
    name: `${operation.name} — Training Scenario (${level})`,
    difficulty: level,
    initialUnits: [...friendlyUnits, ...enemyUnits],
    objectives: objectives.length > 0 ? objectives : ['Maintain unit cohesion and complete the mission objectives.'],
    keyEvents,
    generatedAt: new Date().toISOString(),
  };
}
