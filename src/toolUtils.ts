/**
 * Common utilities for tool handlers
 *
 * WARNING: The zodTypeToJsonSchema function accesses Zod internal structures (_def)
 * which are not part of Zod's public API and may break with Zod updates.
 * Consider switching to a maintained converter like 'zod-to-json-schema' package
 * for production use with full Zod type coverage.
 */

import { z, type ZodTypeAny } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { isHttpError, formatErrorMessage, type HttpError } from './httpClient.js';
import { getConfig } from './config.js';
import { putRawText } from './resources.js';

export interface ResourceLink {
  type: 'resource_link';
  uri: string;
  name: string;
  mimeType: string;
}

export interface TextContent {
  type: 'text';
  text: string;
}

export type ContentItem = TextContent | ResourceLink;

/**
 * Map HTTP error to MCP error
 */
export function httpErrorToMcpError(err: HttpError): McpError {
  const message = formatErrorMessage(err);

  switch (err.status) {
    case 400:
      return new McpError(ErrorCode.InvalidParams, message);
    case 401:
    case 402:
    case 403:
      return new McpError(ErrorCode.InvalidRequest, message);
    case 429:
      // MCP SDK doesn't have RateLimited, use InvalidRequest
      return new McpError(ErrorCode.InvalidRequest, message);
    case 408:
    case 499:
    case 504:
      return new McpError(ErrorCode.InternalError, message);
    default:
      // 4xx client errors -> InvalidRequest, 5xx server errors -> InternalError
      return new McpError(
        err.status >= 400 && err.status < 500 ? ErrorCode.InvalidRequest : ErrorCode.InternalError,
        message
      );
  }
}

/**
 * Handle errors in tool handlers.
 *
 * This function ALWAYS throws and never returns (return type: never).
 * Use as: `return handleToolError(err)` in catch blocks to make control flow
 * explicit and satisfy TypeScript's type checker.
 */
export function handleToolError(err: unknown): never {
  if (err instanceof McpError) {
    throw err;
  }

  if (isHttpError(err)) {
    throw httpErrorToMcpError(err);
  }

  if (err instanceof z.ZodError) {
    const messages = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
    throw new McpError(ErrorCode.InvalidParams, `Validation error: ${messages.join(', ')}`);
  }

  if (err instanceof Error) {
    throw new McpError(ErrorCode.InternalError, err.message);
  }

  throw new McpError(ErrorCode.InternalError, 'Unknown error occurred');
}

export interface RawResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

/** Error returned when raw response cannot be stored */
export interface RawResponseError {
  error: string;
}

/**
 * Union type for the 'raw' field in processRawResponse result.
 * - RawResponse: The full response object (when small enough to inline)
 * - string: A URI reference to the stored resource (when stored successfully)
 * - RawResponseError: An error object (when storage fails)
 */
export type ProcessedRawValue = RawResponse | string | RawResponseError;

/** Result type for processRawResponse */
export interface ProcessRawResponseResult {
  /** The raw response - can be inline object, URI string, or error */
  raw?: ProcessedRawValue;
  /** Resource link if response was stored as a resource */
  resourceLink?: ResourceLink;
}

/**
 * Type guard to check if raw value is an error
 */
export function isRawResponseError(value: ProcessedRawValue): value is RawResponseError {
  return typeof value === 'object' && value !== null && 'error' in value && typeof (value as RawResponseError).error === 'string';
}

/**
 * Type guard to check if raw value is a URI string
 */
export function isRawResponseUri(value: ProcessedRawValue): value is string {
  return typeof value === 'string';
}

/**
 * Type guard to check if raw value is an inline RawResponse
 */
export function isRawResponseInline(value: ProcessedRawValue): value is RawResponse {
  return typeof value === 'object' && value !== null && 'status' in value;
}

/**
 * Process raw response - inline if small, store as resource if large
 *
 * @returns Object with:
 *   - raw: Either the inline RawResponse, a URI string to stored resource, or an error object
 *   - resourceLink: Present only when response was stored as a resource
 */
export function processRawResponse(
  response: RawResponse,
  includeRaw?: boolean
): ProcessRawResponseResult {
  if (!includeRaw) {
    return {};
  }

  const config = getConfig();
  const jsonStr = JSON.stringify(response);

  if (jsonStr.length <= config.maxInlineJsonChars) {
    return { raw: response };
  }

  // Store as resource
  const result = putRawText(jsonStr, 'application/json');
  if (!result) {
    // Too large to store
    return { raw: { error: 'Response too large to store' } };
  }

  return {
    raw: result.uri,
    resourceLink: {
      type: 'resource_link',
      uri: result.uri,
      name: 'Raw response',
      mimeType: 'application/json',
    },
  };
}

