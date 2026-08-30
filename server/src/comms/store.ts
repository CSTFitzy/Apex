import type pg from 'pg';
import { randomId, seal, unseal, sign, verify, type SealedPayload } from './crypto.js';
import {
  ACK_REQUIRED_URGENCIES,
  URGENCY_ORDER,
  type AuditEntry,
  type ChannelStatus,
  type MessageFilter,
  type MessageType,
  type MessageUrgency,
  type PresenceRecord,
  type RadioChannel,
  type TacticalMessage,
  type VoiceLogEntry,
} from './types.js';

/**
 * Persistence and state management for the tactical comms subsystem.
 *
 * The store keeps an authoritative in-memory view so the system stays fully
 * functional in a standalone/desktop deployment, and transparently writes
 * through to PostgreSQL (durable archive) and Redis (offline message queue,
 * presence and rate limiting) whenever those services are available.
 */

export type RedisLike = {
  isOpen?: boolean;
  /** node-redis sets this only once the connection is established and usable. */
  isReady?: boolean;
  rPush(key: string, value: string): Promise<unknown>;
  lRange(key: string, start: number, stop: number): Promise<string[]>;
  del(key: string | string[]): Promise<unknown>;
  hSet(key: string, field: string, value: string): Promise<unknown>;
  hGetAll(key: string): Promise<Record<string, string>>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  set(key: string, value: string): Promise<unknown>;
  get(key: string): Promise<string | null>;
};

const RATE_LIMIT_WINDOW_S = 10;
const RATE_LIMIT_MAX_MESSAGES = Number(process.env.COMMS_RATE_LIMIT || 20);
const MAX_VOICE_LOGS = Number(process.env.COMMS_MAX_VOICE_LOGS || 500);

/** Default company/platoon/battalion radio nets created on first boot. */
const DEFAULT_CHANNELS: Array<Omit<RadioChannel, 'members' | 'activeSpeakerId' | 'status' | 'createdAt'>> = [
  { id: 'company-net', name: 'Company Net', frequencyMHz: 30.125, encrypted: true },
  { id: 'platoon-net', name: 'Platoon Net', frequencyMHz: 31.4, encrypted: true },
  { id: 'battalion-net', name: 'Battalion Net', frequencyMHz: 45.75, encrypted: true },
  { id: 'fires-net', name: 'Fires Net', frequencyMHz: 51.2, encrypted: true },
  { id: 'admin-log-net', name: 'Admin/Log Net', frequencyMHz: 62.9, encrypted: false },
  { id: 'guard-net', name: 'Guard (Emergency)', frequencyMHz: 121.5, encrypted: false },
];

function canonicalise(message: Omit<TacticalMessage, 'signature'>): string {
  return JSON.stringify({
    id: message.id,
    senderId: message.senderId,
    recipientIds: message.recipientIds,
    channelId: message.channelId,
    type: message.type,
    urgency: message.urgency,
    subject: message.subject,
    content: message.content,
    fields: message.fields,
    sentAt: message.sentAt,
  });
}

export interface SendMessageInput {
  senderId: string;
  senderCallsign: string;
  recipientIds?: string[];
  channelId?: string | null;
  type: MessageType;
  urgency?: MessageUrgency;
  subject?: string;
  content?: string;
  fields?: Record<string, string>;
  e2e?: TacticalMessage['e2e'];
}

export class CommsStore {
  private pool: pg.Pool | null = null;
  private redis: RedisLike | null = null;
  private dbReady = false;

  private readonly channels = new Map<string, RadioChannel>();
  private readonly messages = new Map<string, TacticalMessage>();
  private readonly presence = new Map<string, PresenceRecord>();
  private readonly queues = new Map<string, string[]>();
  private readonly audit: AuditEntry[] = [];
  private readonly voiceLogs: VoiceLogEntry[] = [];
  private readonly rateCounters = new Map<string, { count: number; resetAt: number }>();

  /**
   * Redis commands are only issued once the client is fully connected -
   * node-redis otherwise queues them indefinitely while it retries, which would
   * stall message delivery whenever Redis is not deployed.
   */
  private readyRedis(): RedisLike | null {
    return this.redis?.isReady ? this.redis : null;
  }

