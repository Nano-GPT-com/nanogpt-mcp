/**
 * NanoGPT research/data tools.
 */

import { z } from 'zod';
import { requestJson } from '../httpClient.js';
import { handleToolError, processRawResponse, buildContent, zodToJsonSchema } from '../toolUtils.js';

const paramValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
]);

const paramsSchema = z.record(paramValueSchema).optional();

export const xResearchInputSchema = z.object({
  endpoint: z.enum([
    'endpoints',
    'search',
    'search/recent',
    'search/all',
    'counts',
    'counts/recent',
    'counts/all',
    'tweet',
    'tweets',
    'tweet/quotes',
    'tweet/retweeted-by',
    'tweet/liking-users',
    'user',
    'users',
    'user/search',
    'user/tweets',
    'user/mentions',
    'user/liked-tweets',
    'user/followers',
    'user/following',
    'list',
    'list/tweets',
    'list/members',
    'list/followers',
    'space',
    'spaces',
    'spaces/search',
  ]).default('endpoints')
    .describe('X Research endpoint to call. Use endpoints to list supported routes.'),
  params: paramsSchema
    .describe('Query parameters for the selected X endpoint, such as query, username, id, ids, limit, or next_token.'),
  include_raw: z.boolean().optional().default(false)
    .describe('Include the raw NanoGPT API response for debugging. Large raw responses are returned as a resource link.'),
});

export const hunterInputSchema = z.object({
  endpoint: z.enum([
    'endpoints',
    'discover',
    'domain-search',
    'email-finder',
    'email-verifier',
    'people/find',
    'email-enrichment',
    'people-find',
    'person-enrichment',
    'companies/find',
    'company-enrichment',
    'companies-find',
    'combined/find',
    'combined-enrichment',
    'combined-find',
    'email-count',
  ]).default('endpoints')
    .describe('Hunter endpoint to call. Use endpoints to list supported Hunter routes and pricing.'),
  params: z.record(z.unknown()).optional()
    .describe('Parameters for the Hunter endpoint, such as domain, company, email, full_name, first_name, last_name, or linkedin_handle.'),
  include_raw: z.boolean().optional().default(false)
    .describe('Include the raw NanoGPT API response for debugging. Large raw responses are returned as a resource link.'),
});

const dataToolOutputSchema = z.object({
  data: z.unknown(),
  billing: z.record(z.unknown()).optional(),
  meta: z.record(z.unknown()).optional(),
  status: z.number().optional(),
  raw: z.union([z.record(z.unknown()), z.string()]).optional(),
});

export const xResearchInputJsonSchema = zodToJsonSchema(xResearchInputSchema);
export const hunterInputJsonSchema = zodToJsonSchema(hunterInputSchema);
export const outputJsonSchema = zodToJsonSchema(dataToolOutputSchema);

export const xResearch = {
  name: 'nanogpt_x_research',
  description:
    'Retrieve public X data through NanoGPT billing: search, counts, posts, users, timelines, lists, and Spaces.',
  inputSchema: xResearchInputSchema,
  inputJsonSchema: xResearchInputJsonSchema,
  outputJsonSchema,
  annotations: { readOnlyHint: false, openWorldHint: true },
  handler: async (args: unknown) => {
    try {
      const input = xResearchInputSchema.parse(args);
      const endpoint = input.endpoint === 'endpoints' ? 'endpoints' : input.endpoint;
      const response = await requestJson<Record<string, unknown>>({
        method: 'GET',
        path: `/api/v1/x/${endpoint}`,
        query: stringifyParams(input.params),
      });

      return buildDataToolResult({
        label: 'X Research',
        endpoint,
        response,
        includeRaw: input.include_raw,
      });
    } catch (err) {
      return handleToolError(err);
    }
  },
};

export const hunter = {
  name: 'nanogpt_hunter',
  description:
    'Use Hunter.io through NanoGPT billing for domain search, email finding, email verification, enrichment, discovery, and email counts.',
  inputSchema: hunterInputSchema,
  inputJsonSchema: hunterInputJsonSchema,
  outputJsonSchema,
  annotations: { readOnlyHint: false, openWorldHint: true },
  handler: async (args: unknown) => {
    try {
      const input = hunterInputSchema.parse(args);
      const endpoint = input.endpoint === 'endpoints' ? '' : input.endpoint;
      const response = await requestJson<Record<string, unknown>>({
        method: 'POST',
        path: '/api/v1/hunter',
        body: {
          endpoint,
          params: input.params || {},
        },
      });

      return buildDataToolResult({
        label: 'Hunter',
        endpoint: input.endpoint,
        response,
        includeRaw: input.include_raw,
      });
    } catch (err) {
      return handleToolError(err);
    }
  },
};

