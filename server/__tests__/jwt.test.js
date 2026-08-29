import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret';
});

describe('jwt', () => {
  it('generates and verifies a token round-trip', async () => {
    const { generateToken, verifyToken } = await import('../auth/jwt.js');
    const payload = { id: 1, username: 'alice', role: 'analyst' };
    const token = generateToken(payload);

    expect(typeof token).toBe('string');

    const decoded = verifyToken(token);
    expect(decoded.id).toBe(payload.id);
    expect(decoded.username).toBe(payload.username);
    expect(decoded.role).toBe(payload.role);
  });

  it('throws when verifying an invalid token', async () => {
    const { verifyToken } = await import('../auth/jwt.js');
    expect(() => verifyToken('not-a-real-token')).toThrow();
  });
});
