import { describe, it, expect } from 'vitest';
import { resolveAuthDisabled } from '../utils/auth.js';

describe('resolveAuthDisabled', () => {
  it('skips the login screen in dev builds by default', () => {
    expect(resolveAuthDisabled({ DEV: true })).toBe(true);
  });

  it('requires login in production builds by default', () => {
    expect(resolveAuthDisabled({ DEV: false })).toBe(false);
  });

  it('honours VITE_REQUIRE_AUTH over the build mode', () => {
    expect(resolveAuthDisabled({ DEV: true, VITE_REQUIRE_AUTH: 'true' })).toBe(false);
    expect(resolveAuthDisabled({ DEV: false, VITE_REQUIRE_AUTH: 'false' })).toBe(true);
  });
});
