/**
 * Analytics computations for live tactical dashboards.
 *
 * Derives Key Performance Indicators (KPIs), Battle Damage Assessment (BDA)
 * records, and tactical heatmap datasets from the current simulation state
 * (`{ units, events }`). Pure functions only — no I/O — so they are easy to
 * unit test and reuse from both REST routes and WebSocket broadcasts.
 */

/** Compute headline KPIs for the live operations dashboard. */
export function computeKpis({ units = [], events = [] } = {}) {
  const friendly = units.filter((u) => u.side === 'friendly');
  const hostile = units.filter((u) => u.side === 'hostile');

  const friendlyActive = friendly.filter((u) => u.status !== 'destroyed');
  const hostileActive = hostile.filter((u) => u.status !== 'destroyed');

  const friendlyLosses = friendly.length - friendlyActive.length;
  const hostileLosses = hostile.length - hostileActive.length;

  const avgHealth = (list) =>
    list.length === 0 ? 0 : Math.round(list.reduce((sum, u) => sum + u.health, 0) / list.length);

  const destroyedEvents = events.filter((e) => e.damageType === 'destroyed');
  const damagedEvents = events.filter((e) => e.damageType === 'damaged');
  const suppressedEvents = events.filter((e) => e.damageType === 'suppressed');

  const killRatio = friendlyLosses === 0 ? hostileLosses : Number((hostileLosses / friendlyLosses).toFixed(2));

  return {
    generatedAt: new Date().toISOString(),
    unitsTotal: units.length,
    friendlyUnits: friendly.length,
    hostileUnits: hostile.length,
    friendlyActive: friendlyActive.length,
    hostileActive: hostileActive.length,
    friendlyLosses,
    hostileLosses,
    friendlyAvgHealth: avgHealth(friendlyActive),
    hostileAvgHealth: avgHealth(hostileActive),
    killRatio,
    engagementsTotal: events.length,
    engagementsDestroyed: destroyedEvents.length,
    engagementsDamaged: damagedEvents.length,
    engagementsSuppressed: suppressedEvents.length,
    operationalReadiness:
      friendly.length === 0 ? 0 : Math.round((friendlyActive.length / friendly.length) * 100),
  };
}

/** Build Battle Damage Assessment table rows from combat events. */
export function computeBda({ events = [] } = {}) {
  return events
    .slice()
    .reverse()
    .map((event) => ({
      id: event.id,
      timestamp: event.timestamp,
      target: event.targetCallsign,
      targetSide: event.targetSide,
      targetType: event.targetType,
      attacker: event.sourceCallsign,
      attackerSide: event.sourceSide,
      damageType: event.damageType,
      damagePercent: event.damage,
      confidence: event.confidence,
      location: { latitude: event.latitude, longitude: event.longitude },
    }));
}

/** Summarize BDA counts by damage type and confidence, useful for table headers/KPIs. */
export function summarizeBda(bdaRows) {
  const byDamageType = {};
  const byConfidence = {};
  for (const row of bdaRows) {
    byDamageType[row.damageType] = (byDamageType[row.damageType] || 0) + 1;
    byConfidence[row.confidence] = (byConfidence[row.confidence] || 0) + 1;
  }
  return { total: bdaRows.length, byDamageType, byConfidence };
}

/**
 * The seven tactical heatmap layers exposed to the client. Each entry is a
 * `[latitude, longitude, intensity]` tuple consumable directly by
 * `leaflet.heat`.
 */
export const HEATMAP_TYPES = [
  'all-units',
  'friendly-units',
  'hostile-units',
  'engagements',
  'casualties',
  'destroyed',
  'movement',
];

function unitPoints(units, predicate, intensity = 0.5) {
  return units.filter(predicate).map((u) => [u.latitude, u.longitude, intensity]);
}

function eventPoints(events, predicate, intensityFn) {
  return events.filter(predicate).map((e) => [e.latitude, e.longitude, intensityFn ? intensityFn(e) : 0.6]);
}

/** Compute all 7 tactical heatmap datasets from the current simulation state. */
export function computeHeatmaps({ units = [], events = [] } = {}) {
  return {
    'all-units': unitPoints(units, () => true, 0.6),
    'friendly-units': unitPoints(units, (u) => u.side === 'friendly', 0.6),
    'hostile-units': unitPoints(units, (u) => u.side === 'hostile', 0.6),
    engagements: eventPoints(events, () => true, () => 0.5),
    casualties: eventPoints(
      events,
      (e) => e.damageType === 'destroyed' || e.damageType === 'damaged',
      (e) => Math.min(1, e.damage / 100)
    ),
    destroyed: eventPoints(events, (e) => e.damageType === 'destroyed', () => 1),
    // Movement heatmap approximates activity by combining current unit
    // positions with recent engagement locations.
    movement: [...unitPoints(units, (u) => u.status !== 'destroyed', 0.4), ...eventPoints(events, () => true, () => 0.7)],
  };
}

/** Compute a single named heatmap, or `null` if the type is unknown. */
export function computeHeatmap(type, state) {
  const all = computeHeatmaps(state);
  return Object.prototype.hasOwnProperty.call(all, type) ? all[type] : null;
}
