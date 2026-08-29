/**
 * Shared input validation helpers used by route handlers.
 * These are intentionally lightweight (no external dependency) so the
 * server can validate common inputs without pulling in a full schema
 * validation library.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validate an email address string. */
export function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email);
}

/**
 * Validate password strength.
 * Requires at least 8 characters. Additional rules can be added here.
 */
export function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 8;
}

/** Validate a latitude value (-90 to 90). */
export function isValidLatitude(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= -90 && num <= 90;
}

/** Validate a longitude value (-180 to 180). */
export function isValidLongitude(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= -180 && num <= 180;
}

/** Ensure a value is a non-empty string. */
export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate that an object contains all required fields (non-null/undefined).
 * Returns an array of missing field names (empty array if valid).
 */
export function getMissingFields(body, requiredFields) {
  if (!body || typeof body !== 'object') return requiredFields;
  return requiredFields.filter(
    (field) => body[field] === undefined || body[field] === null || body[field] === ''
  );
}
