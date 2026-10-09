/**
 * nanogpt_scrape_urls tool
 *
 * Scrape content from one or more web URLs.
 */

import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { requestJson } from '../httpClient.js';
import { getConfig } from '../config.js';
import { handleToolError, processRawResponse, buildContent, zodToJsonSchema } from '../toolUtils.js';

// Input schema
export const inputSchema = z.object({
  urls: z.array(z.string()).min(1),
  mode: z.enum(['scrape-page', 'conversation']).optional(),
  stealthMode: z.boolean().optional(),
  include_raw: z.boolean().optional().default(false),
});

// Output schema
export const outputSchema = z.object({
  results: z.array(z.record(z.unknown())),
  summary: z.record(z.unknown()),
  raw: z.union([z.record(z.unknown()), z.string()]).optional(),
});

// JSON Schemas for MCP registration
export const inputJsonSchema = zodToJsonSchema(inputSchema);
export const outputJsonSchema = zodToJsonSchema(outputSchema);

// Tool metadata
export const name = 'nanogpt_scrape_urls';
export const description =
  'Scrape content from one or more web URLs. Returns page title, text content, and markdown.';

// Annotations
export const annotations = {
  readOnlyHint: false,
  openWorldHint: true,
};

function formatSuccessfulResult(result: ScrapeResult): string {
  const scrapedText = result.markdown || result.content || '';
  const header = [
    `URL: ${result.url}`,
    `Title: ${result.title || 'No title'}`,
  ].join('\n');

  return scrapedText ? `${header}\n\n${scrapedText}` : header;
}

function formatFailedResult(result: ScrapeResult): string {
  return [
    `URL: ${result.url}`,
    `FAILED: ${result.error || 'Unknown error'}`,
  ].join('\n');
}

interface ScrapeResult {
  url: string;
  success: boolean;
  title?: string;
  content?: string;
  markdown?: string;
  error?: string;
}

interface ScrapeResponse {
  results?: ScrapeResult[];
  summary?: {
    requested?: number;
    processed?: number;
    successful?: number;
    failed?: number;
    actualCost?: number;
    upfrontCost?: number;
    additionalCost?: number;
    creditsUsed?: number;
    stealthModeUsed?: boolean;
    containedPDFs?: boolean;
  };
}

/**
 * Handler for nanogpt_scrape_urls
 */
export async function handler(args: unknown) {
  try {
    // Validate input
    const input = inputSchema.parse(args);
    const config = getConfig();

    // Client-side validation for max URLs
    if (input.urls.length > config.scrapeMaxUrls) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Maximum ${config.scrapeMaxUrls} URLs allowed per request. Received ${input.urls.length}.`
      );
    }

    // Build request body
    const requestBody: Record<string, unknown> = {
      urls: input.urls,
    };

    if (input.mode) requestBody.mode = input.mode;
    if (input.stealthMode !== undefined) requestBody.stealthMode = input.stealthMode;

    // Call NanoGPT API
    const response = await requestJson<ScrapeResponse>({
      method: 'POST',
      path: '/api/scrape-urls',
      body: requestBody,
    });

    const data = response.json;

    // Build output
    const output: Record<string, unknown> = {
      results: data.results || [],
      summary: data.summary || {},
    };

    // Process raw response
    const { raw, resourceLink } = processRawResponse(
      { status: response.status, headers: response.headers, body: data },
      input.include_raw
    );
    if (raw !== undefined) {
      output.raw = raw;
    }

    // Include the complete scraped documents in the standard MCP text content.
    // Some MCP clients do not expose structuredContent to the model, so using a
    // short preview here makes an otherwise successful scrape unusable.
    const results = data.results || [];
    const summary = data.summary || {};
    const formattedResults = results.map((result) => (
      result.success ? formatSuccessfulResult(result) : formatFailedResult(result)
    ));
    let displayText = `Scraped ${results.length} URL(s):`;

    if (formattedResults.length > 0) {
      displayText += `\n\n${formattedResults.join('\n\n---\n\n')}`;
    }

    if (summary.successful !== undefined && summary.failed !== undefined) {
      displayText += `\n\nSummary: ${summary.successful} succeeded, ${summary.failed} failed`;
    }

    return {
      content: buildContent(displayText, resourceLink),
      structuredContent: output,
    };
  } catch (err) {
    return handleToolError(err);
  }
}
