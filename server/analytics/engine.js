/**
 * Stateless real-time tactical analytics engine.
 *
 * All functions here are pure: they compute KPIs, battle damage assessment
 * (BDA), and spatial heatmaps directly from the `units` and `events` arrays
 * supplied by the client for the current simulation. The server keeps no
 * persistent simulation state, so results only reflect the data passed in a
 * given request (see server/routes/analytics.js).
 *
 * Expected `unit` shape (fields are optional/defaulted where sensible):
 *   {
 *     id, side: 'friendly' | 'enemy', type,
 *     strength, maxStrength, readiness (0-100), morale (0-100),
 *     status: 'active' | 'ineffective' | 'destroyed',
 *     position: { lat, lng }, supplyLevel (0-100),
 *     commsStatus: 'normal' | 'degraded' | 'blackout',
 *   }
 *
 * Expected `event` shape:
 *   {
 *     id, type: one of EVENT_TYPES, timestamp (ISO string or epoch ms),
 *     unitId, side, position: { lat, lng }, severity (0-100),
 *   }
 */

export const EVENT_TYPES = {
  CASUALTY: 'casualty',
  ENEMY_CONTACT: 'enemy_contact',
  ENGAGEMENT: 'engagement',
  FIRE_SUPPORT: 'fire_support',
  UNIT_DESTROYED: 'unit_destroyed',
  SUPPLY_LOW: 'supply_low',
  COMMS_BLACKOUT: 'comms_blackout',
};

export const HEATMAP_TYPES = {
  CASUALTY: 'casualty',
  ENEMY_CONTACT: 'enemy_contact',
  ENGAGEMENT: 'engagement',
  FIRE_SUPPORT: 'fire_support',
  RISK: 'risk',
  SUPPLY_VULNERABILITY: 'supply_vulnerability',
  COMMS_BLACKOUT: 'comms_blackout',
};

