import { describe, it, expect } from 'vitest';
import {
  isValidEmail,
  isValidPassword,
  isValidLatitude,
  isValidLongitude,
  isNonEmptyString,
  getMissingFields,
} from '../utils/validators.js';

describe('validators', () => {
  it('validates email addresses', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });

  it('validates password strength', () => {
    expect(isValidPassword('longenough')).toBe(true);
    expect(isValidPassword('short')).toBe(false);
  });

  it('validates latitude bounds', () => {
    expect(isValidLatitude(45.5)).toBe(true);
    expect(isValidLatitude(-90)).toBe(true);
    expect(isValidLatitude(90)).toBe(true);
    expect(isValidLatitude(91)).toBe(false);
    expect(isValidLatitude('not-a-number')).toBe(false);
  });

  it('validates longitude bounds', () => {
    expect(isValidLongitude(120)).toBe(true);
    expect(isValidLongitude(-180)).toBe(true);
    expect(isValidLongitude(181)).toBe(false);
  });

  it('validates non-empty strings', () => {
    expect(isNonEmptyString('hello')).toBe(true);
    expect(isNonEmptyString('   ')).toBe(false);
    expect(isNonEmptyString(42)).toBe(false);
  });

  it('detects missing required fields', () => {
    expect(getMissingFields({ a: 1 }, ['a', 'b'])).toEqual(['b']);
    expect(getMissingFields({ a: 1, b: 2 }, ['a', 'b'])).toEqual([]);
    expect(getMissingFields(null, ['a'])).toEqual(['a']);
  });
});
