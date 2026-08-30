/**
 * Elevation data provider.
 *
 * Uses the Open-Meteo elevation API (no API key required, see
 * API_INTEGRATIONS.md). Requests are batched and coordinates are sent in a
 * single query; on failure the caller receives an error so the route can
 * degrade gracefully.
 */
import axios from 'axios';

const DEFAULT_URL = 'https://api.open-meteo.com/v1/elevation';
const MAX_POINTS_PER_REQUEST = 100;

/**
 * Fetch elevations (metres) for a list of coordinates.
 * @param {Array<{ latitude: number, longitude: number }>} points
 * @returns {Promise<number[]>} Elevations in the same order as `points`.
 */
export async function fetchElevations(points) {
  const baseUrl = process.env.OPEN_METEO_ELEVATION_API || DEFAULT_URL;
  const elevations = [];

  for (let offset = 0; offset < points.length; offset += MAX_POINTS_PER_REQUEST) {
    const batch = points.slice(offset, offset + MAX_POINTS_PER_REQUEST);
    const response = await axios.get(baseUrl, {
      params: {
        latitude: batch.map((point) => point.latitude).join(','),
        longitude: batch.map((point) => point.longitude).join(','),
      },
      timeout: 8000,
    });

    const batchElevations = response.data?.elevation;
    if (!Array.isArray(batchElevations) || batchElevations.length !== batch.length) {
      throw new Error('Unexpected elevation API response');
    }
    elevations.push(...batchElevations.map((value) => Number(value)));
  }

  return elevations;
}
