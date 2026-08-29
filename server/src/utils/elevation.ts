import axios from 'axios';
import type { LatLon, ElevationPoint } from './geo.js';

const OPEN_METEO_ELEVATION_URL =
  process.env.OPEN_METEO_ELEVATION_API || 'https://api.open-meteo.com/v1/elevation';

const BATCH_SIZE = 100;

/**
 * Fetch elevations for a set of points using the free Open-Meteo elevation API,
 * which is backed by SRTM/Copernicus DEM data (~30m / 90m resolution, no API key
 * required). Requests are batched and cached in-memory for the process lifetime
 * to avoid hammering the upstream API during repeated terrain analysis calls.
 */
const elevationCache = new Map<string, number>();

function cacheKey(p: LatLon): string {
  return `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
}

export async function fetchElevations(points: LatLon[]): Promise<ElevationPoint[]> {
  const results: ElevationPoint[] = new Array(points.length);
  const missingIdx: number[] = [];

  points.forEach((p, idx) => {
    const key = cacheKey(p);
    if (elevationCache.has(key)) {
      results[idx] = { ...p, elevation: elevationCache.get(key) as number };
    } else {
      missingIdx.push(idx);
    }
  });

  for (let i = 0; i < missingIdx.length; i += BATCH_SIZE) {
    const batchIdx = missingIdx.slice(i, i + BATCH_SIZE);
    const batchPoints = batchIdx.map((idx) => points[idx]);
    const latitude = batchPoints.map((p) => p.lat).join(',');
    const longitude = batchPoints.map((p) => p.lon).join(',');

    const { data } = await axios.get(OPEN_METEO_ELEVATION_URL, {
      params: { latitude, longitude },
      timeout: 15000,
    });

    const elevations: number[] = data.elevation || [];
    batchIdx.forEach((idx, i2) => {
      const elevation = elevations[i2] ?? 0;
      results[idx] = { ...points[idx], elevation };
      elevationCache.set(cacheKey(points[idx]), elevation);
    });
  }

  return results;
}

export async function fetchElevation(point: LatLon): Promise<number> {
  const [result] = await fetchElevations([point]);
  return result.elevation;
}
