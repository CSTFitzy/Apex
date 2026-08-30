export interface LatLon {
  lat: number;
  lon: number;
}

export type Affiliation = 'friendly' | 'hostile' | 'neutral' | 'unknown';

/** A unit's state as recorded at a single point in the operation timeline. */
export interface AARUnitSnapshot {
  id: string;
  name: string;
  affiliation: Affiliation;
  position: LatLon;
  status: 'active' | 'engaged' | 'destroyed' | 'withdrawn';
  strength: number;
}

/** One recorded tactical event during the operation (combat, movement narration, etc). */
export interface AAREvent {
  eventId: number;
  timestamp: number;
  eventType: 'unit_movement' | 'combat_action' | 'status' | 'operation_start' | 'operation_end';
  message: string;
  unitIds?: string[];
}

/** A single "frame" of the operation timeline: full unit state + any event that occurred. */
export interface AARFrame {
  timestamp: number;
  units: AARUnitSnapshot[];
  event?: AAREvent;
}

export interface CreateAARRequest {
  name?: string;
  startedAt?: number;
  endedAt?: number;
  initialUnits: AARUnitSnapshot[];
  frames: AARFrame[];
}

export interface UnitPerformance {
  unitId: string;
  unitName: string;
  affiliation: Affiliation;
  startingStrength: number;
  endingStrength: number;
  casualties: number;
  casualtyRatePct: number;
  engagementsInvolved: number;
  combatEffectivenessScore: number;
  finalStatus: string;
}

export interface CommanderPerformance {
  friendlyUnitCount: number;
  totalFriendlyCasualties: number;
  totalEnemyCasualties: number;
  averageCombatEffectiveness: number;
  decisionQualityScore: number;
}

export type LessonCategory =
  | 'what_went_well'
  | 'what_could_improve'
  | 'doctrinal_alignment'
  | 'enemy_analysis'
  | 'environmental_factors'
  | 'training_recommendations';

export interface Lesson {
  id: string;
  category: LessonCategory;
  severity: 'low' | 'medium' | 'high';
  summary: string;
  evidenceEventIds: number[];
}

export interface AARSummary {
  operationId: string;
  name: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  friendlyCasualties: number;
  enemyCasualties: number;
  objectivesAchieved: number;
  objectivesTotal: number;
  missionSuccessRatingPct: number;
  overallCombatEffectiveness: number;
}

export interface AAROperation {
  operationId: string;
  name: string;
  startedAt: number;
  endedAt: number;
  initialUnits: AARUnitSnapshot[];
  frames: AARFrame[];
  events: AAREvent[];
  unitPerformance: UnitPerformance[];
  commanderPerformance: CommanderPerformance;
  lessons: Lesson[];
  summary: AARSummary;
  createdAt: number;
}
