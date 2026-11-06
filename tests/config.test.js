import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const baseUrl = (env) => execFileSync(process.execPath, [
  '--input-type=module',
  '-e',
  "import { loadConfig } from './dist/config.js'; console.log(loadConfig().baseUrl);",
], { env: { ...process.env, NANOGPT_API_KEY: 'test-key', NANOGPT_BASE_URL: '', ...env }, encoding: 'utf8' }).trim();

test('defaults to the direct API host', () => {
  assert.equal(baseUrl({}), 'https://api.nano-gpt.com');
});

test('honours NANOGPT_BASE_URL, for clients with only IPv6', () => {
  assert.equal(baseUrl({ NANOGPT_BASE_URL: 'https://nano-gpt.com/' }), 'https://nano-gpt.com');
});
