/**
 * WebSocket message handlers for real-time streaming data.
 *
 * Supports broadcasting map updates, weather alerts, and intelligence
 * updates to all connected clients (or a subset, in the future, based on
 * subscription topics), as well as real-time text messaging and WebRTC
 * voice-call signaling (offer/answer/ICE candidate exchange) between
 * specific users.
 */
import { verifyToken } from '../auth/jwt.js';
import { isAuthDisabled, getDevUser } from '../auth/middleware.js';
import { logger } from '../utils/logger.js';
import { Messages } from '../comms/store.js';

export const MESSAGE_TYPES = {
  MAP_UPDATE: 'MAP_UPDATE',
  WEATHER_ALERT: 'WEATHER_ALERT',
  INTELLIGENCE_UPDATE: 'INTELLIGENCE_UPDATE',
  SUPPLY_UPDATE: 'SUPPLY_UPDATE',
  ANALYTICS_EVENT: 'ANALYTICS_EVENT',
  SUBSCRIBE: 'SUBSCRIBE',
  ERROR: 'ERROR',
  // Real-time messaging
  CHAT_MESSAGE: 'CHAT_MESSAGE',
  TYPING: 'TYPING',
  PRESENCE: 'PRESENCE',
  // WebRTC voice/video call signaling
  CALL_OFFER: 'CALL_OFFER',
  CALL_ANSWER: 'CALL_ANSWER',
  CALL_ICE_CANDIDATE: 'CALL_ICE_CANDIDATE',
  CALL_END: 'CALL_END',
};

/** Registry of userId -> Set of connected sockets, used for presence + call routing. */
const connectedUsers = new Map();

/**
 * The most recently registered WebSocket server. Route handlers use this to
 * push real-time updates without having to import the server entry point
 * (which would create a circular dependency).
 */
let activeServer = null;

/** Return the currently registered WebSocket server, if any. */
export function getWebSocketServer() {
  return activeServer;
}

/**
 * Attach connection/message handling to a `ws` WebSocketServer instance.
 * @param {import('ws').WebSocketServer} wss
 */
