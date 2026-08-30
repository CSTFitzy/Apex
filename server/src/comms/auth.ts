import crypto from 'crypto';
import jwt from 'jsonwebtoken';

/**
 * Unit authentication for the comms subsystem. Units must present a signed
 * token before they may join a radio channel, send messages, or exchange
 * WebRTC signalling traffic.
 */

export type CommsRole = 'COMMANDER' | 'OFFICER' | 'OPERATOR';

export interface CommsIdentity {
  unitId: string;
  callsign: string;
  role: CommsRole;
}

const TOKEN_TTL = process.env.COMMS_TOKEN_TTL || '12h';

/**
 * Signing secret for comms tokens. Falls back to a random per-process secret so
 * that a development deployment is never protected by a hard-coded value.
 */
const secret: string = process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16
  ? process.env.JWT_SECRET
  : crypto.randomBytes(32).toString('hex');

if (!process.env.JWT_SECRET) {
  console.warn('JWT_SECRET is not set - comms tokens are signed with an ephemeral per-process secret.');
}

/** Message types each role is permitted to originate. */
const ROLE_SEND_PERMISSIONS: Record<CommsRole, string[]> = {
  COMMANDER: ['INTEL', 'ORDER', 'CASREP', 'SUPPORT', 'SITREP', 'CUSTOM'],
  OFFICER: ['INTEL', 'ORDER', 'CASREP', 'SUPPORT', 'SITREP', 'CUSTOM'],
  OPERATOR: ['INTEL', 'CASREP', 'SUPPORT', 'SITREP', 'CUSTOM'],
};

export function issueToken(identity: CommsIdentity): { token: string; expiresIn: string } {
  const token = jwt.sign(
    { unitId: identity.unitId, callsign: identity.callsign, role: identity.role },
    secret,
    { expiresIn: TOKEN_TTL } as jwt.SignOptions
  );
  return { token, expiresIn: TOKEN_TTL };
}

export function verifyToken(token: string | undefined): CommsIdentity | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token.replace(/^Bearer\s+/i, ''), secret) as jwt.JwtPayload;
    if (!payload.unitId || !payload.callsign) return null;
    return {
      unitId: String(payload.unitId),
      callsign: String(payload.callsign),
      role: (payload.role as CommsRole) || 'OPERATOR',
    };
  } catch {
    return null;
  }
}

/** Access control check for originating a given message type. */
export function canSend(role: CommsRole, type: string): boolean {
  return ROLE_SEND_PERMISSIONS[role]?.includes(type) ?? false;
}
