/**
 * Validates mock API responses against the backend's OpenAPI spec.
 * Uses Ajv for JSON Schema validation.
 *
 * The spec path is configurable via OPENAPI_SPEC_PATH env var for CI.
 */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_SPEC_PATH = resolve(
  __dirname,
  '../../../../../SOUS/worktrees/checkout-6w8/storefront_backend/openapi/openapi.storefront.v1.json',
);
const SPEC_PATH = process.env.OPENAPI_SPEC_PATH ?? DEFAULT_SPEC_PATH;

interface OpenApiSchema {
  type?: string;
  $ref?: string;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  items?: OpenApiSchema;
  additionalProperties?: boolean | object;
  allOf?: OpenApiSchema[];
  oneOf?: OpenApiSchema[];
  anyOf?: OpenApiSchema[];
  enum?: unknown[];
  nullable?: boolean;
  readOnly?: boolean;
  format?: string;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  description?: string;
  [key: string]: unknown;
}

interface OpenApiResponse {
  content?: Record<string, { schema?: OpenApiSchema }>;
  description?: string;
}

interface OpenApiOperation {
  responses?: Record<string, OpenApiResponse>;
  [key: string]: unknown;
}

interface OpenApiSpec {
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, OpenApiSchema> };
}

let spec: OpenApiSpec | null = null;

function loadSpec(): OpenApiSpec {
  if (spec) return spec;
  if (!existsSync(SPEC_PATH)) {
    throw new Error(
      `OpenAPI spec not found at ${SPEC_PATH}. ` +
        `Set OPENAPI_SPEC_PATH env var to the correct path, or ensure the backend repo is checked out.`,
    );
  }
  const raw = readFileSync(SPEC_PATH, 'utf-8');
  spec = JSON.parse(raw);
  return spec!;
}

/**
 * Resolve all $ref pointers in a schema to their inline definitions.
 * This is needed because Ajv doesn't natively resolve OpenAPI 3.0 $ref paths.
 */
function resolveRefs(schema: OpenApiSchema, components: Record<string, OpenApiSchema>): object {
  if (schema.$ref) {
    const refPath = schema.$ref.replace('#/components/schemas/', '');
    const resolved = components[refPath];
    if (!resolved) {
      return { type: 'object', additionalProperties: true };
    }
    return resolveRefs(resolved, components);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'properties' && typeof value === 'object' && value !== null) {
      const resolvedProps: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(value as Record<string, OpenApiSchema>)) {
        resolvedProps[propName] = resolveRefs(propSchema, components);
      }
      result[key] = resolvedProps;
    } else if (key === 'items' && typeof value === 'object' && value !== null) {
      result[key] = resolveRefs(value as OpenApiSchema, components);
    } else if (key === 'allOf' && Array.isArray(value)) {
      result[key] = value.map((s: OpenApiSchema) => resolveRefs(s, components));
    } else if (key === 'oneOf' && Array.isArray(value)) {
      result[key] = value.map((s: OpenApiSchema) => resolveRefs(s, components));
    } else if (key === 'anyOf' && Array.isArray(value)) {
      result[key] = value.map((s: OpenApiSchema) => resolveRefs(s, components));
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function validateResponse(
  path: string,
  method: string,
  statusCode: number,
  body: unknown,
): { valid: boolean; errors: string[] } {
  const openapi = loadSpec();
  const pathSpec = openapi.paths[path];
  if (!pathSpec) return { valid: false, errors: [`Path ${path} not in OpenAPI spec`] };

  const methodSpec = pathSpec[method.toLowerCase()];
  if (!methodSpec) return { valid: false, errors: [`${method} ${path} not in OpenAPI spec`] };

  const responseSpec = methodSpec.responses?.[String(statusCode)];
  if (!responseSpec)
    return { valid: false, errors: [`No ${statusCode} response for ${method} ${path}`] };

  const schema = responseSpec.content?.['application/json']?.schema;
  if (!schema) return { valid: true, errors: [] };

  // If the schema is just { type: "object", additionalProperties: {} },
  // any object passes — not useful for drift detection. Still validate structure.
  const isWildcard =
    schema.type === 'object' &&
    schema.additionalProperties !== undefined &&
    !schema.properties &&
    !schema.$ref;

  if (isWildcard) {
    // Basic structural validation: response should be an object (or array if spec says array)
    if (typeof body !== 'object' || body === null) {
      return { valid: false, errors: ['Expected object response, got ' + typeof body] };
    }
    return { valid: true, errors: [] };
  }

  const components = openapi.components?.schemas ?? {};
  const resolvedSchema = resolveRefs(schema, components);

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const validate = ajv.compile(resolvedSchema);
  const valid = validate(body);

  return {
    valid: !!valid,
    errors: validate.errors?.map((e) => `${e.instancePath} ${e.message}`) ?? [],
  };
}
