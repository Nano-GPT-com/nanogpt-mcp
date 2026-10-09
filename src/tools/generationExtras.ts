/**
 * Additional NanoGPT API tools useful to agents.
 */

import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { requestJson, requestRaw, isHttpError, formatErrorMessage } from '../httpClient.js';
import { getConfig } from '../config.js';
import { putBase64Image, putMediaBlob } from '../resources.js';
import { handleToolError, processRawResponse, buildContent, zodToJsonSchema, type ResourceLink } from '../toolUtils.js';

const embeddingInputSchema = z.union([
  z.string(),
  z.array(z.string()),
  z.array(z.number()),
  z.array(z.array(z.number())),
]);

export const embeddingsInputSchema = z.object({
  input: embeddingInputSchema,
  model: z.string().optional().default('text-embedding-3-small'),
  encoding_format: z.enum(['float', 'base64']).optional(),
  dimensions: z.number().int().positive().optional(),
  user: z.string().optional(),
  include_raw: z.boolean().optional().default(false),
});

export const aiDetectionInputSchema = z.object({
  text: z.string().min(1),
  mode: z.enum(['ai', 'plagiarism']).optional().default('ai'),
  include_raw: z.boolean().optional().default(false),
});

export const imageEditInputSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
  imageDataUrl: z.string().optional(),
  imageDataUrls: z.array(z.string()).optional(),
  maskDataUrl: z.string().optional(),
  n: z.number().int().min(1).max(10).optional(),
  size: z.string().optional(),
  quality: z.string().optional(),
  response_format: z.enum(['url', 'b64_json']).optional(),
  include_raw: z.boolean().optional().default(false),
});

export const audioTranscribeInputSchema = z.object({
  audio_url: z.string().url().optional(),
  file_url: z.string().url().optional(),
  model: z.string().optional(),
  language: z.string().optional(),
  prompt: z.string().optional(),
  temperature: z.number().optional(),
  response_format: z.enum(['json', 'text', 'srt', 'verbose_json', 'vtt']).optional(),
  timestamp_granularities: z.array(z.enum(['word', 'segment'])).optional(),
  include_raw: z.boolean().optional().default(false),
});

