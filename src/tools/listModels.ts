/**
 * Model listing tools
 *
 * - nanogpt_list_text_models
 * - nanogpt_list_image_models
 * - nanogpt_list_audio_models
 * - nanogpt_list_video_models
 */

import { z } from 'zod';
import { requestJson } from '../httpClient.js';
import { putRawText } from '../resources.js';
import { handleToolError, processRawResponse, buildContent, zodToJsonSchema, type ResourceLink } from '../toolUtils.js';

// Common input schema for text models (defaults to detailed=false)
const textModelsInputSchema = z.object({
  detailed: z.boolean().optional(),
  include_raw: z.boolean().optional().default(false),
});

// Common input schema for other models (defaults to detailed=true)
const otherModelsInputSchema = z.object({
  detailed: z.boolean().optional(),
  include_raw: z.boolean().optional().default(false),
});

// Audio models has an extra `type` parameter
const audioModelsInputSchema = z.object({
  detailed: z.boolean().optional(),
  type: z.enum(['tts', 'stt', 'all']).optional(),
  include_raw: z.boolean().optional().default(false),
});

// Common output schema
const outputSchema = z.object({
  data: z.array(z.unknown()),
  raw: z.union([z.record(z.unknown()), z.string()]).optional(),
});

interface ModelsResponse {
  object?: string;
  data?: unknown[];
}

function modelLabel(m: unknown): string {
  if (typeof m === 'string') return m;
  if (typeof m === 'object' && m !== null) {
    const obj = m as Record<string, unknown>;
    if (typeof obj.id === 'string') return obj.id;
    if (typeof obj.model === 'string') return obj.model;
    if (typeof obj.name === 'string') return obj.name;
  }
  try {
    const s = JSON.stringify(m);
    return s.length > 200 ? s.slice(0, 200) + '…' : s;
  } catch {
    return String(m);
  }
}

function modelPreview(models: unknown[], limit: number): string {
  const items = models.slice(0, limit).map((m) => `- ${modelLabel(m)}`);
  return items.join('\n');
}

// ============================================================================
// nanogpt_list_text_models
// ============================================================================

export const listTextModels = {
  name: 'nanogpt_list_text_models',
  description: 'List available text/chat models with optional pricing details.',
  inputSchema: textModelsInputSchema,
  outputSchema,
  inputJsonSchema: zodToJsonSchema(textModelsInputSchema),
  outputJsonSchema: zodToJsonSchema(outputSchema),
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
  },
  async handler(args: unknown) {
    try {
      const input = textModelsInputSchema.parse(args);

      const query: Record<string, string> = {};
      if (input.detailed !== undefined) {
        query.detailed = String(input.detailed);
      }

      const response = await requestJson<ModelsResponse>({
        method: 'GET',
        path: '/api/v1/models',
        query: Object.keys(query).length > 0 ? query : undefined,
      });

      const data = response.json;
      const models = data.data || [];

      const output: Record<string, unknown> = {
        data: models,
      };

      const { raw, resourceLink } = processRawResponse(
        { status: response.status, headers: response.headers, body: data },
        input.include_raw
      );
      if (raw !== undefined) {
        output.raw = raw;
      }

      const displayText = `Found ${models.length} text model(s)`;

      return {
        content: buildContent(displayText, resourceLink),
        structuredContent: output,
      };
    } catch (err) {
      return handleToolError(err);
    }
  },
};

// ============================================================================
// nanogpt_list_image_models
// ============================================================================

export const listImageModels = {
  name: 'nanogpt_list_image_models',
  description: 'List available image generation models with optional pricing details.',
  inputSchema: otherModelsInputSchema,
  outputSchema,
  inputJsonSchema: zodToJsonSchema(otherModelsInputSchema),
  outputJsonSchema: zodToJsonSchema(outputSchema),
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
  },
  async handler(args: unknown) {
    try {
      const input = otherModelsInputSchema.parse(args);

      const query: Record<string, string> = {};
      // Image models default to detailed=true on the server
      if (input.detailed !== undefined) {
        query.detailed = String(input.detailed);
      }

      const response = await requestJson<ModelsResponse>({
        method: 'GET',
        path: '/api/v1/image-models',
        query: Object.keys(query).length > 0 ? query : undefined,
      });

      const data = response.json;
      const models = data.data || [];

      const output: Record<string, unknown> = {
        data: models,
      };

      const { raw, resourceLink } = processRawResponse(
        { status: response.status, headers: response.headers, body: data },
        input.include_raw
      );
      if (raw !== undefined) {
        output.raw = raw;
      }

      const displayText = `Found ${models.length} image model(s)`;

      return {
        content: buildContent(displayText, resourceLink),
        structuredContent: output,
      };
    } catch (err) {
      return handleToolError(err);
    }
  },
};

// ============================================================================
// nanogpt_list_audio_models
// ============================================================================

