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
  sectors: ViewshedSector[];
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