type DataToolResponse = {
  status: number;
  headers: Record<string, string>;
  json: Record<string, unknown>;
};

function stringifyParams(params: z.infer<typeof paramsSchema>): Record<string, string> {
  const query: Record<string, string> = {};
  if (!params) return query;

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      query[key] = value.map(String).join(',');
    } else {
      query[key] = String(value);
    }
  }
  return query;
}

function buildDataToolResult({
  label,
  endpoint,
  response,
  includeRaw,
}: {
  label: string;
  endpoint: string;
  response: DataToolResponse;
  includeRaw?: boolean;
}) {
  const data = response.json;
  const output: Record<string, unknown> = {
    data: data.data ?? data,
  };
  if (data.billing && typeof data.billing === 'object') output.billing = data.billing;
  if (data.meta && typeof data.meta === 'object') output.meta = data.meta;
  if (typeof data.status === 'number') output.status = data.status;

  const { raw, resourceLink } = processRawResponse(
    { status: response.status, headers: response.headers, body: data },
    includeRaw
  );
  if (raw !== undefined) output.raw = raw;

  return {
    content: buildContent(formatDataToolText(label, endpoint, data), resourceLink),
    structuredContent: output,
  };
}

function formatDataToolText(label: string, endpoint: string, data: Record<string, unknown>): string {
  const primary = data.data ?? data;
  const count = countPrimaryItems(primary);
  let text = `${label} ${endpoint || 'endpoints'} returned ${count.label}.`;

  const billing = data.billing;
  if (billing && typeof billing === 'object') {
    const record = billing as Record<string, unknown>;
    const actualUsd = typeof record.actual_usd === 'number' ? record.actual_usd : undefined;
    const estimatedUsd = typeof record.estimated_usd === 'number' ? record.estimated_usd : undefined;
    if (actualUsd !== undefined) text += ` Actual cost: $${actualUsd.toFixed(6)}.`;
    if (estimatedUsd !== undefined) text += ` Estimated cost: $${estimatedUsd.toFixed(6)}.`;
  }

  const preview = previewPrimary(primary);
  if (preview) text += `\n\nPreview:\n${preview}`;
  return text;
}

function countPrimaryItems(value: unknown): { label: string; count?: number } {
  if (Array.isArray(value)) return { label: `${value.length} item${value.length === 1 ? '' : 's'}`, count: value.length };
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.data)) return { label: `${record.data.length} data item${record.data.length === 1 ? '' : 's'}`, count: record.data.length };
    if (record.data) return { label: '1 data item', count: 1 };
    if (Array.isArray(record.endpoints)) return { label: `${record.endpoints.length} endpoint${record.endpoints.length === 1 ? '' : 's'}`, count: record.endpoints.length };
    return { label: `${Object.keys(record).length} field${Object.keys(record).length === 1 ? '' : 's'}` };
  }
  return { label: value === null || value === undefined ? 'no data' : '1 value', count: value === null || value === undefined ? 0 : 1 };
}

function previewPrimary(value: unknown): string | null {
  const items = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).data)
      ? (value as Record<string, unknown>).data as unknown[]
      : value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).endpoints)
        ? (value as Record<string, unknown>).endpoints as unknown[]
        : null;
  if (!items || items.length === 0) return null;
  return items.slice(0, 3).map((item, index) => `- ${index + 1}: ${summarizeDataItem(item)}`).join('\n');
}

function summarizeDataItem(item: unknown): string {
  if (!item || typeof item !== 'object') return String(item);
  const record = item as Record<string, unknown>;
  const parts = ['id', 'name', 'username', 'email', 'domain', 'title', 'text']
    .map((key) => {
      const value = record[key];
      if (typeof value !== 'string' && typeof value !== 'number') return null;
      const text = String(value).replace(/\s+/g, ' ').trim();
      return text ? `${key}: ${text.slice(0, 120)}${text.length > 120 ? '...' : ''}` : null;
    })
    .filter((part): part is string => Boolean(part))
    .slice(0, 3);
  if (parts.length > 0) return parts.join(', ');
  return `fields: ${Object.keys(record).slice(0, 8).join(', ')}`;
}