export function registerWebSocketHandlers(wss) {
  activeServer = wss;

  wss.on('connection', (socket, request) => {
    socket.isAlive = true;
    socket.topics = new Set(['all']);

    authenticateSocket(socket, request);

    logger.info('WebSocket client connected');

    if (socket.user) {
      registerUserSocket(socket);
      sendPresenceSnapshot(socket);
      broadcastPresence(wss, socket.user, 'online');
    }

    socket.on('pong', () => {
      socket.isAlive = true;
    });

    socket.on('message', (raw) => {
      handleMessage(wss, socket, raw);
    });

    socket.on('close', () => {
      logger.info('WebSocket client disconnected');
      if (socket.user) {
        unregisterUserSocket(wss, socket);
      }
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

  wss.on('close', () => {
    clearInterval(interval);
    if (activeServer === wss) activeServer = null;
  });
}

/**
 * Attempt to authenticate a socket connection using a `token` query param.
 * Unauthenticated sockets are still allowed to connect (read-only) so
 * public dashboards can display non-sensitive data, but `socket.user`
 * will be undefined. When authentication is disabled (see
 * `isAuthDisabled`), tokenless sockets are given the dev user so
 * messaging/presence still work locally.
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

  if (!socket.user && isAuthDisabled()) {
    socket.user = getDevUser();
  }
}

/* ------------------------------------------------------------------ */
/* Presence tracking                                                    */
/* ------------------------------------------------------------------ */

function registerUserSocket(socket) {
  const userId = socket.user.id;
  const sockets = connectedUsers.get(userId) || new Set();
  sockets.add(socket);
  connectedUsers.set(userId, sockets);
}

function unregisterUserSocket(wss, socket) {
  const userId = socket.user.id;
  const sockets = connectedUsers.get(userId);
  if (!sockets) return;
  sockets.delete(socket);
  if (sockets.size === 0) {
    connectedUsers.delete(userId);
    broadcastPresence(wss, socket.user, 'offline');
  }
}

function sendPresenceSnapshot(socket) {
  const online = [...connectedUsers.keys()];
  sendTo(socket, MESSAGE_TYPES.PRESENCE, { status: 'snapshot', online });
}

function broadcastPresence(wss, user, status) {
  if (!wss) return;
  broadcast(wss, MESSAGE_TYPES.PRESENCE, {
    status,
    userId: user.id,
    username: user.username,
  });
}

/** List currently connected user IDs (used for presence indicators). */
export function getOnlineUserIds() {
  return [...connectedUsers.keys()];
}

/* ------------------------------------------------------------------ */
/* Message handling                                                     */
/* ------------------------------------------------------------------ */

function handleMessage(wss, socket, raw) {
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
    case MESSAGE_TYPES.CHAT_MESSAGE:
      handleChatMessage(wss, socket, message.payload);
      break;
    case MESSAGE_TYPES.TYPING:
      handleTyping(wss, socket, message.payload);
      break;
    case MESSAGE_TYPES.CALL_OFFER:
    case MESSAGE_TYPES.CALL_ANSWER:
    case MESSAGE_TYPES.CALL_ICE_CANDIDATE:
    case MESSAGE_TYPES.CALL_END:
      handleCallSignal(socket, message.type, message.payload);
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

function handleChatMessage(wss, socket, payload = {}) {
  if (!socket.user) {
    return sendError(socket, 'Authentication required to send messages');
  }

  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  if (!text) {
    return sendError(socket, 'Message text is required');
  }

  const message = Messages.create({
    conversationId: payload.conversationId || 'global',
    senderId: socket.user.id,
    senderUsername: socket.user.username,
    text,
  });

  broadcastChatMessage(wss, message);
}

function handleTyping(wss, socket, payload = {}) {
  if (!socket.user) return;
  broadcast(wss, MESSAGE_TYPES.TYPING, {
    conversationId: payload.conversationId || 'global',
    userId: socket.user.id,
    username: socket.user.username,
    isTyping: Boolean(payload.isTyping),
  });
}

/**
 * Route a WebRTC signaling message (offer/answer/ICE candidate/hangup)
 * directly to the target user's connected sockets.
 */
function handleCallSignal(socket, type, payload = {}) {
  if (!socket.user) {
    return sendError(socket, 'Authentication required for calls');
  }

  const { targetUserId } = payload;
  if (targetUserId === undefined || targetUserId === null) {
    return sendError(socket, 'targetUserId is required for call signaling');
  }

  const delivered = sendToUser(targetUserId, type, {
    ...payload,
    fromUserId: socket.user.id,
    fromUsername: socket.user.username,
  });

  if (!delivered && type === MESSAGE_TYPES.CALL_OFFER) {
    sendTo(socket, MESSAGE_TYPES.CALL_END, {
      targetUserId,
      reason: 'user_offline',
    });
  }
}

function sendError(socket, error) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ type: MESSAGE_TYPES.ERROR, payload: { error } }));
  }
}

function sendTo(socket, type, payload) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ type, payload }));
  }
}

/**
 * Send a typed message to every connected socket for a given user id.
 * Returns true if delivered to at least one socket.
 */
function sendToUser(userId, type, payload) {
  const sockets = connectedUsers.get(userId);
  if (!sockets || sockets.size === 0) return false;
  let delivered = false;
  sockets.forEach((socket) => {
    if (socket.readyState === socket.OPEN) {
      sendTo(socket, type, payload);
      delivered = true;
    }
  });
  return delivered;
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

/**
 * Broadcast a supply change (consumption, transfer, or status change).
 * Defaults to the registered server so route handlers can call it directly.
 */
export function broadcastSupplyUpdate(data, wss = activeServer) {
  if (!wss) return;
  broadcast(wss, MESSAGE_TYPES.SUPPLY_UPDATE, data, 'supply');
}

/** Broadcast a tactical analytics event (casualty report, enemy contact, etc). */
export function broadcastAnalyticsEvent(wss, data) {
  broadcast(wss, MESSAGE_TYPES.ANALYTICS_EVENT, data, 'analytics');
}

/** Broadcast a chat message to clients subscribed to the 'comms' topic. */
export function broadcastChatMessage(wss, message) {
  broadcast(wss, MESSAGE_TYPES.CHAT_MESSAGE, message, 'comms');
}
