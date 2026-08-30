import type { Server as SocketIOServer, Socket } from 'socket.io';
import { verifyToken, canSend, type CommsIdentity } from './auth.js';
import { commsStore } from './store.js';
import type { MessageType, MessageUrgency, VoiceQuality } from './types.js';

/**
 * Socket.IO gateway for real-time comms: WebRTC signalling (offer / answer /
 * ICE candidates), radio channel membership, push-to-talk state, tactical
 * message delivery, typing indicators and read receipts.
 */

interface SocketState {
  identity: CommsIdentity;
}

const sockets = new Map<string, SocketState>();

let ioRef: SocketIOServer | null = null;

/** The Socket.IO server, once the gateway has been registered (REST routes use it to broadcast). */
export function getCommsIo(): SocketIOServer | null {
  return ioRef;
}

function channelRoom(channelId: string): string {
  return `channel:${channelId}`;
}

function unitRoom(unitId: string): string {
  return `unit:${unitId}`;
}

export function registerCommsGateway(io: SocketIOServer): void {
  ioRef = io;
  io.on('connection', (socket: Socket) => {
    /** Authenticates the socket. Every other comms event requires this first. */
    socket.on('comms:identify', async (payload: { token?: string }, ack?: (res: unknown) => void) => {
      const identity = verifyToken(payload?.token);
      if (!identity) {
        ack?.({ ok: false, error: 'Authentication required' });
        return;
      }
      sockets.set(socket.id, { identity });
      socket.join(unitRoom(identity.unitId));
      const presence = commsStore.setPresence(identity.unitId, identity.callsign, true);
      io.emit('presence:update', presence);

      // Deliver anything that queued up while the unit was offline.
      const queued = await commsStore.drainQueue(identity.unitId);
      for (const message of queued) {
        socket.emit('message:sent', message);
        io.to(unitRoom(message.senderId)).emit('message:status', {
          id: message.id,
          status: message.status,
          deliveredAt: message.deliveredAt,
        });
      }

      ack?.({
        ok: true,
        identity,
        channels: commsStore.listChannels(),
        presence: commsStore.listPresence(),
        queuedCount: queued.length,
      });
    });

    const requireIdentity = (ack?: (res: unknown) => void): CommsIdentity | null => {
      const state = sockets.get(socket.id);
      if (!state) {
        ack?.({ ok: false, error: 'Authentication required' });
        return null;
      }
      return state.identity;
    };

    // ------------------------------------------------------------- channels

    socket.on('channel:join', (payload: { channelId: string }, ack?: (res: unknown) => void) => {
      const identity = requireIdentity(ack);
      if (!identity) return;
      const previous = commsStore
        .listChannels()
        .find((c) => c.members.some((m) => m.unitId === identity.unitId));
      if (previous && previous.id !== payload.channelId) {
        commsStore.leaveChannel(previous.id, identity.unitId);
        socket.leave(channelRoom(previous.id));
        io.emit('channel:state', commsStore.getChannel(previous.id));
      }
      const channel = commsStore.joinChannel(payload.channelId, identity.unitId, identity.callsign);
      if (!channel) {
        ack?.({ ok: false, error: 'Unknown channel' });
        return;
      }
      socket.join(channelRoom(channel.id));
      socket.to(channelRoom(channel.id)).emit('webrtc:peer-joined', {
        unitId: identity.unitId,
        callsign: identity.callsign,
        socketId: socket.id,
        channelId: channel.id,
      });
      io.emit('channel:state', channel);
      ack?.({ ok: true, channel, peers: peersOnChannel(io, channel.id, socket.id) });
    });

    socket.on('channel:leave', (payload: { channelId: string }, ack?: (res: unknown) => void) => {
      const identity = requireIdentity(ack);
      if (!identity) return;
      const channel = commsStore.leaveChannel(payload.channelId, identity.unitId);
      socket.leave(channelRoom(payload.channelId));
      socket.to(channelRoom(payload.channelId)).emit('webrtc:peer-left', {
        unitId: identity.unitId,
        socketId: socket.id,
        channelId: payload.channelId,
      });
      if (channel) io.emit('channel:state', channel);
      ack?.({ ok: true, channel });
    });

    /** Push-to-talk key down/up. */
    socket.on('channel:ptt', (payload: { channelId: string; transmitting: boolean }, ack?: (res: unknown) => void) => {
      const identity = requireIdentity(ack);
      if (!identity) return;
      const channel = commsStore.setTransmitting(payload.channelId, identity.unitId, payload.transmitting);
      if (!channel) {
        ack?.({ ok: false, error: 'Unknown channel' });
        return;
      }
      const granted = payload.transmitting ? channel.activeSpeakerId === identity.unitId : true;
      io.emit('channel:state', channel);
      io.to(channelRoom(channel.id)).emit('channel:speaker', {
        channelId: channel.id,
        speakerId: channel.activeSpeakerId,
        callsign: identity.callsign,
        transmitting: payload.transmitting && granted,
      });
      ack?.({ ok: true, granted, channel });
    });

    /** Records a completed transmission in the voice log for after-action review. */
    socket.on(
      'voice:log',
      (
        payload: { channelId: string; audio?: string; transcript?: string; durationMs?: number; quality?: VoiceQuality },
        ack?: (res: unknown) => void
      ) => {
        const identity = requireIdentity(ack);
        if (!identity) return;
        const entry = commsStore.addVoiceLog({
          channelId: payload.channelId,
          speakerId: identity.unitId,
          speakerCallsign: identity.callsign,
          audio: payload.audio ?? null,
          transcript: payload.transcript ?? '',
          durationMs: payload.durationMs ?? 0,
          quality: payload.quality ?? 'GOOD',
        });
        io.to(channelRoom(payload.channelId)).emit('voice:log', entry);
        ack?.({ ok: true, entry });
      }
    );

    // ------------------------------------------------------- WebRTC signalling

    const relay = (event: 'webrtc:offer' | 'webrtc:answer' | 'webrtc:ice-candidate') => {
      socket.on(event, (payload: { targetSocketId: string; [key: string]: unknown }, ack?: (res: unknown) => void) => {
        const identity = requireIdentity(ack);
        if (!identity || !payload?.targetSocketId) return;
        io.to(payload.targetSocketId).emit(event, {
          ...payload,
          fromSocketId: socket.id,
          fromUnitId: identity.unitId,
          fromCallsign: identity.callsign,
        });
        ack?.({ ok: true });
      });
    };
    relay('webrtc:offer');
    relay('webrtc:answer');
    relay('webrtc:ice-candidate');

    // ------------------------------------------------------------- messaging

    socket.on(
      'message:send',
      async (
        payload: {
          recipientIds?: string[];
          channelId?: string | null;
          type: MessageType;
          urgency?: MessageUrgency;
          subject?: string;
          content?: string;
          fields?: Record<string, string>;
          e2e?: { ciphertext: string; nonce: string; algorithm: string } | null;
        },
        ack?: (res: unknown) => void
      ) => {
        const identity = requireIdentity(ack);
        if (!identity) return;
        if (!canSend(identity.role, payload.type)) {
          ack?.({ ok: false, error: `Role ${identity.role} may not originate ${payload.type} messages` });
          return;
        }
        if (!(await commsStore.checkRateLimit(identity.unitId))) {
          ack?.({ ok: false, error: 'Rate limit exceeded - reduce transmission rate' });
          return;
        }
        const message = commsStore.createMessage({
          senderId: identity.unitId,
          senderCallsign: identity.callsign,
          ...payload,
        });
        dispatchMessage(io, message);
        ack?.({ ok: true, message });
      }
    );

    socket.on('message:read', (payload: { id: string }, ack?: (res: unknown) => void) => {
      const identity = requireIdentity(ack);
      if (!identity) return;
      const message = commsStore.markRead(payload.id, identity.unitId);
      if (!message) {
        ack?.({ ok: false, error: 'Unknown message' });
        return;
      }
      io.emit('message:read', { id: message.id, readerId: identity.unitId, readAt: message.readAt });
      ack?.({ ok: true, message });
    });

    socket.on('message:ack', (payload: { id: string }, ack?: (res: unknown) => void) => {
      const identity = requireIdentity(ack);
      if (!identity) return;
      const message = commsStore.acknowledge(payload.id, identity.unitId);
      if (!message) {
        ack?.({ ok: false, error: 'Unknown message' });
        return;
      }
      io.emit('message:ack', { id: message.id, unitId: identity.unitId });
      ack?.({ ok: true, message });
    });

    socket.on('typing:indicator', (payload: { channelId?: string; recipientIds?: string[]; typing: boolean }) => {
      const identity = requireIdentity();
      if (!identity) return;
      const event = {
        unitId: identity.unitId,
        callsign: identity.callsign,
        typing: payload.typing,
        channelId: payload.channelId ?? null,
      };
      if (payload.channelId) {
        socket.to(channelRoom(payload.channelId)).emit('typing:indicator', event);
      }
      for (const recipientId of payload.recipientIds ?? []) {
        socket.to(unitRoom(recipientId)).emit('typing:indicator', event);
      }
    });

    /** Keepalive so presence does not go stale on flaky tactical links. */
    socket.on('comms:heartbeat', (_payload, ack?: (res: unknown) => void) => {
      const identity = requireIdentity();
      if (identity) commsStore.setPresence(identity.unitId, identity.callsign, true);
      ack?.({ ok: true, serverTime: Date.now() });
    });

    socket.on('disconnect', () => {
      const state = sockets.get(socket.id);
      sockets.delete(socket.id);
      if (!state) return;
      const { identity } = state;
      for (const channel of commsStore.listChannels()) {
        if (channel.members.some((m) => m.unitId === identity.unitId)) {
          commsStore.leaveChannel(channel.id, identity.unitId);
          io.to(channelRoom(channel.id)).emit('webrtc:peer-left', {
            unitId: identity.unitId,
            socketId: socket.id,
            channelId: channel.id,
          });
          io.emit('channel:state', commsStore.getChannel(channel.id));
        }
      }
      const presence = commsStore.setPresence(identity.unitId, identity.callsign, false);
      io.emit('presence:update', presence);
    });
  });
}

function peersOnChannel(io: SocketIOServer, channelId: string, excludeSocketId: string) {
  const room = io.sockets.adapter.rooms.get(channelRoom(channelId));
  if (!room) return [];
  return Array.from(room)
    .filter((id) => id !== excludeSocketId)
    .map((id) => ({ socketId: id, ...sockets.get(id)?.identity }))
    .filter((peer) => Boolean(peer.unitId));
}

/**
 * Routes a message to its recipients: direct units, an entire channel, or a
 * broadcast to every connected station.
 */
export function dispatchMessage(io: SocketIOServer, message: ReturnType<typeof commsStore.createMessage>): void {
  if (message.recipientIds.length > 0) {
    for (const recipientId of message.recipientIds) {
      io.to(unitRoom(recipientId)).emit('message:sent', message);
    }
    io.to(unitRoom(message.senderId)).emit('message:sent', message);
  } else if (message.channelId) {
    io.to(channelRoom(message.channelId)).emit('message:sent', message);
  } else {
    io.emit('message:sent', message);
  }
}
