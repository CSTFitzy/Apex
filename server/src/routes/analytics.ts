import { Router, Request, Response } from 'express';

const router = Router();

type Affiliation = 'friendly' | 'hostile' | 'neutral' | 'unknown';

interface LatLon {
  lat: number;
  lon: number;
}

interface AnalyticsUnit {
  id: string;
  name: string;
  affiliation: Affiliation;
  position: LatLon;
  status: 'active' | 'engaged' | 'destroyed' | 'withdrawn';
  strength: number;
  /** Starting strength, used to compute losses; defaults to `strength` if omitted. */
  maxStrength?: number;
}

type AnalyticsEventType =
  | 'casualty_report'
  | 'enemy_contact'
  | 'engagement'
  | 'fire_support'
  | 'supply_status'
  | 'unit_destroyed'
  | 'objective_update';

interface AnalyticsEvent {
  timestamp: number;
  eventType: AnalyticsEventType;
  unitId?: string;
  location?: LatLon;
  data?: Record<string, unknown>;
}

interface AnalyticsRequestBody {
  units?: AnalyticsUnit[];
  events?: AnalyticsEvent[];
  missionStartTime?: number;
  objectives?: { name: string; progressPct: number }[];
}

// In-memory event log (append-only, capped) - stands in for the TimescaleDB /
// Redis Streams event pipeline described in the design doc. Also doubles as
// the durable store queried by the Grafana PostgreSQL/TimescaleDB data source
// provisioning under grafana/provisioning.
const MAX_LOGGED_EVENTS = 5000;
const eventLog: AnalyticsEvent[] = [];

function totalStrength(units: AnalyticsUnit[], affiliation: Affiliation): number {
  return units
    .filter((u) => u.affiliation === affiliation && u.status !== 'destroyed')
    .reduce((sum, u) => sum + (u.strength || 0), 0);
}

function maxStrength(units: AnalyticsUnit[], affiliation: Affiliation): number {
  return units
    .filter((u) => u.affiliation === affiliation)
    .reduce((sum, u) => sum + (u.maxStrength ?? u.strength ?? 0), 0);
}

function casualtyEvents(events: AnalyticsEvent[]): AnalyticsEvent[] {
  return events.filter((e) => e.eventType === 'casualty_report' || e.eventType === 'engagement');
}

/**
 * Sums KIA/WIA/MIA from casualty/engagement events. When `unitIds` is
 * supplied, only events tagged against one of those units are counted (used
 * to isolate friendly-only casualty KPIs from mixed friendly/enemy events).
 */
function totalCasualties(events: AnalyticsEvent[], unitIds?: Set<string>): { kia: number; wia: number; mia: number } {
  return casualtyEvents(events)
    .filter((e) => !unitIds || (e.unitId !== undefined && unitIds.has(e.unitId)))
    .reduce(
      (acc, e) => {
        const kia = Number(e.data?.kia ?? 0);
        const wia = Number(e.data?.wia ?? 0);
        const mia = Number(e.data?.mia ?? 0);
        return { kia: acc.kia + kia, wia: acc.wia + wia, mia: acc.mia + mia };
      },
      { kia: 0, wia: 0, mia: 0 }
    );
}

function readinessStatus(strengthPct: number): 'READY' | 'DEGRADED' | 'COMBAT_INEFFECTIVE' {
  if (strengthPct >= 75) return 'READY';
  if (strengthPct >= 40) return 'DEGRADED';
  return 'COMBAT_INEFFECTIVE';
}

function threatLevel(enemyStrength: number, friendlyStrength: number): 'MINIMAL' | 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' {
  if (enemyStrength === 0) return 'MINIMAL';
  const ratio = enemyStrength / Math.max(friendlyStrength, 1);
  if (ratio >= 1.5) return 'CRITICAL';
  if (ratio >= 1.1) return 'HIGH';
  if (ratio >= 0.75) return 'MODERATE';
  if (ratio >= 0.4) return 'LOW';
  return 'MINIMAL';
}

/**
 * Computes the live KPI set described in section 2 of the analytics spec:
 * friendly/enemy force KPIs, casualty & medical KPIs, and mission KPIs.
 * Pure/stateless - the client supplies the current unit roster and event
 * stream since simulation state lives client-side.
 */
