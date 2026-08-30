import { describe, it, expect, afterEach } from 'vitest';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env.NODE_ENV = originalEnv.NODE_ENV;
  delete process.env.DISABLE_AUTH;
});

/** Minimal Express-like response double capturing status/json calls. */
function createRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('auth bypass', () => {
  it('is enabled by default outside production', async () => {
    const { isAuthDisabled } = await import('../auth/middleware.js');
    process.env.NODE_ENV = 'development';
    expect(isAuthDisabled()).toBe(true);
  });

  it('is disabled in production unless explicitly requested', async () => {
    const { isAuthDisabled } = await import('../auth/middleware.js');
    process.env.NODE_ENV = 'production';
    expect(isAuthDisabled()).toBe(false);

    process.env.DISABLE_AUTH = 'true';
    expect(isAuthDisabled()).toBe(true);
  });

  it('can be turned off explicitly outside production', async () => {
    const { isAuthDisabled } = await import('../auth/middleware.js');
    process.env.NODE_ENV = 'development';
    process.env.DISABLE_AUTH = 'false';
    expect(isAuthDisabled()).toBe(false);
  });

  it('attaches a dev user to unauthenticated requests when disabled', async () => {
    const { requireAuth } = await import('../auth/middleware.js');
    process.env.NODE_ENV = 'development';

    const req = { headers: {} };
    const res = createRes();
    let called = false;
    requireAuth(req, res, () => {
      called = true;
    });

    expect(called).toBe(true);
    expect(res.statusCode).toBe(null);
    expect(req.user.username).toBe('operator');
  });

  it('still rejects unauthenticated requests when enforced', async () => {
    const { requireAuth } = await import('../auth/middleware.js');
    process.env.DISABLE_AUTH = 'false';

    const req = { headers: {} };
    const res = createRes();
    let called = false;
    requireAuth(req, res, () => {
      called = true;
    });

    expect(called).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('honours a valid token even when auth is disabled', async () => {
    process.env.JWT_SECRET = 'test-secret';
    const { generateToken } = await import('../auth/jwt.js');
    const { requireAuth } = await import('../auth/middleware.js');
    process.env.NODE_ENV = 'development';

    const token = generateToken({ id: 7, username: 'alice', role: 'analyst' });
    const req = { headers: { authorization: 'Bearer ' + token } };
    const res = createRes();
    requireAuth(req, res, () => {});

    expect(req.user.username).toBe('alice');
  });
});
