/**
 * nanogpt_chat tool
 *
 * Send a chat completion request to an AI model.
 * Non-streaming only for MCP v1.
 */

import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { requestJson } from '../httpClient.js';
import { getConfig } from '../config.js';
import { handleToolError, processRawResponse, buildContent, zodToJsonSchema } from '../toolUtils.js';

// Message schema
const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

// Input schema
export const inputSchema = z.object({
  messages: z.array(messageSchema).min(1),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().min(1).optional(),
  include_usage: z.boolean().optional(),
  reasoning: z
    .object({
      exclude: z.boolean().optional(),
    })
    .optional(),
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
export const name = 'nanogpt_chat';
export const description =
  "Send a chat completion request to an AI model. Returns the assistant's response. Non-streaming.";

// Annotations
export const annotations = {
  readOnlyHint: false,
  openWorldHint: true,
};

interface ChatResponse {
  choices?: Array<{
    message: {
      content?: string;
      tool_calls?: unknown[];
      [key: string]: unknown;
    };
  }>;
  usage?: Record<string, unknown>;
}

/**
 * Handler for nanogpt_chat
 */
export async function handler(args: unknown) {
  try {
    // Validate input
    const input = inputSchema.parse(args);
    const config = getConfig();

    // Determine model
    const model = input.model || config.defaultModel;
    if (!model) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'No model specified. Either provide a "model" parameter or set NANOGPT_DEFAULT_MODEL environment variable.'
      );
    }

    // Build request body
    const requestBody: Record<string, unknown> = {
      model,
      messages: input.messages,
      stream: false, // Force non-streaming for MCP v1
    };

    if (input.temperature !== undefined) {
      requestBody.temperature = input.temperature;
    }
    if (input.max_tokens !== undefined) {
      requestBody.max_tokens = input.max_tokens;
    }
    if (input.reasoning !== undefined) {
      requestBody.reasoning = input.reasoning;
    }

    // Call NanoGPT API
    const response = await requestJson<ChatResponse>({
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
    const contentText = assistantMessage.content ?? '';

    // Build output
    const output: Record<string, unknown> = {
      content: contentText,
      message: assistantMessage,
    };

    // Include usage if requested or available
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

    // Build content - handle tool calls or other non-text content
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