function computeKPIs(body: AnalyticsRequestBody) {
  const units = body.units ?? [];
  const events = body.events ?? [];
  const objectives = body.objectives ?? [];

  const friendlyUnits = units.filter((u) => u.affiliation === 'friendly');
  const hostileUnits = units.filter((u) => u.affiliation === 'hostile');

  const friendlyStrength = totalStrength(units, 'friendly');
  const friendlyMax = maxStrength(units, 'friendly') || 1;
  const friendlyStrengthPct = Math.round((friendlyStrength / friendlyMax) * 100);

  const enemyStrength = totalStrength(units, 'hostile');
  const enemyMax = maxStrength(units, 'hostile') || 1;
  const enemyStrengthPct = Math.round((enemyStrength / enemyMax) * 100);

  const friendlyUnitIds = new Set(friendlyUnits.map((u) => u.id));
  const casualties = totalCasualties(events, friendlyUnitIds);
  const totalCasualtyCount = casualties.kia + casualties.wia + casualties.mia;

  const missionStart = body.missionStartTime ?? (events[events.length - 1]?.timestamp ?? Date.now());
  const elapsedMinutes = Math.max((Date.now() - missionStart) / 60000, 1 / 60);
  const casualtyRatePerMin = Number((totalCasualtyCount / elapsedMinutes).toFixed(2));

  const missionProgressPct =
    objectives.length > 0
      ? Math.round(objectives.reduce((sum, o) => sum + o.progressPct, 0) / objectives.length)
      : 0;

  const moralePct = Math.max(0, Math.min(100, Math.round(friendlyStrengthPct - casualtyRatePerMin * 5)));
  const combatEffectiveness = Math.round((friendlyStrengthPct / 100) * (moralePct / 100) * 100);

  return {
    generatedAt: new Date().toISOString(),
    friendly: {
      unitCount: friendlyUnits.length,
      totalPersonnel: friendlyStrength,
      maxPersonnel: friendlyMax,
      strengthPct: friendlyStrengthPct,
      combatEffectivenessPct: combatEffectiveness,
      moralePct,
      readiness: readinessStatus(friendlyStrengthPct),
    },
    enemy: {
      unitCount: hostileUnits.length,
      estimatedStrength: enemyStrength,
      estimatedMaxStrength: enemyMax,
      strengthPct: enemyStrengthPct,
      threatLevel: threatLevel(enemyStrength, friendlyStrength),
    },
    casualties: {
      kia: casualties.kia,
      wia: casualties.wia,
      mia: casualties.mia,
      total: totalCasualtyCount,
      ratePerMinute: casualtyRatePerMin,
      trend: casualtyRatePerMin > 1 ? 'INCREASING' : casualtyRatePerMin > 0 ? 'STABLE' : 'DECREASING',
    },
    mission: {
      progressPct: missionProgressPct,
      elapsedMinutes: Math.round(elapsedMinutes),
      objectives,
    },
  };
}

/**
 * Battle Damage Assessment engine (section 3): aggregates casualty/damage
 * events per-unit and produces a simple projection of time-to-combat-
 * ineffective for each friendly unit based on its current loss rate.
 */
function buildBDA(body: AnalyticsRequestBody) {
  const units = body.units ?? [];
  const events = body.events ?? [];
  const missionStart = body.missionStartTime ?? (events[events.length - 1]?.timestamp ?? Date.now());
  const elapsedMinutes = Math.max((Date.now() - missionStart) / 60000, 1 / 60);

  const perUnit = units.map((unit) => {
    const unitEvents = casualtyEvents(events).filter((e) => e.unitId === unit.id);
    const casualties = unitEvents.reduce(
      (sum, e) => sum + Number(e.data?.kia ?? 0) + Number(e.data?.wia ?? 0) + Number(e.data?.mia ?? 0),
      0
    );
    const startingStrength = unit.maxStrength ?? unit.strength;
    const lossPct = startingStrength > 0 ? Math.round(((startingStrength - unit.strength) / startingStrength) * 100) : 0;
    const lossRatePerMin = casualties / elapsedMinutes;
    const remainingToIneffective = Math.max(unit.strength - startingStrength * 0.4, 0);
    const minutesToCombatIneffective =
      lossRatePerMin > 0 ? Math.round(remainingToIneffective / lossRatePerMin) : null;

    return {
      unitId: unit.id,
      unitName: unit.name,
      affiliation: unit.affiliation,
      status: unit.status,
      casualties,
      lossPct,
      severity: lossPct >= 60 ? 'CRITICAL' : lossPct >= 30 ? 'MODERATE' : lossPct > 0 ? 'LIGHT' : 'NONE',
      minutesToCombatIneffective,
    };
  });

  const timeline = casualtyEvents(events)
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((e) => ({
      timestamp: e.timestamp,
      unitId: e.unitId,
      location: e.location,
      kia: Number(e.data?.kia ?? 0),
      wia: Number(e.data?.wia ?? 0),
      mia: Number(e.data?.mia ?? 0),
    }));

  const friendlyDamage = perUnit
    .filter((u) => u.affiliation === 'friendly')
    .reduce((sum, u) => sum + u.casualties, 0);
  const enemyDamage = perUnit
    .filter((u) => u.affiliation === 'hostile')
    .reduce((sum, u) => sum + u.casualties, 0);

  return {
    generatedAt: new Date().toISOString(),
    perUnit,
    timeline,
    comparison: { friendlyDamage, enemyDamage },
    destroyedUnits: units.filter((u) => u.status === 'destroyed').map((u) => ({ id: u.id, name: u.name })),
  };
}