export const textToSpeechInputSchema = z.object({
  input: z.string().min(1),
  model: z.string().optional(),
  voice: z.string().optional(),
  response_format: z.enum(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm']).optional(),
  speed: z.number().positive().optional(),
  instructions: z.string().optional(),
  include_raw: z.boolean().optional().default(false),
});

export const musicGenerateInputSchema = z.object({
  input: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  model: z.string().optional(),
  duration: z.union([z.number().positive(), z.string().min(1)]).optional(),
  lyrics: z.string().optional(),
  tags: z.array(z.string()).optional(),
  audio: z.string().optional(),
  sampleRate: z.number().int().positive().optional(),
  bitrate: z.number().int().positive().optional(),
  seed: z.number().int().optional(),
  negative_prompt: z.string().optional(),
  response_format: z.enum(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm']).optional(),
  include_raw: z.boolean().optional().default(false),
}).passthrough();

// Many MCP clients abort a tool call after 60 s, so waits default to just under that.
const DEFAULT_MEDIA_WAIT_MS = 50_000;
const mediaJobOperation = z.enum(['submit', 'status', 'poll', 'submit_and_poll']);

export const videoGenerateInputSchema = z.object({
  operation: mediaJobOperation.optional().default('submit'),
  model: z.string().optional(),
  prompt: z.string().optional(),
  imageUrl: z.string().optional(),
  imageDataUrl: z.string().optional(),
  videoUrl: z.string().optional(),
  duration: z.union([z.number().positive(), z.string().min(1)]).optional(),
  resolution: z.string().optional(),
  aspect_ratio: z.string().optional(),
  requestId: z.string().optional(),
  runId: z.string().optional(),
  jobId: z.string().optional(),
  modelSlug: z.string().optional(),
  poll_interval_ms: z.number().int().min(1000).max(30000).optional().default(5000),
  timeout_ms: z.number().int().min(1000).max(600000).optional().default(DEFAULT_MEDIA_WAIT_MS),
  include_raw: z.boolean().optional().default(false),
}).passthrough();

export const model3dGenerateInputSchema = z.object({
  operation: mediaJobOperation.optional().default('submit_and_poll'),
  model: z.string().optional(),
  prompt: z.string().optional(),
  imageUrl: z.string().optional(),
  imageDataUrl: z.string().optional(),
  images: z.array(z.string()).min(1).max(4).optional(),
  model_url: z.string().optional(),
  requestId: z.string().optional(),
  runId: z.string().optional(),
  jobId: z.string().optional(),
  modelSlug: z.string().optional(),
  poll_interval_ms: z.number().int().min(1000).max(30000).optional().default(5000),
  timeout_ms: z.number().int().min(1000).max(1800000).optional().default(DEFAULT_MEDIA_WAIT_MS),
  include_raw: z.boolean().optional().default(false),
}).passthrough();

export const aiQrInputSchema = z.object({
  value: z.string().min(1),
  prompt: z.string().max(1024).optional().default(''),
  negative_prompt: z.string().optional().default(''),
  seed: z.number().int().min(-1).max(9999).optional().default(-1),
  control_strength: z.number().min(0.8).max(1.4).optional().default(1.15),
  prompt_tuning: z.boolean().optional().default(true),
  restoration_rate: z.number().min(0).max(1).optional().default(0.5),
  size: z.enum(['768', '1024', '1152', '1536']).optional().default('1152'),
  padding_ratio: z.number().min(0).max(0.5).optional().default(0.2),
  correct_level: z.enum(['7', '15', '25']).optional().default('15'),
  anchor_style: z.enum(['circle', 'square', 'minimal']).optional().default('square'),
  response_format: z.enum(['url', 'b64_json']).optional().default('url'),
  include_raw: z.boolean().optional().default(false),
});

const genericOutputSchema = z.object({
  data: z.unknown().optional(),
  raw: z.union([z.record(z.unknown()), z.string()]).optional(),
});

const imageOutputSchema = z.object({
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

export const embeddings = {
  name: 'nanogpt_embeddings',
  description: 'Create vector embeddings for text or token inputs using NanoGPT embedding models.',
  inputSchema: embeddingsInputSchema,
  inputJsonSchema: zodToJsonSchema(embeddingsInputSchema),
  outputJsonSchema: zodToJsonSchema(genericOutputSchema),
  annotations: { readOnlyHint: false, openWorldHint: false },
  async handler(args: unknown) {
    try {
      const input = embeddingsInputSchema.parse(args);
      const response = await requestJson<Record<string, unknown>>({
        method: 'POST',
        path: '/api/v1/embeddings',
        body: stripIncludeRaw(input),
      });
      return buildJsonToolResult('Embeddings', response, input.include_raw, summarizeEmbeddings);
    } catch (err) {
      return handleToolError(err);
    }
  },
};

export const aiDetection = {
  name: 'nanogpt_ai_detection',
  description: 'Detect AI-written text or plagiarism using NanoGPT AI Detection.',
  inputSchema: aiDetectionInputSchema,
  inputJsonSchema: zodToJsonSchema(aiDetectionInputSchema),
  outputJsonSchema: zodToJsonSchema(genericOutputSchema),
  annotations: { readOnlyHint: false, openWorldHint: false },
  async handler(args: unknown) {
    try {
      const input = aiDetectionInputSchema.parse(args);
      const response = await requestJson<Record<string, unknown>>({
        method: 'POST',
        path: '/api/v1/ai-detection',
        body: stripIncludeRaw(input),
      });
      return buildJsonToolResult('AI detection', response, input.include_raw, summarizeAiDetection);
    } catch (err) {
      return handleToolError(err);
    }
  },
};

export const imageEdit = {
  name: 'nanogpt_image_edit',
  description: 'Edit or inpaint images using NanoGPT image editing models. Provide imageDataUrl or imageDataUrls plus a prompt.',
  inputSchema: imageEditInputSchema,
  inputJsonSchema: zodToJsonSchema(imageEditInputSchema),
  outputJsonSchema: zodToJsonSchema(genericOutputSchema),
  annotations: { readOnlyHint: false, openWorldHint: true },
  async handler(args: unknown) {
    try {
      const input = imageEditInputSchema.parse(args);
      if (!input.imageDataUrl && (!input.imageDataUrls || input.imageDataUrls.length === 0)) {
        throw new McpError(ErrorCode.InvalidParams, 'Provide imageDataUrl or imageDataUrls.');
      }
      const response = await requestJson<{ data?: Array<{ url?: string; b64_json?: string }> }>({
        method: 'POST',
        path: '/v1/images/edits',
        body: { ...stripIncludeRaw(input), response_format: input.response_format || 'url' },
      });

      const resourceLinks: ResourceLink[] = [];
      const images = (response.json.data || []).map((item, index) => {
        if (item.b64_json) {
          const mimeType = detectImageMimeType(item.b64_json);
          const stored = putBase64Image(item.b64_json, mimeType);
          if (stored) {
            resourceLinks.push({ type: 'resource_link', uri: stored.uri, name: `Edited image ${index + 1}`, mimeType });
            return { kind: 'resource', uri: stored.uri, mimeType, bytes: stored.bytes };
          }
          return { kind: 'error', error: 'Edited image exceeded resource cache size.', mimeType };
        }
        if (item.url) return { kind: 'url', url: item.url };
        return { kind: 'error', error: 'Image edit response item did not include url or b64_json.' };
      });

      const output: Record<string, unknown> = { images };
      const { raw, resourceLink } = processRawResponse(
        { status: response.status, headers: response.headers, body: response.json },
        input.include_raw
      );
      if (raw !== undefined) output.raw = raw;
      if (resourceLink) resourceLinks.push(resourceLink);

      return {
        content: [
          { type: 'text', text: `Edited ${images.length} image${images.length === 1 ? '' : 's'}.` },
          ...resourceLinks,
        ],
        structuredContent: output,
      };
    } catch (err) {
      return handleToolError(err);
    }
  },
};

export const audioTranscribe = {
  name: 'nanogpt_audio_transcribe',
  description: 'Transcribe audio from a URL using NanoGPT speech-to-text models.',
  inputSchema: audioTranscribeInputSchema,
  inputJsonSchema: zodToJsonSchema(audioTranscribeInputSchema),
  outputJsonSchema: zodToJsonSchema(genericOutputSchema),
  annotations: { readOnlyHint: false, openWorldHint: true },
  async handler(args: unknown) {
    try {
      const input = audioTranscribeInputSchema.parse(args);
      if (!input.audio_url && !input.file_url) {
        throw new McpError(ErrorCode.InvalidParams, 'Provide audio_url or file_url.');
      }
      const body = stripIncludeRaw(input);
      if (input.audio_url && !body.file_url) body.file_url = input.audio_url;
      const response = await requestJson<Record<string, unknown>>({
        method: 'POST',
        path: '/api/v1/audio/transcriptions',
        body,
      });
      return buildJsonToolResult('Audio transcription', response, input.include_raw, summarizeTranscription);
    } catch (err) {
      return handleToolError(err);
    }
  },
};

export const textToSpeech = {
  name: 'nanogpt_text_to_speech',
  description: 'Generate speech audio from text using NanoGPT text-to-speech models. Returns generated audio as a media resource.',
  inputSchema: textToSpeechInputSchema,
  inputJsonSchema: zodToJsonSchema(textToSpeechInputSchema),
  outputJsonSchema: zodToJsonSchema(genericOutputSchema),
  annotations: { readOnlyHint: false, openWorldHint: false },
  async handler(args: unknown) {
    try {
      const input = textToSpeechInputSchema.parse(args);
      const response = await requestRaw({
        method: 'POST',
        path: '/api/v1/audio/speech',
        body: stripIncludeRaw(input),
        accept: 'audio/*, application/json',
        timeoutMs: 300_000,
      });

      const contentType = response.contentType || 'application/octet-stream';
      if (contentType.includes('application/json')) {
        const text = response.body.toString('utf-8');
        const data = JSON.parse(text || '{}') as Record<string, unknown>;
        const output: Record<string, unknown> = { data };
        const { raw, resourceLink } = processRawResponse(
          { status: response.status, headers: response.headers, body: data },
          input.include_raw
        );
        if (raw !== undefined) output.raw = raw;
        return {
          content: buildContent('Text-to-speech returned JSON metadata.', resourceLink),
          structuredContent: output,
        };
      }

      const stored = putMediaBlob(response.body, contentType);
      if (!stored) {
        throw new Error('Generated audio exceeded maximum MCP resource cache size.');
      }

      const resourceLink: ResourceLink = {
        type: 'resource_link',
        uri: stored.uri,
        name: 'Generated speech',
        mimeType: contentType,
      };
      const output: Record<string, unknown> = {
        audio: {
          uri: stored.uri,
          mimeType: contentType,
          bytes: stored.bytes,
        },
      };
      const { raw, resourceLink: rawResourceLink } = processRawResponse(
        {
          status: response.status,
          headers: response.headers,
          body: {
            contentType,
            bytes: stored.bytes,
            resource: stored.uri,
          },
        },
        input.include_raw
      );
      if (raw !== undefined) output.raw = raw;

      const content = buildContent(`Generated speech audio (${stored.bytes} bytes).`, resourceLink);
      if (rawResourceLink) content.push(rawResourceLink);

      return {
        content,
        structuredContent: output,
      };
    } catch (err) {
      return handleToolError(err);
    }
  },
};

export const musicGenerate = {
  name: 'nanogpt_music_generate',
  description:
    'Generate music through music-capable NanoGPT audio models exposed on the audio speech transport. Returns generated audio as a media resource when the API returns audio bytes.',
  inputSchema: musicGenerateInputSchema,
  inputJsonSchema: zodToJsonSchema(musicGenerateInputSchema),
  outputJsonSchema: zodToJsonSchema(genericOutputSchema),
  annotations: { readOnlyHint: false, openWorldHint: false },
  async handler(args: unknown) {
    try {
      const input = musicGenerateInputSchema.parse(args);
      const requestBody = stripIncludeRaw(input);
      if (!requestBody.input) {
        requestBody.input = input.text || input.prompt;
      }
      if (!requestBody.input) {
        throw new McpError(ErrorCode.InvalidParams, 'Provide input, text, or prompt for music generation.');
      }
      delete requestBody.text;
      delete requestBody.prompt;

      const response = await requestRaw({
        method: 'POST',
        path: '/api/v1/audio/speech',
        body: requestBody,
        accept: 'audio/*, application/json',
        timeoutMs: 600_000,
      });

      return buildBinaryMediaToolResult({
        label: 'Music generation',
        resourceName: 'Generated music',
        response,
        includeRaw: input.include_raw,
      });
    } catch (err) {
      return handleToolError(err);
    }
  },
};

export const videoGenerate = {
  name: 'nanogpt_video_generate',
  description:
    'Submit NanoGPT video generation jobs and get the video URL. Use nanogpt_list_video_models for model ids. ' +
    'operation "submit_and_poll" submits and waits up to timeout_ms (default 50 s) for the result; if the job is ' +
    'still running it returns the runId, then call again with operation "poll" and that runId to keep waiting, ' +
    'or "status" for a single check. Keep timeout_ms below your MCP client tool-call timeout (often 60 s).',
  inputSchema: videoGenerateInputSchema,
  inputJsonSchema: zodToJsonSchema(videoGenerateInputSchema),
  outputJsonSchema: zodToJsonSchema(genericOutputSchema),
  annotations: { readOnlyHint: false, openWorldHint: true },
  async handler(args: unknown) {
    try {
      return await runMediaJob('Video', videoGenerateInputSchema.parse(args));
    } catch (err) {
      return handleToolError(err);
    }
  },
};

export const model3dGenerate = {
  name: 'nanogpt_3d_generate',
  description:
    'Generate a 3D model (GLB and other formats) from a text prompt or an input image with NanoGPT 3D models. ' +
    'Use nanogpt_list_3d_models for model ids and whether each accepts text, images, or both. ' +
    'imageUrl/imageDataUrl take a public https URL or a data URL. Jobs usually take 1-10 minutes: the default ' +
    'operation "submit_and_poll" waits up to timeout_ms (default 50 s) and otherwise returns the runId; then call ' +
    'again with operation "poll" and that runId to keep waiting, or "status" for a single check. ' +
    'Keep timeout_ms below your MCP client tool-call timeout (often 60 s).',
  inputSchema: model3dGenerateInputSchema,
  inputJsonSchema: zodToJsonSchema(model3dGenerateInputSchema),
  outputJsonSchema: zodToJsonSchema(genericOutputSchema),
  annotations: { readOnlyHint: false, openWorldHint: true },
  async handler(args: unknown) {
    try {
      return await runMediaJob('3D', model3dGenerateInputSchema.parse(args));
    } catch (err) {
      return handleToolError(err);
    }
  },
};

type MediaJobInput = {
  operation: 'submit' | 'status' | 'poll' | 'submit_and_poll';
  model?: string;
  requestId?: string;
  runId?: string;
  jobId?: string;
  modelSlug?: string;
  poll_interval_ms: number;
  timeout_ms: number;
  include_raw: boolean;
  [key: string]: unknown;
};

async function runMediaJob(label: 'Video' | '3D', input: MediaJobInput) {
  // The wait budget includes submission time so the whole call fits the
  // client's tool-call timeout.
  const startedAt = Date.now();
  const deadline = startedAt + input.timeout_ms;

  if (input.operation === 'status') {
    const statusResponse = await requestVideoStatus(input, Math.min(STATUS_REQUEST_TIMEOUT_MS, input.timeout_ms));
    return buildJsonToolResult(`${label} status`, statusResponse, input.include_raw, summarizeVideoStatus);
  }

  let submission: Record<string, unknown> | undefined;
  let identifiers: MediaJobIdentifiers;
  if (input.operation === 'poll') {
    identifiers = {
      requestId: input.requestId,
      runId: input.runId,
      jobId: input.jobId,
      modelSlug: input.modelSlug,
    };
    if (!identifiers.requestId && !identifiers.runId && !identifiers.jobId) {
      throw new McpError(ErrorCode.InvalidParams, `Provide runId (or requestId/jobId) to poll a ${label} job.`);
    }
  } else {
    if (!input.model) {
      throw new McpError(ErrorCode.InvalidParams, `Provide a model id to submit a ${label} job.`);
    }

    const submitResponse = await requestJson<Record<string, unknown>>({
      method: 'POST',
      path: '/api/generate-video',
      body: buildVideoSubmitBody(input),
      timeoutMs: 300_000,
    });

    if (input.operation !== 'submit_and_poll') {
      return buildJsonToolResult(`${label} generation submitted`, submitResponse, input.include_raw, summarizeVideoStatus);
    }

    submission = submitResponse.json;
    identifiers = extractVideoIdentifiers(submitResponse.json, input);
    if (!identifiers.requestId && !identifiers.runId && !identifiers.jobId) {
      return buildJsonToolResult(
        `${label} generation submitted; no status identifier was returned`,
        submitResponse,
        input.include_raw,
        summarizeVideoStatus
      );
    }
  }

  // The job is already submitted (and billed), so polling must always hand
  // the identifiers back: transient failures (dropped connection, 408, 429,
  // 5xx) keep polling, and any other failure returns the ids with the error.
  const pollStartedAt = Date.now();
  let lastStatus: Record<string, unknown> | undefined;
  let lastHttp: { status: number; headers: Record<string, string> } | undefined;
  let lastPollError: string | undefined;
  let pollFailed = false;
  for (;;) {
    // A slow submission can use up the whole budget; return the ids instead.
    if (deadline - Date.now() < 1000) break;
    try {
      const statusResponse = await requestVideoStatus(
        identifiers,
        Math.max(1000, Math.min(STATUS_REQUEST_TIMEOUT_MS, deadline - Date.now()))
      );
      lastStatus = statusResponse.json;
      lastHttp = { status: statusResponse.status, headers: statusResponse.headers };
      lastPollError = undefined;
      if (isTerminalVideoStatus(lastStatus)) break;
    } catch (err) {
      lastPollError = isHttpError(err) ? formatErrorMessage(err) : err instanceof Error ? err.message : String(err);
      // A freshly submitted job can briefly be unknown to the status endpoint.
      const justSubmitted = submission !== undefined && Date.now() - pollStartedAt < NEW_JOB_NOT_FOUND_GRACE_MS;
      if (!isTransientPollError(err) && !(justSubmitted && isHttpError(err) && err.status === 404)) {
        pollFailed = true;
        break;
      }
    }
    if (Date.now() + input.poll_interval_ms > deadline) break;
    await sleep(input.poll_interval_ms);
  }
  const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);

  const output: Record<string, unknown> = {
    ...(submission ? { submission } : {}),
    runId: identifiers.runId || identifiers.requestId || identifiers.jobId,
    ...(identifiers.modelSlug ? { modelSlug: identifiers.modelSlug } : {}),
    status: lastStatus ?? null,
    urls: lastStatus ? extractMediaJobUrls(lastStatus) : [],
  };
  if (lastPollError) output.lastPollError = lastPollError;
  const { raw, resourceLink } = processRawResponse(
    // Snapshot: output.raw is assigned below and must not reference itself.
    { status: lastHttp?.status ?? 0, headers: lastHttp?.headers, body: { ...output } },
    input.include_raw
  );
  if (raw !== undefined) output.raw = raw;

  const resume = `operation "poll" (keep waiting) or "status" with runId "${output.runId}"` +
    `${identifiers.modelSlug ? ` and modelSlug "${identifiers.modelSlug}"` : ''}`;
  let text: string;
  if (pollFailed) {
    text = `${label} job ${output.runId} was submitted, but checking its status failed: ${lastPollError}. ` +
      `Check it again later with ${resume}.`;
  } else if (lastStatus !== undefined && isTerminalVideoStatus(lastStatus)) {
    text = `${label} generation status: ${summarizeVideoStatus(lastStatus)}`;
  } else {
    text = `${label} job ${output.runId} is still running after ${elapsedSeconds}s` +
      `${lastStatus ? ` (${summarizeVideoStatus(lastStatus)})` : ''}` +
      `${lastPollError ? `; last status check did not complete: ${lastPollError}` : ''}. ` +
      `Continue with ${resume}.`;
  }

  return {
    content: buildContent(text, resourceLink),
    structuredContent: output,
    ...(pollFailed ? { isError: true } : {}),
  };
}

export const aiQr = {
  name: 'nanogpt_ai_qr',
  description: 'Generate an artistic, scannable QR code using NanoGPT Artistic QR. Encodes value as the QR payload and uses prompt for the visual style.',
  inputSchema: aiQrInputSchema,
  inputJsonSchema: zodToJsonSchema(aiQrInputSchema),
  outputJsonSchema: zodToJsonSchema(imageOutputSchema),
  annotations: { readOnlyHint: false, openWorldHint: true },
  async handler(args: unknown) {
    try {
      const input = aiQrInputSchema.parse(args);
      const response = await requestJson<{ data?: Array<{ url?: string; b64_json?: string }> }>({
        method: 'POST',
        path: '/v1/images/generations',
        body: {
          model: 'qrbtf-g1',
          url: input.value,
          prompt: input.prompt,
          negative_prompt: input.negative_prompt,
          seed: input.seed,
          control_strength: input.control_strength,
          prompt_tuning: input.prompt_tuning,
          image_restoration: input.restoration_rate > 0,
          restoration_rate: input.restoration_rate,
          size: input.size,
          padding_ratio: input.padding_ratio,
          correct_level: input.correct_level,
          anchor_style: input.anchor_style,
          response_format: input.response_format,
        },
        timeoutMs: 300_000,
      });

      const resourceLinks: ResourceLink[] = [];
      const images = (response.json.data || []).map((item, index) => {
        if (item.b64_json) {
          const mimeType = detectImageMimeType(item.b64_json);
          const stored = putBase64Image(item.b64_json, mimeType);
          if (stored) {
            resourceLinks.push({ type: 'resource_link', uri: stored.uri, name: `AI QR ${index + 1}`, mimeType });
            return { kind: 'resource', uri: stored.uri, mimeType, bytes: stored.bytes };
          }
          return { kind: 'error', error: 'Generated QR exceeded resource cache size.', mimeType };
        }
        if (item.url) return { kind: 'url', url: item.url };
        return { kind: 'error', error: 'AI QR response item did not include url or b64_json.' };
      });

      const output: Record<string, unknown> = { images };
      const { raw, resourceLink } = processRawResponse(
        { status: response.status, headers: response.headers, body: response.json },
        input.include_raw
      );
      if (raw !== undefined) output.raw = raw;
      if (resourceLink) resourceLinks.push(resourceLink);

      return {
        content: [
          { type: 'text', text: summarizeImages('Generated AI QR', images) },
          ...resourceLinks,
        ],
        structuredContent: output,
      };
    } catch (err) {
      return handleToolError(err);
    }
  },
};

function stripIncludeRaw<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  const { include_raw: _includeRaw, ...body } = input;
  return body;
}

function buildJsonToolResult(
  label: string,
  response: { status: number; headers: Record<string, string>; json: Record<string, unknown> },
  includeRaw: boolean | undefined,
  summarize: (data: Record<string, unknown>) => string
) {
  const output: Record<string, unknown> = { data: response.json };
  const { raw, resourceLink } = processRawResponse(
    { status: response.status, headers: response.headers, body: response.json },
    includeRaw
  );
  if (raw !== undefined) output.raw = raw;
  return {
    content: buildContent(`${label}: ${summarize(response.json)}`, resourceLink),
    structuredContent: output,
  };
}

function buildBinaryMediaToolResult({
  label,
  resourceName,
  response,
  includeRaw,
}: {
  label: string;
  resourceName: string;
  response: { status: number; headers: Record<string, string>; body: Buffer; contentType: string };
  includeRaw: boolean | undefined;
}) {
  const contentType = response.contentType || 'application/octet-stream';
  if (contentType.includes('application/json')) {
    const text = response.body.toString('utf-8');
    const data = JSON.parse(text || '{}') as Record<string, unknown>;
    const output: Record<string, unknown> = { data };
    const { raw, resourceLink } = processRawResponse(
      { status: response.status, headers: response.headers, body: data },
      includeRaw
    );
    if (raw !== undefined) output.raw = raw;
    return {
      content: buildContent(`${label} returned JSON metadata.`, resourceLink),
      structuredContent: output,
    };
  }

  const stored = putMediaBlob(response.body, contentType);
  if (!stored) {
    throw new Error(`${label} output exceeded maximum MCP resource cache size.`);
  }

  const resourceLink: ResourceLink = {
    type: 'resource_link',
    uri: stored.uri,
    name: resourceName,
    mimeType: contentType,
  };
  const output: Record<string, unknown> = {
    audio: {
      uri: stored.uri,
      mimeType: contentType,
      bytes: stored.bytes,
    },
  };
  const { raw, resourceLink: rawResourceLink } = processRawResponse(
    {
      status: response.status,
      headers: response.headers,
      body: {
        contentType,
        bytes: stored.bytes,
        resource: stored.uri,
      },
    },
    includeRaw
  );
  if (raw !== undefined) output.raw = raw;

  const content = buildContent(`${label} generated audio (${stored.bytes} bytes).`, resourceLink);
  if (rawResourceLink) content.push(rawResourceLink);

  return {
    content,
    structuredContent: output,
  };
}

function buildVideoSubmitBody(input: MediaJobInput): Record<string, unknown> {
  const {
    operation: _operation,
    requestId: _requestId,
    runId: _runId,
    jobId: _jobId,
    modelSlug: _modelSlug,
    poll_interval_ms: _pollIntervalMs,
    timeout_ms: _timeoutMs,
    include_raw: _includeRaw,
    ...body
  } = input;
  return body;
}

const STATUS_REQUEST_TIMEOUT_MS = 120_000;
const NEW_JOB_NOT_FOUND_GRACE_MS = 30_000;

type MediaJobIdentifiers = { requestId?: string; runId?: string; jobId?: string; modelSlug?: string };

function requestVideoStatus(input: MediaJobIdentifiers, timeoutMs = STATUS_REQUEST_TIMEOUT_MS) {
  const query: Record<string, string> = {};
  if (input.requestId) query.requestId = input.requestId;
  if (input.runId) query.runId = input.runId;
  if (input.jobId) query.jobId = input.jobId;
  // The status endpoint only reads requestId/runId; jobId is an alias.
  if (!query.requestId && !query.runId && input.jobId) query.requestId = input.jobId;
  if (input.modelSlug) query.modelSlug = input.modelSlug;

  if (Object.keys(query).length === 0) {
    throw new McpError(ErrorCode.InvalidParams, 'Provide requestId, runId, or jobId for video status lookup.');
  }

  return requestJson<Record<string, unknown>>({
    method: 'GET',
    path: '/api/video/status',
    query,
    timeoutMs,
  });
}

function extractVideoIdentifiers(
  data: Record<string, unknown>,
  fallback: { requestId?: string; runId?: string; jobId?: string; modelSlug?: string }
): { requestId?: string; runId?: string; jobId?: string; modelSlug?: string } {
  const requestId = getStringField(data, ['requestId', 'request_id', 'id', 'jobId', 'job_id']) || fallback.requestId;
  const runId = getStringField(data, ['runId', 'run_id']) || fallback.runId;
  const jobId = getStringField(data, ['jobId', 'job_id']) || fallback.jobId;
  const modelSlug = getStringField(data, ['modelSlug', 'model_slug', 'model']) || fallback.modelSlug;
  return { requestId, runId, jobId, modelSlug };
}

function getStringField(data: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

// /api/video/status nests the job under `data` ({ requestId, data: { status, output }, model }).
function unwrapVideoStatus(data: Record<string, unknown>): Record<string, unknown> {
  const inner = data.data;
  return inner && typeof inner === 'object' && !Array.isArray(inner) ? inner as Record<string, unknown> : data;
}

function extractMediaJobUrls(data: Record<string, unknown>): string[] {
  const job = unwrapVideoStatus(data);
  const output = job.output && typeof job.output === 'object' ? job.output as Record<string, unknown> : {};
  const urls: string[] = [];
  const add = (value: unknown) => {
    let url = typeof value === 'string' ? value : (value as { url?: unknown } | null | undefined)?.url;
    // Some models return a stable server-relative URL (/api/generate-video/content?...).
    if (typeof url === 'string' && url.startsWith('/api/')) url = `${getConfig().baseUrl}${url}`;
    if (typeof url === 'string' && /^https?:\/\//.test(url) && !urls.includes(url)) urls.push(url);
  };
  for (const source of [output, job, data]) {
    add(source.video);
    add(source.model_url);
    for (const key of ['url', 'videoUrl', 'video_url', 'outputUrl', 'output_url']) add(source[key]);
    for (const key of ['videoUrls', 'model3d_assets']) {
      const list = source[key];
      if (Array.isArray(list)) list.forEach(add);
    }
  }
  return urls;
}

function getErrorText(data: Record<string, unknown>): string | undefined {
  const job = unwrapVideoStatus(data);
  for (const source of [job, data]) {
    const error = source.error;
    if (typeof error === 'string' && error) return error;
    if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
      return (error as { message: string }).message;
    }
  }
  return undefined;
}

function summarizeVideoStatus(data: Record<string, unknown>): string {
  const job = unwrapVideoStatus(data);
  const status = getStringField(job, ['status', 'state']) || getStringField(data, ['status', 'state']);
  const id = getStringField(data, ['runId', 'run_id', 'requestId', 'request_id', 'id', 'jobId', 'job_id'])
    || getStringField(job, ['request_id', 'requestId', 'id']);
  const urls = extractMediaJobUrls(data);
  const error = getErrorText(data);
  const parts = [];
  parts.push(`status ${status || 'unknown'}`);
  if (id) parts.push(`id ${id}`);
  if (error) parts.push(`error ${error}`);
  parts.push(...urls.slice(0, 10));
  return parts.join(', ');
}

function isTerminalVideoStatus(data: Record<string, unknown>): boolean {
  const status = (
    getStringField(unwrapVideoStatus(data), ['status', 'state']) || getStringField(data, ['status', 'state']) || ''
  ).toLowerCase();
  return ['succeeded', 'success', 'completed', 'complete', 'failed', 'error', 'canceled', 'cancelled', 'timed_out']
    .includes(status);
}

function isTransientPollError(err: unknown): boolean {
  if (!isHttpError(err)) return false;
  return err.status === 0 || err.status === 408 || err.status === 429 || err.status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeEmbeddings(data: Record<string, unknown>): string {
  const embeddingData = Array.isArray(data.data) ? data.data : [];
  const usage = data.usage && typeof data.usage === 'object' ? data.usage as Record<string, unknown> : {};
  const tokens = typeof usage.total_tokens === 'number' ? `, ${usage.total_tokens} token(s)` : '';
  return `created ${embeddingData.length} embedding${embeddingData.length === 1 ? '' : 's'}${tokens}.`;
}

function summarizeAiDetection(data: Record<string, unknown>): string {
  const content = typeof data.content === 'string' ? data.content.replace(/\s+/g, ' ').trim() : '';
  return content ? content.slice(0, 240) : 'completed.';
}

function summarizeTranscription(data: Record<string, unknown>): string {
  const text = typeof data.text === 'string'
    ? data.text
    : typeof data.transcription === 'string'
      ? data.transcription
      : '';
  return text ? text.replace(/\s+/g, ' ').trim().slice(0, 240) : 'completed.';
}

function summarizeImages(
  label: string,
  images: Array<{ kind: string; uri?: string; url?: string; error?: string }>
): string {
  if (images.length === 0) return `${label}: no image returned.`;
  if (images.length === 1) {
    const image = images[0];
    if (image.kind === 'url') return `${label}: ${image.url}`;
    if (image.kind === 'resource') return `${label}: stored as resource ${image.uri}`;
    return `${label}: ${image.error || 'image generation failed.'}`;
  }

  const urlCount = images.filter((image) => image.kind === 'url').length;
  const resourceCount = images.filter((image) => image.kind === 'resource').length;
  const errorCount = images.filter((image) => image.kind === 'error').length;
  const parts: string[] = [];
  if (urlCount) parts.push(`${urlCount} URL${urlCount === 1 ? '' : 's'}`);
  if (resourceCount) parts.push(`${resourceCount} resource${resourceCount === 1 ? '' : 's'}`);
  if (errorCount) parts.push(`${errorCount} error${errorCount === 1 ? '' : 's'}`);
  return `${label}: ${parts.join(', ')}.`;
}

function detectImageMimeType(base64Data: string): string {
  const dataUrlMatch = base64Data.match(/^data:([^;]+);base64,/);
  if (dataUrlMatch) return dataUrlMatch[1];
  if (base64Data.startsWith('iVBOR')) return 'image/png';
  if (base64Data.startsWith('/9j/')) return 'image/jpeg';
  if (base64Data.startsWith('R0lG')) return 'image/gif';
  if (base64Data.startsWith('UklG')) return 'image/webp';
  return 'image/png';
}