  constructor() {
    for (const definition of DEFAULT_CHANNELS) {
      this.channels.set(definition.id, {
        ...definition,
        members: [],
        activeSpeakerId: null,
        status: 'IDLE',
        createdAt: new Date().toISOString(),
      });
    }
  }

  /** Attaches optional PostgreSQL / Redis backends and provisions the schema. */
  async init(pool: pg.Pool | null, redis: RedisLike | null): Promise<void> {
    this.pool = pool;
    this.redis = redis;
    if (!pool) return;
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS messages (
          id VARCHAR(64) PRIMARY KEY,
          sender_id VARCHAR(64) NOT NULL,
          sender_callsign VARCHAR(64),
          recipient_ids JSONB DEFAULT '[]'::jsonb,
          channel_id VARCHAR(64),
          type VARCHAR(50),
          urgency VARCHAR(20),
          subject TEXT,
          encrypted_content JSONB,
          fields JSONB DEFAULT '{}'::jsonb,
          e2e JSONB,
          requires_ack BOOLEAN DEFAULT FALSE,
          acknowledged_by JSONB DEFAULT '[]'::jsonb,
          read_by JSONB DEFAULT '[]'::jsonb,
          status VARCHAR(20),
          signature TEXT,
          sent_at TIMESTAMPTZ,
          delivered_at TIMESTAMPTZ,
          read_at TIMESTAMPTZ
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS radio_channels (
          id VARCHAR(64) PRIMARY KEY,
          name VARCHAR(255),
          frequency_mhz NUMERIC(8, 3),
          encrypted BOOLEAN DEFAULT TRUE,
          members JSONB DEFAULT '[]'::jsonb,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS voice_logs (
          id VARCHAR(64) PRIMARY KEY,
          channel_id VARCHAR(64),
          speaker_id VARCHAR(64),
          speaker_callsign VARCHAR(64),
          audio_data BYTEA,
          transcript TEXT,
          duration_ms INT,
          quality_level VARCHAR(20),
          timestamp TIMESTAMPTZ
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS comms_audit (
          id VARCHAR(64) PRIMARY KEY,
          action VARCHAR(20),
          actor_id VARCHAR(64),
          target_id VARCHAR(64),
          detail TEXT,
          timestamp TIMESTAMPTZ
        )
      `);
      this.dbReady = true;
      await this.loadFromDatabase();
    } catch (error) {
      console.warn('Comms persistence unavailable, running in-memory only:', (error as Error).message);
      this.dbReady = false;
    }
  }

  private async loadFromDatabase(): Promise<void> {
    if (!this.pool || !this.dbReady) return;
    for (const channel of this.channels.values()) {
      await this.pool.query(
        `INSERT INTO radio_channels (id, name, frequency_mhz, encrypted, members)
         VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (id) DO NOTHING`,
        [channel.id, channel.name, channel.frequencyMHz, channel.encrypted, JSON.stringify([])]
      );
    }
    const { rows } = await this.pool.query('SELECT * FROM radio_channels');
    for (const row of rows) {
      if (this.channels.has(row.id)) continue;
      this.channels.set(row.id, {
        id: row.id,
        name: row.name,
        frequencyMHz: Number(row.frequency_mhz),
        encrypted: row.encrypted,
        members: [],
        activeSpeakerId: null,
        status: 'IDLE',
        createdAt: new Date(row.created_at ?? Date.now()).toISOString(),
      });
    }

    const messageRows = await this.pool.query(
      'SELECT * FROM messages ORDER BY sent_at DESC LIMIT 500'
    );
    for (const row of messageRows.rows) {
      const sealed = row.encrypted_content as SealedPayload | null;
      const message: TacticalMessage = {
        id: row.id,
        senderId: row.sender_id,
        senderCallsign: row.sender_callsign ?? row.sender_id,
        recipientIds: row.recipient_ids ?? [],
        channelId: row.channel_id,
        type: row.type,
        urgency: row.urgency,
        subject: row.subject ?? '',
        content: sealed ? unseal(sealed) ?? '' : '',
        fields: row.fields ?? {},
        e2e: row.e2e ?? null,
        requiresAck: row.requires_ack,
        acknowledgedBy: row.acknowledged_by ?? [],
        readBy: row.read_by ?? [],
        status: row.status,
        signature: row.signature ?? '',
        sentAt: new Date(row.sent_at).toISOString(),
        deliveredAt: row.delivered_at ? new Date(row.delivered_at).toISOString() : null,
        readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
      };
      this.messages.set(message.id, message);
    }
  }

  // ---------------------------------------------------------------- channels

  listChannels(): RadioChannel[] {
    return Array.from(this.channels.values()).sort((a, b) => a.frequencyMHz - b.frequencyMHz);
  }

  getChannel(id: string): RadioChannel | undefined {
    return this.channels.get(id);
  }

  createChannel(name: string, frequencyMHz: number, encrypted: boolean): RadioChannel {
    const channel: RadioChannel = {
      id: randomId('chan'),
      name,
      frequencyMHz,
      encrypted,
      members: [],
      activeSpeakerId: null,
      status: 'IDLE',
      createdAt: new Date().toISOString(),
    };
    this.channels.set(channel.id, channel);
    void this.persistChannel(channel);
    return channel;
  }

  /** Adds a unit to a channel, removing it from any other net it was on. */
  joinChannel(channelId: string, unitId: string, callsign: string): RadioChannel | null {
    const channel = this.channels.get(channelId);
    if (!channel) return null;
    for (const other of this.channels.values()) {
      if (other.id !== channelId) {
        other.members = other.members.filter((m) => m.unitId !== unitId);
        if (other.activeSpeakerId === unitId) {
          other.activeSpeakerId = null;
          other.status = 'IDLE';
        }
      }
    }
    if (!channel.members.some((m) => m.unitId === unitId)) {
      channel.members.push({ unitId, callsign, joinedAt: new Date().toISOString(), muted: false });
    }
    const record = this.presence.get(unitId);
    if (record) record.channelId = channelId;
    this.recordAudit('JOINED', unitId, channelId);
    void this.persistChannel(channel);
    return channel;
  }

  leaveChannel(channelId: string, unitId: string): RadioChannel | null {
    const channel = this.channels.get(channelId);
    if (!channel) return null;
    channel.members = channel.members.filter((m) => m.unitId !== unitId);
    if (channel.activeSpeakerId === unitId) {
      channel.activeSpeakerId = null;
      channel.status = 'IDLE';
    }
    const record = this.presence.get(unitId);
    if (record && record.channelId === channelId) record.channelId = null;
    this.recordAudit('LEFT', unitId, channelId);
    void this.persistChannel(channel);
    return channel;
  }

  /** Push-to-talk: claims or releases the channel for a speaker. */
  setTransmitting(channelId: string, unitId: string, transmitting: boolean): RadioChannel | null {
    const channel = this.channels.get(channelId);
    if (!channel) return null;
    if (transmitting) {
      // The net is half-duplex: a second station cannot seize a busy channel.
      if (channel.activeSpeakerId && channel.activeSpeakerId !== unitId) return channel;
      channel.activeSpeakerId = unitId;
      channel.status = 'BUSY';
      this.recordAudit('TRANSMITTED', unitId, channelId);
    } else if (channel.activeSpeakerId === unitId) {
      channel.activeSpeakerId = null;
      channel.status = 'IDLE';
    }
    return channel;
  }

  setChannelStatus(channelId: string, status: ChannelStatus): RadioChannel | null {
    const channel = this.channels.get(channelId);
    if (!channel) return null;
    channel.status = status;
    return channel;
  }

  private async persistChannel(channel: RadioChannel): Promise<void> {
    const redis = this.readyRedis();
    if (redis) {
      await redis.set(`apex:channel:${channel.id}`, JSON.stringify(channel)).catch(() => undefined);
    }
    if (!this.pool || !this.dbReady) return;
    await this.pool
      .query(
        `INSERT INTO radio_channels (id, name, frequency_mhz, encrypted, members)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, members = EXCLUDED.members`,
        [channel.id, channel.name, channel.frequencyMHz, channel.encrypted, JSON.stringify(channel.members)]
      )
      .catch((error) => console.warn('Channel persistence failed:', error.message));
  }

  // ---------------------------------------------------------------- presence

  setPresence(unitId: string, callsign: string, online: boolean): PresenceRecord {
    const existing = this.presence.get(unitId);
    const record: PresenceRecord = {
      unitId,
      callsign,
      online,
      lastSeen: new Date().toISOString(),
      channelId: existing?.channelId ?? null,
    };
    this.presence.set(unitId, record);
    const redis = this.readyRedis();
    if (redis) {
      void redis.hSet('apex:presence', unitId, JSON.stringify(record)).catch(() => undefined);
    }
    return record;
  }

  listPresence(): PresenceRecord[] {
    return Array.from(this.presence.values()).sort((a, b) => a.callsign.localeCompare(b.callsign));
  }

  isOnline(unitId: string): boolean {
    return this.presence.get(unitId)?.online ?? false;
  }

  // ---------------------------------------------------------------- messages

  /** Redis-backed sliding window rate limit; falls back to an in-memory counter. */
  async checkRateLimit(unitId: string): Promise<boolean> {
    const redis = this.readyRedis();
    if (redis) {
      try {
        const key = `apex:ratelimit:${unitId}`;
        const count = await redis.incr(key);
        if (count === 1) await redis.expire(key, RATE_LIMIT_WINDOW_S);
        return count <= RATE_LIMIT_MAX_MESSAGES;
      } catch {
        /* fall through to the in-memory limiter */
      }
    }
    const now = Date.now();
    const entry = this.rateCounters.get(unitId);
    if (!entry || entry.resetAt < now) {
      this.rateCounters.set(unitId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_S * 1000 });
      return true;
    }
    entry.count += 1;
    return entry.count <= RATE_LIMIT_MAX_MESSAGES;
  }

  createMessage(input: SendMessageInput): TacticalMessage {
    const recipientIds = input.recipientIds ?? [];
    const urgency = input.urgency ?? 'ROUTINE';
    const draft: Omit<TacticalMessage, 'signature'> = {
      id: randomId('msg'),
      senderId: input.senderId,
      senderCallsign: input.senderCallsign,
      recipientIds,
      channelId: input.channelId ?? null,
      type: input.type,
      urgency,
      subject: input.subject ?? '',
      content: input.content ?? '',
      fields: input.fields ?? {},
      e2e: input.e2e ?? null,
      requiresAck: ACK_REQUIRED_URGENCIES.includes(urgency),
      acknowledgedBy: [],
      readBy: [],
      // A message addressed to an offline unit is queued rather than delivered.
      status:
        recipientIds.length > 0 && recipientIds.every((id) => !this.isOnline(id)) ? 'QUEUED' : 'SENT',
      sentAt: new Date().toISOString(),
      deliveredAt: null,
      readAt: null,
    };
    const message: TacticalMessage = { ...draft, signature: sign(canonicalise(draft)) };
    this.messages.set(message.id, message);
    this.recordAudit('SENT', message.senderId, message.id, `${message.type}/${message.urgency}`);

    for (const recipientId of recipientIds) {
      if (!this.isOnline(recipientId)) this.enqueue(recipientId, message.id);
    }

    void this.persistMessage(message);
    return message;
  }

  /** Verifies the integrity signature of a stored message. */
  verifyIntegrity(message: TacticalMessage): boolean {
    const { signature, ...rest } = message;
    return verify(canonicalise(rest), signature);
  }

  getMessage(id: string): TacticalMessage | undefined {
    return this.messages.get(id);
  }

  markDelivered(id: string): TacticalMessage | undefined {
    const message = this.messages.get(id);
    if (!message || message.status === 'READ') return message;
    message.status = 'DELIVERED';
    message.deliveredAt = message.deliveredAt ?? new Date().toISOString();
    void this.persistMessage(message);
    return message;
  }

  markRead(id: string, readerId: string): TacticalMessage | undefined {
    const message = this.messages.get(id);
    if (!message) return undefined;
    if (!message.readBy.includes(readerId)) message.readBy.push(readerId);
    message.status = 'READ';
    message.readAt = message.readAt ?? new Date().toISOString();
    message.deliveredAt = message.deliveredAt ?? message.readAt;
    this.recordAudit('READ', readerId, message.id);
    void this.persistMessage(message);
    return message;
  }

  acknowledge(id: string, unitId: string): TacticalMessage | undefined {
    const message = this.messages.get(id);
    if (!message) return undefined;
    if (!message.acknowledgedBy.includes(unitId)) message.acknowledgedBy.push(unitId);
    this.recordAudit('ACK', unitId, message.id);
    void this.persistMessage(message);
    return message;
  }

  listMessages(filter: MessageFilter = {}): TacticalMessage[] {
    const search = filter.search?.toLowerCase();
    let results = Array.from(this.messages.values()).filter((message) => {
      if (filter.senderId && message.senderId !== filter.senderId) return false;
      if (filter.recipientId && !message.recipientIds.includes(filter.recipientId)) return false;
      if (filter.channelId && message.channelId !== filter.channelId) return false;
      if (filter.type && message.type !== filter.type) return false;
      if (filter.urgency && message.urgency !== filter.urgency) return false;
      if (filter.since && message.sentAt < filter.since) return false;
      if (filter.until && message.sentAt > filter.until) return false;
      if (filter.unreadFor && message.readBy.includes(filter.unreadFor)) return false;
      if (search) {
        const haystack = [
          message.subject,
          message.content,
          message.senderCallsign,
          ...Object.values(message.fields),
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });

    switch (filter.sort) {
      case 'oldest':
        results.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
        break;
      case 'sender':
        results.sort((a, b) => a.senderCallsign.localeCompare(b.senderCallsign));
        break;
      case 'type':
        results.sort((a, b) => a.type.localeCompare(b.type));
        break;
      case 'urgency':
        results.sort((a, b) => URGENCY_ORDER.indexOf(b.urgency) - URGENCY_ORDER.indexOf(a.urgency));
        break;
      default:
        results.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
    }

    if (filter.limit && filter.limit > 0) results = results.slice(0, filter.limit);
    return results;
  }

  unreadCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const message of this.messages.values()) {
      for (const recipientId of message.recipientIds) {
        if (!message.readBy.includes(recipientId)) {
          counts[recipientId] = (counts[recipientId] ?? 0) + 1;
        }
      }
    }
    return counts;
  }

  private async persistMessage(message: TacticalMessage): Promise<void> {
    if (!this.pool || !this.dbReady) return;
    const encrypted = message.content ? seal(message.content) : null;
    await this.pool
      .query(
        `INSERT INTO messages (id, sender_id, sender_callsign, recipient_ids, channel_id, type, urgency,
            subject, encrypted_content, fields, e2e, requires_ack, acknowledged_by, read_by, status,
            signature, sent_at, delivered_at, read_at)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13::jsonb,$14::jsonb,$15,$16,$17,$18,$19)
         ON CONFLICT (id) DO UPDATE SET
            acknowledged_by = EXCLUDED.acknowledged_by,
            read_by = EXCLUDED.read_by,
            status = EXCLUDED.status,
            delivered_at = EXCLUDED.delivered_at,
            read_at = EXCLUDED.read_at`,
        [
          message.id,
          message.senderId,
          message.senderCallsign,
          JSON.stringify(message.recipientIds),
          message.channelId,
          message.type,
          message.urgency,
          message.subject,
          encrypted ? JSON.stringify(encrypted) : null,
          JSON.stringify(message.fields),
          message.e2e ? JSON.stringify(message.e2e) : null,
          message.requiresAck,
          JSON.stringify(message.acknowledgedBy),
          JSON.stringify(message.readBy),
          message.status,
          message.signature,
          message.sentAt,
          message.deliveredAt,
          message.readAt,
        ]
      )
      .catch((error) => console.warn('Message persistence failed:', error.message));
  }

  // ------------------------------------------------------------ offline queue

  private enqueue(unitId: string, messageId: string): void {
    const queue = this.queues.get(unitId) ?? [];
    queue.push(messageId);
    this.queues.set(unitId, queue);
    const redis = this.readyRedis();
    if (redis) {
      void redis.rPush(`apex:queue:${unitId}`, messageId).catch(() => undefined);
    }
  }

  /** Drains and returns the queued messages for a unit that has come online. */
  async drainQueue(unitId: string): Promise<TacticalMessage[]> {
    let ids = this.queues.get(unitId) ?? [];
    const redis = this.readyRedis();
    if (redis) {
      try {
        const stored = await redis.lRange(`apex:queue:${unitId}`, 0, -1);
        ids = Array.from(new Set([...ids, ...stored]));
        await redis.del(`apex:queue:${unitId}`);
      } catch {
        /* redis unavailable - use the in-memory queue only */
      }
    }
    this.queues.delete(unitId);
    return ids
      .map((id) => this.markDelivered(id))
      .filter((message): message is TacticalMessage => Boolean(message));
  }

  // ------------------------------------------------------------- voice logs

  addVoiceLog(entry: Omit<VoiceLogEntry, 'id' | 'timestamp'> & { timestamp?: string }): VoiceLogEntry {
    const log: VoiceLogEntry = {
      ...entry,
      id: randomId('voice'),
      timestamp: entry.timestamp ?? new Date().toISOString(),
    };
    this.voiceLogs.push(log);
    if (this.voiceLogs.length > MAX_VOICE_LOGS) this.voiceLogs.shift();
    if (this.pool && this.dbReady) {
      void this.pool
        .query(
          `INSERT INTO voice_logs (id, channel_id, speaker_id, speaker_callsign, audio_data, transcript,
              duration_ms, quality_level, timestamp)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            log.id,
            log.channelId,
            log.speakerId,
            log.speakerCallsign,
            log.audio ? Buffer.from(log.audio, 'base64') : null,
            log.transcript,
            log.durationMs,
            log.quality,
            log.timestamp,
          ]
        )
        .catch((error) => console.warn('Voice log persistence failed:', error.message));
    }
    return log;
  }

  listVoiceLogs(channelId?: string): VoiceLogEntry[] {
    const logs = channelId ? this.voiceLogs.filter((l) => l.channelId === channelId) : this.voiceLogs;
    return [...logs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  // ------------------------------------------------------------------ audit

  recordAudit(action: AuditEntry['action'], actorId: string, targetId: string | null, detail?: string): void {
    const entry: AuditEntry = {
      id: randomId('audit'),
      action,
      actorId,
      targetId,
      detail,
      timestamp: new Date().toISOString(),
    };
    this.audit.push(entry);
    if (this.audit.length > 2000) this.audit.shift();
    if (this.pool && this.dbReady) {
      void this.pool
        .query(
          'INSERT INTO comms_audit (id, action, actor_id, target_id, detail, timestamp) VALUES ($1,$2,$3,$4,$5,$6)',
          [entry.id, entry.action, entry.actorId, entry.targetId, entry.detail ?? null, entry.timestamp]
        )
        .catch(() => undefined);
    }
  }

  listAudit(limit = 200): AuditEntry[] {
    return this.audit.slice(-limit).reverse();
  }

  // -------------------------------------------------------------- retention

  /**
   * Applies the configured retention policy (COMMS_RETENTION_DAYS; 0 or unset
   * means messages are retained permanently).
   */
  async applyRetentionPolicy(): Promise<number> {
    const days = Number(process.env.COMMS_RETENTION_DAYS || 0);
    if (!days || days <= 0) return 0;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    let removed = 0;
    for (const [id, message] of this.messages) {
      if (message.sentAt < cutoff) {
        this.messages.delete(id);
        removed += 1;
      }
    }
    if (this.pool && this.dbReady) {
      await this.pool.query('DELETE FROM messages WHERE sent_at < $1', [cutoff]).catch(() => undefined);
    }
    return removed;
  }
}

export const commsStore = new CommsStore();
