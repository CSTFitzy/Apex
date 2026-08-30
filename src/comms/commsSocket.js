/**
 * Socket.IO client wrapper for real-time chat messaging and WebRTC
 * signaling. Mirrors the event names defined in
 * `server/comms/gateway.js`.
 */
import { io } from 'socket.io-client';

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
 * Thin wrapper around a socket.io-client connection scoped to comms
 * (voice signaling + chat messaging).
 */
export class CommsSocket {
  constructor(url = import.meta.env.VITE_COMMS_URL || `${window.location.protocol === 'https:' ? 'https' : 'http'}://${window.location.hostname}:3000`) {
    this.url = url;
    this.socket = null;
  }

  /** Connect to the comms gateway, authenticating with a JWT. */
  connect(token) {
    this.socket = io(this.url, {
      path: '/socket.io',
      auth: { token },
      autoConnect: true,
      reconnection: true,
    });
    return this.socket;
  }

  /** Register a listener for a socket event. Returns an unsubscribe function. */
  on(event, callback) {
    this.socket?.on(event, callback);
    return () => this.socket?.off(event, callback);
  }

  /** Emit an event to the server. */
  emit(event, payload) {
    this.socket?.emit(event, payload);
  }

  // --- Chat convenience methods -------------------------------------
  joinChat(roomId) {
    this.emit(CHAT_EVENTS.JOIN, { roomId });
  }

  leaveChat(roomId) {
    this.emit(CHAT_EVENTS.LEAVE, { roomId });
  }

  sendMessage(roomId, text) {
    this.emit(CHAT_EVENTS.SEND, { roomId, text });
  }

  sendTyping(roomId) {
    this.emit(CHAT_EVENTS.TYPING, { roomId });
  }

  // --- Voice signaling convenience methods ---------------------------
  joinVoiceRoom(roomId) {
    this.emit(SIGNAL_EVENTS.JOIN_ROOM, { roomId });
  }

  leaveVoiceRoom(roomId) {
    this.emit(SIGNAL_EVENTS.LEAVE_ROOM, { roomId });
  }

  sendOffer(targetSocketId, sdp) {
    this.emit(SIGNAL_EVENTS.OFFER, { targetSocketId, sdp });
  }

  sendAnswer(targetSocketId, sdp) {
    this.emit(SIGNAL_EVENTS.ANSWER, { targetSocketId, sdp });
  }

  sendIceCandidate(targetSocketId, candidate) {
    this.emit(SIGNAL_EVENTS.ICE_CANDIDATE, { targetSocketId, candidate });
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }
}

export default CommsSocket;
