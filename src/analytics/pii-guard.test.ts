import { describe, it, expect } from 'vitest';
import { stripPII } from './pii-guard';

describe('stripPII', () => {
  it('strips email field', () => {
    const result = stripPII({ email: 'test@test.com', merchant_id: 'foo' });
    expect(result.email).toBeUndefined();
    expect(result.merchant_id).toBe('foo');
  });

  it('strips phone field', () => {
    expect(stripPII({ phone: '+31612345678' }).phone).toBeUndefined();
  });

  it('strips phone_number field', () => {
    expect(stripPII({ phone_number: '+31612345678' }).phone_number).toBeUndefined();
  });

  it('strips name fields', () => {
    const result = stripPII({
      first_name: 'John',
      last_name: 'Doe',
      full_name: 'John Doe',
      name: 'John',
    });
    expect(result.first_name).toBeUndefined();
    expect(result.last_name).toBeUndefined();
    expect(result.full_name).toBeUndefined();
    expect(result.name).toBeUndefined();
  });

  it('strips address fields', () => {
    const result = stripPII({
      address: '123 Main St',
      street: 'Main St',
      house_number: '123',
      city: 'Amsterdam',
    });
    expect(result.address).toBeUndefined();
    expect(result.street).toBeUndefined();
    expect(result.house_number).toBeUndefined();
    expect(result.city).toBeUndefined();
  });

  it('truncates postal_code to prefix', () => {
    expect(stripPII({ postal_code: '1015CJ' }).postal_code).toBe('1015');
  });

  it('handles short postal codes', () => {
    expect(stripPII({ postal_code: '10' }).postal_code).toBe('10');
  });

  it('passes allowed fields through unchanged', () => {
    const input = {
      merchant_id: 'x',
      cart_total: '50.00',
      currency: 'EUR',
      language: 'nl',
      item_count: 3,
    };
    expect(stripPII(input)).toEqual(input);
  });

  it('handles empty object', () => {
    expect(stripPII({})).toEqual({});
  });
});
