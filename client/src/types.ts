export interface LatLon {
  lat: number;
  lon: number;
}

export interface AOBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export type AOShape = 'rectangle' | 'circle' | 'polygon';

/** A user-drawn operational area (AO) that scopes every other analysis tool. */
export interface AreaOfOperations {
  shape: AOShape;
  /** Outline vertices (for a circle these approximate the circumference). */
  vertices: LatLon[];
  /** Circle definition, present only when shape === 'circle'. */
  circle?: { center: LatLon; radiusM: number };
  bounds: AOBounds;
  /** Centroid used for point queries such as weather. */
  center: LatLon;
  areaKm2: number;
  perimeterKm: number;
}

/** Active map interaction mode for the drawing tools panel. */
export type DrawMode = 'none' | 'rectangle' | 'circle' | 'polygon' | 'los';

/** A line-of-sight observer placed on the map (eye height fixed at 1.5 m AGL). */
export interface LosObserver {
  id: string;
  position: LatLon;
  observerHeightM: number;
  radiusM: number;
  viewshed: ViewshedResult | null;
  loading: boolean;
  error?: string;
}

export interface SpotHeight extends LatLon {
  elevation: number;
  prominence: number;
  observableSpotHeights?: number;
  totalComparedSpotHeights?: number;
}

export interface IntervisibilityLink {
  from: LatLon;
  to: LatLon;
  visible: boolean;
  distanceM: number;
}

export interface TerrainReport {
  bbox: AOBounds;
  generatedAt: string;
  spotHeights: SpotHeight[];
  intervisibility: IntervisibilityLink[];
  summary: string;
}

export interface LosResult {
  distance: number;
  visible: boolean;
  obstructedAt: LatLon | null;
  profile: Array<LatLon & { elevation: number; losHeight: number; distance: number }>;
}

export interface ViewshedSector {
  bearing: number;
  endPoint: LatLon;
  visible: boolean;
  visibleDistanceM: number;
}

export interface ViewshedResult {
  origin: LatLon;
  radius: number;
  /** Observer eye height (metres AGL) used for the analysis. */
  observerHeight?: number;
  sectors: ViewshedSector[];
  /** Terrain samples visible from the observer across all rays. */
  visibleSamples?: number;
  /** Terrain samples in shadow across all rays. */
  blockedSamples?: number;
  sampleCount?: number;
  visibleAreaPct: number;
}

export interface OperationalImpact {
  level: 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE';
  factors: string[];
}

export interface WeatherData {
  location: LatLon;
  current: Record<string, number | string>;
  daily: Record<string, Array<number | string>>;
  hourly?: Record<string, Array<number | string>>;
  units: { current: Record<string, string>; daily: Record<string, string> };
  operationalImpact: OperationalImpact;
}

export interface ExtractedCoordinate extends LatLon {
  raw: string;
}

export interface DoctrineProfile {
  id: string;
  name: string;
  keywords: string[];
  composition: string;
  typicalEquipment: string[];
  tactics: string[];
  counterTactics: string[];
}

export interface DocumentExtraction {
  coordinates: ExtractedCoordinate[];
  mgrsReferences: string[];
  enemyMentions: string[];
  friendlyMentions: string[];
  objectives: string[];
  keyTerms: string[];
}

export interface DocumentUploadResult {
  filename: string;
  characterCount: number;
  extraction: DocumentExtraction;
  matchedDoctrine: DoctrineProfile[];
  suggestedAO: (ExtractedCoordinate & { needsManualConfirmation: boolean }) | null;
  rawTextPreview: string;
}

export interface ThreatAssessment {
  level: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  probabilityOfSuccessPct: number;
  rationale: string[];
}

export interface CounterPlan {
  narrative: string;
  recommendedActions: string[];
}

export interface CounterPlanResult {
  matchedDoctrine: DoctrineProfile[];
  threatAssessment: ThreatAssessment;
  counterPlan: CounterPlan;
}

export type Affiliation = 'friendly' | 'hostile' | 'neutral' | 'unknown';

export interface FriendlyForce {
  name: string;
  composition: string;
  strength?: number;
}

