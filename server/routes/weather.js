/**
 * Meteorological data routes.
 *
 * Provides stubbed/pass-through endpoints for the weather data providers
 * described in API_INTEGRATIONS.md (Open-Meteo, MET Norway, OpenWeatherMap).
 * Results are cached via the WeatherCache model to reduce upstream calls.
 */
import { Router } from 'express';
import axios from 'axios';
import { requireAuth } from '../auth/middleware.js';
import { WeatherCache } from '../db/models.js';
import { isValidLatitude, isValidLongitude } from '../utils/validators.js';
import { logger } from '../utils/logger.js';

const router = Router();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Fetch (and cache) an Open-Meteo forecast for the given coordinates.
 * Exported so other modules (e.g. the terrain/AOO analysis) can reuse the
 * same provider and caching behaviour.
 * @param {number} latitude
 * @param {number} longitude
 */
export async function fetchForecast(latitude, longitude) {
  const provider = 'open-meteo';
  const baseUrl = process.env.OPEN_METEO_API || 'https://api.open-meteo.com/v1/forecast';
  const response = await axios.get(baseUrl, {
    params: {
      latitude,
      longitude,
      hourly: 'temperature_2m,precipitation,windspeed_10m,winddirection_10m',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
      timezone: 'auto',
    },
    timeout: 5000,
  });

  const data = {
    location: { latitude, longitude },
    hourly: response.data.hourly,
    daily: response.data.daily,
    timezone: response.data.timezone,
  };

  // Caching is best-effort: a missing/unavailable database must not prevent
  // callers from receiving live forecast data.
  try {
    await WeatherCache.upsert({
      latitude,
      longitude,
      provider,
      data,
      expiresAt: new Date(Date.now() + CACHE_TTL_MS),
    });
  } catch (err) {
    logger.warn('Failed to cache weather forecast', { error: err.message });
  }

  return data;
}

/**
 * GET /api/weather/forecast?lat=&lon=
 * Fetch a weather forecast for the given coordinates using Open-Meteo
 * (no API key required). Falls back to cached data on upstream failure.
 */
router.get('/forecast', requireAuth, async (req, res) => {
  const { lat, lon } = req.query;

  if (!isValidLatitude(lat) || !isValidLongitude(lon)) {
    return res.status(400).json({ error: 'Valid lat and lon query parameters are required' });
  }

  const latitude = Number(lat);
  const longitude = Number(lon);
  const provider = 'open-meteo';

  try {
    return res.json(await fetchForecast(latitude, longitude));
  } catch (err) {
    logger.warn('Weather forecast fetch failed, attempting cache fallback', {
      error: err.message,
    });

    try {
      const cached = await WeatherCache.findLatest({ latitude, longitude, provider });
      if (cached) {
        return res.json({ ...cached.data, cached: true });
      }
    } catch (cacheErr) {
      logger.warn('Weather cache lookup failed', { error: cacheErr.message });
    }

    return res.status(502).json({ error: 'Failed to fetch weather data' });
  }
});

/**
 * GET /api/weather/alerts?lat=&lon=
 * Stub: return active severe weather alerts for a location.
 * TODO: integrate with OpenWeatherMap's alerts data once an API key is configured.
 */
router.get('/alerts', requireAuth, (req, res) => {
  return res.json({ alerts: [] });
});

export default router;
