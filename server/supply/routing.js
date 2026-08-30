/**
 * Logistics route optimization for resupply convoys.
 *
 * Plans routes from supply depots to units, accounting for terrain-dependent
 * convoy speed and known enemy contact areas (which are routed around rather
 * than driven through), and estimates travel time.
 *
 * Like the forecasting engine these helpers are pure and database-free.
 */

const EARTH_RADIUS_KM = 6371;

/** Average sustained convoy speed (km/h) by terrain classification. */
export const TERRAIN_SPEEDS = {
  road: 60,
  trail: 35,
  open: 25,
  urban: 20,
  forest: 15,
  mountain: 12,
  swamp: 8,
};

/** Speed used when the terrain class is unknown. */
export const DEFAULT_TERRAIN = 'open';

/** Extra distance (km) added around a threat area when detouring. */
const THREAT_BUFFER_KM = 2;

const toRadians = (degrees) => (degrees * Math.PI) / 180;
const toDegrees = (radians) => (radians * 180) / Math.PI;

/**
 * Great-circle distance in kilometres between two lat/lon points.
 */
export function haversineDistanceKm(a, b) {
  const lat1 = toRadians(Number(a.latitude));
  const lat2 = toRadians(Number(b.latitude));
  const deltaLat = lat2 - lat1;
  const deltaLon = toRadians(Number(b.longitude) - Number(a.longitude));

  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Convoy speed (km/h) for a terrain class. */
export function terrainSpeed(terrain) {
  return TERRAIN_SPEEDS[terrain] || TERRAIN_SPEEDS[DEFAULT_TERRAIN];
}

/**
 * Project point `p` onto the segment `a`–`b`.
 * Uses a local equirectangular projection, which is accurate enough at the
 * scale of a tactical area of operations.
 * @returns {{distanceKm: number, t: number, lengthKm: number}}
 */
function projectToSegment(p, a, b) {
  const latRef = toRadians((Number(a.latitude) + Number(b.latitude)) / 2);
  const project = (point) => ({
    x: toRadians(Number(point.longitude)) * Math.cos(latRef) * EARTH_RADIUS_KM,
    y: toRadians(Number(point.latitude)) * EARTH_RADIUS_KM,
  });

  const pa = project(a);
  const pb = project(b);
  const pp = project(p);

  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    return { distanceKm: Math.hypot(pp.x - pa.x, pp.y - pa.y), t: 0, lengthKm: 0 };
  }

  let t = ((pp.x - pa.x) * dx + (pp.y - pa.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  return {
    distanceKm: Math.hypot(pp.x - (pa.x + t * dx), pp.y - (pa.y + t * dy)),
    t,
    lengthKm: Math.sqrt(lengthSq),
  };
}

/** Shortest distance (km) from point `p` to the segment `a`–`b`. */
export function distanceToSegmentKm(p, a, b) {
  return projectToSegment(p, a, b).distanceKm;
}

/**
 * Offset a point by `distanceKm` along `bearingDegrees`.
 */
export function offsetPoint(point, bearingDegrees, distanceKm) {
  const lat = toRadians(Number(point.latitude));
  const lon = toRadians(Number(point.longitude));
  const bearing = toRadians(bearingDegrees);
  const angular = distanceKm / EARTH_RADIUS_KM;

  const lat2 = Math.asin(
    Math.sin(lat) * Math.cos(angular) + Math.cos(lat) * Math.sin(angular) * Math.cos(bearing)
  );
  const lon2 =
    lon +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat),
      Math.cos(angular) - Math.sin(lat) * Math.sin(lat2)
    );

  const normalizedLon = ((toDegrees(lon2) + 540) % 360) - 180;
  return {
    latitude: Math.round(toDegrees(lat2) * 1e6) / 1e6,
    longitude: Math.round(normalizedLon * 1e6) / 1e6,
  };
}

/**
 * Find the threat area (if any) whose danger radius intersects a leg.
 * @param {object} from
 * @param {object} to
 * @param {Array} threats - [{ latitude, longitude, radiusKm, name }]
 */
