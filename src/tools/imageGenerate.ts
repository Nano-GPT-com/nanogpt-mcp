/**
 * nanogpt_image_generate tool
 *
 * Generate images from a text prompt using AI image models.
 */

import { z } from 'zod';
import { requestJson } from '../httpClient.js';
import {
  handleToolError,
  processRawResponse,
  buildContent,
  zodToJsonSchema,
  type ResourceLink,
} from '../toolUtils.js';
import { putBase64Image } from '../resources.js';

// Input schema
export const inputSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
  n: z.number().min(1).max(10).optional(),
  size: z.string().optional(),
  resolution: z.string().optional(),
  width: z.number().min(1).optional(),
  height: z.number().min(1).optional(),
  aspect_ratio: z.string().optional(),
  quality: z.string().optional(),
  response_format: z.enum(['url', 'b64_json']).optional(),
  imageDataUrl: z.string().optional(),
  imageDataUrls: z.array(z.string()).optional(),
  include_raw: z.boolean().optional().default(false),
});

// Output schema
export const outputSchema = z.object({
  images: z.array(
    z.object({
      kind: z.enum(['resource', 'url', 'error']),
      uri: z.string().optional(),
      mimeType: z.string().optional(),
      bytes: z.number().optional(),
      url: z.string().optional(),
      error: z.string().optional(),
    })
  ),
  raw: z.union([z.record(z.unknown()), z.string()]).optional(),
});

// JSON Schemas for MCP registration
export const inputJsonSchema = zodToJsonSchema(inputSchema);
export const outputJsonSchema = zodToJsonSchema(outputSchema);

// Tool metadata
export const name = 'nanogpt_image_generate';
export const description =
  'Generate images from a text prompt using AI image models like DALL-E, Flux, or Midjourney.';

// Annotations
export const annotations = {
  readOnlyHint: false,
  openWorldHint: true,
};

interface ImageData {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
}

interface ImageResponse {
  data?: ImageData[];
  created?: number;
}

/**
 * Detect MIME type from base64 data.
 * Handles data URLs (data:image/png;base64,...) and raw base64 with magic bytes.
 */
function detectMimeType(base64Data: string): string {
  // Check for data URL prefix
  const dataUrlMatch = base64Data.match(/^data:([^;]+);base64,/);
  if (dataUrlMatch) {
    return dataUrlMatch[1];
  }

  // Try to detect from magic bytes in raw base64
  // First few bytes of common image formats when base64 encoded:
  // PNG: iVBOR (first 5 chars of base64)
  // JPEG: /9j/ (first 4 chars of base64)
  // GIF: R0lG (first 4 chars of base64)
  // WebP: UklG (first 4 chars of base64, RIFF header)
  if (base64Data.startsWith('iVBOR')) {
    return 'image/png';
  }
  if (base64Data.startsWith('/9j/')) {
    return 'image/jpeg';
  }
  if (base64Data.startsWith('R0lG')) {
    return 'image/gif';
  }
  if (base64Data.startsWith('UklG')) {
    return 'image/webp';
  }

  // Default to PNG if detection fails
  return 'image/png';
}

/**
 * Handler for nanogpt_image_generate
 */
export async function handler(args: unknown) {
  try {
    // Validate input
    const input = inputSchema.parse(args);

    // Build request body - default to URL format unless explicitly requested
    const requestBody: Record<string, unknown> = {
      prompt: input.prompt,
      response_format: input.response_format || 'url',
    };

    if (input.model) requestBody.model = input.model;
    if (input.n) requestBody.n = input.n;
    if (input.size) requestBody.size = input.size;
    if (input.resolution) requestBody.resolution = input.resolution;
    if (input.width) requestBody.width = input.width;
    if (input.height) requestBody.height = input.height;
    if (input.aspect_ratio) requestBody.aspect_ratio = input.aspect_ratio;
    if (input.quality) requestBody.quality = input.quality;
    if (input.imageDataUrl) requestBody.imageDataUrl = input.imageDataUrl;
    if (input.imageDataUrls) requestBody.imageDataUrls = input.imageDataUrls;

    // Call NanoGPT API
    const response = await requestJson<ImageResponse>({
      method: 'POST',
      path: '/v1/images/generations',
      body: requestBody,
    });

    const data = response.json;
    const images: Array<{
      kind: 'resource' | 'url' | 'error';
      uri?: string;
      mimeType?: string;
      bytes?: number;
      url?: string;
      error?: string;
    }> = [];
    const resourceLinks: ResourceLink[] = [];

    // Process each image
    if (data.data) {
      for (let i = 0; i < data.data.length; i++) {
        const item = data.data[i];

        if (item.b64_json) {
          // Detect MIME type from base64 data
          const mimeType = detectMimeType(item.b64_json);

          // Store base64 image as resource
          const result = putBase64Image(item.b64_json, mimeType);
          if (result) {
            images.push({
              kind: 'resource',
              uri: result.uri,
              mimeType,
              bytes: result.bytes,
            });
            resourceLinks.push({
              type: 'resource_link',
              uri: result.uri,
              name: `Image ${i + 1}`,
              mimeType,
            });
          } else {
            // Image too large to store - report as error with details
            images.push({
              kind: 'error',
              mimeType,
              error: 'Image exceeds maximum storage size and could not be cached',
            });
          }
        } else if (item.url) {
          // Return URL directly
          images.push({
            kind: 'url',
            url: item.url,
          });
        }
      }
    }

    // Build output
    const output: Record<string, unknown> = {
      images,
    };

    // Process raw response
    const { raw, resourceLink } = processRawResponse(
      { status: response.status, headers: response.headers, body: data },
      input.include_raw
    );
    if (raw !== undefined) {
      output.raw = raw;
    }
    if (resourceLink) {
      resourceLinks.push(resourceLink);
    }

    // Build human-readable content
    let displayText: string;
    if (images.length === 0) {
      displayText = 'No images generated.';
    } else if (images.length === 1) {
      const img = images[0];
      if (img.kind === 'url') {
        displayText = `Generated 1 image: ${img.url}`;
      } else if (img.kind === 'error') {
        displayText = `Generated 1 image but storage failed: ${img.error}`;
      } else {
        displayText = `Generated 1 image (stored as resource: ${img.uri})`;
      }
    } else {
      const urlCount = images.filter((i) => i.kind === 'url').length;
      const resourceCount = images.filter((i) => i.kind === 'resource').length;
      const errorCount = images.filter((i) => i.kind === 'error').length;
      const parts: string[] = [];
      if (urlCount > 0) parts.push(`${urlCount} as URLs`);
      if (resourceCount > 0) parts.push(`${resourceCount} as resources`);
      if (errorCount > 0) parts.push(`${errorCount} failed to store`);
      displayText = `Generated ${images.length} images (${parts.join(', ')})`;
    }

    // Build content with all resource links
    const content: Array<{ type: string; text?: string; uri?: string; name?: string; mimeType?: string }> = [
      { type: 'text', text: displayText },
    ];
    for (const link of resourceLinks) {
      content.push(link);
    }

    return {
      content,
      structuredContent: output,
    };
  } catch (err) {
    return handleToolError(err);
  }
}
