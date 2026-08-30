/**
 * Frontend API client for communicating with the Sharknet backend.
 * Wraps `fetch` with base URL handling, JSON parsing, and JWT auth headers.
 */

const API_URL = import.meta.env.VITE_API_URL || '/api';

/** Get the stored auth token, if any. */
function getToken() {
  return localStorage.getItem('sharknet_token');
}

/** Persist the auth token (or clear it if null). */
export function setToken(token) {
  if (token) {
    localStorage.setItem('sharknet_token', token);
  } else {
    localStorage.removeItem('sharknet_token');
  }
}

/** Build the standard authorization header value for a JWT. */
function buildAuthHeader(token) {
  const scheme = 'Bearer';
  return scheme + ' ' + token;
}

/**
 * Perform an authenticated JSON request against the API.
 * @param {string} path - Path relative to the API base (e.g. '/tactical/locations').
 * @param {RequestInit} [options]
 */
async function request(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: buildAuthHeader(token) } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : null;

  if (!response.ok) {
    const error = new Error((body && body.error) || `Request failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return body;
}

export const api = {
  get: (path) => request(path, { method: 'GET' }),
  post: (path, data) => request(path, { method: 'POST', body: JSON.stringify(data) }),
  delete: (path) => request(path, { method: 'DELETE' }),

  // Convenience wrappers for common endpoints.
  login: (email, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (username, email, password) =>
    request('/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password }) }),
  getWeatherForecast: (lat, lon) => request(`/weather/forecast?lat=${lat}&lon=${lon}`),
  getIntelligenceReports: () => request('/odin/reports'),
  getTacticalLocations: () => request('/tactical/locations'),

  // Supply chain / logistics.
  getSupplyStatus: (windowHours) =>
    request(`/supply/status${windowHours ? `?window=${windowHours}` : ''}`),
  getSupplyForecast: (windowHours) =>
    request(`/supply/forecast${windowHours ? `?window=${windowHours}` : ''}`),
  getSupplyDepots: () => request('/supply/depots'),
  getSupplyConsumption: (limit = 200) => request(`/supply/consumption?limit=${limit}`),
  consumeSupply: (payload) =>
    request('/supply/consume', { method: 'POST', body: JSON.stringify(payload) }),
  transferSupply: (payload) =>
    request('/supply/transfer', { method: 'POST', body: JSON.stringify(payload) }),
};

export default api;
