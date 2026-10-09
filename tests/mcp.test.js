/**
 * Automated tests for NanoGPT MCP server
 *
 * Spawns the built server (dist/index.js) over stdio against an in-process
 * mock of the NanoGPT API, so no API key or network access is needed.
 *
 * Run with: npm run build && node --test tests/mcp.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import http from 'node:http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
const PACKAGE_VERSION = packageJson.version;

const MCP_SERVER_PATH = join(__dirname, '..', 'dist', 'index.js');

function readJson(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (chunk) => {
      buf += chunk.toString('utf-8');
    });
    req.on('end', () => {
      if (!buf) return resolve({});
      try {
        resolve(JSON.parse(buf));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const videoStatusPolls = new Map();

async function startMockNanoGptServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');

    res.setHeader('content-type', 'application/json');

    if (req.method === 'POST' && url.pathname === '/api/check-balance') {
      res.statusCode = 200;
      res.end(JSON.stringify({ usd_balance: '1.23', nano_balance: '4.56' }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/models') {
      res.statusCode = 200;
      res.end(JSON.stringify({ data: [{ id: 'gpt-4.1-nano' }] }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/image-models') {
      res.statusCode = 200;
      res.end(JSON.stringify({ data: [{ id: 'image-1' }] }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/audio-models') {
      res.statusCode = 200;
      res.end(JSON.stringify({ data: [{ id: 'tts-1' }] }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/video-models') {
      const models = Array.from({ length: 30 }, (_, i) => ({ id: `video-${i + 1}` }));
      res.statusCode = 200;
      res.end(JSON.stringify({ data: models }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      let body = {};
      try {
        body = await readJson(req);
      } catch {
        body = {};
      }

      if (!body || typeof body.model !== 'string' || !body.model) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: 'No model specified' } }));
        return;
      }

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          choices: [{ message: { content: 'test passed' } }],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        })
      );
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/v1/embeddings') {
      res.statusCode = 200;
      res.end(JSON.stringify({
        object: 'list',
        data: [{ object: 'embedding', embedding: [0.1, 0.2, 0.3], index: 0 }],
        usage: { prompt_tokens: 2, total_tokens: 2 },
      }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/v1/ai-detection') {
      res.statusCode = 200;
      res.end(JSON.stringify({
        object: 'ai_detection.result',
        mode: 'ai',
        content: 'Likely human-written.',
        result: { score: 0.12 },
        usage: { total_tokens: 10 },
      }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/scrape-urls') {
      const body = await readJson(req);
      const urlToScrape = Array.isArray(body.urls) && typeof body.urls[0] === 'string'
        ? body.urls[0]
        : 'https://example.com';
      const content = `Plain-text scrape ${'x'.repeat(150)} COMPLETE_CONTENT`;
      const markdown = `# Complete scrape\n\n${'Full markdown content. '.repeat(12)}END_OF_SCRAPED_DOCUMENT`;

      res.statusCode = 200;
      res.end(JSON.stringify({
        results: [{
          url: urlToScrape,
          success: true,
          title: 'Example documentation',
          content,
          markdown,
        }],
        summary: { successful: 1, failed: 0 },
      }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/images/edits') {
      res.statusCode = 200;
      res.end(JSON.stringify({
        data: [{ url: 'https://example.com/edited.png' }],
      }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/images/generations') {
      let body = {};
      try {
        body = await readJson(req);
      } catch {
        body = {};
      }

      res.statusCode = 200;
      res.end(JSON.stringify({
        data: [{
          url: body.model === 'qrbtf-g1'
            ? 'https://example.com/ai-qr.png'
            : 'https://example.com/generated.png',
        }],
        provider: body.model === 'qrbtf-g1' ? 'qrbtf' : 'mock-image',
      }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/v1/audio/transcriptions') {
      res.statusCode = 200;
      res.end(JSON.stringify({ text: 'mock transcript', language: 'en', duration: 1.5 }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/v1/audio/speech') {
      res.statusCode = 200;
      res.setHeader('content-type', 'audio/mpeg');
      res.end(Buffer.from('mock audio bytes'));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/3d-models') {
      res.statusCode = 200;
      res.end(JSON.stringify({ data: [{ id: 'model3d-1' }, { id: 'model3d-2' }] }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/generate-video') {
      let body = {};
      try {
        body = await readJson(req);
      } catch {
        body = {};
      }
      if (body.prompt === 'slow-submit') {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      // Mirrors the production 202 response: runId/requestId/id share one value.
      const promptRunIds = {
        flaky: 'vid_flaky',
        slow: 'vid_slow',
        fails: 'vid_failed',
        forbidden: 'vid_forbidden',
        missing: 'vid_missing',
        'relative-url': 'vid_relative',
        hang: 'vid_hang',
        stall: 'vid_stall',
        'slow-submit': 'vid_slow_submit',
      };
      const runId = body.model === 'model3d-1' ? 'vid_3d' : promptRunIds[body.prompt] || 'vid_video';
      res.statusCode = 202;
      res.end(JSON.stringify({
        runId,
        id: runId,
        requestId: runId,
        status: 'pending',
        model: body.model || 'video-1',
      }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/video/status') {
      // Like production, only requestId/runId identify the job.
      const id = url.searchParams.get('runId') || url.searchParams.get('requestId');
      if (!id) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing requestId parameter' }));
        return;
      }
      const polls = (videoStatusPolls.get(id) || 0) + 1;
      videoStatusPolls.set(id, polls);

      if (id === 'vid_flaky' && polls === 2) {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: 'Service temporarily unavailable' }));
        return;
      }
      if (id === 'vid_forbidden') {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }
      if (id === 'vid_missing' && polls === 1) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Video generation request not found' }));
        return;
      }
      if (id === 'vid_hang') {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      if (id === 'vid_stall') {
        // Headers and part of the body arrive, then the body stalls.
        res.statusCode = 200;
        res.write('{"requestId":"vid_stall","data":');
        setTimeout(() => res.end('{"status":"IN_PROGRESS"}}'), 5000);
        return;
      }

      // Production nests the job state under `data`.
      const model = url.searchParams.get('modelSlug') || 'video-1';
      if (id === 'vid_failed') {
        res.statusCode = 200;
        res.end(JSON.stringify({
          requestId: id,
          data: { status: 'FAILED', request_id: id, error: 'Provider rejected the prompt' },
          model,
        }));
        return;
      }
      const neverDone = new Set(['vid_slow', 'vid_hang', 'vid_slow_submit']);
      const done = id === 'vid_done' || (!neverDone.has(id) && polls >= 3);
      const output = id === 'vid_3d'
        ? {
            kind: '3d',
            format: 'glb',
            model_url: 'https://example.com/model.glb',
            model3d_assets: [{ label: 'GLB', url: 'https://example.com/model.glb' }],
          }
        : id === 'vid_relative'
          ? {
              video: { url: '/api/generate-video/content?model=video-relative-url&runId=vid_relative' },
              videoUrls: ['/api/generate-video/content?model=video-relative-url&runId=vid_relative'],
            }
          : { video: { url: 'https://example.com/video.mp4' }, videoUrls: ['https://example.com/video.mp4'] };
      res.statusCode = 200;
      res.end(JSON.stringify({
        requestId: id,
        data: done
          ? { status: 'COMPLETED', request_id: id, output }
          : { status: 'IN_PROGRESS', request_id: id },
        model,
      }));
      return;
    }

    const scraperPaths = new Set([
      '/api/v1/firecrawl',
      '/api/v1/reddit',
      '/api/v1/googlemaps',
      '/api/v1/googlemaps/reviews',
      '/api/v1/facebook/ads',
      '/api/v1/facebook/posts',
      '/api/v1/instagram/profile',
      '/api/v1/instagram/posts',
      '/api/v1/instagram/reels',
      '/api/v1/linkedin/profile',
      '/api/v1/tiktok',
    ]);
    if (req.method === 'POST' && scraperPaths.has(url.pathname)) {
      let body = {};
      try {
        body = await readJson(req);
      } catch {
        body = {};
      }

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          object: `${url.pathname.slice('/api/v1/'.length).replaceAll('/', '.')}.scrape`,
          actor: 'mock-actor',
          name: 'Mock Scraper',
          model: 'mock-scraper',
          status: 'SUCCEEDED',
          runId: 'mock-run',
          defaultDatasetId: 'mock-dataset',
          items: [{ title: 'Mock item', url: 'https://example.com', input: body }],
          usage: {
            chargedEventCounts: { result: 1 },
            actualCostUsd: 0.001,
            estimatedMaxChargeUsd: 0.01,
            paymentSource: 'USD',
          },
          metadata: { resultLimit: body.resultLimit || 1 },
        })
      );
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/v1/x')) {
      const endpoint = url.pathname.slice('/api/v1/x/'.length) || 'endpoints';
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          data: endpoint === 'endpoints'
            ? { endpoints: ['GET /api/v1/x/search?query=...'] }
            : { data: [{ id: 'x-post-1', text: 'Mock X result' }], meta: { result_count: 1 } },
          billing: endpoint === 'endpoints' ? undefined : {
            estimated_usd: 0.002,
            actual_usd: 0.001,
          },
        })
      );
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/v1/hunter') {
      let body = {};
      try {
        body = await readJson(req);
      } catch {
        body = {};
      }

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          data: body.endpoint
            ? { email: 'test@example.com', domain: body.params?.domain || 'example.com' }
            : [{ path: 'domain-search', displayName: 'Hunter Domain Search' }],
          meta: {
            nanogpt: {
              endpoint: body.endpoint || 'endpoints',
              costUsd: body.endpoint ? 0.001 : 0,
            },
          },
          status: 200,
        })
      );
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: { message: `Not found: ${req.method} ${url.pathname}` } }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  return { server, baseUrl };
}

// Helper to send JSON-RPC messages to MCP server
class McpTestClient {
  constructor({ baseUrl, apiKey }) {
    this.process = null;
    this.pendingRequests = new Map();
    this.requestId = 0;
    this.buffer = '';
    this.initialized = false;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async start(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      let resolved = false;

      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.stop();
          reject(new Error(`Server failed to become ready within ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.process = spawn('node', [MCP_SERVER_PATH], {
        env: {
          ...process.env,
          NANOGPT_BASE_URL: this.baseUrl,
          NANOGPT_API_KEY: this.apiKey,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.stdout.on('data', (data) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.process.stderr.on('data', (data) => {
        const msg = data.toString();
        // Check for server ready message
        if (msg.includes('connected and ready') && !resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          resolve();
        }
        // Only log non-info messages for debugging
        if (!msg.includes('[INFO]')) {
          console.error('MCP stderr:', msg);
        }
      });

      this.process.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          reject(err);
        }
      });

      this.process.on('exit', (code) => {
        if (!resolved && code !== 0) {
          resolved = true;
          clearTimeout(timeoutId);
          reject(new Error(`Server process exited with code ${code}`));
        }
      });
    });
  }

  processBuffer() {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined) {
          const resolver = this.pendingRequests.get(msg.id);
          if (resolver) {
            this.pendingRequests.delete(msg.id);
            resolver(msg);
          }
        }
      } catch (e) {
        // Not JSON, skip
      }
    }
  }

  async send(method, params = undefined) {
    const id = ++this.requestId;
    const msg = {
      jsonrpc: '2.0',
      method,
      id,
    };
    if (params !== undefined) {
      msg.params = params;
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${method} timed out`));
        }
      }, 30000);
      
      this.pendingRequests.set(id, (msg) => {
        clearTimeout(timeoutId);
        resolve(msg);
      });
      this.process.stdin.write(JSON.stringify(msg) + '\n');
    });
  }

  async sendNotification(method, params = undefined) {
    const msg = {
      jsonrpc: '2.0',
      method,
    };
    if (params !== undefined) {
      msg.params = params;
    }
    this.process.stdin.write(JSON.stringify(msg) + '\n');
  }

  async initialize() {
    const response = await this.send('initialize', {
      protocolVersion: '2024-10-07',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    });
    await this.sendNotification('notifications/initialized');
    this.initialized = true;
    return response;
  }

  async callTool(name, args = {}) {
    return this.send('tools/call', { name, arguments: args });
  }

  async listTools() {
    return this.send('tools/list');
  }

  async stop() {
    if (this.process) {
      this.process.stdin.end();
      this.process.kill();
      this.process = null;
    }
  }
}

describe('NanoGPT MCP Server', () => {
  let client;
  let initResponse;
  let mock;

  before(async () => {
    mock = await startMockNanoGptServer();
    client = new McpTestClient({ baseUrl: mock.baseUrl, apiKey: 'test-key' });
    await client.start();
    initResponse = await client.initialize();
  });

  after(async () => {
    await client.stop();
    await new Promise((resolve) => mock.server.close(resolve));
  });

  test('should have initialized successfully', async () => {
    assert.ok(initResponse.result, 'Response should have result');
    assert.strictEqual(initResponse.result.serverInfo.name, 'nanogpt-mcp');
    assert.strictEqual(initResponse.result.serverInfo.version, PACKAGE_VERSION);
    assert.ok(initResponse.result.capabilities.tools, 'Should have tools capability');
    assert.ok(client.initialized, 'Client should be marked as initialized');
  });

  test('should list all 34 tools', async () => {
    const response = await client.listTools();
    assert.ok(response.result, 'Response should have result');
    assert.ok(Array.isArray(response.result.tools), 'Tools should be an array');
    assert.strictEqual(response.result.tools.length, 34, 'Should have 34 tools');

    const toolNames = response.result.tools.map((t) => t.name).sort();
    const expectedTools = [
      'nanogpt_3d_generate',
      'nanogpt_ai_detection',
      'nanogpt_ai_qr',
      'nanogpt_audio_transcribe',
      'nanogpt_chat',
      'nanogpt_embeddings',
      'nanogpt_facebook_ads',
      'nanogpt_facebook_posts_scrape',
      'nanogpt_firecrawl',
      'nanogpt_get_balance',
      'nanogpt_google_maps_reviews_scrape',
      'nanogpt_google_maps_scrape',
      'nanogpt_hunter',
      'nanogpt_image_edit',
      'nanogpt_image_generate',
      'nanogpt_instagram_posts_scrape',
      'nanogpt_instagram_profile',
      'nanogpt_instagram_reels',
      'nanogpt_linkedin_profile',
      'nanogpt_list_3d_models',
      'nanogpt_list_audio_models',
      'nanogpt_list_image_models',
      'nanogpt_list_text_models',
      'nanogpt_list_video_models',
      'nanogpt_music_generate',
      'nanogpt_reddit',
      'nanogpt_scrape_urls',
      'nanogpt_text_to_speech',
      'nanogpt_tiktok_scrape',
      'nanogpt_video_generate',
      'nanogpt_vision',
      'nanogpt_web_search',
      'nanogpt_x_research',
      'nanogpt_youtube_transcribe',
    ];
    assert.deepStrictEqual(toolNames, expectedTools, 'Should have all expected tools');

    const scrapeTool = response.result.tools.find((tool) => tool.name === 'nanogpt_scrape_urls');
    assert.ok(scrapeTool.outputSchema, 'nanogpt_scrape_urls should advertise its output schema');
    assert.ok(scrapeTool.outputSchema.properties?.results, 'output schema should describe results');
    assert.ok(scrapeTool.outputSchema.properties?.summary, 'output schema should describe summary');
  });

  test('nanogpt_scrape_urls should return the complete scraped document in text content', async () => {
    const response = await client.callTool('nanogpt_scrape_urls', {
      urls: ['https://example.com/docs'],
    });

    assert.ok(response.result, 'Response should have result');
    assert.ok(response.result.structuredContent, 'Should have structuredContent');
    assert.strictEqual(response.result.structuredContent.results.length, 1);

    const textItem = response.result.content.find((item) => item?.type === 'text');
    assert.ok(textItem, 'Should include a text content item');
    assert.ok(textItem.text.includes('# Complete scrape'), 'Text should use scraped markdown when available');
    assert.ok(
      textItem.text.includes('END_OF_SCRAPED_DOCUMENT'),
      'Text should include content beyond the old 100-character preview'
    );
    assert.ok(!textItem.text.includes('COMPLETE_CONTENT'), 'Text should not duplicate plain text when markdown is available');
    assert.ok(textItem.text.includes('Summary: 1 succeeded, 0 failed'), 'Text should include the scrape summary');
  });

  test('nanogpt_get_balance should return balance info', async () => {
    const response = await client.callTool('nanogpt_get_balance', {});
    assert.ok(response.result, 'Response should have result');
    assert.ok(response.result.content, 'Should have content');
    assert.ok(response.result.structuredContent, 'Should have structuredContent');

    const structured = response.result.structuredContent;
    assert.ok(typeof structured.usd_balance === 'number', 'usd_balance should be a number');
    assert.ok(typeof structured.nano_balance === 'number', 'nano_balance should be a number');
  });

  test('nanogpt_list_text_models should return models', async () => {
    const response = await client.callTool('nanogpt_list_text_models', {});
    assert.ok(response.result, 'Response should have result');
    assert.ok(response.result.structuredContent, 'Should have structuredContent');
    assert.ok(Array.isArray(response.result.structuredContent.data), 'data should be an array');
    assert.ok(response.result.structuredContent.data.length > 0, 'Should have at least one model');
  });

  test('nanogpt_list_image_models should return models', async () => {
    const response = await client.callTool('nanogpt_list_image_models', {});
    assert.ok(response.result, 'Response should have result');
    assert.ok(response.result.structuredContent, 'Should have structuredContent');
    assert.ok(Array.isArray(response.result.structuredContent.data), 'data should be an array');
  });

  test('nanogpt_list_video_models should include preview in content', async () => {
    const response = await client.callTool('nanogpt_list_video_models', {});
    assert.ok(response.result, 'Response should have result');
    assert.ok(response.result.content, 'Should have content');
    assert.ok(response.result.structuredContent, 'Should have structuredContent');

    const structured = response.result.structuredContent;
    assert.ok(Array.isArray(structured.data), 'data should be an array');
    assert.ok(structured.data.length > 0, 'Should have at least one video model');

    const content = response.result.content;
    const textItem = content.find((c) => c && c.type === 'text');
    assert.ok(textItem, 'Should include a text content item');
    assert.ok(typeof textItem.text === 'string', 'Text content should be a string');
    assert.ok(textItem.text.includes('Found '), 'Text should include model count');
    assert.ok(textItem.text.includes('Preview (first 20):'), 'Text should include preview section');

    const linkItem = content.find((c) => c && c.type === 'resource_link');
    if (linkItem) {
      assert.ok(typeof linkItem.uri === 'string', 'resource_link uri should be a string');
      assert.ok(linkItem.uri.startsWith('nanogpt://raw/'), `resource_link should point to nanogpt://raw/*, got: ${linkItem.uri}`);
    }
  });

  test('nanogpt_chat without model should fail with InvalidRequest', async () => {
    // No default model set, so this should fail
    const response = await client.callTool('nanogpt_chat', {
      messages: [{ role: 'user', content: 'Hello' }],
    });

    // Should either succeed (if NANOGPT_DEFAULT_MODEL is set) or fail with InvalidRequest
    if (response.error) {
      const errorMsg = String(response.error.message || '');
      assert.ok(errorMsg.includes('No model specified'), `Should mention no model, got: ${errorMsg}`);
    } else {
      // If it succeeded, that's fine too (means default model was set)
      assert.ok(response.result, 'Response should have result');
    }
  });

  test('nanogpt_chat with model should return response', async () => {
    const response = await client.callTool('nanogpt_chat', {
      messages: [{ role: 'user', content: 'Say "test passed" and nothing else' }],
      model: 'gpt-4.1-nano',
      max_tokens: 50,
    });

    assert.ok(response.result, 'Response should have result');
    assert.ok(response.result.content, 'Should have content');
    assert.ok(response.result.structuredContent, 'Should have structuredContent');
    assert.ok(typeof response.result.structuredContent.content === 'string', 'content should be string');
  });

  test('nanogpt_vision should return response', async () => {
    const response = await client.callTool('nanogpt_vision', {
      prompt: 'What is in this image?',
      image_url: 'https://example.com/test.jpg',
      model: 'gpt-4.1-nano',
    });

    assert.ok(response.result, 'Response should have result');
    assert.ok(response.result.content, 'Should have content');
    assert.ok(response.result.structuredContent, 'Should have structuredContent');
    assert.ok(typeof response.result.structuredContent.content === 'string', 'content should be string');
  });

  test('application scraper tools should return items and usage', async () => {
    const cases = [
      {
        name: 'nanogpt_firecrawl',
        args: { operation: 'scrape', url: 'https://example.com', resultLimit: 1 },
      },
      {
        name: 'nanogpt_reddit',
        args: { searches: ['nanogpt'], maxItems: 1, resultLimit: 1 },
      },
      {
        name: 'nanogpt_google_maps_scrape',
        args: { searchStringsArray: ['coffee shops in Amsterdam'], maxCrawledPlacesPerSearch: 1, resultLimit: 1 },
      },
      {
        name: 'nanogpt_google_maps_reviews_scrape',
        args: { placeIds: ['mock-place-id'], maxReviews: 1, resultLimit: 1 },
      },
      {
        name: 'nanogpt_facebook_posts_scrape',
        args: { startUrls: ['https://www.facebook.com/nanogpt'], resultsLimit: 1, resultLimit: 1 },
      },
      {
        name: 'nanogpt_facebook_ads',
        args: { startUrls: ['https://www.facebook.com/ads/library/?id=1'], resultsLimit: 1, resultLimit: 1 },
      },
      {
        name: 'nanogpt_instagram_profile',
        args: { usernames: ['instagram'], resultLimit: 1 },
      },
      {
        name: 'nanogpt_instagram_posts_scrape',
        args: { username: ['instagram'], resultsLimit: 1, resultLimit: 1 },
      },
      {
        name: 'nanogpt_instagram_reels',
        args: { username: ['instagram'], resultsLimit: 1, resultLimit: 1 },
      },
      {
        name: 'nanogpt_linkedin_profile',
        args: { profileUrls: ['https://www.linkedin.com/in/example/'], resultLimit: 1 },
      },
      {
        name: 'nanogpt_tiktok_scrape',
        args: { profiles: ['tiktok'], resultsPerPage: 1, resultLimit: 1 },
      },
    ];

    for (const testCase of cases) {
      const response = await client.callTool(testCase.name, testCase.args);
      assert.ok(response.result, `${testCase.name} should have result`);
      assert.ok(response.result.content, `${testCase.name} should have content`);
      assert.ok(response.result.structuredContent, `${testCase.name} should have structuredContent`);
      assert.ok(Array.isArray(response.result.structuredContent.items), `${testCase.name} items should be an array`);
      assert.strictEqual(response.result.structuredContent.items.length, 1, `${testCase.name} should return one mock item`);
      assert.strictEqual(response.result.structuredContent.usage.actualCostUsd, 0.001, `${testCase.name} should return usage`);
    }
  });

  test('research tools should return data', async () => {
    const xResponse = await client.callTool('nanogpt_x_research', {
      endpoint: 'search',
      params: { query: 'NanoGPT', limit: 10 },
    });
    assert.ok(xResponse.result, 'nanogpt_x_research should have result');
    assert.ok(xResponse.result.structuredContent, 'nanogpt_x_research should have structuredContent');
    assert.ok(xResponse.result.structuredContent.data, 'nanogpt_x_research should return data');

    const hunterResponse = await client.callTool('nanogpt_hunter', {
      endpoint: 'domain-search',
      params: { domain: 'example.com' },
    });
    assert.ok(hunterResponse.result, 'nanogpt_hunter should have result');
    assert.ok(hunterResponse.result.structuredContent, 'nanogpt_hunter should have structuredContent');
    assert.ok(hunterResponse.result.structuredContent.data, 'nanogpt_hunter should return data');
  });

  test('additional generation and analysis tools should return data/resources', async () => {
    const embeddingsResponse = await client.callTool('nanogpt_embeddings', {
      input: 'hello',
      model: 'text-embedding-3-small',
    });
    assert.ok(embeddingsResponse.result?.structuredContent?.data, 'nanogpt_embeddings should return data');

    const detectionResponse = await client.callTool('nanogpt_ai_detection', {
      text: 'This is a short test.',
      mode: 'ai',
    });
    assert.ok(detectionResponse.result?.structuredContent?.data, 'nanogpt_ai_detection should return data');

    const aiQrResponse = await client.callTool('nanogpt_ai_qr', {
      value: 'https://nano-gpt.com',
      prompt: 'clean geometric blueprint style',
    });
    assert.ok(Array.isArray(aiQrResponse.result?.structuredContent?.images), 'nanogpt_ai_qr should return images');
    assert.strictEqual(
      aiQrResponse.result.structuredContent.images[0].url,
      'https://example.com/ai-qr.png',
      'nanogpt_ai_qr should route to the QR image model'
    );

    const imageEditResponse = await client.callTool('nanogpt_image_edit', {
      prompt: 'Make it brighter',
      imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    });
    assert.ok(Array.isArray(imageEditResponse.result?.structuredContent?.images), 'nanogpt_image_edit should return images');

    const transcriptResponse = await client.callTool('nanogpt_audio_transcribe', {
      audio_url: 'https://example.com/audio.mp3',
    });
    assert.ok(transcriptResponse.result?.structuredContent?.data, 'nanogpt_audio_transcribe should return data');

    const speechResponse = await client.callTool('nanogpt_text_to_speech', {
      input: 'Hello from NanoGPT',
      include_raw: true,
    });
    assert.ok(speechResponse.result?.structuredContent?.audio?.uri, 'nanogpt_text_to_speech should return audio resource');
    assert.ok(
      speechResponse.result.structuredContent.audio.uri.startsWith('nanogpt://media/'),
      'audio resource should use nanogpt://media/*'
    );
    assert.ok(speechResponse.result.structuredContent.raw, 'nanogpt_text_to_speech should honor include_raw for binary responses');

    const musicResponse = await client.callTool('nanogpt_music_generate', {
      input: 'ambient synth loop',
    });
    assert.ok(musicResponse.result?.structuredContent?.audio?.uri, 'nanogpt_music_generate should return audio resource');

    const videoSubmitResponse = await client.callTool('nanogpt_video_generate', {
      operation: 'submit',
      model: 'video-1',
      prompt: 'A calm ocean wave',
    });
    assert.strictEqual(
      videoSubmitResponse.result?.structuredContent?.data?.runId,
      'vid_video',
      'nanogpt_video_generate submit should return the run id'
    );

    const videoStatusResponse = await client.callTool('nanogpt_video_generate', {
      operation: 'status',
      runId: 'vid_done',
    });
    assert.strictEqual(
      videoStatusResponse.result?.structuredContent?.data?.data?.status,
      'COMPLETED',
      'nanogpt_video_generate status should return the nested job status'
    );
    const videoStatusText = videoStatusResponse.result.content.find((item) => item?.type === 'text')?.text || '';
    assert.ok(videoStatusText.includes('status COMPLETED'), 'status summary should read the nested status');
    assert.ok(videoStatusText.includes('https://example.com/video.mp4'), 'status summary should include the video URL');
  });

  test('nanogpt_video_generate submit_and_poll should stop at the nested COMPLETED status', async () => {
    const response = await client.callTool('nanogpt_video_generate', {
      operation: 'submit_and_poll',
      model: 'video-1',
      prompt: 'A calm ocean wave',
      poll_interval_ms: 1000,
      timeout_ms: 30000,
    });
    assert.ok(response.result, `Should succeed: ${JSON.stringify(response.error)}`);
    assert.strictEqual(response.result.structuredContent.status.data.status, 'COMPLETED');
    assert.deepStrictEqual(response.result.structuredContent.urls, ['https://example.com/video.mp4']);
    assert.strictEqual(videoStatusPolls.get('vid_video'), 3, 'Polling should stop at the first COMPLETED status');
    const text = response.result.content.find((item) => item?.type === 'text')?.text || '';
    assert.ok(text.includes('https://example.com/video.mp4'), 'Text should include the video URL');
  });

  test('nanogpt_video_generate submit_and_poll should stop at FAILED and surface the error', async () => {
    const response = await client.callTool('nanogpt_video_generate', {
      operation: 'submit_and_poll',
      model: 'video-1',
      prompt: 'fails',
      poll_interval_ms: 1000,
      timeout_ms: 30000,
    });
    assert.ok(response.result, `Should succeed: ${JSON.stringify(response.error)}`);
    assert.strictEqual(videoStatusPolls.get('vid_failed'), 1, 'Polling should stop at FAILED');
    const text = response.result.content.find((item) => item?.type === 'text')?.text || '';
    assert.ok(text.includes('status FAILED'), `Unexpected text: ${text}`);
    assert.ok(text.includes('Provider rejected the prompt'), 'Text should include the failure reason');
  });

  test('nanogpt_video_generate submit_and_poll should return the run id when a status check fails permanently', async () => {
    const response = await client.callTool('nanogpt_video_generate', {
      operation: 'submit_and_poll',
      model: 'video-1',
      prompt: 'forbidden',
      poll_interval_ms: 1000,
      timeout_ms: 30000,
    });
    assert.ok(response.result, `Should return a result: ${JSON.stringify(response.error)}`);
    assert.strictEqual(response.result.isError, true, 'A failed status check should be an error result');
    assert.strictEqual(response.result.structuredContent.runId, 'vid_forbidden');
    assert.strictEqual(response.result.structuredContent.submission.runId, 'vid_forbidden');
    assert.strictEqual(videoStatusPolls.get('vid_forbidden'), 1, 'Permanent errors should not be retried');
    const text = response.result.content.find((item) => item?.type === 'text')?.text || '';
    assert.ok(text.includes('vid_forbidden') && text.includes('"poll"'), `Unexpected text: ${text}`);
  });

  test('nanogpt_video_generate submit_and_poll should tolerate a not-found status right after submit', async () => {
    const response = await client.callTool('nanogpt_video_generate', {
      operation: 'submit_and_poll',
      model: 'video-1',
      prompt: 'missing',
      poll_interval_ms: 1000,
      timeout_ms: 30000,
    });
    assert.ok(response.result, `Should succeed: ${JSON.stringify(response.error)}`);
    assert.strictEqual(response.result.structuredContent.status.data.status, 'COMPLETED');
  });

  test('nanogpt_video_generate poll should wait on an existing run id', async () => {
    const response = await client.callTool('nanogpt_video_generate', {
      operation: 'poll',
      runId: 'vid_done',
      timeout_ms: 30000,
    });
    assert.ok(response.result, `Should succeed: ${JSON.stringify(response.error)}`);
    assert.strictEqual(response.result.structuredContent.status.data.status, 'COMPLETED');
    assert.strictEqual(response.result.structuredContent.submission, undefined);
    assert.deepStrictEqual(response.result.structuredContent.urls, ['https://example.com/video.mp4']);

    const jobIdResponse = await client.callTool('nanogpt_video_generate', {
      operation: 'poll',
      jobId: 'vid_done',
      timeout_ms: 30000,
    });
    assert.ok(jobIdResponse.result, `jobId alias should work: ${JSON.stringify(jobIdResponse.error)}`);
    assert.strictEqual(jobIdResponse.result.isError, undefined, 'jobId alias should not fail');
    assert.strictEqual(jobIdResponse.result.structuredContent.status.data.status, 'COMPLETED');

    const missingId = await client.callTool('nanogpt_video_generate', { operation: 'poll' });
    assert.ok(missingId.error || missingId.result?.isError, 'poll without a run id should fail');
  });

  test('nanogpt_video_generate should resolve server-relative output URLs', async () => {
    const response = await client.callTool('nanogpt_video_generate', {
      operation: 'submit_and_poll',
      model: 'video-relative-url',
      prompt: 'relative-url',
      poll_interval_ms: 1000,
      timeout_ms: 30000,
    });
    assert.ok(response.result, `Should succeed: ${JSON.stringify(response.error)}`);
    const [videoUrl] = response.result.structuredContent.urls;
    assert.ok(
      /^http:\/\/127\.0\.0\.1:\d+\/api\/generate-video\/content\?model=video-relative-url&runId=vid_relative$/.test(videoUrl),
      `Unexpected URL: ${videoUrl}`
    );
  });

  test('nanogpt_video_generate timeout_ms should include submission time', async () => {
    const startedAt = Date.now();
    const response = await client.callTool('nanogpt_video_generate', {
      operation: 'submit_and_poll',
      model: 'video-1',
      prompt: 'slow-submit',
      poll_interval_ms: 1000,
      timeout_ms: 3000,
    });
    const elapsed = Date.now() - startedAt;
    assert.ok(response.result, `Should succeed: ${JSON.stringify(response.error)}`);
    assert.ok(elapsed < 4000, `Submission time should count toward timeout_ms, took ${elapsed} ms`);
    assert.strictEqual(response.result.structuredContent.runId, 'vid_slow_submit');
  });

  test('nanogpt_video_generate timeout_ms should bound a stalled response body', async () => {
    const startedAt = Date.now();
    const response = await client.callTool('nanogpt_video_generate', {
      operation: 'submit_and_poll',
      model: 'video-1',
      prompt: 'stall',
      poll_interval_ms: 1000,
      timeout_ms: 2000,
    });
    const elapsed = Date.now() - startedAt;
    assert.ok(response.result, `Should succeed: ${JSON.stringify(response.error)}`);
    assert.ok(elapsed < 4000, `A stalled body should not outlive timeout_ms, took ${elapsed} ms`);
    assert.ok(response.result.structuredContent.lastPollError?.includes('timed out'), 'Should report the poll timeout');
  });

  test('nanogpt_video_generate submit_and_poll should support include_raw', async () => {
    const response = await client.callTool('nanogpt_video_generate', {
      operation: 'submit_and_poll',
      model: 'video-1',
      prompt: 'A calm ocean wave',
      poll_interval_ms: 1000,
      timeout_ms: 30000,
      include_raw: true,
    });
    assert.ok(response.result, `include_raw should not break the result: ${JSON.stringify(response.error)}`);
    assert.ok(response.result.structuredContent.raw, 'Should include raw output');
    assert.ok(response.result.structuredContent.runId, 'Should include the run id');
  });

  test('nanogpt_video_generate timeout_ms should bound a hanging status request', async () => {
    const startedAt = Date.now();
    const response = await client.callTool('nanogpt_video_generate', {
      operation: 'submit_and_poll',
      model: 'video-1',
      prompt: 'hang',
      poll_interval_ms: 1000,
      timeout_ms: 2000,
    });
    const elapsed = Date.now() - startedAt;
    assert.ok(response.result, `Should succeed: ${JSON.stringify(response.error)}`);
    assert.ok(elapsed < 4000, `Should return within the timeout budget, took ${elapsed} ms`);
    const text = response.result.content.find((item) => item?.type === 'text')?.text || '';
    assert.ok(text.includes('still running'), `Unexpected text: ${text}`);
  });

  test('nanogpt_video_generate submit_and_poll should survive a transient status failure', async () => {
    const response = await client.callTool('nanogpt_video_generate', {
      operation: 'submit_and_poll',
      model: 'video-1',
      prompt: 'flaky',
      poll_interval_ms: 1000,
      timeout_ms: 30000,
    });
    assert.ok(response.result, `Should succeed: ${JSON.stringify(response.error)}`);
    assert.strictEqual(response.result.structuredContent.status.data.status, 'COMPLETED');
    assert.strictEqual(response.result.structuredContent.lastPollError, undefined);
  });

  test('nanogpt_video_generate submit_and_poll should return the job id when the timeout elapses', async () => {
    const response = await client.callTool('nanogpt_video_generate', {
      operation: 'submit_and_poll',
      model: 'video-1',
      prompt: 'slow',
      poll_interval_ms: 1000,
      timeout_ms: 2500,
    });
    assert.ok(response.result, `Should succeed: ${JSON.stringify(response.error)}`);
    const text = response.result.content.find((item) => item?.type === 'text')?.text || '';
    assert.ok(text.includes('still running after 2s'), `Text should report the real elapsed time: ${text}`);
    assert.ok(text.includes('vid_slow'), 'Text should include the run id for a later status check');
    assert.ok(!text.includes('completed'), 'Text must not claim completion');
  });

  test('nanogpt_list_3d_models and nanogpt_3d_generate should return the GLB URL', async () => {
    const listResponse = await client.callTool('nanogpt_list_3d_models', {});
    assert.strictEqual(listResponse.result?.structuredContent?.data?.length, 2, 'Should list 3D models');

    const response = await client.callTool('nanogpt_3d_generate', {
      model: 'model3d-1',
      prompt: 'a red teapot',
      poll_interval_ms: 1000,
      timeout_ms: 30000,
    });
    assert.ok(response.result, `Should succeed: ${JSON.stringify(response.error)}`);
    assert.deepStrictEqual(response.result.structuredContent.urls, ['https://example.com/model.glb']);
    const text = response.result.content.find((item) => item?.type === 'text')?.text || '';
    assert.ok(text.startsWith('3D generation status: status COMPLETED'), `Unexpected text: ${text}`);

    const missingModel = await client.callTool('nanogpt_3d_generate', { prompt: 'a red teapot' });
    assert.ok(missingModel.error || missingModel.result?.isError, 'Submitting without a model should fail');
  });
});
