/**
 * Shared input validation helpers used by route handlers.
 * These are intentionally lightweight (no external dependency) so the
 * server can validate common inputs without pulling in a full schema
 * validation library.
 */

/** Validate an email address string without using a backtracking-prone regex. */
export function isValidEmail(email) {
  if (typeof email !== 'string' || email.length === 0 || email.length > 254) return false;
  if (/\s/.test(email)) return false;

  const atIndex = email.indexOf('@');
  if (atIndex <= 0 || atIndex !== email.lastIndexOf('@')) return false;

  const localPart = email.slice(0, atIndex);
  const domainPart = email.slice(atIndex + 1);
  if (!localPart || !domainPart) return false;

  const dotIndex = domainPart.indexOf('.');
  if (dotIndex <= 0 || dotIndex === domainPart.length - 1) return false;

  return true;
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
