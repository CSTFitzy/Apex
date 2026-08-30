/**
 * WebSocket message handlers for real-time streaming data.
 *
 * Supports broadcasting map updates, weather alerts, and intelligence
 * updates to all connected clients (or a subset, in the future, based on
 * subscription topics).
 */
import { verifyToken } from '../auth/jwt.js';
import { logger } from '../utils/logger.js';

export const MESSAGE_TYPES = {
  MAP_UPDATE: 'MAP_UPDATE',
  WEATHER_ALERT: 'WEATHER_ALERT',
  INTELLIGENCE_UPDATE: 'INTELLIGENCE_UPDATE',
  ANALYTICS_EVENT: 'ANALYTICS_EVENT',
  SUBSCRIBE: 'SUBSCRIBE',
  ERROR: 'ERROR',
};

/**
 * Attach connection/message handling to a `ws` WebSocketServer instance.
 * @param {import('ws').WebSocketServer} wss
 */
export function registerWebSocketHandlers(wss) {
  wss.on('connection', (socket, request) => {
    socket.isAlive = true;
    socket.topics = new Set(['all']);

    authenticateSocket(socket, request);

    logger.info('WebSocket client connected');

    socket.on('pong', () => {
      socket.isAlive = true;
    });

    socket.on('message', (raw) => {
      handleMessage(socket, raw);
    });

    socket.on('close', () => {
      logger.info('WebSocket client disconnected');
    });

    socket.on('error', (err) => {
      logger.error('WebSocket connection error', { error: err.message });
    });
  });

  // Periodically ping clients to detect stale connections.
  const interval = setInterval(() => {
    wss.clients.forEach((socket) => {
      if (socket.isAlive === false) {
        return socket.terminate();
      }
      socket.isAlive = false;
      socket.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));
}

/**
 * Attempt to authenticate a socket connection using a `token` query param.
 * Unauthenticated sockets are still allowed to connect (read-only) so
 * public dashboards can display non-sensitive data, but `socket.user`
 * will be undefined.
 */
function authenticateSocket(socket, request) {
  try {
    const url = new URL(request.url, 'http://localhost');
    const token = url.searchParams.get('token');
    if (token) {
      socket.user = verifyToken(token);
    }
  } catch (err) {
    logger.warn('WebSocket authentication failed', { error: err.message });
  }
}

function handleMessage(socket, raw) {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    return sendError(socket, 'Invalid JSON payload');
  }

  switch (message.type) {
    case MESSAGE_TYPES.SUBSCRIBE:
      handleSubscribe(socket, message.payload);
      break;
    default:
      sendError(socket, `Unknown message type: ${message.type}`);
  }
}

function handleSubscribe(socket, payload = {}) {
  const { topics } = payload;
  if (Array.isArray(topics)) {
    socket.topics = new Set(topics);
  }
}

function sendError(socket, error) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ type: MESSAGE_TYPES.ERROR, payload: { error } }));
  }
}

/**
 * Broadcast a message to all connected clients subscribed to a topic.
 * @param {import('ws').WebSocketServer} wss
 * @param {string} type - One of MESSAGE_TYPES
 * @param {object} payload
 * @param {string} [topic='all']
 */
export function broadcast(wss, type, payload, topic = 'all') {
  const message = JSON.stringify({ type, payload });
  wss.clients.forEach((socket) => {
    const subscribed = socket.topics && (socket.topics.has('all') || socket.topics.has(topic));
    if (subscribed && socket.readyState === socket.OPEN) {
      socket.send(message);
    }
  });
}

/** Broadcast a map update (new/updated tactical symbol or location). */
export function broadcastMapUpdate(wss, data) {
  broadcast(wss, MESSAGE_TYPES.MAP_UPDATE, data, 'map');
}

/** Broadcast a weather alert. */
export function broadcastWeatherAlert(wss, data) {
  broadcast(wss, MESSAGE_TYPES.WEATHER_ALERT, data, 'weather');
}

/** Broadcast an intelligence update (new ODIN report, etc). */
export function broadcastIntelligenceUpdate(wss, data) {
  broadcast(wss, MESSAGE_TYPES.INTELLIGENCE_UPDATE, data, 'intelligence');
}

/** Broadcast a tactical analytics event (casualty report, enemy contact, etc). */
export function broadcastAnalyticsEvent(wss, data) {
  broadcast(wss, MESSAGE_TYPES.ANALYTICS_EVENT, data, 'analytics');
}
