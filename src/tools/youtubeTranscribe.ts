/**
 * nanogpt_youtube_transcribe tool
 *
 * Get transcripts from YouTube videos.
 */

import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { requestJson } from '../httpClient.js';
import { handleToolError, processRawResponse, buildContent, zodToJsonSchema } from '../toolUtils.js';

// Input schema - max 10 URLs per the spec
export const inputSchema = z.object({
  urls: z.array(z.string()).min(1).max(10),
  include_raw: z.boolean().optional().default(false),
});

// Output schema
export const outputSchema = z.object({
  transcripts: z.array(z.record(z.unknown())),
  summary: z.record(z.unknown()),
  raw: z.union([z.record(z.unknown()), z.string()]).optional(),
});

// JSON Schemas for MCP registration
export const inputJsonSchema = zodToJsonSchema(inputSchema);
export const outputJsonSchema = zodToJsonSchema(outputSchema);

// Tool metadata
export const name = 'nanogpt_youtube_transcribe';
export const description = 'Get transcripts from YouTube videos. Supports up to 10 URLs per request.';

// Annotations
export const annotations = {
  readOnlyHint: false,
  openWorldHint: true,
};

interface TranscriptResult {
  url: string;
  success: boolean;
  title?: string;
  transcript?: string;
  error?: string;
}

interface TranscribeResponse {
  transcripts?: TranscriptResult[];
  summary?: {
    requested?: number;
    processed?: number;
    successful?: number;
    failed?: number;
    totalCost?: number;
  };
}

/**
 * Handler for nanogpt_youtube_transcribe
 */
export async function handler(args: unknown) {
  try {
    // Validate input
    const input = inputSchema.parse(args);

    // Build request body

    // Build request body
    const requestBody: Record<string, unknown> = {
      urls: input.urls,
    };

    // Call NanoGPT API
    const response = await requestJson<TranscribeResponse>({
      method: 'POST',
      path: '/api/youtube-transcribe',
      body: requestBody,
    });

    const data = response.json;

    // Build output
    const output: Record<string, unknown> = {
      transcripts: data.transcripts || [],
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

    // Build human-readable content
    const transcripts = data.transcripts || [];
    const summary = data.summary || {};
    let displayText = `Transcribed ${transcripts.length} video(s):`;

    for (const result of transcripts) {
      if (result.success) {
        displayText += `\n- ${result.url}: ${result.title || 'No title'}`;
        if (result.transcript) {
          const preview = result.transcript.slice(0, 100);
          displayText += ` (${preview}${result.transcript.length > 100 ? '...' : ''})`;
        }
      } else {
        displayText += `\n- ${result.url}: FAILED - ${result.error || 'Unknown error'}`;
      }
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