type HeatmapType =
  | 'casualty'
  | 'enemy_contact'
  | 'engagement'
  | 'fire_support'
  | 'risk'
  | 'supply_vulnerability'
  | 'comms_blackout';

const HEATMAP_EVENT_TYPES: Record<HeatmapType, AnalyticsEventType[]> = {
  casualty: ['casualty_report'],
  enemy_contact: ['enemy_contact', 'engagement'],
  engagement: ['engagement'],
  fire_support: ['fire_support'],
  risk: ['casualty_report', 'engagement', 'enemy_contact'],
  supply_vulnerability: ['supply_status'],
  comms_blackout: [],
};

/**
 * Spatial binning heatmap generator (section 7.3): buckets events into a
 * lat/lon grid and normalizes counts to a 0-255 intensity value suitable for
 * a Leaflet heat overlay.
 */
function buildHeatmap(type: HeatmapType, events: AnalyticsEvent[], cellSizeDeg = 0.01) {
  const relevantTypes = HEATMAP_EVENT_TYPES[type] ?? [];
  const relevant = events.filter((e) => e.location && relevantTypes.includes(e.eventType));

  const buckets = new Map<string, { lat: number; lon: number; count: number }>();
  for (const event of relevant) {
    const lat = Math.round(event.location!.lat / cellSizeDeg) * cellSizeDeg;
    const lon = Math.round(event.location!.lon / cellSizeDeg) * cellSizeDeg;
    const key = `${lat.toFixed(6)},${lon.toFixed(6)}`;
    const existing = buckets.get(key);
    if (existing) existing.count += 1;
    else buckets.set(key, { lat, lon, count: 1 });
  }

  const maxCount = Math.max(1, ...Array.from(buckets.values()).map((b) => b.count));
  const cells = Array.from(buckets.values()).map((b) => ({
    lat: b.lat,
    lon: b.lon,
    count: b.count,
    intensity: Math.round((b.count / maxCount) * 255),
  }));

  return { type, cellSizeDeg, generatedAt: new Date().toISOString(), maxCount, cells };
}

/**
 * POST /api/analytics/events
 * Append one or more tactical events to the in-memory event log (stand-in
 * for the TimescaleDB / Redis Streams pipeline described in the design doc).
 */
router.post('/events', (req: Request, res: Response) => {
  try {
    const events: AnalyticsEvent[] = Array.isArray(req.body) ? req.body : [req.body];
    for (const event of events) {
      if (!event?.eventType) continue;
      eventLog.push({ ...event, timestamp: event.timestamp ?? Date.now() });
    }
    while (eventLog.length > MAX_LOGGED_EVENTS) eventLog.shift();
    res.status(201).json({ logged: events.length, totalEvents: eventLog.length });
  } catch (error) {
    console.error('Failed to log analytics event:', error);
    res.status(500).json({ error: 'Failed to log event' });
  }
});

/** GET /api/analytics/events - retrieve the buffered event log. */
router.get('/events', (req: Request, res: Response) => {
  const since = req.query.since ? Number(req.query.since) : undefined;
  const filtered = since ? eventLog.filter((e) => e.timestamp >= since) : eventLog;
  res.json({ events: filtered.slice(-1000) });
});

/**
 * POST /api/analytics/kpis
 * Body: { units, events, missionStartTime?, objectives? }
 * Real-time KPI monitoring engine (friendly/enemy force, casualty, mission KPIs).
 */
router.post('/kpis', (req: Request, res: Response) => {
  try {
    res.json(computeKPIs(req.body as AnalyticsRequestBody));
  } catch (error) {
    console.error('KPI computation failed:', error);
    res.status(500).json({ error: 'Failed to compute KPIs' });
  }
});

/**
 * POST /api/analytics/bda
 * Body: { units, events, missionStartTime? }
 * Battle Damage Assessment engine.
 */
router.post('/bda', (req: Request, res: Response) => {
  try {
    res.json(buildBDA(req.body as AnalyticsRequestBody));
  } catch (error) {
    console.error('BDA computation failed:', error);
    res.status(500).json({ error: 'Failed to compute battle damage assessment' });
  }
});

/**
 * POST /api/analytics/heatmap
 * Body: { type, events, cellSizeDeg? }
 * Tactical heatmap generator (casualty, enemy_contact, engagement, fire_support,
 * risk, supply_vulnerability, comms_blackout).
 */
router.post('/heatmap', (req: Request, res: Response) => {
  try {
    const { type, events, cellSizeDeg } = req.body as {
      type: HeatmapType;
      events?: AnalyticsEvent[];
      cellSizeDeg?: number;
    };
    if (!type || !(type in HEATMAP_EVENT_TYPES)) {
      res.status(400).json({ error: 'Invalid or missing heatmap type' });
      return;
    }
    res.json(buildHeatmap(type, events ?? [], cellSizeDeg));
  } catch (error) {
    console.error('Heatmap generation failed:', error);
    res.status(500).json({ error: 'Failed to generate heatmap' });
  }
});

export default router;