/** A unit rendered on the tactical map using NATO APP-6D symbology (via milsymbol). */
export interface TacticalUnit {
  id: string;
  name: string;
  affiliation: Affiliation;
  /** APP-6D-style SIDC (Symbol Identification Code) */
  sidc: string;
  position: LatLon;
  /** Waypoints the unit will move through during simulation */
  route: LatLon[];
  status: 'active' | 'engaged' | 'destroyed' | 'withdrawn';
  strength: number;
  /** Starting strength (defaults to initial `strength` if omitted) - used by BDA/KPI loss calculations. */
  maxStrength?: number;
}

export interface SimulationEvent {
  timestamp: number;
  message: string;
}

/** A single predicted future position for a unit, produced by the LSTM movement model. */
export interface PredictedPosition {
  position: LatLon;
  minutesAhead: number;
  confidencePct: number;
}

/** Multi-step-ahead movement forecast for one unit. */
export interface TrajectoryPrediction {
  unitId: string;
  unitName: string;
  points: PredictedPosition[];
}

export type ThreatTrend = 'INCREASING' | 'DECREASING' | 'STABLE';

/** Forecast of how a unit's threat level is expected to change over time. */
export interface ThreatForecast {
  unitId: string;
  unitName: string;
  hoursAhead: number;
  trend: ThreatTrend;
  confidencePct: number;
  predictedLevel: ThreatAssessment['level'];
}

/** Combined AI prediction bundle for one hostile unit. */
export interface UnitPrediction {
  unitId: string;
  unitName: string;
  trajectory: TrajectoryPrediction;
  threatForecasts: ThreatForecast[];
  casualtyForecastPct: number;
  engagementProbabilityPct: number;
  recommendations: string[];
}

// ---------------------------------------------------------------------------
// Analytics / Grafana-style tactical dashboard types (KPIs, BDA, heatmaps)
// ---------------------------------------------------------------------------

export type AnalyticsEventType =
  | 'casualty_report'
  | 'enemy_contact'
  | 'engagement'
  | 'fire_support'
  | 'supply_status'
  | 'unit_destroyed'
  | 'objective_update';

/** A single tactical event logged for KPI/BDA/heatmap analytics. */
export interface AnalyticsEvent {
  timestamp: number;
  eventType: AnalyticsEventType;
  unitId?: string;
  location?: LatLon;
  data?: Record<string, unknown>;
}

export interface MissionObjective {
  name: string;
  progressPct: number;
}

export interface KPIReport {
  generatedAt: string;
  friendly: {
    unitCount: number;
    totalPersonnel: number;
    maxPersonnel: number;
    strengthPct: number;
    combatEffectivenessPct: number;
    moralePct: number;
    readiness: 'READY' | 'DEGRADED' | 'COMBAT_INEFFECTIVE';
  };
  enemy: {
    unitCount: number;
    estimatedStrength: number;
    estimatedMaxStrength: number;
    strengthPct: number;
    threatLevel: 'MINIMAL' | 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  };
  casualties: {
    kia: number;
    wia: number;
    mia: number;
    total: number;
    ratePerMinute: number;
    trend: 'INCREASING' | 'STABLE' | 'DECREASING';
  };
  mission: {
    progressPct: number;
    elapsedMinutes: number;
    objectives: MissionObjective[];
  };
}

export interface BDAUnitAssessment {
  unitId: string;
  unitName: string;
  affiliation: Affiliation;
  status: TacticalUnit['status'];
  casualties: number;
  lossPct: number;
  severity: 'NONE' | 'LIGHT' | 'MODERATE' | 'CRITICAL';
  minutesToCombatIneffective: number | null;
}

export interface BDAReport {
  generatedAt: string;
  perUnit: BDAUnitAssessment[];
  timeline: Array<{ timestamp: number; unitId?: string; location?: LatLon; kia: number; wia: number; mia: number }>;
  comparison: { friendlyDamage: number; enemyDamage: number };
  destroyedUnits: Array<{ id: string; name: string }>;
}

export type HeatmapType =
  | 'casualty'
  | 'enemy_contact'
  | 'engagement'
  | 'fire_support'
  | 'risk'
  | 'supply_vulnerability'
  | 'comms_blackout';

export interface HeatmapCell {
  lat: number;
  lon: number;
  count: number;
  intensity: number;
}

export interface HeatmapResult {
  type: HeatmapType;
  cellSizeDeg: number;
  generatedAt: string;
  maxCount: number;
  cells: HeatmapCell[];
}