/**
 * Build content array with text and optional resource link
 */
export function buildContent(text: string, resourceLink?: ResourceLink): ContentItem[] {
  const content: ContentItem[] = [{ type: 'text', text }];
  if (resourceLink) {
    content.push(resourceLink);
  }
  return content;
}

/**
 * Common input schema for include_raw parameter
 */
export const includeRawSchema = z.boolean().optional().default(false);

// JSON Schema types - exported for use in tool definitions
export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  additionalProperties?: boolean;
  enum?: unknown[];
  const?: unknown;
  oneOf?: JsonSchema[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
}

/**
 * Zod to JSON Schema converter (simplified)
 *
 * WARNING: This function accesses Zod internal structures (_def) which are not
 * part of Zod's public API. This implementation:
 * - May break with future Zod versions
 * - Does not support all Zod types (see UNSUPPORTED_ZOD_TYPES)
 * - Uses defensive checks but may still fail on edge cases
 *
 * For production use with full Zod type coverage, consider using the
 * 'zod-to-json-schema' package instead.
 */
export function zodToJsonSchema(schema: ZodTypeAny): JsonSchema {
  return zodTypeToJsonSchema(schema);
}

/** Zod types that are explicitly not supported by this converter */
const UNSUPPORTED_ZOD_TYPES = [
  'ZodIntersection',
  'ZodTuple',
  'ZodNativeEnum',
  'ZodBigInt',
  'ZodNaN',
  'ZodDate',
  'ZodSymbol',
  'ZodUndefined',
  'ZodVoid',
  'ZodNever',
  'ZodFunction',
  'ZodLazy',
  'ZodPromise',
  'ZodBranded',
  'ZodPipeline',
  'ZodReadonly',
  'ZodCatch',
  'ZodDiscriminatedUnion',
  'ZodEffects',
  'ZodMap',
  'ZodSet',
] as const;

/**
 * Safely get the Zod definition object
 */
function getZodDef(schema: ZodTypeAny): { typeName: string; [key: string]: unknown } | null {
  try {
    const schemaAny = schema as { _def?: unknown };
    if (!schemaAny._def || typeof schemaAny._def !== 'object') {
      return null;
    }
    const def = schemaAny._def as { typeName?: unknown; [key: string]: unknown };
    if (typeof def.typeName !== 'string') {
      return null;
    }
    return def as { typeName: string; [key: string]: unknown };
  } catch {
    return null;
  }
}

/**
 * Safely get checks array from a Zod definition
 */
function getChecks(def: { [key: string]: unknown }): Array<{ kind: string; value?: number }> {
  if (!def.checks || !Array.isArray(def.checks)) {
    return [];
  }
  return def.checks.filter(
    (c): c is { kind: string; value?: number } =>
      typeof c === 'object' && c !== null && typeof (c as { kind?: unknown }).kind === 'string'
  );
}

