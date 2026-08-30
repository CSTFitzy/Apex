/**
 * Shared type definitions for the Apex tactical communications subsystem
 * (WebRTC voice radio + real-time tactical messaging).
 */

export type MessageType = 'INTEL' | 'ORDER' | 'CASREP' | 'SUPPORT' | 'SITREP' | 'CUSTOM';

/** NATO-style message precedence, lowest to highest. */
export type MessageUrgency = 'ROUTINE' | 'PRIORITY' | 'IMMEDIATE' | 'FLASH';

export type MessageStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ';

export type VoiceQuality = 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'LOST';

export type ChannelStatus = 'IDLE' | 'BUSY' | 'COMPROMISED';

export interface LatLon {
  lat: number;
  lon: number;
}

export interface TacticalMessage {
  id: string;
  senderId: string;
  senderCallsign: string;
  /** Empty for a pure channel broadcast; one entry for a direct message. */
  recipientIds: string[];
  channelId: string | null;
  type: MessageType;
  urgency: MessageUrgency;
  subject: string;
  /** Plain text rendering of the message (may be empty when E2E encrypted). */
  content: string;
  /** Structured template fields, e.g. { location: '...', strength: '...' }. */
  fields: Record<string, string>;
  /** Opaque client-side (end-to-end) ciphertext; the server never decrypts it. */
  e2e?: { ciphertext: string; nonce: string; algorithm: string } | null;
  requiresAck: boolean;
  acknowledgedBy: string[];
  readBy: string[];
  status: MessageStatus;
  /** HMAC-SHA256 over the immutable message fields - detects tampering. */
  signature: string;
  sentAt: string;
  deliveredAt: string | null;
  readAt: string | null;
}

export interface ChannelMember {
  unitId: string;
  callsign: string;
  joinedAt: string;
  muted: boolean;
}

export interface RadioChannel {
  id: string;
  name: string;
  /** Simulated radio frequency in MHz (e.g. 30.125). */
  frequencyMHz: number;
  encrypted: boolean;
  members: ChannelMember[];
  activeSpeakerId: string | null;
  status: ChannelStatus;
  createdAt: string;
}

export interface VoiceLogEntry {
  id: string;
  channelId: string;
  speakerId: string;
  speakerCallsign: string;
  /** Base64 encoded Opus/WebM audio clip (optional - transcript only logs omit it). */
  audio: string | null;
  transcript: string;
  durationMs: number;
  quality: VoiceQuality;
  timestamp: string;
}

export interface PresenceRecord {
  unitId: string;
  callsign: string;
  online: boolean;
  lastSeen: string;
  channelId: string | null;
  /**
   * Base64 SPKI ECDH public key published by the unit. Peers use it to derive a
   * shared session key so message bodies can be encrypted end-to-end; the
   * server only ever relays this public material.
   */
  publicKey?: string | null;
}

export interface AuditEntry {
  id: string;
  action: 'SENT' | 'READ' | 'ACK' | 'DELETED' | 'JOINED' | 'LEFT' | 'TRANSMITTED';
  actorId: string;
  targetId: string | null;
  timestamp: string;
  detail?: string;
}

export interface MessageFilter {
  senderId?: string;
  recipientId?: string;
  channelId?: string;
  type?: MessageType;
  urgency?: MessageUrgency;
  search?: string;
  since?: string;
  until?: string;
  unreadFor?: string;
  sort?: 'newest' | 'oldest' | 'sender' | 'type' | 'urgency';
  limit?: number;
}

/** Ordered precedence used for sorting/ranking urgency. */
export const URGENCY_ORDER: MessageUrgency[] = ['ROUTINE', 'PRIORITY', 'IMMEDIATE', 'FLASH'];

export const MESSAGE_TYPES: MessageType[] = ['INTEL', 'ORDER', 'CASREP', 'SUPPORT', 'SITREP', 'CUSTOM'];

/**
 * Structured templates for each tactical message type. The field list is
 * exposed to the client so the composer can render the correct form.
 */
export const MESSAGE_TEMPLATES: Record<MessageType, { label: string; fields: string[] }> = {
  INTEL: { label: 'Intel Report', fields: ['time', 'location', 'enemyType', 'strength', 'direction'] },
  ORDER: { label: 'Order', fields: ['orderType', 'unitTarget', 'objective', 'rulesOfEngagement'] },
  CASREP: { label: 'Casualty Report', fields: ['location', 'casualtyCount', 'wiaKia', 'medevacRequired'] },
  SUPPORT: { label: 'Support Request', fields: ['requestType', 'location', 'urgency', 'details'] },
  SITREP: { label: 'Situation Update', fields: ['unitStatus', 'currentPosition', 'assessment', 'nextAction'] },
  CUSTOM: { label: 'Custom Message', fields: [] },
};

/** Urgency levels that must be explicitly acknowledged by the recipient. */
export const ACK_REQUIRED_URGENCIES: MessageUrgency[] = ['IMMEDIATE', 'FLASH'];
