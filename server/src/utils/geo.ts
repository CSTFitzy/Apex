/**
 * Geospatial helper utilities used by the terrain analysis engine.
 * All calculations use free, no-key data sources (Open-Meteo elevation API)
 * and standard geodesy formulas so the engine works without any paid GIS
 * stack (GDAL/GRASS/Whitebox are not required for this implementation).
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface ElevationPoint extends LatLon {
  elevation: number;
}

const EARTH_RADIUS_M = 6371000;

/** Convert degrees to radians. */
export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Convert radians to degrees. */
export function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Great-circle distance between two points in metres (Haversine formula). */
export function haversineDistance(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Initial bearing in degrees (0-360) from point a to point b. */
export function bearing(a: LatLon, b: LatLon): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Destination point given a start point, bearing (deg) and distance (m). */
export function destinationPoint(
  start: LatLon,
  bearingDeg: number,
  distanceM: number
): LatLon {
  const angDist = distanceM / EARTH_RADIUS_M;
  const brng = toRad(bearingDeg);
  const lat1 = toRad(start.lat);
  const lon1 = toRad(start.lon);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angDist) +
      Math.cos(lat1) * Math.sin(angDist) * Math.cos(brng)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(angDist) * Math.cos(lat1),
      Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2)
    );

  return { lat: toDeg(lat2), lon: (((toDeg(lon2) + 540) % 360) - 180) };
}

/** Linearly interpolate `steps` points (inclusive of both ends) between a and b. */
export function interpolatePoints(
  a: LatLon,
  b: LatLon,
  steps: number
): LatLon[] {
  const points: LatLon[] = [];
  const n = Math.max(steps, 1);
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    points.push({
      lat: a.lat + (b.lat - a.lat) * f,
      lon: a.lon + (b.lon - a.lon) * f,
    });
  }
  return points;
}

/**
 * Determine whether the target is visible from the observer given an
 * elevation profile sampled between them (line-of-sight analysis).
 *
 * Accounts for observer/target height-of-eye offsets, earth curvature and
 * standard atmospheric refraction (using the common 7/6 refraction
 * coefficient) - the same approach used by military LOS/viewshed tools.
 */
export function computeLineOfSight(
  profile: ElevationPoint[],
  observerHeight = 2,
  targetHeight = 2
): {
  visible: boolean;
  obstructedAt: LatLon | null;
  profile: Array<ElevationPoint & { losHeight: number; distance: number }>;
} {
  if (profile.length < 2) {
    return { visible: true, obstructedAt: null, profile: [] };
  }

  const origin = profile[0];
  const target = profile[profile.length - 1];
  const totalDistance = haversineDistance(origin, target);

  const observerElev = origin.elevation + observerHeight;
  const targetElev = target.elevation + targetHeight;

  const REFRACTION_COEFF = 0.13;
  const curvatureAndRefraction = (d: number) =>
    ((1 - REFRACTION_COEFF) * d * d) / (2 * EARTH_RADIUS_M);

  let visible = true;
  let obstructedAt: LatLon | null = null;

  const annotated = profile.map((p) => {
    const d = haversineDistance(origin, p);
    const f = totalDistance === 0 ? 0 : d / totalDistance;
    // Straight line-of-sight height at this distance, adjusted for curvature/refraction
    const losHeight =
      observerElev + (targetElev - observerElev) * f - curvatureAndRefraction(d);
    return { ...p, losHeight, distance: d };
  });

  for (const p of annotated) {
    if (p.distance <= 0 || p.distance >= totalDistance) continue;
    if (p.elevation > p.losHeight) {
      visible = false;
      if (!obstructedAt) obstructedAt = { lat: p.lat, lon: p.lon };
      break;
    }
  }

  return { visible, obstructedAt, profile: annotated };
}

export interface RayVisibilityPoint extends ElevationPoint {
  distance: number;
  visible: boolean;
}

/**
 * Radial line-of-sight ray casting using the classic maximum-vertical-angle
 * algorithm: walking outward from the observer, a sample is visible when its
 * vertical angle (corrected for earth curvature and refraction) is at least as
 * high as every sample before it. This yields per-sample visibility along the
 * ray - what the LOS visibility disc renders as green (visible) and red
 * (terrain shadow) - as well as the distance to the first obstruction.
 */
export function castVisibilityRay(
  profile: ElevationPoint[],
  observerHeight = 1.5,
  targetHeight = 0
): { points: RayVisibilityPoint[]; firstObstructionDistanceM: number | null } {
  if (profile.length < 2) {
    return { points: [], firstObstructionDistanceM: null };
  }

  const origin = profile[0];
  const observerElev = origin.elevation + observerHeight;

  const REFRACTION_COEFF = 0.13;
  const curvatureAndRefraction = (d: number) =>
    ((1 - REFRACTION_COEFF) * d * d) / (2 * EARTH_RADIUS_M);

  let maxAngle = -Infinity;
  let firstObstructionDistanceM: number | null = null;
  const points: RayVisibilityPoint[] = [];

  for (let i = 1; i < profile.length; i++) {
    const p = profile[i];
    const distance = haversineDistance(origin, p);
    if (distance <= 0) continue;

    const apparentElev =
      p.elevation + targetHeight - curvatureAndRefraction(distance);
    const angle = (apparentElev - observerElev) / distance;
    const visible = angle >= maxAngle;

    if (visible) {
      maxAngle = angle;
    } else if (firstObstructionDistanceM === null) {
      firstObstructionDistanceM = distance;
    }

    points.push({ ...p, distance, visible });
  }

  return { points, firstObstructionDistanceM };
}

/** Compute slope (degrees) and aspect (degrees, 0=N) from a 3x3 elevation grid using Horn's method. */
export function computeSlopeAspect(
  grid: number[][],
  cellSizeM: number
): { slopeDeg: number; aspectDeg: number } {
  // grid is [ [nw, n, ne], [w, center, e], [sw, s, se] ]
  const [[a, b, c], [d, , f], [g, h, i]] = grid;
  const dzdx = (c + 2 * f + i - (a + 2 * d + g)) / (8 * cellSizeM);
  const dzdy = (g + 2 * h + i - (a + 2 * b + c)) / (8 * cellSizeM);
  const slopeRad = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
  let aspectRad = Math.atan2(dzdy, -dzdx);
  let aspectDeg = 90 - toDeg(aspectRad);
  if (aspectDeg < 0) aspectDeg += 360;
  return { slopeDeg: toDeg(slopeRad), aspectDeg };
}

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

/** Generate a regular grid of sample points inside a bounding box. */
export function sampleGrid(bbox: BoundingBox, resolution: number): LatLon[] {
  const points: LatLon[] = [];
  const res = Math.max(2, Math.min(resolution, 40));
  for (let i = 0; i < res; i++) {
    for (let j = 0; j < res; j++) {
      const lat = bbox.south + ((bbox.north - bbox.south) * i) / (res - 1);
      const lon = bbox.west + ((bbox.east - bbox.west) * j) / (res - 1);
      points.push({ lat, lon });
    }
  }
  return points;
}
