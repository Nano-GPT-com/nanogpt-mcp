/**
 * nanogpt_vision tool
 *
 * Analyze images with a vision-capable model (default: zai-org/glm-4.6v).
 */

import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { requestJson } from '../httpClient.js';
import { getConfig } from '../config.js';
import { handleToolError, processRawResponse, buildContent, zodToJsonSchema } from '../toolUtils.js';

// Input schema
export const inputSchema = z.object({
  prompt: z.string().min(1),
  image_url: z.string().min(1).optional(),
  image_urls: z.array(z.string().min(1)).min(1).optional(),
  image_data_url: z.string().min(1).optional(),
  image_data_urls: z.array(z.string().min(1)).min(1).optional(),
  image_detail: z.enum(['low', 'high', 'auto']).optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().min(1).optional(),
  include_usage: z.boolean().optional(),
  system_prompt: z.string().optional(),
  include_raw: z.boolean().optional().default(false),
});

// Output schema
export const outputSchema = z.object({
  content: z.string(),
  message: z.record(z.unknown()),
  usage: z.record(z.unknown()).optional(),
  raw: z.union([z.record(z.unknown()), z.string()]).optional(),
});

// JSON Schemas for MCP registration
export const inputJsonSchema = zodToJsonSchema(inputSchema);
export const outputJsonSchema = zodToJsonSchema(outputSchema);

// Tool metadata
export const name = 'nanogpt_vision';
export const description =
  'Analyze images with a vision-capable model. Provide an image URL or data URL plus a prompt.';

// Annotations
export const annotations = {
  readOnlyHint: false,
  openWorldHint: true,
};

interface VisionResponse {
  choices?: Array<{
    message: {
      content?: unknown;
      tool_calls?: unknown[];
      [key: string]: unknown;
    };
  }>;
  usage?: Record<string, unknown>;
}

type VisionContentItem =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

/**
 * Handler for nanogpt_vision
 */
export async function handler(args: unknown) {
  try {
    // Validate input
    const input = inputSchema.parse(args);
    const config = getConfig();

    const imageSources: string[] = [];
    if (input.image_url) imageSources.push(input.image_url);
    if (input.image_data_url) imageSources.push(input.image_data_url);
    if (input.image_urls) imageSources.push(...input.image_urls);
    if (input.image_data_urls) imageSources.push(...input.image_data_urls);

    if (imageSources.length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Provide at least one image via image_url/image_urls or image_data_url/image_data_urls.'
      );
    }

    // Determine model
    const model = input.model || config.visionModel;
    if (!model) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'No vision model specified. Provide "model" or set NANOGPT_VISION_MODEL.'
      );
    }

    // Build content array (text + images)
    const content: VisionContentItem[] = [{ type: 'text', text: input.prompt }];
    const detail = input.image_detail;

    const addImage = (url: string) => {
      if (detail) {
        content.push({ type: 'image_url', image_url: { url, detail } });
      } else {
        content.push({ type: 'image_url', image_url: { url } });
      }
    };

    for (const url of imageSources) {
      addImage(url);
    }

    // Build messages
    const messages: Array<{ role: 'system' | 'user'; content: string | VisionContentItem[] }> = [];
    if (input.system_prompt) {
      messages.push({ role: 'system', content: input.system_prompt });
    }
    messages.push({ role: 'user', content });

    // Build request body
    const requestBody: Record<string, unknown> = {
      model,
      messages,
      stream: false, // Force non-streaming for MCP v1
    };

    if (input.temperature !== undefined) {
      requestBody.temperature = input.temperature;
    }
    if (input.max_tokens !== undefined) {
      requestBody.max_tokens = input.max_tokens;
    }

    // Call NanoGPT API
    const response = await requestJson<VisionResponse>({
      method: 'POST',
      path: '/v1/chat/completions',
      body: requestBody,
    });

    const data = response.json;

    // Extract assistant message
    const choice = data.choices?.[0];
    if (!choice) {
      throw new McpError(ErrorCode.InternalError, 'No response from model');
    }

    const assistantMessage = choice.message;
    const rawContent = assistantMessage.content;
    let contentText = '';

    if (typeof rawContent === 'string') {
      contentText = rawContent;
    } else if (rawContent !== undefined) {
      contentText = JSON.stringify(rawContent);
    }

    // Build output
    const output: Record<string, unknown> = {
      content: contentText,
      message: assistantMessage,
    };

    if (input.include_usage && data.usage) {
      output.usage = data.usage;
    }

    // Process raw response
    const { raw, resourceLink } = processRawResponse(
      { status: response.status, headers: response.headers, body: data },
      input.include_raw
    );
    if (raw !== undefined) {
      output.raw = raw;
    }

    // Build content
    let displayText: string;
    if (contentText) {
      displayText = contentText;
    } else if (assistantMessage.tool_calls) {
      displayText = `Assistant requested tool calls: ${JSON.stringify(assistantMessage.tool_calls)}`;
    } else {
      displayText = JSON.stringify(assistantMessage);
    }

    return {
      content: buildContent(displayText, resourceLink),
      structuredContent: output,
    };
  } catch (err) {
    return handleToolError(err);
  }
}