export const listAudioModels = {
  name: 'nanogpt_list_audio_models',
  description: 'List available audio models (TTS and STT) with optional pricing details.',
  inputSchema: audioModelsInputSchema,
  outputSchema,
  inputJsonSchema: zodToJsonSchema(audioModelsInputSchema),
  outputJsonSchema: zodToJsonSchema(outputSchema),
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
  },
  async handler(args: unknown) {
    try {
      const input = audioModelsInputSchema.parse(args);

      const query: Record<string, string> = {};
      // Audio models default to detailed=true on the server
      if (input.detailed !== undefined) {
        query.detailed = String(input.detailed);
      }
      if (input.type) {
        query.type = input.type;
      }

      const response = await requestJson<ModelsResponse>({
        method: 'GET',
        path: '/api/v1/audio-models',
        query: Object.keys(query).length > 0 ? query : undefined,
      });

      const data = response.json;
      const models = data.data || [];

      const output: Record<string, unknown> = {
        data: models,
      };

      const { raw, resourceLink } = processRawResponse(
        { status: response.status, headers: response.headers, body: data },
        input.include_raw
      );
      if (raw !== undefined) {
        output.raw = raw;
      }

      const typeLabel = input.type === 'tts' ? 'TTS' : input.type === 'stt' ? 'STT' : 'audio';
      const displayText = `Found ${models.length} ${typeLabel} model(s)`;

      return {
        content: buildContent(displayText, resourceLink),
        structuredContent: output,
      };
    } catch (err) {
      return handleToolError(err);
    }
  },
};

// ============================================================================
// nanogpt_list_video_models
// ============================================================================

export const listVideoModels = {
  name: 'nanogpt_list_video_models',
  description: 'List available video generation models with optional pricing details.',
  inputSchema: otherModelsInputSchema,
  outputSchema,
  inputJsonSchema: zodToJsonSchema(otherModelsInputSchema),
  outputJsonSchema: zodToJsonSchema(outputSchema),
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
  },
  async handler(args: unknown) {
    try {
      const input = otherModelsInputSchema.parse(args);

      const query: Record<string, string> = {};
      // Video models default to detailed=true on the server
      if (input.detailed !== undefined) {
        query.detailed = String(input.detailed);
      }

      const response = await requestJson<ModelsResponse>({
        method: 'GET',
        path: '/api/v1/video-models',
        query: Object.keys(query).length > 0 ? query : undefined,
      });

      const data = response.json;
      const models = data.data || [];

      const output: Record<string, unknown> = {
        data: models,
      };

      const { raw, resourceLink } = processRawResponse(
        { status: response.status, headers: response.headers, body: data },
        input.include_raw
      );
      if (raw !== undefined) {
        output.raw = raw;
      }

      let modelsLink: ResourceLink | undefined;
      if (!input.include_raw && models.length > 0) {
        const jsonStr = JSON.stringify({ data: models }, null, 2);
        const stored = putRawText(jsonStr, 'application/json');
        if (stored) {
          modelsLink = {
            type: 'resource_link',
            uri: stored.uri,
            name: 'Video models',
            mimeType: 'application/json',
          };
        }
      }

      const preview = models.length > 0 ? `\n\nPreview (first 20):\n${modelPreview(models, 20)}` : '';
      const displayText = `Found ${models.length} video model(s)${preview}`;

      return {
        content: buildContent(displayText, modelsLink ?? resourceLink),
        structuredContent: output,
      };
    } catch (err) {
      return handleToolError(err);
    }
  },
};

export const list3dModels = {
  name: 'nanogpt_list_3d_models',
  description: 'List available 3D model generation models (text-to-3D, image-to-3D, retexture) with pricing and input capabilities.',
  inputSchema: otherModelsInputSchema,
  outputSchema,
  inputJsonSchema: zodToJsonSchema(otherModelsInputSchema),
  outputJsonSchema: zodToJsonSchema(outputSchema),
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
  },
  async handler(args: unknown) {
    try {
      const input = otherModelsInputSchema.parse(args);

      const query: Record<string, string> = {};
      if (input.detailed !== undefined) {
        query.detailed = String(input.detailed);
      }

      const response = await requestJson<ModelsResponse>({
        method: 'GET',
        path: '/api/v1/3d-models',
        query: Object.keys(query).length > 0 ? query : undefined,
      });

      const data = response.json;
      const models = data.data || [];

      const output: Record<string, unknown> = {
        data: models,
      };

      const { raw, resourceLink } = processRawResponse(
        { status: response.status, headers: response.headers, body: data },
        input.include_raw
      );
      if (raw !== undefined) {
        output.raw = raw;
      }

      let modelsLink: ResourceLink | undefined;
      if (!input.include_raw && models.length > 0) {
        const jsonStr = JSON.stringify({ data: models }, null, 2);
        const stored = putRawText(jsonStr, 'application/json');
        if (stored) {
          modelsLink = {
            type: 'resource_link',
            uri: stored.uri,
            name: '3D models',
            mimeType: 'application/json',
          };
        }
      }

      const preview = models.length > 0 ? `\n\nPreview (first 20):\n${modelPreview(models, 20)}` : '';
      const displayText = `Found ${models.length} 3D model(s)${preview}`;

      return {
        content: buildContent(displayText, modelsLink ?? resourceLink),
        structuredContent: output,
      };
    } catch (err) {
      return handleToolError(err);
    }
  },
};