const DEFAULT_CELL_SIZE_DEG = 0.05;

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function toTimestampMs(value) {
  if (value === undefined || value === null) return Date.now();
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function isFriendly(entity) {
  return entity?.side === 'friendly';
}

function isEnemy(entity) {
  return entity?.side === 'enemy';
}

/* ------------------------------------------------------------------ */
/* KPIs                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Compute headline tactical KPIs from the current unit roster and event log.
 * @param {object[]} units
 * @param {object[]} events
 * @param {object} [options]
 * @param {number} [options.windowMs=900000] - Trailing window (default 15m) used for casualty rate/trend.
 */
export function computeKPIs(units = [], events = [], options = {}) {
  const windowMs = num(options.windowMs, 15 * 60 * 1000);

  const friendlyUnits = units.filter(isFriendly);
  const enemyUnits = units.filter(isEnemy);

  const friendlyStrength = friendlyUnits.reduce((sum, u) => sum + num(u.strength), 0);
  const friendlyMaxStrength = friendlyUnits.reduce((sum, u) => sum + num(u.maxStrength, num(u.strength)), 0);
  const enemyStrength = enemyUnits.reduce((sum, u) => sum + num(u.strength), 0);
  const enemyMaxStrength = enemyUnits.reduce((sum, u) => sum + num(u.maxStrength, num(u.strength)), 0);

  const friendlyReadiness = average(friendlyUnits.map((u) => num(u.readiness)));
  const friendlyMorale = average(friendlyUnits.map((u) => num(u.morale)));

  const strengthRatio = friendlyMaxStrength > 0 ? friendlyStrength / friendlyMaxStrength : 0;
  const combatEffectiveness = clamp(
    (strengthRatio * 100 * 0.4) + (friendlyReadiness * 0.35) + (friendlyMorale * 0.25),
    0,
    100
  );

  const casualtyEvents = events.filter((e) => e.type === EVENT_TYPES.CASUALTY);
  const now = Date.now();
  const recentCasualties = casualtyEvents.filter((e) => now - toTimestampMs(e.timestamp) <= windowMs);
  const previousWindowCasualties = casualtyEvents.filter((e) => {
    const age = now - toTimestampMs(e.timestamp);
    return age > windowMs && age <= windowMs * 2;
  });

  const casualtyCount = recentCasualties.reduce((sum, e) => sum + num(e.severity, 1), 0);
  const casualtyRate = casualtyCount / (windowMs / 60000); // casualties per minute

  const previousCount = previousWindowCasualties.reduce((sum, e) => sum + num(e.severity, 1), 0);
  let casualtyTrend = 'stable';
  if (casualtyCount > previousCount * 1.1) casualtyTrend = 'increasing';
  else if (casualtyCount < previousCount * 0.9) casualtyTrend = 'decreasing';

  const enemyLossPct = enemyMaxStrength > 0 ? clamp(1 - enemyStrength / enemyMaxStrength, 0, 1) * 100 : 0;
  const friendlyLossPct = friendlyMaxStrength > 0 ? clamp(1 - friendlyStrength / friendlyMaxStrength, 0, 1) * 100 : 0;
  const missionProgress = clamp(enemyLossPct - friendlyLossPct * 0.5, 0, 100);

  return {
    friendlyStrength,
    friendlyMaxStrength,
    enemyStrength,
    enemyMaxStrength,
    friendlyReadiness: round(friendlyReadiness),
    friendlyMorale: round(friendlyMorale),
    combatEffectiveness: round(combatEffectiveness),
    casualtyRate: round(casualtyRate, 2),
    casualtyTrend,
    missionProgress: round(missionProgress),
    generatedAt: new Date(now).toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Battle Damage Assessment (BDA)                                       */
/* ------------------------------------------------------------------ */

function severityForLossPct(lossPct) {
  if (lossPct >= 75) return 'critical';
  if (lossPct >= 50) return 'heavy';
  if (lossPct >= 20) return 'moderate';
  if (lossPct > 0) return 'light';
  return 'none';
}

/**
 * Estimate minutes until a unit becomes combat ineffective (readiness <= 30
 * or losses reach 50%) given its current casualty trend, based on a linear
 * projection of the unit's own casualty events.
 */
function estimateTimeToIneffectiveMinutes(unit, unitEvents) {
  const maxStrength = num(unit.maxStrength, num(unit.strength));
  if (maxStrength <= 0) return null;

  const ineffectiveThreshold = maxStrength * 0.5;
  const currentLosses = maxStrength - num(unit.strength, maxStrength);
  if (currentLosses >= ineffectiveThreshold) return 0;

  const casualtyEvents = unitEvents
    .filter((e) => e.type === EVENT_TYPES.CASUALTY)
    .sort((a, b) => toTimestampMs(a.timestamp) - toTimestampMs(b.timestamp));

  if (casualtyEvents.length < 2) return null;

  const first = casualtyEvents[0];
  const last = casualtyEvents[casualtyEvents.length - 1];
  const elapsedMinutes = (toTimestampMs(last.timestamp) - toTimestampMs(first.timestamp)) / 60000;
  const totalSeverity = casualtyEvents.reduce((sum, e) => sum + num(e.severity, 1), 0);
  if (elapsedMinutes <= 0 || totalSeverity <= 0) return null;

  const ratePerMinute = totalSeverity / elapsedMinutes;
  if (ratePerMinute <= 0) return null;

  const remaining = ineffectiveThreshold - currentLosses;
  return round(remaining / ratePerMinute, 1);
}

/**
 * Compute per-unit battle damage assessment plus friendly/enemy comparison
 * totals.
 * @param {object[]} units
 * @param {object[]} events
 */
export function computeBDA(units = [], events = []) {
  const perUnit = units.map((unit) => {
    const maxStrength = num(unit.maxStrength, num(unit.strength));
    const strength = num(unit.strength);
    const casualties = Math.max(0, maxStrength - strength);
    const lossPercent = maxStrength > 0 ? round((casualties / maxStrength) * 100) : 0;
    const unitEvents = events.filter((e) => e.unitId === unit.id);

    return {
      unitId: unit.id,
      name: unit.name || unit.id,
      side: unit.side,
      type: unit.type,
      strength,
      maxStrength,
      casualties,
      lossPercent,
      severity: severityForLossPct(lossPercent),
      status: unit.status || (strength <= 0 ? 'destroyed' : 'active'),
      timeToCombatIneffectiveMinutes: estimateTimeToIneffectiveMinutes(unit, unitEvents),
    };
  });

  const friendlyDamage = perUnit
    .filter((u) => u.side === 'friendly')
    .reduce((sum, u) => sum + u.casualties, 0);
  const enemyDamage = perUnit
    .filter((u) => u.side === 'enemy')
    .reduce((sum, u) => sum + u.casualties, 0);

  const exchangeRatio = friendlyDamage > 0 ? round(enemyDamage / friendlyDamage, 2) : enemyDamage > 0 ? Infinity : 0;

  return {
    units: perUnit,
    summary: {
      friendlyDamage,
      enemyDamage,
      exchangeRatio: Number.isFinite(exchangeRatio) ? exchangeRatio : null,
      unitsDestroyed: perUnit.filter((u) => u.status === 'destroyed').length,
      unitsIneffective: perUnit.filter((u) => u.severity === 'critical' || u.severity === 'heavy').length,
    },
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Heatmaps                                                             */
/* ------------------------------------------------------------------ */

function cellKey(lat, lng, cellSize) {
  const row = Math.floor(lat / cellSize);
  const col = Math.floor(lng / cellSize);
  return `${row}:${col}`;
}

/**
 * Bin a list of {lat, lng, weight} points into a spatial grid.
 * Returns an array of cells sorted by descending intensity.
 */
function binPoints(points, cellSize) {
  const cells = new Map();

  points.forEach(({ lat, lng, weight = 1 }) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const key = cellKey(lat, lng, cellSize);
    const existing = cells.get(key);
    if (existing) {
      existing.intensity += weight;
      existing.count += 1;
    } else {
      const row = Math.floor(lat / cellSize);
      const col = Math.floor(lng / cellSize);
      cells.set(key, {
        lat: round((row + 0.5) * cellSize, 4),
        lng: round((col + 0.5) * cellSize, 4),
        intensity: weight,
        count: 1,
      });
    }
  });

  return Array.from(cells.values())
    .map((cell) => ({ ...cell, intensity: round(cell.intensity, 2) }))
    .sort((a, b) => b.intensity - a.intensity);
}

function pointsFromEvents(events, type) {
  return events
    .filter((e) => e.type === type && e.position)
    .map((e) => ({ lat: num(e.position.lat), lng: num(e.position.lng), weight: num(e.severity, 1) }));
}

function eventsRiskPoints(events) {
  const riskWeights = {
    [EVENT_TYPES.CASUALTY]: 3,
    [EVENT_TYPES.ENEMY_CONTACT]: 2,
    [EVENT_TYPES.ENGAGEMENT]: 2.5,
    [EVENT_TYPES.UNIT_DESTROYED]: 4,
  };
  return events
    .filter((e) => e.position && riskWeights[e.type])
    .map((e) => ({
      lat: num(e.position.lat),
      lng: num(e.position.lng),
      weight: riskWeights[e.type] * num(e.severity, 1),
    }));
}

function unitSupplyVulnerabilityPoints(units) {
  return units
    .filter((u) => u.position && num(u.supplyLevel, 100) < 50)
    .map((u) => ({
      lat: num(u.position.lat),
      lng: num(u.position.lng),
      weight: clamp(50 - num(u.supplyLevel, 100), 1, 50),
    }));
}

function commsBlackoutPoints(units, events) {
  const unitPoints = units
    .filter((u) => u.position && u.commsStatus && u.commsStatus !== 'normal')
    .map((u) => ({
      lat: num(u.position.lat),
      lng: num(u.position.lng),
      weight: u.commsStatus === 'blackout' ? 3 : 1.5,
    }));
  const eventPoints = pointsFromEvents(events, EVENT_TYPES.COMMS_BLACKOUT);
  return [...unitPoints, ...eventPoints];
}

/**
 * Compute a spatially-binned heatmap grid for one of the 7 supported
 * tactical heatmap types.
 * @param {object[]} units
 * @param {object[]} events
 * @param {string} type - one of HEATMAP_TYPES
 * @param {object} [options]
 * @param {number} [options.cellSize=0.05] - grid cell size in degrees.
 */
export function computeHeatmap(units = [], events = [], type, options = {}) {
  const cellSize = num(options.cellSize, DEFAULT_CELL_SIZE_DEG);

  let points;
  switch (type) {
    case HEATMAP_TYPES.CASUALTY:
      points = pointsFromEvents(events, EVENT_TYPES.CASUALTY);
      break;
    case HEATMAP_TYPES.ENEMY_CONTACT:
      points = pointsFromEvents(events, EVENT_TYPES.ENEMY_CONTACT);
      break;
    case HEATMAP_TYPES.ENGAGEMENT:
      points = pointsFromEvents(events, EVENT_TYPES.ENGAGEMENT);
      break;
    case HEATMAP_TYPES.FIRE_SUPPORT:
      points = pointsFromEvents(events, EVENT_TYPES.FIRE_SUPPORT);
      break;
    case HEATMAP_TYPES.RISK:
      points = eventsRiskPoints(events);
      break;
    case HEATMAP_TYPES.SUPPLY_VULNERABILITY:
      points = unitSupplyVulnerabilityPoints(units);
      break;
    case HEATMAP_TYPES.COMMS_BLACKOUT:
      points = commsBlackoutPoints(units, events);
      break;
    default:
      throw new Error(`Unknown heatmap type: ${type}`);
  }

  return {
    type,
    cellSize,
    cells: binPoints(points, cellSize),
    generatedAt: new Date().toISOString(),
  };
}

/** Compute all 7 tactical heatmaps at once, keyed by type. */
export function computeAllHeatmaps(units = [], events = [], options = {}) {
  return Object.fromEntries(
    Object.values(HEATMAP_TYPES).map((type) => [type, computeHeatmap(units, events, type, options)])
  );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, decimals = 0) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
