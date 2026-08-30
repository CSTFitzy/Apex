import { io, type Socket } from 'socket.io-client';

/**
 * Socket.IO transport for the tactical comms subsystem. A single connection
 * carries WebRTC signalling, radio channel state, presence and real-time
 * message delivery, and reconnects automatically on a dropped link.
 */

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });
  }
  return socket;
}

/** Promise wrapper around a Socket.IO emit that expects an acknowledgement. */
export function emitWithAck<T = { ok: boolean; error?: string }>(
  event: string,
  payload: unknown,
  timeoutMs = 8000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), timeoutMs);
    getSocket().emit(event, payload, (response: T) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
