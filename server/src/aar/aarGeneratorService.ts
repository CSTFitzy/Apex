import type {
  AAREvent,
  AARFrame,
  AAROperation,
  AARUnitSnapshot,
  CreateAARRequest,
} from './types.js';
import { computeCommanderPerformance, computeUnitPerformance } from './performanceService.js';
import { generateLessons } from './lessonsService.js';
import { nextOperationId } from './store.js';

/**
 * AARGeneratorService: turns a raw operation timeline (initial unit states +
 * recorded frames/events from the tactical simulation) into a fully computed
 * AAR record - performance analytics, commander evaluation, and AI-generated
 * lessons learned.
 */
export function generateAAR(request: CreateAARRequest): AAROperation {
  const initialUnits: AARUnitSnapshot[] = request.initialUnits ?? [];
  const frames: AARFrame[] = request.frames ?? [];
  const events: AAREvent[] = frames
    .filter((f): f is AARFrame & { event: AAREvent } => f.event !== undefined)
    .map((f) => f.event);

  const unitPerformance = computeUnitPerformance(initialUnits, frames);
  const commanderPerformance = computeCommanderPerformance(unitPerformance);
  const lessons = generateLessons(events, frames, unitPerformance);

  const startedAt = request.startedAt ?? frames[0]?.timestamp ?? Date.now();
  const endedAt = request.endedAt ?? frames[frames.length - 1]?.timestamp ?? startedAt;

  const friendly = unitPerformance.filter((u) => u.affiliation === 'friendly');
  const missionSuccessRatingPct = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        commanderPerformance.averageCombatEffectiveness * 0.6 +
          commanderPerformance.decisionQualityScore * 0.4
      )
    )
  );

  const operation: AAROperation = {
    operationId: nextOperationId(),
    name: request.name || `Operation ${new Date(startedAt).toLocaleString()}`,
    startedAt,
    endedAt,
    initialUnits,
    frames,
    events,
    unitPerformance,
    commanderPerformance,
    lessons,
    summary: {
      operationId: '',
      name: '',
      startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt - startedAt),
      friendlyCasualties: commanderPerformance.totalFriendlyCasualties,
      enemyCasualties: commanderPerformance.totalEnemyCasualties,
      objectivesAchieved: 0,
      objectivesTotal: 0,
      missionSuccessRatingPct,
      overallCombatEffectiveness:
        friendly.length > 0 ? commanderPerformance.averageCombatEffectiveness : 100,
    },
    createdAt: Date.now(),
  };

  operation.summary.operationId = operation.operationId;
  operation.summary.name = operation.name;

  return operation;
}
