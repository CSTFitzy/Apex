import crypto from 'crypto';

/**
 * Cryptography for the tactical comms subsystem.
 *
 * - AES-256-GCM encryption at rest for message content stored in PostgreSQL.
 * - HMAC-SHA256 signatures so tampering with a stored/relayed message is
 *   detectable.
 * - A rotating keyring: new material is derived from the master secret on a
 *   fixed interval, and every ciphertext records the key version that produced
 *   it so previously stored messages remain readable after a rotation.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const DEFAULT_ROTATION_MS = 60 * 60 * 1000; // 1 hour

interface KeyMaterial {
  version: number;
  encryptionKey: Buffer;
  signingKey: Buffer;
  createdAt: number;
}

export interface SealedPayload {
  v: number;
  iv: string;
  tag: string;
  data: string;
}

function masterSecret(): Buffer {
  const configured = process.env.COMMS_ENCRYPTION_KEY;
  if (configured && configured.length >= 32) {
    return Buffer.from(configured, 'utf8');
  }
  if (configured) {
    console.warn('COMMS_ENCRYPTION_KEY is shorter than 32 characters - using a random ephemeral key instead.');
  }
  // No configured secret: generate an ephemeral one so development still works.
  // Messages encrypted at rest will not be readable across server restarts.
  return crypto.randomBytes(48);
}

class Keyring {
  private readonly master = masterSecret();
  private readonly rotationMs = Number(process.env.COMMS_KEY_ROTATION_MS) || DEFAULT_ROTATION_MS;
  private readonly keys = new Map<number, KeyMaterial>();
  private currentVersion = 0;

  constructor() {
    this.rotate();
  }

  /** Derives a fresh key version from the master secret. */
  rotate(): KeyMaterial {
    const version = ++this.currentVersion;
    const salt = Buffer.from(`apex-comms-v${version}`, 'utf8');
    const encryptionKey = crypto.hkdfSync('sha256', this.master, salt, Buffer.from('encryption'), 32);
    const signingKey = crypto.hkdfSync('sha256', this.master, salt, Buffer.from('signing'), 32);
    const material: KeyMaterial = {
      version,
      encryptionKey: Buffer.from(encryptionKey),
      signingKey: Buffer.from(signingKey),
      createdAt: Date.now(),
    };
    this.keys.set(version, material);
    return material;
  }

  current(): KeyMaterial {
    const material = this.keys.get(this.currentVersion)!;
    if (Date.now() - material.createdAt >= this.rotationMs) {
      return this.rotate();
    }
    return material;
  }

  get(version: number): KeyMaterial | undefined {
    return this.keys.get(version);
  }

  get versionCount(): number {
    return this.keys.size;
  }

  get activeVersion(): number {
    return this.currentVersion;
  }
}

const keyring = new Keyring();

/** Encrypts a UTF-8 string with the current AES-256-GCM key version. */
export function seal(plaintext: string): SealedPayload {
  const key = keyring.current();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key.encryptionKey, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    v: key.version,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

/** Decrypts a payload produced by {@link seal}. Returns null if unreadable. */
export function unseal(payload: SealedPayload): string | null {
  const key = keyring.get(payload.v);
  if (!key) return null;
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key.encryptionKey, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    const out = Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]);
    return out.toString('utf8');
  } catch {
    return null;
  }
}

/** Produces an integrity signature (`version:hmac`) over the supplied canonical string. */
export function sign(canonical: string): string {
  const key = keyring.current();
  const mac = crypto.createHmac('sha256', key.signingKey).update(canonical).digest('base64');
  return `${key.version}:${mac}`;
}

/** Verifies a signature produced by {@link sign} in constant time. */
export function verify(canonical: string, signature: string): boolean {
  const [rawVersion, mac] = signature.split(':');
  const key = keyring.get(Number(rawVersion));
  if (!key || !mac) return false;
  const expected = crypto.createHmac('sha256', key.signingKey).update(canonical).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(mac);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Forces a key rotation (exposed for the admin endpoint / scheduled jobs). */
export function rotateKeys(): { version: number; versions: number } {
  const material = keyring.rotate();
  return { version: material.version, versions: keyring.versionCount };
}

export function keyStatus(): { activeVersion: number; versions: number; rotationMs: number } {
  return {
    activeVersion: keyring.activeVersion,
    versions: keyring.versionCount,
    rotationMs: Number(process.env.COMMS_KEY_ROTATION_MS) || DEFAULT_ROTATION_MS,
  };
}

export function randomId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(9).toString('hex')}`;
}
