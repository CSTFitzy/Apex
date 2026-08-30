import type { MessageType, MessageUrgency, VoiceQuality } from '../types';

/** Presentation helpers shared by the communications dashboard components. */

export const MESSAGE_TYPE_LABELS: Record<MessageType, string> = {
  INTEL: 'Intel Report',
  ORDER: 'Order',
  CASREP: 'Casualty Report',
  SUPPORT: 'Support Request',
  SITREP: 'Situation Update',
  CUSTOM: 'Custom',
};

/** Structured template fields per message type, mirroring the server templates. */
export const MESSAGE_TEMPLATE_FIELDS: Record<MessageType, string[]> = {
  INTEL: ['time', 'location', 'enemyType', 'strength', 'direction'],
  ORDER: ['orderType', 'unitTarget', 'objective', 'rulesOfEngagement'],
  CASREP: ['location', 'casualtyCount', 'wiaKia', 'medevacRequired'],
  SUPPORT: ['requestType', 'location', 'urgency', 'details'],
  SITREP: ['unitStatus', 'currentPosition', 'assessment', 'nextAction'],
  CUSTOM: [],
};

export const FIELD_LABELS: Record<string, string> = {
  time: 'Time',
  location: 'Location / Grid',
  enemyType: 'Enemy Type',
  strength: 'Strength',
  direction: 'Direction of Movement',
  orderType: 'Order Type',
  unitTarget: 'Target Unit',
  objective: 'Objective',
  rulesOfEngagement: 'Rules of Engagement',
  casualtyCount: 'Casualty Count',
  wiaKia: 'WIA / KIA',
  medevacRequired: 'MEDEVAC Required',
  requestType: 'Request Type',
  urgency: 'Urgency',
  details: 'Details',
  unitStatus: 'Unit Status',
  currentPosition: 'Current Position',
  assessment: 'Assessment',
  nextAction: 'Next Action',
};

export const URGENCY_COLORS: Record<MessageUrgency, string> = {
  ROUTINE: '#7f8c8d',
  PRIORITY: '#f1c40f',
  IMMEDIATE: '#e67e22',
  FLASH: '#e74c3c',
};

export const TYPE_COLORS: Record<MessageType, string> = {
  INTEL: '#3498db',
  ORDER: '#9b59b6',
  CASREP: '#e74c3c',
  SUPPORT: '#e67e22',
  SITREP: '#2ecc71',
  CUSTOM: '#95a5a6',
};

/** Green -> yellow -> red colour ramp for voice quality. */
export const QUALITY_COLORS: Record<VoiceQuality, string> = {
  EXCELLENT: '#2ecc71',
  GOOD: '#8bc34a',
  FAIR: '#f1c40f',
  POOR: '#e67e22',
  LOST: '#e74c3c',
};

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Renders structured template fields as a standard radio-protocol message body,
 * e.g. "CONTACT REPORT. LOCATION: 38SMB1234. OVER."
 */
export function buildProtocolText(
  type: MessageType,
  fields: Record<string, string>,
  freeText: string,
  senderCallsign: string,
  recipientCallsign: string
): string {
  const parts = MESSAGE_TEMPLATE_FIELDS[type]
    .filter((field) => fields[field]?.trim())
    .map((field) => `${FIELD_LABELS[field]?.toUpperCase() ?? field.toUpperCase()}: ${fields[field].trim()}`);
  const body = [freeText.trim(), ...parts].filter(Boolean).join('. ');
  const prefix = `${recipientCallsign}, THIS IS ${senderCallsign}.`;
  // "OUT" ends an exchange, "OVER" invites a reply - orders expect a response.
  const suffix = type === 'ORDER' || type === 'SUPPORT' ? 'OVER.' : 'OUT.';
  return `${prefix} ${body}${body.endsWith('.') ? '' : '.'} ${suffix}`.replace(/\s+/g, ' ').trim();
}
