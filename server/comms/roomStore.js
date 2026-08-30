/**
 * In-memory presence tracking for comms rooms (text + voice channels).
 *
 * Rooms are ephemeral and scoped to the lifetime of the process; this keeps
 * the implementation simple and dependency-free while still letting the
 * gateway answer "who else is in this room" for newly joining peers.
 */

/** @type {Map<string, Map<string, { id: number|string, username: string }>>} */
const rooms = new Map();

/**
 * Add a socket to a room's participant list.
 * @param {string} roomId
 * @param {string} socketId
 * @param {{ id: number|string, username: string }} user
 * @returns {Array<{ socketId: string, user: object }>} other participants already in the room
 */
export function joinRoom(roomId, socketId, user) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Map());
  }
  const participants = rooms.get(roomId);
  const others = Array.from(participants.entries()).map(([id, u]) => ({ socketId: id, user: u }));
  participants.set(socketId, user);
  return others;
}

/**
 * Remove a socket from a room. Cleans up the room entirely once empty.
 * @param {string} roomId
 * @param {string} socketId
 */
export function leaveRoom(roomId, socketId) {
  const participants = rooms.get(roomId);
  if (!participants) return;
  participants.delete(socketId);
  if (participants.size === 0) {
    rooms.delete(roomId);
  }
}

/** Remove a socket from every room it was a member of. Returns the list of room ids it left. */
export function leaveAllRooms(socketId) {
  const left = [];
  for (const [roomId, participants] of rooms.entries()) {
    if (participants.has(socketId)) {
      participants.delete(socketId);
      left.push(roomId);
      if (participants.size === 0) {
        rooms.delete(roomId);
      }
    }
  }
  return left;
}

/** List participants currently in a room. */
export function listParticipants(roomId) {
  const participants = rooms.get(roomId);
  if (!participants) return [];
  return Array.from(participants.entries()).map(([socketId, user]) => ({ socketId, user }));
}

/** Test-only helper to reset all room state. */
export function _resetRoomsForTests() {
  rooms.clear();
}
