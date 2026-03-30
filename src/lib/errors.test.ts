import { describe, expect, it } from 'vitest';
import { errorDetail, errorCode } from '@/lib/errors';

describe('errorDetail', () => {
  it('extracts body.detail from SDK ApiError', () => {
    expect(errorDetail({ status: 400, body: { detail: 'Invalid request' } })).toBe(
      'Invalid request',
    );
  });

  it('extracts body.error.message from backend error envelope in body', () => {
    expect(
      errorDetail({
        status: 400,
        body: { error: { code: 'SOME_ERROR', message: 'Something went wrong' } },
      }),
    ).toBe('Something went wrong');
  });

  it('extracts body.message string', () => {
    expect(errorDetail({ body: { message: 'Direct body message' } })).toBe('Direct body message');
  });

  it('extracts top-level detail (raw DRF-style response)', () => {
    expect(errorDetail({ detail: 'Invalid discount code' })).toBe('Invalid discount code');
  });

  it('falls back to status + statusText', () => {
    expect(errorDetail({ status: 500, statusText: 'Internal Server Error' })).toBe(
      '500 Internal Server Error',
    );
  });

  it('extracts message from Error objects', () => {
    expect(errorDetail(new Error('Network failure'))).toBe('Network failure');
  });

  it('extracts body.error envelope nested message', () => {
    expect(
      errorDetail({
        body: { error: { code: 'DISCOUNT_INVALID', message: 'Discount is not valid' } },
      }),
    ).toBe('Discount is not valid');
  });

  it('extracts raw error envelope (top-level error.message)', () => {
    expect(errorDetail({ error: { code: 'DISCOUNT_EXPIRED', message: 'Discount expired' } })).toBe(
      'Discount expired',
    );
  });

  it('returns Unknown error for null/undefined', () => {
    expect(errorDetail(null)).toBe('Unknown error');
    expect(errorDetail(undefined)).toBe('Unknown error');
  });

  describe('VALIDATION_ERROR formatting', () => {
    it('formats field-level details for VALIDATION_ERROR', () => {
      const result = errorDetail({
        status: 400,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            details: {
              email: ['Enter a valid email address.'],
              phone_number: ['This field is required.', 'Must be at least 10 digits.'],
            },
          },
        },
      });
      expect(result).toBe(
        'email: Enter a valid email address.. phone number: This field is required., Must be at least 10 digits.',
      );
    });

    it('falls back to message when VALIDATION_ERROR details is empty', () => {
      const result = errorDetail({
        status: 400,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            details: {},
          },
        },
      });
      expect(result).toBe('Validation failed');
    });

    it('falls back to message when VALIDATION_ERROR has no details field', () => {
      const result = errorDetail({
        status: 400,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
          },
        },
      });
      expect(result).toBe('Validation failed');
    });
  });
});

describe('errorCode', () => {
  it('extracts code from body.error.code (SDK ApiError)', () => {
    expect(
      errorCode({ status: 400, body: { error: { code: 'DISCOUNT_INVALID', message: 'msg' } } }),
    ).toBe('DISCOUNT_INVALID');
  });

  it('extracts code from raw error envelope (top-level error.code)', () => {
    expect(errorCode({ error: { code: 'DISCOUNT_EXPIRED', message: 'msg' } })).toBe(
      'DISCOUNT_EXPIRED',
    );
  });

  it('returns undefined when no code is present', () => {
    expect(errorCode({ detail: 'some error' })).toBeUndefined();
  });

  it('returns undefined for null/undefined', () => {
    expect(errorCode(null)).toBeUndefined();
    expect(errorCode(undefined)).toBeUndefined();
  });
});
