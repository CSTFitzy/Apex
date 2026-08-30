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

export type SupplyType = 'Ammo' | 'Fuel' | 'Medical' | 'Rations' | 'Water';
export type SupplyLineStatus = 'SECURE' | 'THREATENED' | 'CRITICAL' | 'CUT';

export interface DepotInventory {
  supplyType: SupplyType;
  quantity: number;
  maxQuantity: number;
  priority: number;
}

export interface SupplyDepot {
  id: number;
  name: string;
  location: LatLon;
  totalCapacity: number;
  securityLevel: number;
  status: 'Operational' | 'Damaged' | 'Destroyed' | 'Captured';
  inventory: DepotInventory[];
}

export interface ConvoyRoute {
  id: string;
  depotId: number;
  depotName: string;
  waypoints: LatLon[];
  distanceM: number;
  etaMinutes: number;
  fuelCostLiters: number;
  riskLevel: SupplyLineStatus;
  progressPct: number;
}

export interface SupplyForecast {
  unitId: string;
  unitName: string;
  generatedAt: string;
  projections: Array<{
    supplyType: SupplyType;
    currentQuantity: number;
    hourlyConsumption: number;
    depletionHours: number | null;
    projectedLevels: Array<{ hoursAhead: number; quantity: number }>;
    warning: string | null;
  }>;
  logisticsHealthPct: number;
}

export interface AllocationResult {
  allocations: Array<{
    unitId: string;
    unitName: string;
    supplyType: SupplyType;
    requestedQuantity: number;
    allocatedQuantity: number;
    priorityScore: number;
    effectivenessPct: number;
  }>;
  unallocatedSupplies: Partial<Record<SupplyType, number>>;
  transportUtilizationPct: number;
}

export interface ResupplyPlan {
  requestId: string;
  status: 'Pending' | 'Planned' | 'InTransit';
  depot: SupplyDepot;
  route: ConvoyRoute;
  warnings: string[];
}

export interface DatabaseOptimizationStatus {
  postgis: boolean;
  timescaledb: boolean;
  pgrouting: boolean;
  pgStatStatements: boolean;
  neo4jConfigured: boolean;
  optimizedTables: string[];
  indexes: string[];
  cacheStrategy: Record<string, string>;
}
