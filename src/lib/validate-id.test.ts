import { describe, it, expect } from 'vitest';
import { validateStorageId } from './validate-id';

describe('validateStorageId', () => {
  it('accepts valid UUID', () => {
    expect(validateStorageId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });
  it('accepts alphanumeric with hyphens and underscores', () => {
    expect(validateStorageId('cart_123-abc')).toBe(true);
  });
  it('rejects path traversal attempts', () => {
    expect(validateStorageId('../../../etc/passwd')).toBe(false);
  });
  it('rejects empty string', () => {
    expect(validateStorageId('')).toBe(false);
  });
  it('rejects null and undefined', () => {
    expect(validateStorageId(null as unknown as string)).toBe(false);
    expect(validateStorageId(undefined as unknown as string)).toBe(false);
  });
  it('rejects strings with special characters', () => {
    expect(validateStorageId('id;DROP TABLE')).toBe(false);
    expect(validateStorageId('id<script>')).toBe(false);
  });
});
