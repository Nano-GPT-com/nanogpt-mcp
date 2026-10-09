/**
 * HTTP client for NanoGPT API requests
 *
 * Handles authentication, timeouts, and error normalization.
 * Never logs or exposes API keys.
 */

import { getConfig } from './config.js';
import { registerRequest, unregisterRequest } from './activeRequests.js';
import { fetch as undiciFetch } from 'undici';

// Safe headers to expose in raw responses
const SAFE_RESPONSE_HEADERS = [
  'x-request-id',
  'x-vercel-id',
  'x-payment-response', // Exposed for payment flow observability per spec
  'content-type',
  'content-length',
];

export interface HttpError {
  status: number;
  message: string;
  code?: string;
}

export interface HttpResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  json: T;
}

export interface RawHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  contentType: string;
}

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  query?: Record<string, string>;
  timeoutMs?: number;
}

export interface RawRequestOptions extends RequestOptions {
  accept?: string;
}

/**
 * Extract a safe subset of headers for debugging
 */
function extractSafeHeaders(headers: Headers): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const key of SAFE_RESPONSE_HEADERS) {
    const value = headers.get(key);
    if (value) {
      safe[key] = value;
    }
  }
  return safe;
}

/**
 * Extract error message from upstream response.
 * Handles JSON error objects and plain text responses wrapped as { text }.
 */
function extractErrorMessage(json: unknown): string {
  if (typeof json === 'object' && json !== null) {
    const obj = json as Record<string, unknown>;
    if (typeof obj.error === 'string') {
      return obj.error;
    }
    if (typeof obj.error === 'object' && obj.error !== null) {
      const errorObj = obj.error as Record<string, unknown>;
      if (typeof errorObj.message === 'string') {
        return errorObj.message;
      }
    }
    if (typeof obj.message === 'string') {
      return obj.message;
    }
    // Handle non-JSON responses wrapped as { text } (e.g., HTML error pages, plain text)
    if (typeof obj.text === 'string') {
      // Truncate long HTML/text responses to a reasonable length
      const text = obj.text.trim();
      if (text.length > 200) {
        return text.slice(0, 200) + '...';
      }
      return text || 'Unknown error';
    }
  }
  return 'Unknown error';
}

/**
 * Make an HTTP request to NanoGPT
 */
export async function requestJson<T = unknown>({
  method,
  path,
  body,
  query,
  timeoutMs,
}: RequestOptions): Promise<HttpResponse<T>> {
  const config = getConfig();
  const timeout = timeoutMs ?? config.timeoutMs;
  const fetchImpl: typeof fetch = (globalThis.fetch ?? undiciFetch) as typeof fetch;

  // Build URL
  const url = new URL(path, config.baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }

  // Build headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': `@nanogpt/mcp/1.5.0`,
  };

  // Add auth headers based on mode
  const authMode = config.authMode;
  if (authMode === 'bearer' || authMode === 'both') {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }
  if (authMode === 'x-api-key' || authMode === 'both') {
    headers['x-api-key'] = config.apiKey;
  }

  // Setup abort controller for timeout and graceful shutdown
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // Register controller for graceful shutdown support
  registerRequest(controller);

  try {
    const response = await fetchImpl(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    // Extract safe headers
    const safeHeaders = extractSafeHeaders(response.headers);

    // Parse JSON response
    let json: unknown;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        json = await response.json();
      } catch (parseErr) {
        // An abort while the body streams in is a timeout, not malformed JSON.
        if (controller.signal.aborted) throw parseErr;
        json = null;
      }
    } else {
      const text = await response.text();
      json = { text };
    }
    // Keep the timeout armed until the body is read: a stalled body would
    // otherwise hang past timeoutMs.
    clearTimeout(timeoutId);

    // Handle non-2xx responses
    if (!response.ok) {
      const errorMessage = extractErrorMessage(json);
      const error: HttpError = {
        status: response.status,
        message: errorMessage,
      };

      // Extract error code if present
      if (typeof json === 'object' && json !== null) {
        const obj = json as Record<string, unknown>;
        if (typeof obj.code === 'string') {
          error.code = obj.code;
        }
      }

      throw error;
    }

    return {
      status: response.status,
      headers: safeHeaders,
      json: json as T,
    };
  } catch (err) {
    clearTimeout(timeoutId);

    // Handle abort/timeout
    if (err instanceof Error && err.name === 'AbortError') {
      throw {
        status: 408,
        message: 'Request timed out',
      } as HttpError;
    }

    // Re-throw HttpError
    if (isHttpError(err)) {
      throw err;
    }

    // Handle network errors
    if (err instanceof Error) {
      throw {
        status: 0,
        message: `Network error: ${err.message}`,
      } as HttpError;
    }

    throw {
      status: 0,
      message: 'Unknown error occurred',
    } as HttpError;
  } finally {
    // Always unregister the controller when request completes
    unregisterRequest(controller);
  }
}

