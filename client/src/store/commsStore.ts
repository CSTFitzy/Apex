import { create } from 'zustand';
import api from '../api/client';
import { getSocket } from '../comms/socket';
import { RadioTransport } from '../comms/radio';
import { decryptFrom, encryptFor, publicKey } from '../comms/e2e';
import type {
  CommsIdentity,
  CommsRole,
  LinkQuality,
  MessageType,
  MessageUrgency,
  PresenceRecord,
  RadioChannel,
  RadioPeer,
  TacticalMessage,
  TypingIndicator,
  VoiceLogEntry,
} from '../types';

/**
 * Central state for the communications dashboard: authentication, radio channel
 * membership, WebRTC peers, the tactical message log and the unit roster.
 */

export interface ComposeInput {
  type: MessageType;
  urgency: MessageUrgency;
  subject: string;
  content: string;
  fields: Record<string, string>;
  recipientIds: string[];
  channelId: string | null;
}

export interface MessageFilters {
  type: MessageType | 'ALL';
  urgency: MessageUrgency | 'ALL';
  search: string;
  sort: 'newest' | 'oldest' | 'sender' | 'type' | 'urgency';
}

interface CommsState {
  identity: CommsIdentity | null;
  token: string | null;
  connected: boolean;
  error: string | null;

  channels: RadioChannel[];
  currentChannelId: string | null;
  activeSpeaker: { channelId: string; unitId: string; callsign: string } | null;
  peers: RadioPeer[];
  transmitting: boolean;
  muted: boolean;
  receiveLevel: number;
  latencyMs: number | null;
  link: LinkQuality | null;

  messages: TacticalMessage[];
  unread: Record<string, number>;
  typing: TypingIndicator[];
  filters: MessageFilters;
  selectedMessageId: string | null;
  /** Message that should raise a priority alert in the UI. */
  alert: TacticalMessage | null;

  roster: PresenceRecord[];
  voiceLogs: VoiceLogEntry[];

  signIn: (unitId: string, callsign: string, role: CommsRole) => Promise<void>;
  signOut: () => void;
  joinChannel: (channelId: string) => Promise<void>;
  leaveChannel: () => Promise<void>;
  setTransmitting: (transmitting: boolean) => Promise<void>;
  setMuted: (muted: boolean) => void;
  updateLink: (link: LinkQuality) => void;
  sendMessage: (input: ComposeInput) => Promise<TacticalMessage | null>;
  markRead: (id: string) => Promise<void>;
  acknowledge: (id: string) => Promise<void>;
  setTyping: (typing: boolean, target: { channelId: string | null; recipientIds: string[] }) => void;
  setFilters: (filters: Partial<MessageFilters>) => void;
  selectMessage: (id: string | null) => void;
  dismissAlert: () => void;
  refreshMessages: () => Promise<void>;
}

let transport: RadioTransport | null = null;
let listenersBound = false;

const AUTH_SCHEME = 'Bearer';

function authHeader(token: string | null): Record<string, string> {
  return token ? { Authorization: `${AUTH_SCHEME} ${token}` } : {};
}

