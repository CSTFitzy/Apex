/**
 * End-to-end encryption for direct tactical messages.
 *
 * Each station generates an ECDH (P-256) key pair on start-up and publishes the
 * public half through the presence roster. A shared AES-256-GCM session key is
 * then derived per peer via Diffie-Hellman, so the signalling server relays
 * ciphertext it cannot read.
 */

export interface E2EPayload {
  ciphertext: string;
  nonce: string;
  algorithm: string;
}

const ALGORITHM = 'ECDH-P256+AES-256-GCM';
const NONCE_BYTES = 12;

let keyPair: CryptoKeyPair | null = null;
const sessionKeys = new Map<string, CryptoKey>();

function toBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function fromBase64(value: string): ArrayBuffer {
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function subtle(): SubtleCrypto | null {
  return typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null;
}

/** Generates (once) and returns this station's ECDH key pair. */
async function localKeyPair(): Promise<CryptoKeyPair | null> {
  const api = subtle();
  if (!api) return null;
  if (!keyPair) {
    keyPair = await api.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
  }
  return keyPair;
}

/** Base64 SPKI public key to publish in the roster, or null if unsupported. */
export async function publicKey(): Promise<string | null> {
  const pair = await localKeyPair();
  const api = subtle();
  if (!pair || !api) return null;
  return toBase64(await api.exportKey('spki', pair.publicKey));
}

async function sessionKeyFor(unitId: string, peerPublicKey: string): Promise<CryptoKey | null> {
  const cached = sessionKeys.get(unitId);
  if (cached) return cached;
  const pair = await localKeyPair();
  const api = subtle();
  if (!pair || !api) return null;
  const imported = await api.importKey(
    'spki',
    fromBase64(peerPublicKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const derived = await api.deriveKey(
    { name: 'ECDH', public: imported },
    pair.privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  sessionKeys.set(unitId, derived);
  return derived;
}

/** Encrypts a message body for a single recipient. Returns null if E2E is unavailable. */
export async function encryptFor(
  unitId: string,
  peerPublicKey: string | null | undefined,
  plaintext: string
): Promise<E2EPayload | null> {
  const api = subtle();
  if (!api || !peerPublicKey) return null;
  const key = await sessionKeyFor(unitId, peerPublicKey);
  if (!key) return null;
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = await api.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    new TextEncoder().encode(plaintext)
  );
  return { ciphertext: toBase64(ciphertext), nonce: toBase64(nonce.buffer), algorithm: ALGORITHM };
}

/** Decrypts a payload from a peer. Returns null when the key or payload is unusable. */
export async function decryptFrom(
  unitId: string,
  peerPublicKey: string | null | undefined,
  payload: E2EPayload
): Promise<string | null> {
  const api = subtle();
  if (!api || !peerPublicKey || payload.algorithm !== ALGORITHM) return null;
  const key = await sessionKeyFor(unitId, peerPublicKey);
  if (!key) return null;
  try {
    const plaintext = await api.decrypt(
      { name: 'AES-GCM', iv: fromBase64(payload.nonce) },
      key,
      fromBase64(payload.ciphertext)
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

/** Drops cached session keys, forcing re-derivation after a key rotation. */
export function resetSessionKeys(): void {
  sessionKeys.clear();
}
