/**
 * Configuration management for NanoGPT MCP server
 *
 * All configuration is read from environment variables.
 * API keys are never logged or exposed.
 */

export type AuthMode = 'bearer' | 'x-api-key' | 'both';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Config {
  baseUrl: string;
  apiKey: string;
  authMode: AuthMode;
  timeoutMs: number;
  maxRetries: number;
  defaultModel?: string;
  visionModel: string;
  logLevel: LogLevel;
  maxInlineJsonChars: number;
  maxResourceCacheItems: number;
  maxResourceBytes: number;
  scrapeMaxUrls: number;
}

let config: Config | null = null;

/**
 * Validate and load configuration from environment variables.
 * Fails fast with clear error messages (never prints API key).
 */
export function loadConfig(): Config {
  const baseUrl = process.env.NANOGPT_BASE_URL || 'https://nano-gpt.com';
  const apiKey = process.env.NANOGPT_API_KEY;

  // Required variables
  const missing: string[] = [];
  if (!apiKey) missing.push('NANOGPT_API_KEY');

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Validate auth mode
  const authModeRaw = process.env.NANOGPT_AUTH_MODE || 'bearer';
  if (!['bearer', 'x-api-key', 'both'].includes(authModeRaw)) {
    throw new Error(`Invalid NANOGPT_AUTH_MODE: ${authModeRaw}. Must be: bearer, x-api-key, or both`);
  }
  const authMode = authModeRaw as AuthMode;

  // Validate log level
  const logLevelRaw = process.env.NANOGPT_LOG_LEVEL || 'info';
  if (!['debug', 'info', 'warn', 'error'].includes(logLevelRaw)) {
    throw new Error(`Invalid NANOGPT_LOG_LEVEL: ${logLevelRaw}. Must be: debug, info, warn, or error`);
  }
  const logLevel = logLevelRaw as LogLevel;

  // Parse numeric values with defaults
  const timeoutMs = parseIntWithDefault(process.env.NANOGPT_TIMEOUT_MS, 120000);
  if (timeoutMs <= 0) {
    throw new Error(`NANOGPT_TIMEOUT_MS must be positive, got: ${timeoutMs}`);
  }

  const maxRetries = parseIntWithDefault(process.env.NANOGPT_MAX_RETRIES, 0);
  if (maxRetries < 0) {
    throw new Error(`NANOGPT_MAX_RETRIES must be non-negative, got: ${maxRetries}`);
  }

  const visionModelRaw = process.env.NANOGPT_VISION_MODEL;
  const visionModel =
    visionModelRaw && visionModelRaw.trim().length > 0 ? visionModelRaw.trim() : 'Qwen/Qwen3-VL-235B-A22B-Instruct';

  const maxInlineJsonChars = parseIntWithDefault(process.env.NANOGPT_MAX_INLINE_JSON_CHARS, 10000);
  if (maxInlineJsonChars <= 0) {
    throw new Error(`NANOGPT_MAX_INLINE_JSON_CHARS must be positive, got: ${maxInlineJsonChars}`);
  }

  const maxResourceCacheItems = parseIntWithDefault(process.env.NANOGPT_MAX_RESOURCE_CACHE_ITEMS, 100);
  if (maxResourceCacheItems <= 0) {
    throw new Error(`NANOGPT_MAX_RESOURCE_CACHE_ITEMS must be positive, got: ${maxResourceCacheItems}`);
  }

  const maxResourceBytes = parseIntWithDefault(process.env.NANOGPT_MAX_RESOURCE_BYTES, 10485760);
  if (maxResourceBytes <= 0) {
    throw new Error(`NANOGPT_MAX_RESOURCE_BYTES must be positive, got: ${maxResourceBytes}`);
  }

  const scrapeMaxUrls = parseIntWithDefault(process.env.NANOGPT_SCRAPE_MAX_URLS, 5);
  if (scrapeMaxUrls <= 0) {
    throw new Error(`NANOGPT_SCRAPE_MAX_URLS must be positive, got: ${scrapeMaxUrls}`);
  }

  config = {
    baseUrl: baseUrl.replace(/\/$/, ''), // Remove trailing slash
    apiKey: apiKey!,
    authMode,
    timeoutMs,
    maxRetries,
    defaultModel: process.env.NANOGPT_DEFAULT_MODEL,
    visionModel,
    logLevel,
    maxInlineJsonChars,
    maxResourceCacheItems,
    maxResourceBytes,
    scrapeMaxUrls,
  };

  return config;
}

/**
 * Get the current configuration. Throws if not loaded.
 */
export function getConfig(): Config {
  if (!config) {
    throw new Error('Configuration not loaded. Call loadConfig() first.');
  }
  return config;
}

/**
 * Parse an integer with a default value
 */
function parseIntWithDefault(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Safe logging that never exposes API keys
 */
export function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  const cfg = config || { logLevel: 'info' as LogLevel };
  const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  const currentLevel = levels.indexOf(cfg.logLevel);
  const msgLevel = levels.indexOf(level);

  // Skip if message level is below configured level
  if (msgLevel < currentLevel) {
    return;
  }

  // Sanitize data to remove any potential API key leaks
  const sanitized = data ? sanitizeForLogging(data) : undefined;

  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

  if (sanitized) {
    console.error(`${prefix} ${message}`, JSON.stringify(sanitized));
  } else {
    console.error(`${prefix} ${message}`);
  }
}

/**
 * Remove sensitive data from objects before logging
 */
function sanitizeForLogging(data: Record<string, unknown>): Record<string, unknown> {
  const sensitive = ['apiKey', 'api_key', 'authorization', 'x-api-key', 'password', 'secret', 'token'];
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (sensitive.some((s) => key.toLowerCase().includes(s.toLowerCase()))) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = sanitizeForLogging(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}
