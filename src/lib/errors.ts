/** Extract a human-readable detail string from an SDK error (ApiError or Error). */
export function errorDetail(error: unknown): string {
  if (!error || typeof error !== 'object') return 'Unknown error';
  const e = error as Record<string, unknown>;

  // SDK ApiError wraps the response body: { status, statusText, body: { ... } }
  if (e.body && typeof e.body === 'object') {
    const body = e.body as Record<string, unknown>;

    if (body.error && typeof body.error === 'object') {
      const err = body.error as Record<string, unknown>;
      // For VALIDATION_ERROR, format field-level details
      if (err.code === 'VALIDATION_ERROR' && err.details && typeof err.details === 'object') {
        const details = err.details as Record<string, string[]>;
        const messages = Object.entries(details).map(([field, fieldErrors]) => {
          const fieldName = field.replace(/_/g, ' ');
          const errorMsg = Array.isArray(fieldErrors)
            ? fieldErrors.join(', ')
            : String(fieldErrors);
          return `${fieldName}: ${errorMsg}`;
        });
        if (messages.length > 0) return messages.join('. ');
      }
      // For all other errors, use the message
      if (typeof err.message === 'string') return err.message;
    }

    if (typeof body.detail === 'string') return body.detail;
    if (typeof body.message === 'string') return body.message;
  }

  // Raw DRF-style response body: { detail: "..." }
  if (typeof e.detail === 'string') return e.detail;

  // Raw error envelope: { error: { code, message } }
  if (e.error && typeof e.error === 'object') {
    const nested = e.error as Record<string, unknown>;
    if (typeof nested.message === 'string') return nested.message;
  }

  // Plain Error object or any object with message
  if ('message' in error && typeof (error as Error).message === 'string')
    return (error as Error).message;

  // HTTP status fallback
  if (typeof e.status === 'number' && typeof e.statusText === 'string') {
    return `${e.status} ${e.statusText}`;
  }

  return 'Unknown error';
}

/** Extract the `code` field from a backend error envelope, if present. */
export function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as Record<string, unknown>;

  // SDK ApiError: body.error.code
  if (e.body && typeof e.body === 'object') {
    const body = e.body as Record<string, unknown>;
    if (body.error && typeof body.error === 'object') {
      const nested = body.error as Record<string, unknown>;
      if (typeof nested.code === 'string') return nested.code;
    }
  }

  // Raw envelope: error.code
  if (e.error && typeof e.error === 'object') {
    const nested = e.error as Record<string, unknown>;
    if (typeof nested.code === 'string') return nested.code;
  }

  return undefined;
}
