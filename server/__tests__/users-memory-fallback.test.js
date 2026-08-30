import { describe, it, expect, beforeAll } from 'vitest';

// Point at a host/port that will refuse connections so the Users model falls
// back to its in-memory store, without requiring a real PostgreSQL instance
// in the test environment.
beforeAll(() => {
  process.env.DB_HOST = '127.0.0.1';
  process.env.DB_PORT = '1';
});

describe('Users in-memory fallback', () => {
  it('creates, finds by email, and finds by id when the database is unreachable', async () => {
    const { Users } = await import('../db/models.js');

    const created = await Users.create({
      username: 'fallback-user',
      email: 'fallback@example.com',
      password: 'password123',
    });

    expect(created.id).toBeTypeOf('number');
    expect(created.username).toBe('fallback-user');
    expect(created.email).toBe('fallback@example.com');
    expect(created.password_hash).toBeUndefined();

    const byEmail = await Users.findByEmail('fallback@example.com');
    expect(byEmail).not.toBeNull();
    expect(byEmail.username).toBe('fallback-user');

    const validPassword = await Users.verifyPassword(byEmail, 'password123');
    expect(validPassword).toBe(true);

    const invalidPassword = await Users.verifyPassword(byEmail, 'wrong-password');
    expect(invalidPassword).toBe(false);

    const byId = await Users.findById(created.id);
    expect(byId).not.toBeNull();
    expect(byId.email).toBe('fallback@example.com');
    expect(byId.password_hash).toBeUndefined();
  });

  it('returns null for unknown users instead of throwing', async () => {
    const { Users } = await import('../db/models.js');
    expect(await Users.findByEmail('missing@example.com')).toBeNull();
    expect(await Users.findById(999999)).toBeNull();
  });
});
