/**
 * Terrain / area-of-operations (AOO) analysis routes.
 *
 * Given a point picked on the tactical map, sample elevation data around it,
 * derive a terrain assessment (relief, slope, mobility, key terrain,
 * obstacles), combine it with the weather forecast, and expose both a JSON
 * analysis and a downloadable plain-text report.
 */
import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { isValidLatitude, isValidLongitude } from '../utils/validators.js';
import { logger } from '../utils/logger.js';
import { fetchElevations } from '../terrain/elevation.js';
import { fetchForecast } from './weather.js';
import {
  buildSampleGrid,
  analyzeTerrain,
  summarizeWeather,
  buildTerrainWeatherReport,
} from '../terrain/analysis.js';

const router = Router();

const DEFAULT_RADIUS_KM = 5;
const MAX_RADIUS_KM = 200;
const GRID_SIZE = 7;

/**
 * Parse and validate the AOO parameters shared by the analysis endpoints.
 * Returns { error } when the request is invalid.
 */
function parseAoo(query) {
  const { lat, lon } = query;
  if (!isValidLatitude(lat) || !isValidLongitude(lon)) {
    return { error: 'Valid lat and lon query parameters are required' };
  }

  const radius = query.radius === undefined ? DEFAULT_RADIUS_KM : Number(query.radius);
  if (!Number.isFinite(radius) || radius <= 0 || radius > MAX_RADIUS_KM) {
    return { error: `radius must be a number between 0 and ${MAX_RADIUS_KM} (km)` };
  }

  const name = typeof query.name === 'string' ? query.name.slice(0, 120) : undefined;
  return { latitude: Number(lat), longitude: Number(lon), radiusKm: radius, name };
}

/**
 * Run the full AOO assessment: elevation sampling + terrain analysis, plus a
 * best-effort weather summary (weather failures don't fail the analysis).
 */
async function assessAoo({ latitude, longitude, radiusKm }) {
  const grid = buildSampleGrid(latitude, longitude, radiusKm, GRID_SIZE);
  const elevations = await fetchElevations(grid);
  const samples = grid.map((point, index) => ({ ...point, elevation: elevations[index] }));
  const terrain = analyzeTerrain({ latitude, longitude, radiusKm, samples });

  let weather = null;
  try {
    weather = summarizeWeather(await fetchForecast(latitude, longitude));
  } catch (err) {
    logger.warn('AOO weather lookup failed; returning terrain analysis only', {
      error: err.message,
    });
  }

  return { terrain, weather };
}

/**
 * GET /api/terrain/analyze?lat=&lon=&radius=
 * Return the structured terrain (and weather) analysis for an AOO.
 */
router.get('/analyze', requireAuth, async (req, res) => {
  const params = parseAoo(req.query);
  if (params.error) return res.status(400).json({ error: params.error });

  try {
    const { terrain, weather } = await assessAoo(params);
    return res.json({ aoo: { ...params, name: params.name || null }, terrain, weather });
  } catch (err) {
    logger.error('Terrain analysis failed', { error: err.message });
    return res.status(502).json({ error: 'Failed to fetch terrain elevation data' });
  }
});

/**
 * GET /api/terrain/report?lat=&lon=&radius=&name=&format=text|json
 * Generate the terrain & weather report for an AOO. `format=text` (default)
 * returns a downloadable plain-text report.
 */
router.get('/report', requireAuth, async (req, res) => {
  const params = parseAoo(req.query);
  if (params.error) return res.status(400).json({ error: params.error });

  try {
    const { terrain, weather } = await assessAoo(params);
    const generatedAt = new Date().toISOString();
    const report = buildTerrainWeatherReport({
      terrain,
      weather,
      name: params.name,
      generatedAt,
    });

    if (req.query.format === 'json') {
      return res.json({ generatedAt, terrain, weather, report });
    }

    res.type('text/plain').send(report);
    return undefined;
  } catch (err) {
    logger.error('Terrain report generation failed', { error: err.message });
    return res.status(502).json({ error: 'Failed to generate terrain & weather report' });
  }
});

export default router;