function zodTypeToJsonSchema(schema: ZodTypeAny): JsonSchema {
  const def = getZodDef(schema);

  if (!def) {
    // Cannot access Zod internals, return permissive schema
    return {};
  }

  const typeName = def.typeName;

  // Check for explicitly unsupported types
  if (UNSUPPORTED_ZOD_TYPES.includes(typeName as (typeof UNSUPPORTED_ZOD_TYPES)[number])) {
    throw new Error(
      `Unsupported Zod type: ${typeName}. Consider using 'zod-to-json-schema' package for full support.`
    );
  }

  switch (typeName) {
    case 'ZodString': {
      const strSchema: JsonSchema = { type: 'string' };
      const checks = getChecks(def);
      for (const check of checks) {
        if (check.kind === 'min' && typeof check.value === 'number') {
          strSchema.minLength = check.value;
        }
        if (check.kind === 'max' && typeof check.value === 'number') {
          strSchema.maxLength = check.value;
        }
      }
      return strSchema;
    }

    case 'ZodNumber': {
      const numSchema: JsonSchema = { type: 'number' };
      const checks = getChecks(def);
      for (const check of checks) {
        if (check.kind === 'min' && typeof check.value === 'number') {
          numSchema.minimum = check.value;
        }
        if (check.kind === 'max' && typeof check.value === 'number') {
          numSchema.maximum = check.value;
        }
      }
      return numSchema;
    }

    case 'ZodBoolean':
      return { type: 'boolean' };

    case 'ZodArray': {
      // Safely access array item type
      const itemType = def.type as ZodTypeAny | undefined;
      if (!itemType) {
        return { type: 'array' };
      }

      const arraySchema: JsonSchema = {
        type: 'array',
        items: zodTypeToJsonSchema(itemType),
      };

      // Safely access length constraints
      const minLen = def.minLength as { value?: number } | undefined;
      const maxLen = def.maxLength as { value?: number } | undefined;
      if (minLen && typeof minLen.value === 'number') {
        arraySchema.minItems = minLen.value;
      }
      if (maxLen && typeof maxLen.value === 'number') {
        arraySchema.maxItems = maxLen.value;
      }
      return arraySchema;
    }

    case 'ZodObject': {
      // Safely access shape
      const shapeFn = def.shape as (() => Record<string, ZodTypeAny>) | undefined;
      if (typeof shapeFn !== 'function') {
        return { type: 'object' };
      }

      let shape: Record<string, ZodTypeAny>;
      try {
        shape = shapeFn();
      } catch {
        return { type: 'object' };
      }

      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodTypeToJsonSchema(value);
        if (!isZodOptional(value)) {
          required.push(key);
        }
      }

      const objSchema: JsonSchema = {
        type: 'object',
        properties,
        additionalProperties: false,
      };
      if (required.length > 0) {
        objSchema.required = required;
      }
      return objSchema;
    }

    case 'ZodOptional':
    case 'ZodDefault':
    case 'ZodNullable': {
      // Safely access inner type
      const innerType = def.innerType as ZodTypeAny | undefined;
      if (!innerType) {
        return {};
      }
      const innerSchema = zodTypeToJsonSchema(innerType);

      // For ZodNullable, wrap the type to allow null
      if (typeName === 'ZodNullable') {
        if (typeof innerSchema.type === 'string') {
          return { ...innerSchema, type: [innerSchema.type, 'null'] };
        }
        // Complex inner type - use oneOf
        return { oneOf: [innerSchema, { type: 'null' }] };
      }

      return innerSchema;
    }

    case 'ZodEnum': {
      const values = def.values as unknown[] | undefined;
      if (!Array.isArray(values)) {
        return { type: 'string' };
      }
      return {
        type: 'string',
        enum: values,
      };
    }

    case 'ZodUnion': {
      const options = def.options as ZodTypeAny[] | undefined;
      if (!Array.isArray(options) || options.length === 0) {
        return {};
      }

      // Map options to schemas, handling undefined types gracefully
      const schemas = options.map((o) => zodTypeToJsonSchema(o));

      // Check for simple nullable union (Type | null)
      if (schemas.length === 2) {
        const nullIndex = schemas.findIndex((s) => s.type === 'null');
        if (nullIndex !== -1) {
          const otherSchema = schemas[1 - nullIndex];
          const otherType = otherSchema.type;
          // Only combine if the other type is a simple string type
          if (typeof otherType === 'string' && otherType !== 'null') {
            return { ...otherSchema, type: [otherType, 'null'] };
          }
        }
      }

      // General union - use oneOf
      return { oneOf: schemas };
    }

    case 'ZodNull':
      return { type: 'null' };

    case 'ZodLiteral': {
      const value = def.value;
      if (value === undefined) {
        return {};
      }
      return { const: value };
    }

    case 'ZodRecord': {
      // ZodRecord is a dynamic object with unknown keys
      // Optionally we could handle valueType for additionalProperties
      return { type: 'object' };
    }

    case 'ZodUnknown':
    case 'ZodAny':
      // These types accept any value - return empty schema (permissive)
      return {};

    default:
      // Unknown type - return empty schema (permissive)
      // This is safer than throwing for forward compatibility
      return {};
  }
}

/**
 * Check if a Zod schema is optional (wrapped in ZodOptional or ZodDefault)
 */
function isZodOptional(schema: ZodTypeAny): boolean {
  const def = getZodDef(schema);
  if (!def) return false;

  const typeName = def.typeName;
  return typeName === 'ZodOptional' || typeName === 'ZodDefault';
}
