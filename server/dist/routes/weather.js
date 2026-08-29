import { Router } from 'express';
import axios from 'axios';
const router = Router();
const OPEN_METEO_FORECAST_URL = process.env.OPEN_METEO_API || 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_ARCHIVE_URL = process.env.OPEN_METEO_ARCHIVE_API || 'https://archive-api.open-meteo.com/v1/archive';
const CURRENT_FIELDS = [
    'temperature_2m',
    'relative_humidity_2m',
    'precipitation',
    'weather_code',
    'cloud_cover',
    'pressure_msl',
    'wind_speed_10m',
    'wind_direction_10m',
    'wind_gusts_10m',
    'visibility',
].join(',');
const DAILY_FIELDS = [
    'temperature_2m_max',
    'temperature_2m_min',
    'precipitation_sum',
    'wind_speed_10m_max',
    'wind_gusts_10m_max',
    'wind_direction_10m_dominant',
].join(',');
function assessOperationalImpact(current) {
    const factors = [];
    let severity = 0;
    const visibility = current.visibility ?? 10000;
    if (visibility < 1000) {
        factors.push('Visibility below 1km - severe restriction on observation and target acquisition');
        severity += 3;
    }
    else if (visibility < 4000) {
        factors.push('Reduced visibility - degraded long-range observation');
        severity += 1;
    }
    const windSpeed = current.wind_speed_10m ?? 0;
    if (windSpeed > 40) {
        factors.push('High winds - aviation and airborne operations significantly restricted');
        severity += 3;
    }
    else if (windSpeed > 20) {
        factors.push('Moderate winds - may affect indirect fire accuracy and small UAS operations');
        severity += 1;
    }
    const precipitation = current.precipitation ?? 0;
    if (precipitation > 7.5) {
        factors.push('Heavy precipitation - mobility and equipment degraded, thermal/optic performance reduced');
        severity += 2;
    }
    else if (precipitation > 0.5) {
        factors.push('Light-to-moderate precipitation - minor mobility and visibility impact');
        severity += 1;
    }
    const cloudCover = current.cloud_cover ?? 0;
    if (cloudCover > 80) {
        factors.push('Heavy cloud cover - reduced illumination, limits satellite/overhead imagery collection');
        severity += 1;
    }
    if (factors.length === 0) {
        factors.push('Conditions favorable for planned operations');
    }
    let level = 'LOW';
    if (severity >= 6)
        level = 'SEVERE';
    else if (severity >= 3)
        level = 'HIGH';
    else if (severity >= 1)
        level = 'MODERATE';
    return { level, factors };
}
/**
 * GET /api/weather?lat=&lon=
 * Proxies the free Open-Meteo API (no API key required) for current
 * conditions and a 7-day forecast, and computes an operational impact
 * assessment from the current conditions.
 */
router.get('/', async (req, res) => {
    try {
        const lat = parseFloat(String(req.query.lat));
        const lon = parseFloat(String(req.query.lon));
        if (Number.isNaN(lat) || Number.isNaN(lon)) {
            return res.status(400).json({ error: 'lat and lon query params are required' });
        }
        const { data } = await axios.get(OPEN_METEO_FORECAST_URL, {
            params: {
                latitude: lat,
                longitude: lon,
                current: CURRENT_FIELDS,
                daily: DAILY_FIELDS,
                hourly: 'temperature_2m,precipitation_probability,visibility,wind_speed_10m',
                forecast_days: 7,
                timezone: 'auto',
            },
            timeout: 15000,
        });
        const impact = assessOperationalImpact(data.current || {});
        res.json({
            location: { lat, lon },
            current: data.current,
            daily: data.daily,
            hourly: data.hourly,
            units: { current: data.current_units, daily: data.daily_units },
            operationalImpact: impact,
        });
    }
    catch (error) {
        console.error('Weather lookup failed:', error);
        res.status(500).json({ error: 'Failed to fetch weather data' });
    }
});
/**
 * GET /api/weather/history?lat=&lon=&start=YYYY-MM-DD&end=YYYY-MM-DD
 * Historical weather via Open-Meteo's free archive API.
 */
router.get('/history', async (req, res) => {
    try {
        const lat = parseFloat(String(req.query.lat));
        const lon = parseFloat(String(req.query.lon));
        const startDate = String(req.query.start || '');
        const endDate = String(req.query.end || '');
        if (Number.isNaN(lat) || Number.isNaN(lon) || !startDate || !endDate) {
            return res
                .status(400)
                .json({ error: 'lat, lon, start and end query params are required' });
        }
        const { data } = await axios.get(OPEN_METEO_ARCHIVE_URL, {
            params: {
                latitude: lat,
                longitude: lon,
                start_date: startDate,
                end_date: endDate,
                daily: DAILY_FIELDS,
                timezone: 'auto',
            },
            timeout: 15000,
        });
        res.json({ location: { lat, lon }, daily: data.daily, units: data.daily_units });
    }
    catch (error) {
        console.error('Historical weather lookup failed:', error);
        res.status(500).json({ error: 'Failed to fetch historical weather data' });
    }
});
export default router;
