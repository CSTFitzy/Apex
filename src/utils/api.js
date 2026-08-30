/**
 * Frontend API client for communicating with the Apex backend.
 * Wraps `fetch` with base URL handling, JSON parsing, and JWT auth headers.
 */

const API_URL = import.meta.env.VITE_API_URL || '/api';

/** Get the stored auth token, if any. */
function getToken() {
  return localStorage.getItem('apex_token');
}

/** Persist the auth token (or clear it if null). */
export function setToken(token) {
  if (token) {
    localStorage.setItem('apex_token', token);
  } else {
    localStorage.removeItem('apex_token');
  }
}

/**
 * Decode the current user's id/username/role from the stored JWT, without
 * verifying its signature (verification happens server-side). Returns
 * null if there is no token or it can't be decoded.
 */
export function getCurrentUser() {
  const token = getToken();
  if (!token) return null;
  try {
    const [, payload] = token.split('.');
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
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

/**
 * Perform an authenticated request and return the raw response text along
 * with its content type, for endpoints that may respond with non-JSON
 * bodies (e.g. AAR CSV/HTML report export).
 */
async function requestText(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: buildAuthHeader(token) } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    if (contentType.includes('application/json')) {
      try {
        message = JSON.parse(text).error || message;
      } catch {
        // fall through to default message
      }
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return { contentType, body: text };
}

async function requestForm(path, formData, options = {}) {
  const token = getToken();
  const headers = {
    ...(token ? { Authorization: buildAuthHeader(token) } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    method: options.method || 'POST',
    body: formData,
    headers,
  });
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
  put: (path, data) => request(path, { method: 'PUT', body: JSON.stringify(data) }),

  // Convenience wrappers for common endpoints.
  login: (email, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (username, email, password) =>
    request('/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password }) }),
  getWeatherForecast: (lat, lon) => request(`/weather/forecast?lat=${lat}&lon=${lon}`),
  getIntelligenceReports: () => request('/odin/reports'),

  // Area of operations (AOO) terrain & weather analysis.
  analyzeTerrain: (lat, lon, radiusKm) =>
    request(`/terrain/analyze?lat=${lat}&lon=${lon}&radius=${radiusKm}`),
  getTerrainReport: (lat, lon, radiusKm, name) =>
    requestText(
      `/terrain/report?lat=${lat}&lon=${lon}&radius=${radiusKm}` +
        (name ? `&name=${encodeURIComponent(name)}` : '')
    ),

  getTacticalLocations: () => request('/tactical/locations'),
  getTacticalUnits: (scenarioId = 'default') => request(`/tactical/units?scenarioId=${encodeURIComponent(scenarioId)}`),
  saveTacticalUnit: (unit) => request('/tactical/units', { method: 'POST', body: JSON.stringify(unit) }),
  deleteTacticalUnit: (unitId) => request(`/tactical/units/${encodeURIComponent(unitId)}`, { method: 'DELETE' }),
  getTacticalMarkups: (scenarioId = 'default') =>
    request(`/tactical/markups/${encodeURIComponent(scenarioId)}`),
  saveTacticalMarkups: (payload) => request('/tactical/markups', { method: 'POST', body: JSON.stringify(payload) }),
  exportTacticalMarkups: (scenarioId = 'default') =>
    requestText(`/tactical/markups/${encodeURIComponent(scenarioId)}/export`),
  uploadTacticalDocument: ({ file, scenarioId = 'default', tags = '' }) => {
    const formData = new FormData();
    formData.append('document', file);
    formData.append('scenarioId', scenarioId);
    formData.append('tags', tags);
    return requestForm('/tactical/documents/upload', formData);
  },
  getTacticalDocuments: (scenarioId = 'default') =>
    request(`/tactical/documents?scenarioId=${encodeURIComponent(scenarioId)}`),
  searchTacticalDocuments: (query, scenarioId = 'default') =>
    request(
      `/tactical/documents/search?q=${encodeURIComponent(query)}&scenarioId=${encodeURIComponent(scenarioId)}`
    ),
  getTacticalDocumentPreview: (documentId) =>
    request(`/tactical/documents/${encodeURIComponent(documentId)}/preview`),
  deleteTacticalDocument: (documentId) =>
    request(`/tactical/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' }),
  analyzeEnemyCoas: (payload) =>
    request('/tactical/analyze-enemy-coas', { method: 'POST', body: JSON.stringify(payload) }),
  recommendCounterMoves: (payload) =>
    request('/tactical/recommend-counter-moves', { method: 'POST', body: JSON.stringify(payload) }),
  generateOpord: (payload) =>
    request('/tactical/generate-opord', { method: 'POST', body: JSON.stringify(payload) }),
  saveTacticalScenario: (payload) =>
    request('/tactical/scenarios', { method: 'POST', body: JSON.stringify(payload) }),
  getTacticalScenario: (scenarioId) =>
    request(`/tactical/scenarios/${encodeURIComponent(scenarioId)}`),
  listScenarios: (filters = {}) => request(`/scenarios?${new URLSearchParams(filters)}`),
  createScenario: (payload) => request('/scenarios', { method: 'POST', body: JSON.stringify(payload) }),
  updateScenario: (id, payload) => request(`/scenarios/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) }),
  archiveScenario: (id) => request(`/scenarios/${encodeURIComponent(id)}/archive`, { method: 'POST', body: '{}' }),
  duplicateScenario: (id, payload = {}) => request(`/scenarios/${encodeURIComponent(id)}/duplicate`, { method: 'POST', body: JSON.stringify(payload) }),
  getScenarioVersions: (id) => request(`/scenarios/${encodeURIComponent(id)}/versions`),
  getKPIs: (units, events) => request('/analytics/kpis', { method: 'POST', body: JSON.stringify({ units, events }) }),
  getBDA: (units, events) => request('/analytics/bda', { method: 'POST', body: JSON.stringify({ units, events }) }),
  getHeatmap: (units, events, type) =>
    request('/analytics/heatmap', { method: 'POST', body: JSON.stringify({ units, events, type }) }),
  postAnalyticsEvent: (event) => request('/analytics/events', { method: 'POST', body: JSON.stringify(event) }),
  getAnalyticsEvents: (limit) => request(`/analytics/events${limit ? `?limit=${limit}` : ''}`),
  getMessages: (conversationId = 'global') =>
    request(`/messages?conversationId=${encodeURIComponent(conversationId)}`),
  sendMessage: (text, conversationId = 'global') =>
    request('/messages', { method: 'POST', body: JSON.stringify({ text, conversationId }) }),

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

  // After-Action Review (AAR).
  startAAROperation: (meta) => request('/aar/operations', { method: 'POST', body: JSON.stringify(meta) }),
  listAAROperations: () => request('/aar/operations'),
  getAAROperation: (id) => request(`/aar/operations/${id}`),
  recordAARFrame: (operationId, units) =>
    request('/aar/frame', { method: 'POST', body: JSON.stringify({ operationId, units }) }),
  recordAAREvent: (operationId, event) =>
    request('/aar/events', { method: 'POST', body: JSON.stringify({ operationId, ...event }) }),
  addAARBookmark: (operationId, bookmark) =>
    request(`/aar/operations/${operationId}/bookmarks`, { method: 'POST', body: JSON.stringify(bookmark) }),
  endAAROperation: (operationId) =>
    request(`/aar/operations/${operationId}/end`, { method: 'POST', body: JSON.stringify({}) }),
  getAARAnalytics: (operationId) => request(`/aar/operations/${operationId}/analytics`),
  getAARLessons: (operationId, query) =>
    request(`/aar/operations/${operationId}/lessons${query ? `?q=${encodeURIComponent(query)}` : ''}`),
  getAARComparison: (operationId, withOperationId) =>
    request(`/aar/operations/${operationId}/comparison?with=${encodeURIComponent(withOperationId)}`),
  generateAARTraining: (operationId, difficulty) =>
    request(`/aar/operations/${operationId}/training`, { method: 'POST', body: JSON.stringify({ difficulty }) }),
  getAARAIAnalysis: (operationId, forceRefresh = false) =>
    request(`/aar/operations/${operationId}/ai-analysis`, { method: 'POST', body: JSON.stringify({ forceRefresh }) }),
  getAARAIStatus: () => request('/aar/ai-status'),
  exportAARReport: (operationId, format = 'json') =>
    requestText('/aar/export', { method: 'POST', body: JSON.stringify({ operationId, format }) }),
};

export default api;
