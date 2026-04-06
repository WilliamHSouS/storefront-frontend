/**
 * Contract tests: validate mock API responses against the OpenAPI spec.
 *
 * These tests hit the mock API server (port 4322) and validate each response
 * against the backend's OpenAPI schema. Failures reveal where the mock has
 * drifted from the real API contract.
 *
 * The test suite iterates over the endpoint registry in mock-api-contract-guard.ts,
 * so adding a new mock endpoint without a matching schema triggers a failure
 * automatically.
 *
 * Run: npx playwright test e2e/contract.spec.ts --project=desktop
 */
import { test, expect } from '@playwright/test';
import { validateResponse } from './helpers/validate-mock-responses';
import {
  MOCK_ENDPOINTS,
  resolveMockPath,
  type MockEndpoint,
} from './helpers/mock-api-contract-guard';

const MOCK_BASE = 'http://localhost:4322';

/** Helper: make a request to the mock API using the endpoint descriptor. */
async function requestEndpoint(endpoint: MockEndpoint): Promise<{ status: number; data: unknown }> {
  const resolvedPath = resolveMockPath(endpoint);
  const url = `${MOCK_BASE}${resolvedPath}`;

  const fetchOpts: RequestInit = {
    method: endpoint.method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (endpoint.body && endpoint.method !== 'GET') {
    fetchOpts.body = JSON.stringify(endpoint.body);
  }

  const res = await fetch(url, fetchOpts);
  const data = await res.json();
  return { status: res.status, data };
}

// ── Data-driven contract tests over all mock endpoints ─────────
//
// The for-loop + conditionals pattern is intentional: it generates one Playwright
// test per mock endpoint from the registry. Skipped endpoints use test.skip()
// annotations. This is the standard approach for data-driven Playwright suites.

/* eslint-disable playwright/no-conditional-in-test -- data-driven test generation from endpoint registry requires conditionals for setup/divergence filtering */
/* eslint-disable playwright/valid-title -- dynamic titles from endpoint registry */
/* eslint-disable playwright/no-skipped-test -- skipped endpoints are intentional (not in OpenAPI spec) */
/* eslint-disable playwright/expect-expect -- skipped tests have no assertions by design */

test.describe('Contract: all mock endpoints vs OpenAPI spec', () => {
  for (const endpoint of MOCK_ENDPOINTS) {
    const label = endpoint.label
      ? `${endpoint.method} ${endpoint.specPath} — ${endpoint.label}`
      : `${endpoint.method} ${endpoint.specPath}`;

    if (endpoint.skipReason) {
      test.skip(label, () => {
        // Skipped: endpoint not in OpenAPI spec
      });

      continue;
    }

    test(label, async () => {
      // Run per-endpoint setup (create cart, checkout, etc.)
      if (endpoint.setup) await endpoint.setup();

      const { status, data } = await requestEndpoint(endpoint);
      expect(status).toBe(endpoint.expectedStatus);

      const result = validateResponse(
        endpoint.specPath,
        endpoint.method,
        endpoint.expectedStatus,
        data,
      );

      // Filter known divergences (e.g. product_id string vs integer)
      const errors = endpoint.knownDivergences
        ? result.errors.filter((e) => !endpoint.knownDivergences!.some((d) => e.includes(d)))
        : result.errors;

      expect(errors, `Schema validation errors:\n${errors.join('\n')}`).toEqual([]);
    });
  }
});

/* eslint-enable playwright/expect-expect -- end data-driven test generation */
/* eslint-enable playwright/no-skipped-test -- end data-driven test generation */
/* eslint-enable playwright/valid-title -- end data-driven test generation */
/* eslint-enable playwright/no-conditional-in-test -- end data-driven test generation */

// ── Guard: no unregistered mock endpoints ────────────────────────

test.describe('Contract: registry completeness', () => {
  test('at least 26 non-skipped endpoints in registry', async () => {
    const nonSkipped = MOCK_ENDPOINTS.filter((e) => !e.skipReason);
    expect(
      nonSkipped.length,
      'Expected at least 26 non-skipped endpoints in the registry',
    ).toBeGreaterThanOrEqual(26);
  });

  test('every mock endpoint has a unique label', async () => {
    const labels = MOCK_ENDPOINTS.map((e) => `${e.method} ${e.specPath} ${e.label ?? ''}`);
    const duplicates = labels.filter((l, i) => labels.indexOf(l) !== i);
    expect(duplicates, `Duplicate endpoint labels: ${duplicates.join(', ')}`).toEqual([]);
  });
});
