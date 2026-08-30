/**
 * Frontend authentication mode helpers.
 *
 * Apex can run without any user accounts (and without a database) by
 * bypassing the login screen. This is the default when running the dev
 * server, so `npm run dev` opens straight into the dashboard.
 */

/**
 * Resolve whether the login screen should be skipped for the given
 * environment.
 *
 * `VITE_REQUIRE_AUTH` takes precedence when set ('true' enforces login,
 * anything else disables it). Otherwise auth is disabled in dev builds
 * and enforced in production builds.
 *
 * @param {{DEV?: boolean, VITE_REQUIRE_AUTH?: string}} env
 * @returns {boolean}
 */
export function resolveAuthDisabled(env = {}) {
  const flag = env.VITE_REQUIRE_AUTH;
  if (flag) return flag !== 'true';
  return Boolean(env.DEV);
}

/** Whether the login screen is bypassed in this build. */
export const AUTH_DISABLED = resolveAuthDisabled(import.meta.env);
