/**
 * Real-time chat message routing and parsing.
 *
 * Keeps the shape of chat/signaling payloads consistent regardless of
 * transport, and centralizes validation so malformed or oversized payloads
 * never reach room broadcasts.
 */

export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_ROOM_ID_LENGTH = 128;

export const CHAT_EVENT_TYPES = {
  MESSAGE: 'MESSAGE',
  TYPING: 'TYPING',
  SYSTEM: 'SYSTEM',
};

/**
 * Validate and normalize a room id (used for both text channels and voice
 * channels). Returns null if the room id is missing or malformed.
 * @param {unknown} roomId
 * @returns {string|null}
 */
export function parseRoomId(roomId) {
  if (typeof roomId !== 'string') return null;
  const trimmed = roomId.trim();
  if (!trimmed || trimmed.length > MAX_ROOM_ID_LENGTH) return null;
  if (!/^[a-zA-Z0-9_\-:.]+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Parse and validate an incoming chat message payload.
 * @param {unknown} raw
 * @returns {{ ok: true, message: { roomId: string, text: string } } | { ok: false, error: string }}
 */
export function parseChatMessage(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Message payload must be an object' };
  }

  const roomId = parseRoomId(raw.roomId);
  if (!roomId) {
    return { ok: false, error: 'Invalid or missing roomId' };
  }

  if (typeof raw.text !== 'string' || raw.text.trim().length === 0) {
    return { ok: false, error: 'Message text must be a non-empty string' };
  }

  const text = raw.text.slice(0, MAX_MESSAGE_LENGTH);
  return { ok: true, message: { roomId, text } };
}

/**
 * Build a fully-formed chat message envelope ready to broadcast.
 * @param {{ roomId: string, text: string }} message
 * @param {{ id: number|string, username: string }} sender
 */
export function buildChatEnvelope(message, sender) {
  return {
    type: CHAT_EVENT_TYPES.MESSAGE,
    roomId: message.roomId,
    text: message.text,
    sender: { id: sender?.id ?? null, username: sender?.username ?? 'unknown' },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Parse and validate a "typing" indicator payload.
 * @param {unknown} raw
 * @returns {{ ok: true, roomId: string } | { ok: false, error: string }}
 */
export function parseTypingIndicator(raw) {
  const roomId = parseRoomId(raw && raw.roomId);
  if (!roomId) {
    return { ok: false, error: 'Invalid or missing roomId' };
  }
  return { ok: true, roomId };
}
