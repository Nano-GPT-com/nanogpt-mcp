/**
 * In-memory LRU resource cache for NanoGPT MCP server
 *
 * Stores large payloads (images, media, raw JSON) that are too big to inline.
 * Resources are ephemeral and will be evicted when the cache is full.
 */

import { randomUUID } from 'crypto';
import { getConfig } from './config.js';

export type ResourceType = 'raw' | 'image' | 'media';

interface ResourceEntry {
  id: string;
  type: ResourceType;
  mimeType: string;
  data: string; // text for raw, base64 for binary resources
  bytes: number;
  createdAt: number;
}

// In-memory LRU cache
const cache = new Map<string, ResourceEntry>();
const accessOrder: string[] = [];

/**
 * Generate a resource URI
 */
export function makeUri(type: ResourceType, id: string): string {
  return `nanogpt://${type}/${id}`;
}

/**
 * Parse a resource URI
 */
export function parseUri(uri: string): { type: ResourceType; id: string } | null {
  const match = uri.match(/^nanogpt:\/\/(raw|image|media)\/([a-f0-9-]+)$/);
  if (!match) return null;
  return {
    type: match[1] as ResourceType,
    id: match[2],
  };
}

/**
 * Update access order for LRU eviction
 */
function updateAccessOrder(id: string): void {
  const index = accessOrder.indexOf(id);
  if (index > -1) {
    accessOrder.splice(index, 1);
  }
  accessOrder.push(id);
}

/**
 * Evict oldest entries if cache is full
 */
function evictIfNeeded(): void {
  const config = getConfig();
  while (cache.size >= config.maxResourceCacheItems && accessOrder.length > 0) {
    const oldestId = accessOrder.shift()!;
    cache.delete(oldestId);
  }
}

/**
 * Store raw text/JSON as a resource
 */
export function putRawText(
  text: string,
  mimeType: string = 'application/json'
): { uri: string; bytes: number } | null {
  const config = getConfig();
  const bytes = Buffer.byteLength(text, 'utf-8');

  // Check size limit
  if (bytes > config.maxResourceBytes) {
    return null;
  }

  // Evict if needed
  evictIfNeeded();

  const id = randomUUID();
  const entry: ResourceEntry = {
    id,
    type: 'raw',
    mimeType,
    data: text,
    bytes,
    createdAt: Date.now(),
  };

  cache.set(id, entry);
  updateAccessOrder(id);

  return {
    uri: makeUri('raw', id),
    bytes,
  };
}

/**
 * Store binary data (image) as a resource
 */
export function putBlob(buffer: Buffer, mimeType: string): { uri: string; bytes: number } | null {
  return putBinaryBlob(buffer, mimeType, 'image');
}

/**
 * Store binary media data as a resource
 */
export function putMediaBlob(buffer: Buffer, mimeType: string): { uri: string; bytes: number } | null {
  return putBinaryBlob(buffer, mimeType, 'media');
}

function putBinaryBlob(buffer: Buffer, mimeType: string, type: 'image' | 'media'): { uri: string; bytes: number } | null {
  const config = getConfig();

  // Convert to base64 first, then check size limit against actual stored size
  // (base64 encoding expands data by ~33%)
  const base64Data = buffer.toString('base64');
  const storedBytes = base64Data.length;

  // Check size limit against actual stored size
  if (storedBytes > config.maxResourceBytes) {
    return null;
  }

  // Evict if needed
  evictIfNeeded();

  const id = randomUUID();
  const entry: ResourceEntry = {
    id,
    type,
    mimeType,
    data: base64Data,
    bytes: storedBytes,
    createdAt: Date.now(),
  };

  cache.set(id, entry);
  updateAccessOrder(id);

  return {
    uri: makeUri(type, id),
    bytes: storedBytes,
  };
}

/**
 * Store base64-encoded image data
 */
export function putBase64Image(
  base64: string,
  mimeType: string
): { uri: string; bytes: number } | null {
  const config = getConfig();

  // Remove data URL prefix if present
  const cleanBase64 = base64.replace(/^data:[^,]+,/, '');
  const bytes = cleanBase64.length; // Track actual stored string size

  // Check size limit
  if (bytes > config.maxResourceBytes) {
    return null;
  }

  // Evict if needed
  evictIfNeeded();

  const id = randomUUID();
  const entry: ResourceEntry = {
    id,
    type: 'image',
    mimeType,
    data: cleanBase64,
    bytes,
    createdAt: Date.now(),
  };

  cache.set(id, entry);
  updateAccessOrder(id);

  return {
    uri: makeUri('image', id),
    bytes,
  };
}

export interface ResourceReadResult {
  mimeType: string;
  text?: string;
  blob?: string;
}

/**
 * Read a resource by URI
 */
export function read(uri: string): ResourceReadResult | null {
  const parsed = parseUri(uri);
  if (!parsed) return null;

  const entry = cache.get(parsed.id);
  if (!entry) return null;

  // Update access order
  updateAccessOrder(parsed.id);

  if (entry.type === 'raw') {
    return {
      mimeType: entry.mimeType,
      text: entry.data,
    };
  } else {
    return {
      mimeType: entry.mimeType,
      blob: entry.data,
    };
  }
}

/**
 * List all cached resources (for resources/list)
 */
export function listResources(): Array<{ uri: string; name: string; mimeType: string }> {
  const result: Array<{ uri: string; name: string; mimeType: string }> = [];

  for (const [id, entry] of cache.entries()) {
    result.push({
      uri: makeUri(entry.type, id),
      name: entry.type === 'raw' ? 'Raw response' : entry.type === 'image' ? 'Generated image' : 'Generated media',
      mimeType: entry.mimeType,
    });
  }

  return result;
}

/**
 * Clear all cached resources (for graceful shutdown)
 */
export function clearCache(): void {
  cache.clear();
  accessOrder.length = 0;
}

/**
 * Get cache statistics (for debugging)
 */
export function getCacheStats(): { count: number; totalBytes: number } {
  let totalBytes = 0;
  for (const entry of cache.values()) {
    totalBytes += entry.bytes;
  }
  return {
    count: cache.size,
    totalBytes,
  };
}
