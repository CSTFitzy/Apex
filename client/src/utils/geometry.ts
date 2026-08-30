/**
 * Client-side geodesic helpers used by the operational-area (AO) drawing tools
 * and the line-of-sight (LOS) visibility overlay. All functions are pure so the
 * map components stay free of geometry maths.
 */
import type { AOBounds, AOShape, AreaOfOperations, LatLon, ViewshedResult } from '../types';

const EARTH_RADIUS_M = 6371000;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance in metres between two positions. */
export function haversineDistance(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Destination position given a start point, bearing (degrees) and distance (metres). */
export function destinationPoint(start: LatLon, bearingDeg: number, distanceM: number): LatLon {
  const angDist = distanceM / EARTH_RADIUS_M;
  const brng = toRad(bearingDeg);
  const lat1 = toRad(start.lat);
  const lon1 = toRad(start.lon);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angDist) + Math.cos(lat1) * Math.sin(angDist) * Math.cos(brng)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(angDist) * Math.cos(lat1),
      Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2)
    );
  return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 };
}

/** Bounding box enclosing a set of positions. */
export function boundsOf(points: LatLon[]): AOBounds {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  return {
    north: Math.max(...lats),
    south: Math.min(...lats),
    east: Math.max(...lons),
    west: Math.min(...lons),
  };
}

/** Polygon area in square metres (shoelace on a local equirectangular projection). */
export function polygonAreaM2(points: LatLon[]): number {
  if (points.length < 3) return 0;
  const latRef = toRad(points.reduce((sum, p) => sum + p.lat, 0) / points.length);
  const xy = points.map((p) => ({
    x: toRad(p.lon) * Math.cos(latRef) * EARTH_RADIUS_M,
    y: toRad(p.lat) * EARTH_RADIUS_M,
  }));
  let sum = 0;
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i];
    const b = xy[(i + 1) % xy.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Closed-polygon perimeter in metres. */
export function polygonPerimeterM(points: LatLon[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    total += haversineDistance(points[i], points[(i + 1) % points.length]);
  }
  return total;
}

function vertexMean(points: LatLon[]): LatLon {
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
    lon: points.reduce((s, p) => s + p.lon, 0) / points.length,
  };
}

/** Area-weighted centroid of a polygon, falling back to the vertex mean for degenerate shapes. */
export function polygonCentroid(points: LatLon[]): LatLon {
  if (points.length === 0) return { lat: 0, lon: 0 };
  if (points.length < 3) return vertexMean(points);

  let twiceArea = 0;
  let lat = 0;
  let lon = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const cross = a.lon * b.lat - b.lon * a.lat;
    twiceArea += cross;
    lat += (a.lat + b.lat) * cross;
    lon += (a.lon + b.lon) * cross;
  }
  if (twiceArea === 0) return vertexMean(points);
  return { lat: lat / (3 * twiceArea), lon: lon / (3 * twiceArea) };
}

/** Vertices approximating a circle of the given radius (used for AO circles). */
export function circleVertices(center: LatLon, radiusM: number, segments = 64): LatLon[] {
  const points: LatLon[] = [];
  for (let i = 0; i < segments; i++) {
    points.push(destinationPoint(center, (360 / segments) * i, radiusM));
  }
  return points;
}

/** Rectangle vertices (clockwise from north-west) given two opposite corners. */
export function rectangleVertices(a: LatLon, b: LatLon): LatLon[] {
  const north = Math.max(a.lat, b.lat);
  const south = Math.min(a.lat, b.lat);
  const east = Math.max(a.lon, b.lon);
  const west = Math.min(a.lon, b.lon);
  return [
    { lat: north, lon: west },
    { lat: north, lon: east },
    { lat: south, lon: east },
    { lat: south, lon: west },
  ];
}

