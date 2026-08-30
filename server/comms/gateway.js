/**
 * Socket.IO gateway: real-time chat messaging and WebRTC signaling.
 *
 * Voice/video media itself is exchanged directly peer-to-peer over WebRTC;
 * this gateway only relays the signaling handshake (offers/answers/ICE
 * candidates) and room presence, plus general-purpose chat messages.
 */
import { Server } from 'socket.io';
import { verifyToken } from '../auth/jwt.js';
import { logger } from '../utils/logger.js';
import { parseChatMessage, parseTypingIndicator, buildChatEnvelope, CHAT_EVENT_TYPES, parseRoomId } from './messages.js';
import { isValidSdp, preferAudioCodecs } from './codecs.js';
import { joinRoom, leaveRoom, leaveAllRooms, listParticipants } from './roomStore.js';

export const SIGNAL_EVENTS = {
  JOIN_ROOM: 'voice:join',
  LEAVE_ROOM: 'voice:leave',
  OFFER: 'voice:offer',
  ANSWER: 'voice:answer',
  ICE_CANDIDATE: 'voice:ice-candidate',
  PEER_JOINED: 'voice:peer-joined',
  PEER_LEFT: 'voice:peer-left',
  ROOM_PARTICIPANTS: 'voice:participants',
};

export const CHAT_EVENTS = {
  JOIN: 'chat:join',
  LEAVE: 'chat:leave',
  SEND: 'chat:send',
  TYPING: 'chat:typing',
  RECEIVE: 'chat:message',
};

/**
 * Attach a Socket.IO server to the given HTTP server and wire up comms
 * event handlers. Sockets authenticate with a JWT passed via
 * `socket.handshake.auth.token` (or `?token=` query param as a fallback).
 * @param {import('http').Server} httpServer
 * @param {{ corsOrigins?: string[], path?: string }} [options]
 * @returns {import('socket.io').Server}
 */
export function createCommsGateway(httpServer, options = {}) {
  const io = new Server(httpServer, {
    path: options.path || '/socket.io',
    cors: {
      origin: options.corsOrigins && options.corsOrigins.length > 0 ? options.corsOrigins : false,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    try {
      socket.user = verifyToken(token);
      return next();
    } catch (err) {
      logger.warn('Socket.IO authentication failed', { error: err.message });
      return next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    logger.info('Comms socket connected', { userId: socket.user?.id });

    registerChatHandlers(io, socket);
    registerSignalingHandlers(io, socket);

    socket.on('disconnect', () => {
      const leftRooms = leaveAllRooms(socket.id);
      leftRooms.forEach((roomId) => {
        socket.to(voiceRoomName(roomId)).emit(SIGNAL_EVENTS.PEER_LEFT, { socketId: socket.id, roomId });
      });
      logger.info('Comms socket disconnected', { userId: socket.user?.id });
    });
  });

  return io;
}

function registerChatHandlers(io, socket) {
  socket.on(CHAT_EVENTS.JOIN, (payload) => {
    const roomId = parseRoomId(payload && payload.roomId);
    if (!roomId) {
      return socket.emit('error', { error: 'Invalid or missing roomId' });
    }
    socket.join(chatRoomName(roomId));
  });

  socket.on(CHAT_EVENTS.LEAVE, (payload) => {
    const roomId = parseRoomId(payload && payload.roomId);
    if (!roomId) return;
    socket.leave(chatRoomName(roomId));
  });

  socket.on(CHAT_EVENTS.SEND, (payload) => {
    const result = parseChatMessage(payload);
    if (!result.ok) {
      return socket.emit('error', { error: result.error });
    }
    const envelope = buildChatEnvelope(result.message, socket.user);
    io.to(chatRoomName(result.message.roomId)).emit(CHAT_EVENTS.RECEIVE, envelope);
  });

  socket.on(CHAT_EVENTS.TYPING, (payload) => {
    const result = parseTypingIndicator(payload);
    if (!result.ok) return;
    socket.to(chatRoomName(result.roomId)).emit(CHAT_EVENTS.TYPING, {
      type: CHAT_EVENT_TYPES.TYPING,
      roomId: result.roomId,
      sender: { id: socket.user?.id ?? null, username: socket.user?.username ?? 'unknown' },
    });
  });
}

function registerSignalingHandlers(io, socket) {
  socket.on(SIGNAL_EVENTS.JOIN_ROOM, (payload) => {
    const roomId = parseRoomId(payload && payload.roomId);
    if (!roomId) {
      return socket.emit('error', { error: 'Invalid or missing roomId' });
    }

    const user = { id: socket.user?.id ?? null, username: socket.user?.username ?? 'unknown' };
    const existingPeers = joinRoom(roomId, socket.id, user);
    socket.join(voiceRoomName(roomId));
    socket.data.voiceRoomId = roomId;

    socket.emit(SIGNAL_EVENTS.ROOM_PARTICIPANTS, { roomId, participants: existingPeers });
    socket.to(voiceRoomName(roomId)).emit(SIGNAL_EVENTS.PEER_JOINED, { roomId, socketId: socket.id, user });
  });

  socket.on(SIGNAL_EVENTS.LEAVE_ROOM, (payload) => {
    const roomId = parseRoomId(payload && payload.roomId);
    if (!roomId) return;
    leaveRoom(roomId, socket.id);
    socket.leave(voiceRoomName(roomId));
    socket.to(voiceRoomName(roomId)).emit(SIGNAL_EVENTS.PEER_LEFT, { roomId, socketId: socket.id });
  });

  socket.on(SIGNAL_EVENTS.OFFER, (payload) => relaySignal(io, socket, SIGNAL_EVENTS.OFFER, payload));
  socket.on(SIGNAL_EVENTS.ANSWER, (payload) => relaySignal(io, socket, SIGNAL_EVENTS.ANSWER, payload));

  socket.on(SIGNAL_EVENTS.ICE_CANDIDATE, (payload) => {
    const { targetSocketId, candidate } = payload || {};
    if (typeof targetSocketId !== 'string' || !candidate || typeof candidate !== 'object') {
      return socket.emit('error', { error: 'Invalid ICE candidate payload' });
    }
    io.to(targetSocketId).emit(SIGNAL_EVENTS.ICE_CANDIDATE, {
      fromSocketId: socket.id,
      candidate,
    });
  });
}

/**
 * Relay an SDP offer/answer to a specific peer, applying the server's
 * audio codec preference and rejecting malformed SDP before forwarding it.
 */
function relaySignal(io, socket, event, payload) {
  const { targetSocketId, sdp } = payload || {};
  if (typeof targetSocketId !== 'string') {
    return socket.emit('error', { error: 'Missing targetSocketId' });
  }
  if (!isValidSdp(sdp)) {
    return socket.emit('error', { error: 'Invalid SDP payload' });
  }

  io.to(targetSocketId).emit(event, {
    fromSocketId: socket.id,
    sdp: preferAudioCodecs(sdp),
  });
}

function chatRoomName(roomId) {
  return `chat:${roomId}`;
}

function voiceRoomName(roomId) {
  return `voice:${roomId}`;
}

export { listParticipants };
