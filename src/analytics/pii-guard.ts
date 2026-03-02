/**
 * PII guard — strips personally identifiable information from analytics events.
 *
 * Every event passes through this before being sent to PostHog.
 * Defensive layer that prevents accidental PII leakage.
 */

const PII_FIELDS = new Set([
  'email',
  'phone',
  'phone_number',
  'first_name',
  'last_name',
  'full_name',
  'name',
  'address',
  'street',
  'house_number',
  'city',
]);

export function stripPII(
  props: Record<string, unknown>,
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(props)) {
    if (PII_FIELDS.has(key)) continue;

    // Truncate postal code to prefix (first 4 chars) for geographic analysis
    // without full address resolution
    if (key === 'postal_code' && typeof value === 'string') {
      cleaned[key] = value.slice(0, 4);
      continue;
    }

    cleaned[key] = value;
  }

  return cleaned;
}