/** Build the AO description (bounds, centroid, area, perimeter) for a drawn shape. */
export function buildAO(
  shape: AOShape,
  vertices: LatLon[],
  circle?: { center: LatLon; radiusM: number }
): AreaOfOperations {
  const areaM2 = circle ? Math.PI * circle.radiusM ** 2 : polygonAreaM2(vertices);
  const perimeterM = circle ? 2 * Math.PI * circle.radiusM : polygonPerimeterM(vertices);
  return {
    shape,
    vertices,
    circle,
    bounds: boundsOf(vertices),
    center: circle ? circle.center : polygonCentroid(vertices),
    areaKm2: areaM2 / 1_000_000,
    perimeterKm: perimeterM / 1000,
  };
}

export interface VisibilityWedge {
  visible: boolean;
  positions: Array<[number, number]>;
}

export interface VisibilityStats {
  visibleSamples: number;
  blockedSamples: number;
  totalSamples: number;
  /** Area-weighted share of the circle that is visible from the observer. */
  visibleAreaPct: number;
}

/**
 * Convert a ray-cast viewshed into filled wedges: the portion of every sector
 * between the observer and the first obstruction is rendered green while the
 * remaining shadowed portion is rendered red, producing a colour-graded
 * visibility disc that follows the terrain shadows.
 */
export function viewshedWedges(viewshed: ViewshedResult): VisibilityWedge[] {
  const { origin, radius, sectors } = viewshed;
  if (sectors.length < 2 || radius <= 0) return [];

  const wedges: VisibilityWedge[] = [];
  const arcSteps = 4;

  for (let i = 0; i < sectors.length; i++) {
    const current = sectors[i];
    const next = sectors[(i + 1) % sectors.length];
    const startBearing = current.bearing;
    const endBearing = i === sectors.length - 1 ? 360 : next.bearing;
    const visibleStart = Math.max(0, Math.min(current.visibleDistanceM, radius));
    const visibleEnd = Math.max(0, Math.min(next.visibleDistanceM, radius));

    const arc = (from: number, to: number): Array<[number, number]> => {
      const points: Array<[number, number]> = [];
      for (let s = 0; s <= arcSteps; s++) {
        const f = s / arcSteps;
        const bearingDeg = startBearing + (endBearing - startBearing) * f;
        const p = destinationPoint(origin, bearingDeg, from + (to - from) * f);
        points.push([p.lat, p.lon]);
      }
      return points;
    };

    const visibleArc = arc(visibleStart, visibleEnd);
    if (visibleStart > 0 || visibleEnd > 0) {
      wedges.push({ visible: true, positions: [[origin.lat, origin.lon], ...visibleArc] });
    }
    if (visibleStart < radius || visibleEnd < radius) {
      wedges.push({ visible: false, positions: [...visibleArc, ...arc(radius, radius).reverse()] });
    }
  }

  return wedges;
}

/**
 * Visible / blocked terrain sample counts and coverage for a viewshed. Sample
 * counts come from the server's ray casting when available, otherwise they are
 * derived from the per-sector results.
 */
export function visibilityStats(viewshed: ViewshedResult): VisibilityStats {
  const { sectors, radius } = viewshed;
  if (viewshed.sampleCount) {
    return {
      visibleSamples: viewshed.visibleSamples ?? 0,
      blockedSamples: viewshed.blockedSamples ?? 0,
      totalSamples: viewshed.sampleCount,
      visibleAreaPct: viewshed.visibleAreaPct,
    };
  }

  const visibleSamples = sectors.filter((s) => s.visible).length;
  const areaFraction =
    sectors.length === 0 || radius <= 0
      ? 0
      : sectors.reduce((sum, s) => sum + Math.min(Math.max(s.visibleDistanceM, 0) / radius, 1) ** 2, 0) /
        sectors.length;
  return {
    visibleSamples,
    blockedSamples: sectors.length - visibleSamples,
    totalSamples: sectors.length,
    visibleAreaPct: areaFraction * 100,
  };
}

/** Format a distance in metres for display (metres below 1 km, otherwise kilometres). */
export function formatDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${Math.round(metres)} m`;
}
