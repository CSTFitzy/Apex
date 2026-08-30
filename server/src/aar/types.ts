/** Shared domain types for the After-Action Review (AAR) system. */

export type Affiliation = 'friendly' | 'hostile' | 'neutral' | 'unknown';

export interface LatLon {
  lat: number;
  lon: number;
}

/** Minimal unit shape the AAR system needs - a superset of the simulation's TacticalUnit. */
export interface AARUnit {
  id: string;
  name: string;
  affiliation: Affiliation;
  position: LatLon;
  status: 'active' | 'engaged' | 'destroyed' | 'withdrawn';
  strength: number;
}

/** A single event captured during an operation (contact, message, objective, etc). */
export interface OperationEvent {
  timestamp: number;
  message: string;
  type: 'contact' | 'movement' | 'message' | 'objective' | 'supply' | 'other';
}

/** A snapshot of every unit's state at one point in time - the basic unit of replay. */
export interface OperationFrame {
  timestamp: number;
  units: AARUnit[];
  events: OperationEvent[];
}

/** A bookmarked moment of interest within an operation's timeline. */
export interface Bookmark {
  id: string;
  timestamp: number;
  label: string;
}

export interface Operation {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number | null;
  frames: OperationFrame[];
  bookmarks: Bookmark[];
}

export interface OperationSummary {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number | null;
  durationMs: number;
  frameCount: number;
  eventCount: number;
  casualties: number;
  objectivesAchieved: number;
  successRating: number;
}

export interface UnitPerformance {
  unitId: string;
  unitName: string;
  affiliation: Affiliation;
  startingStrength: number;
  endingStrength: number;
  casualties: number;
  damageDealt: number;
  combatEffectivenessScore: number;
  survived: boolean;
  engagements: number;
}

export interface PerformanceAnalytics {
  operationId: string;
  units: UnitPerformance[];
  rankings: {
    mostDamageDealt: string[];
    bestSurvivalRate: string[];
    mostCasualtiesTaken: string[];
  };
  commanderEffectiveness: {
    tacticalDecisionQualityScore: number;
    supplyManagementScore: number;
    combatEffectivenessScore: number;
    overallScore: number;
  };
}

export type LessonCategory =
  | 'what_went_well'
  | 'what_could_improve'
  | 'doctrinal_alignment'
  | 'enemy_analysis'
  | 'environmental_factors'
  | 'training_recommendations';

export interface LessonInsight {
  id: string;
  operationId: string;
  category: LessonCategory;
  title: string;
  detail: string;
  severity: 'low' | 'medium' | 'high';
  applicability: 'unit' | 'commander' | 'doctrine' | 'general';
  createdAt: number;
}

export interface TrainingScenario {
  id: string;
  sourceOperationId: string;
  name: string;
  difficulty: 'easy' | 'medium' | 'hard';
  focusAreas: string[];
  initialUnits: AARUnit[];
  scoringTargets: {
    unitId: string;
    unitName: string;
    historicalCombatEffectivenessScore: number;
  }[];
}

export interface ComparisonResult {
  operationIds: string[];
  metrics: OperationSummary[];
  trend: {
    metric: string;
    direction: 'improving' | 'worsening' | 'stable';
    detail: string;
  }[];
  similarityScorePct: number;
}