/**
 * Make an HTTP request to NanoGPT and return raw bytes.
 */
export async function requestRaw({
  method,
  path,
  body,
  query,
  timeoutMs,
  accept,
}: RawRequestOptions): Promise<RawHttpResponse> {
  const config = getConfig();
  const timeout = timeoutMs ?? config.timeoutMs;
  const fetchImpl: typeof fetch = (globalThis.fetch ?? undiciFetch) as typeof fetch;

  const url = new URL(path, config.baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': `@nanogpt/mcp/1.5.0`,
  };
  if (accept) headers.Accept = accept;

  const authMode = config.authMode;
  if (authMode === 'bearer' || authMode === 'both') {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }
  if (authMode === 'x-api-key' || authMode === 'both') {
    headers['x-api-key'] = config.apiKey;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  registerRequest(controller);

  try {
    const response = await fetchImpl(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const safeHeaders = extractSafeHeaders(response.headers);
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const arrayBuffer = await response.arrayBuffer();
    clearTimeout(timeoutId);
    const buffer = Buffer.from(arrayBuffer);

    if (!response.ok) {
      let parsed: unknown = null;
      const text = buffer.toString('utf-8');
      if (contentType.includes('application/json')) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { text };
        }
      } else {
        parsed = { text };
      }
      throw {
        status: response.status,
        message: extractErrorMessage(parsed),
      } as HttpError;
    }

    return {
      status: response.status,
      headers: safeHeaders,
      body: buffer,
      contentType,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw {
        status: 408,
        message: 'Request timed out',
      } as HttpError;
    }
    throw err;
  } finally {
    unregisterRequest(controller);
  }
}

/**
 * Type guard for HttpError
 */
export function isHttpError(err: unknown): err is HttpError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    'message' in err &&
    typeof (err as HttpError).status === 'number' &&
    typeof (err as HttpError).message === 'string'
  );
}

/**
 * Format error for user display (never includes secrets)
 */
export function formatErrorMessage(err: HttpError): string {
  const { status, message, code } = err;

  if (status === 401) {
    return 'Authentication failed. Check your NANOGPT_API_KEY.';
  }
  if (status === 402) {
    return `Insufficient balance: ${message}. Please top up your NanoGPT account.`;
  }
  if (status === 403) {
    if (code === 'paid_features_disabled') {
      return 'Paid features are disabled. Enable paid models in your NanoGPT settings.';
    }
    return `Access denied: ${message}`;
  }
  if (status === 408 || status === 499 || status === 504) {
    return `Request timed out or was aborted: ${message}`;
  }
  if (status === 429) {
    return `Rate limited: ${message}. Please wait and try again.`;
  }
  if (status >= 500) {
    return `Server error (${status}): ${message}. Please try again later.`;
  }
  if (status === 400) {
    return `Invalid request: ${message}`;
  }

  return `Error (${status}): ${message}`;
}