function findBlockingThreat(from, to, threats) {
  let blocking = null;
  let worstIntrusion = 0;

  for (const threat of threats) {
    const radius = Number(threat.radiusKm) || 0;
    if (radius <= 0) continue;
    const distance = distanceToSegmentKm(threat, from, to);
    const intrusion = radius + THREAT_BUFFER_KM - distance;
    if (intrusion > worstIntrusion) {
      worstIntrusion = intrusion;
      blocking = threat;
    }
  }

  return blocking;
}

/** Bearing in degrees from `a` to `b`. */
function bearingDegrees(a, b) {
  const lat1 = toRadians(Number(a.latitude));
  const lat2 = toRadians(Number(b.latitude));
  const deltaLon = toRadians(Number(b.longitude) - Number(a.longitude));
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

/** Linear interpolation between two points (adequate over short legs). */
function interpolate(a, b, t) {
  return {
    latitude: Number(a.latitude) + (Number(b.latitude) - Number(a.latitude)) * t,
    longitude: Number(a.longitude) + (Number(b.longitude) - Number(a.longitude)) * t,
  };
}

/**
 * Perpendicular offset (km) from the leg needed so that *both* resulting legs
 * stay outside a circle of radius `radiusKm` centred on the leg.
 *
 * For a leg of length L with the threat projected `side` km from an endpoint,
 * a detour at perpendicular distance d keeps that leg clear when
 * `d >= R * side / sqrt(side^2 - R^2)`. When an endpoint already sits inside
 * the danger area the geometry has no solution, so a bounded fallback is used.
 */
function detourOffsetKm(radiusKm, sideA, sideB) {
  const clearance = (side) =>
    side > radiusKm * 1.0001
      ? (radiusKm * side) / Math.sqrt(side * side - radiusKm * radiusKm)
      : radiusKm * 3;
  const required = Math.max(clearance(sideA), clearance(sideB), radiusKm);
  return Math.min(required, radiusKm * 5);
}

/**
 * Compute a waypoint that routes a leg around a threat area.
 */
function detourWaypoint(from, to, threat) {
  const radius = (Number(threat.radiusKm) || 0) + THREAT_BUFFER_KM;
  const { t, lengthKm } = projectToSegment(threat, from, to);
  const foot = interpolate(from, to, t);
  const offset = detourOffsetKm(radius, t * lengthKm, (1 - t) * lengthKm);

  // Steer away from the threat: the bearing from the threat to the projection
  // foot is perpendicular to the leg. If the threat sits exactly on the leg,
  // fall back to either perpendicular of the leg bearing.
  const bearing =
    haversineDistanceKm(threat, foot) > 1e-6
      ? bearingDegrees(threat, foot)
      : bearingDegrees(from, to) + 90;

  return offsetPoint(foot, bearing, offset);
}

/**
 * Plan a logistics route between two points.
 *
 * Threat areas that the direct leg would pass through are avoided by
 * inserting a waypoint offset perpendicular to the leg, just outside the
 * threat radius. Up to `maxDetours` detours are attempted; any residual
 * exposure is reported in the returned `risk` field.
 *
 * @param {object} options
 * @param {object} options.from - { latitude, longitude, name? }
 * @param {object} options.to - { latitude, longitude, name? }
 * @param {string} [options.terrain] - Terrain classification for the route.
 * @param {Array} [options.threats] - Enemy contact areas to avoid.
 * @param {number} [options.maxDetours]
 */
export function planRoute({ from, to, terrain = DEFAULT_TERRAIN, threats = [], maxDetours = 3 }) {
  const waypoints = [{ ...from }, { ...to }];
  const avoided = [];
  let detours = 0;
  let index = 0;

  // Walk the path leg by leg, inserting a detour waypoint whenever a leg
  // passes through a threat area. Each inserted waypoint is re-checked so the
  // resulting path is clear of every known contact area.
  while (index < waypoints.length - 1 && detours < maxDetours) {
    const threat = findBlockingThreat(waypoints[index], waypoints[index + 1], threats);
    if (!threat) {
      index += 1;
      continue;
    }

    waypoints.splice(index + 1, 0, detourWaypoint(waypoints[index], waypoints[index + 1], threat));
    const label = threat.name || 'contact area';
    if (!avoided.some((entry) => entry.name === label)) {
      avoided.push({ name: label, radiusKm: Number(threat.radiusKm) || 0 });
    }
    detours += 1;
  }

  let distanceKm = 0;
  for (let i = 1; i < waypoints.length; i += 1) {
    distanceKm += haversineDistanceKm(waypoints[i - 1], waypoints[i]);
  }

  const speed = terrainSpeed(terrain);
  const travelHours = speed > 0 ? distanceKm / speed : null;
  const residualThreats = threats.filter((threat) => {
    for (let i = 1; i < waypoints.length; i += 1) {
      const distance = distanceToSegmentKm(threat, waypoints[i - 1], waypoints[i]);
      if (distance < (Number(threat.radiusKm) || 0)) return true;
    }
    return false;
  });

  return {
    waypoints: waypoints.map((point) => ({
      latitude: Number(point.latitude),
      longitude: Number(point.longitude),
      name: point.name,
    })),
    terrain,
    speedKph: speed,
    distanceKm: Math.round(distanceKm * 100) / 100,
    travelHours: travelHours === null ? null : Math.round(travelHours * 100) / 100,
    detours,
    avoidedThreats: avoided,
    risk: residualThreats.length > 0 ? 'high' : detours > 0 ? 'moderate' : 'low',
  };
}

/**
 * Choose the closest depot that still holds stock of every requested supply
 * type, falling back to the closest depot overall.
 *
 * @param {object} destination - { latitude, longitude }
 * @param {Array} depots - [{ id, name, latitude, longitude, stock }]
 * @param {string[]} [requiredTypes]
 */
export function selectDepot(destination, depots = [], requiredTypes = []) {
  const withDistance = depots
    .filter((depot) => depot.latitude !== null && depot.longitude !== null)
    .map((depot) => ({ depot, distanceKm: haversineDistanceKm(destination, depot) }))
    .sort((a, b) => a.distanceKm - b.distanceKm);

  if (withDistance.length === 0) return null;

  const stocked = withDistance.find(({ depot }) =>
    requiredTypes.every((type) => Number((depot.stock || {})[type]) > 0)
  );

  return (stocked || withDistance[0]).depot;
}

/**
 * Build resupply routes for a set of recommendations produced by the
 * forecasting engine.
 *
 * @param {Array} recommendations - Output of `recommendResupply`.
 * @param {Array} depots
 * @param {object} [options]
 * @param {string} [options.terrain]
 * @param {Array} [options.threats]
 */
export function planResupplyRoutes(recommendations = [], depots = [], options = {}) {
  const { terrain = DEFAULT_TERRAIN, threats = [] } = options;

  return recommendations
    .filter(
      (recommendation) =>
        recommendation.latitude !== null &&
        recommendation.latitude !== undefined &&
        recommendation.longitude !== null &&
        recommendation.longitude !== undefined
    )
    .map((recommendation) => {
      const requiredTypes = recommendation.items.map((item) => item.supplyType);
      const depot = selectDepot(recommendation, depots, requiredTypes);
      if (!depot) {
        return { ...recommendation, depot: null, route: null };
      }

      const route = planRoute({
        from: {
          latitude: depot.latitude,
          longitude: depot.longitude,
          name: depot.name,
        },
        to: {
          latitude: recommendation.latitude,
          longitude: recommendation.longitude,
          name: recommendation.unitName,
        },
        terrain,
        threats,
      });

      return {
        unitId: recommendation.unitId,
        unitName: recommendation.unitName,
        priority: recommendation.priority,
        items: recommendation.items,
        depot: { id: depot.id, name: depot.name },
        route,
        // Convoys that arrive after depletion cannot prevent a supply outage.
        arrivesBeforeDepletion:
          recommendation.hoursToFirstDepletion === null || route.travelHours === null
            ? true
            : route.travelHours < recommendation.hoursToFirstDepletion,
      };
    });
}