export const useCommsStore = create<CommsState>((set, get) => ({
  identity: null,
  token: null,
  connected: false,
  error: null,

  channels: [],
  currentChannelId: null,
  activeSpeaker: null,
  peers: [],
  transmitting: false,
  muted: false,
  receiveLevel: 0,
  latencyMs: null,
  link: null,

  messages: [],
  unread: {},
  typing: [],
  filters: { type: 'ALL', urgency: 'ALL', search: '', sort: 'newest' },
  selectedMessageId: null,
  alert: null,

  roster: [],
  voiceLogs: [],

  async signIn(unitId, callsign, role) {
    try {
      const { data } = await api.post<{ token: string; identity: CommsIdentity }>('/comms/auth', {
        unitId,
        callsign,
        role,
      });
      set({ token: data.token, identity: data.identity, error: null });

      const socket = getSocket();
      bindSocketListeners(set, get);

      const identityKey = await publicKey();
      const identify = async () => {
        const response = await new Promise<{ ok: boolean; error?: string; channels?: RadioChannel[]; presence?: PresenceRecord[] }>(
          (resolve) => {
            socket.emit('comms:identify', { token: data.token, publicKey: identityKey }, resolve);
          }
        );
        if (!response.ok) {
          set({ error: response.error ?? 'Comms authentication rejected', connected: false });
          return;
        }
        set({
          connected: true,
          channels: response.channels ?? [],
          roster: response.presence ?? [],
          error: null,
        });
      };

      socket.off('connect', identify);
      socket.on('connect', identify);
      if (socket.connected) await identify();

      transport =
        transport ??
        new RadioTransport({
          onPeersChanged: (peers) => set({ peers }),
          onError: (message) => set({ error: message }),
          onReceiveLevel: (receiveLevel) => set({ receiveLevel }),
          onLatency: (latencyMs) => set({ latencyMs }),
          onTransmissionRecorded: ({ audio, durationMs }) => {
            const { currentChannelId, link } = get();
            if (!currentChannelId) return;
            getSocket().emit('voice:log', {
              channelId: currentChannelId,
              audio,
              durationMs,
              quality: link?.quality ?? 'GOOD',
              transcript: `Voice transmission (${(durationMs / 1000).toFixed(1)}s)`,
            });
          },
        });

      await get().refreshMessages();
    } catch (err) {
      set({ error: (err as Error).message || 'Unable to authenticate with the comms server' });
    }
  },

  signOut() {
    transport?.dispose();
    transport = null;
    set({
      identity: null,
      token: null,
      connected: false,
      currentChannelId: null,
      peers: [],
      transmitting: false,
    });
  },

  async joinChannel(channelId) {
    try {
      await transport?.join(channelId);
      set({ currentChannelId: channelId, error: null });
      void transport?.measureLatency();
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  async leaveChannel() {
    await transport?.leave();
    set({ currentChannelId: null, peers: [], transmitting: false });
  },

  async setTransmitting(transmitting) {
    const granted = await transport?.setTransmitting(transmitting);
    set({ transmitting: transmitting ? Boolean(granted) : false });
  },

  setMuted(muted) {
    transport?.setMuted(muted);
    set({ muted });
  },

  updateLink(link) {
    transport?.setStaticLevel(link.staticLevel);
    set({ link });
  },

  async sendMessage(input) {
    const { token, roster, identity } = get();
    if (!identity) {
      set({ error: 'Sign in to the comms net before transmitting' });
      return null;
    }
    try {
      // Direct messages are sealed end-to-end; the server relays ciphertext only.
      let e2e = null;
      if (input.recipientIds.length === 1) {
        const recipient = roster.find((r) => r.unitId === input.recipientIds[0]);
        e2e = await encryptFor(input.recipientIds[0], recipient?.publicKey, input.content);
      }
      const { data } = await api.post<{ message: TacticalMessage }>(
        '/messages',
        { ...input, content: e2e ? '' : input.content, e2e },
        { headers: authHeader(token) }
      );
      return data.message;
    } catch (err) {
      const message = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
      set({ error: message || 'Message transmission failed' });
      return null;
    }
  },

  async markRead(id) {
    const { token } = get();
    await api.put(`/messages/${id}/read`, {}, { headers: authHeader(token) }).catch(() => undefined);
  },

  async acknowledge(id) {
    const { token } = get();
    await api.post(`/messages/${id}/ack`, {}, { headers: authHeader(token) }).catch(() => undefined);
  },

  setTyping(typing, target) {
    getSocket().emit('typing:indicator', {
      typing,
      channelId: target.channelId,
      recipientIds: target.recipientIds,
    });
  },

  setFilters(filters) {
    set({ filters: { ...get().filters, ...filters } });
  },

  selectMessage(selectedMessageId) {
    set({ selectedMessageId });
    if (selectedMessageId) void get().markRead(selectedMessageId);
  },

  dismissAlert() {
    set({ alert: null });
  },

  async refreshMessages() {
    const { token } = get();
    if (!token) return;
    try {
      const { data } = await api.get<{ messages: TacticalMessage[]; unread: Record<string, number> }>(
        '/messages',
        { headers: authHeader(token) }
      );
      set({ messages: data.messages, unread: data.unread });
    } catch {
      /* the socket feed keeps the log fresh if the REST call fails */
    }
  },
}));

type Setter = (partial: Partial<CommsState> | ((state: CommsState) => Partial<CommsState>)) => void;

/** Wires the Socket.IO feed into the store exactly once. */
function bindSocketListeners(set: Setter, get: () => CommsState): void {
  if (listenersBound) return;
  listenersBound = true;
  const socket = getSocket();

  socket.on('disconnect', () => set({ connected: false }));

  socket.on('channel:state', (channel: RadioChannel | undefined) => {
    if (!channel) return;
    set((state) => ({
      channels: state.channels.some((c) => c.id === channel.id)
        ? state.channels.map((c) => (c.id === channel.id ? channel : c))
        : [...state.channels, channel],
    }));
  });

  socket.on(
    'channel:speaker',
    (payload: { channelId: string; speakerId: string | null; callsign: string; transmitting: boolean }) => {
      set({
        activeSpeaker:
          payload.transmitting && payload.speakerId
            ? { channelId: payload.channelId, unitId: payload.speakerId, callsign: payload.callsign }
            : null,
      });
    }
  );

  socket.on('presence:update', (record: PresenceRecord) => {
    set((state) => ({
      roster: state.roster.some((r) => r.unitId === record.unitId)
        ? state.roster.map((r) => (r.unitId === record.unitId ? record : r))
        : [...state.roster, record],
    }));
  });

  socket.on('message:sent', async (message: TacticalMessage) => {
    const { identity, roster } = get();
    let resolved = message;
    if (message.e2e && identity && message.recipientIds.includes(identity.unitId)) {
      const sender = roster.find((r) => r.unitId === message.senderId);
      const plaintext = await decryptFrom(message.senderId, sender?.publicKey, message.e2e);
      resolved = { ...message, content: plaintext ?? '[unable to decrypt - no session key]' };
    }
    set((state) => ({
      messages: [resolved, ...state.messages.filter((m) => m.id !== resolved.id)],
      alert:
        (resolved.urgency === 'IMMEDIATE' || resolved.urgency === 'FLASH') &&
        resolved.senderId !== identity?.unitId
          ? resolved
          : state.alert,
    }));
  });

  socket.on('message:status', (payload: { id: string; status: TacticalMessage['status']; deliveredAt: string | null }) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === payload.id ? { ...m, status: payload.status, deliveredAt: payload.deliveredAt } : m
      ),
    }));
  });

  socket.on('message:read', (payload: { id: string; readerId: string; readAt: string }) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === payload.id
          ? {
              ...m,
              status: 'READ',
              readAt: payload.readAt,
              readBy: m.readBy.includes(payload.readerId) ? m.readBy : [...m.readBy, payload.readerId],
            }
          : m
      ),
    }));
  });

  socket.on('message:ack', (payload: { id: string; unitId: string }) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === payload.id && !m.acknowledgedBy.includes(payload.unitId)
          ? { ...m, acknowledgedBy: [...m.acknowledgedBy, payload.unitId] }
          : m
      ),
    }));
  });

  socket.on('typing:indicator', (payload: TypingIndicator) => {
    set((state) => ({
      typing: payload.typing
        ? [...state.typing.filter((t) => t.unitId !== payload.unitId), payload]
        : state.typing.filter((t) => t.unitId !== payload.unitId),
    }));
  });

  socket.on('voice:log', (entry: VoiceLogEntry) => {
    set((state) => ({ voiceLogs: [...state.voiceLogs, entry].slice(-200) }));
  });
}
