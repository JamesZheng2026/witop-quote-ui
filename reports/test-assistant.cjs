#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createServer, createAssistantAccessVerifier } = require('../scripts/server');
const { createAssistant, validateMessages, AssistantError, DEFAULT_BASE_URL } = require('../scripts/assistant');

const tick = () => new Promise(resolve => setImmediate(resolve));

function request(server, url, { method = 'GET', headers = {}, body } = {}) {
  const req = new EventEmitter();
  Object.assign(req, { url, method, headers: { host: '127.0.0.1:8765', ...headers } });
  const response = new Promise(resolve => {
    const outputHeaders = {};
    const chunks = [];
    const res = new EventEmitter();
    Object.assign(res, {
      destroyed: false,
      setHeader(key, value) { outputHeaders[key] = value; },
      writeHead(status, values = {}) { this.status = status; Object.assign(outputHeaders, values); },
      write(data) { chunks.push(String(data)); return true; },
      flushHeaders() {},
      end(data) {
        if (data !== undefined) chunks.push(String(data));
        this.destroyed = true;
        resolve({ status: this.status, headers: outputHeaders, body: chunks.join('') });
        this.emit('close');
      }
    });
    server.emit('request', req, res);
  });
  setImmediate(() => {
    if (body !== undefined) req.emit('data', Buffer.from(body));
    req.emit('end');
  });
  return response;
}

async function rejectsCode(fn, code) {
  await assert.rejects(fn, error => error instanceof AssistantError && error.code === code);
}

async function main() {
  const tokenFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'witop-ai-access-test-'));
  const tokenFile = path.join(tokenFolder, 'token');
  fs.writeFileSync(tokenFile, 'ACCESS_TOKEN_FOR_TESTS_1234', { mode: 0o600 });
  const verifyToken = createAssistantAccessVerifier(tokenFile);
  assert.equal(await verifyToken('ACCESS_TOKEN_FOR_TESTS_1234'), true);
  assert.equal(await verifyToken('ACCESS_TOKEN_FOR_TESTS_0000'), false);
  fs.unlinkSync(tokenFile);
  fs.rmdirSync(tokenFolder);

  assert.deepEqual(validateMessages([{ role: 'user', content: '  优化卡片  ' }]), [{ role: 'user', content: '优化卡片' }]);
  assert.equal(validateMessages([{ role: 'user', content: '需求' }, { role: 'assistant', content: '答'.repeat(5000) },
    { role: 'user', content: '继续' }]).length, 3, 'A streamed answer can be replayed on the next turn');
  const redactedInput = validateMessages([{ role: 'user', content: 'Authorization: Bearer sk-ant-1234567890 email buyer@example.com 电话 87654321' }])[0].content;
  assert(!redactedInput.includes('sk-ant-1234567890'));
  assert(!redactedInput.includes('buyer@example.com'));
  assert(!redactedInput.includes('87654321'));
  for (const value of [[], [{ role: 'assistant', content: 'x' }],
    [{ role: 'user', content: 'x' }, { role: 'user', content: 'y' }],
    [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }],
    [{ role: 'user', content: 'x'.repeat(4001) }]]) {
    assert.throws(() => validateMessages(value), error => error instanceof AssistantError && error.code === 'AI_INVALID_REQUEST');
  }

  let captured;
  const mockClient = { beta: { messages: { stream(params, options) {
    captured = { params, options };
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '优化' } };
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '方案' } };
      },
      async finalMessage() {
        return { model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 20, output_tokens: 8 } };
      }
    };
  } } } };
  const assistant = createAssistant({ client: mockClient });
  let streamed = '';
  const usage = await assistant.stream([{ role: 'user', content: '优化卡片' }], { onText: text => { streamed += text; } });
  assert.equal(streamed, '优化方案');
  assert.deepEqual(usage, { model: 'claude-opus-5-5', inputTokens: 20, outputTokens: 8 });
  assert.equal(captured.params.model, 'claude-opus-5-5');
  assert.deepEqual(captured.params.thinking, { type: 'adaptive' });
  assert.deepEqual(captured.params.output_config, { effort: 'low' });
  assert.deepEqual(captured.params.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(captured.params.fallbacks, 'default');
  assert.match(captured.params.system, /不得声称已经修改/);
  assert(!JSON.stringify(captured.params).includes('ACCESS_TOKEN_FOR_TESTS'));

  const accessToken = 'ACCESS_TOKEN_FOR_TESTS_1234';
  let checkedToken;
  const server = createServer({
    query: async () => { throw new Error('SQL should not run'); },
    assistant,
    verifyAssistantAccess: async token => { checkedToken = token; return token === accessToken; },
    limitAssistant: () => 0
  });
  const unauthorized = await request(server, '/api/assistant/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }] })
  });
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(JSON.parse(unauthorized.body), { error: 'AI_ACCESS_REQUIRED' });
  assert.equal((await request(server, '/api/assistant/chat')).status, 405);
  const unsupported = await request(server, '/api/assistant/chat', {
    method: 'POST', headers: { 'x-witop-ai-access': accessToken, 'content-type': 'text/plain' }, body: '{}'
  });
  assert.equal(unsupported.status, 415);
  const invalidMessages = await request(server, '/api/assistant/chat', {
    method: 'POST', headers: { 'x-witop-ai-access': accessToken, 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [] })
  });
  assert.equal(invalidMessages.status, 400);
  assert.deepEqual(JSON.parse(invalidMessages.body), { error: 'AI_INVALID_REQUEST' });
  const response = await request(server, '/api/assistant/chat', {
    method: 'POST', headers: { 'x-witop-ai-access': accessToken, 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: '优化卡片' }] })
  });
  assert.equal(checkedToken, accessToken);
  assert.equal(response.status, 200);
  assert.match(response.headers['Content-Type'], /^text\/event-stream/);
  assert.match(response.body, /event: meta/);
  assert.match(response.body, /event: delta/);
  assert.match(response.body, /优化/);
  assert.match(response.body, /event: done/);
  assert(!response.body.includes(accessToken));

  const broken = createServer({
    assistant: { model: 'fixture', async stream() { throw new Error('PRIVATE_UPSTREAM_DETAIL'); } },
    verifyAssistantAccess: async () => true,
    limitAssistant: () => 0
  });
  const brokenResponse = await request(broken, '/api/assistant/chat', {
    method: 'POST', headers: { 'x-witop-ai-access': accessToken, 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }] })
  });
  assert.equal(brokenResponse.status, 200);
  assert.match(brokenResponse.body, /AI_FAILED/);
  assert(!brokenResponse.body.includes('PRIVATE_UPSTREAM_DETAIL'));

  let release;
  const blockedAssistant = { model: 'fixture', stream(messages, { onText }) {
    onText('等待');
    return new Promise(resolve => { release = () => resolve({ model: 'fixture', inputTokens: 1, outputTokens: 1 }); });
  } };
  const busyServer = createServer({ assistant: blockedAssistant, verifyAssistantAccess: async () => true, limitAssistant: () => 0 });
  const first = request(busyServer, '/api/assistant/chat', {
    method: 'POST', headers: { 'x-witop-ai-access': accessToken, 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'first' }] })
  });
  await tick();
  const second = await request(busyServer, '/api/assistant/chat', {
    method: 'POST', headers: { 'x-witop-ai-access': accessToken, 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'second' }] })
  });
  assert.equal(second.status, 429);
  assert.deepEqual(JSON.parse(second.body), { error: 'AI_BUSY' });
  release();
  assert.equal((await first).status, 200);

  const limitedServer = createServer({ assistant, verifyAssistantAccess: async () => true, limitAssistant: () => 30 });
  const limited = await request(limitedServer, '/api/assistant/chat', {
    method: 'POST', headers: { 'x-witop-ai-access': accessToken, 'content-type': 'application/json' }, body: '{}'
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers['Retry-After'], '30');

  const unconfigured = createServer({ assistant, verifyAssistantAccess: async () => { throw new AssistantError('AI_ACCESS_NOT_CONFIGURED'); } });
  const unavailable = await request(unconfigured, '/api/assistant/chat', {
    method: 'POST', headers: { 'x-witop-ai-access': accessToken, 'content-type': 'application/json' }, body: '{}'
  });
  assert.equal(unavailable.status, 503);
  assert.deepEqual(JSON.parse(unavailable.body), { error: 'AI_ACCESS_NOT_CONFIGURED' });

  await rejectsCode(() => createAssistant({ client: { beta: { messages: { stream() {
    return { async *[Symbol.asyncIterator]() {}, async finalMessage() { return { stop_reason: 'refusal', usage: {} }; } };
  } } } } }).stream([{ role: 'user', content: 'x' }], { onText() {} }), 'AI_REFUSED');

  // A compatible (non-Anthropic) upstream must use the plain Messages API:
  // no beta namespace, and none of the Anthropic-only request fields.
  let compatibleCapture;
  const compatibleAssistant = createAssistant({
    client: { messages: { stream(params) {
      compatibleCapture = params;
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '兼容' } };
        },
        async finalMessage() {
          return { model: 'compatible-model', stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 2 } };
        }
      };
    } } },
    model: 'compatible-model',
    baseURL: 'https://compatible.example/anthropic'
  });
  let compatibleText = '';
  const compatibleUsage = await compatibleAssistant.stream([{ role: 'user', content: '优化卡片' }],
    { onText: text => { compatibleText += text; } });
  assert.equal(compatibleText, '兼容');
  assert.deepEqual(compatibleUsage, { model: 'compatible-model', inputTokens: 5, outputTokens: 2 });
  assert.equal(compatibleCapture.model, 'compatible-model');
  assert.equal(compatibleCapture.thinking, undefined);
  assert.equal(compatibleCapture.output_config, undefined);
  assert.equal(compatibleCapture.betas, undefined);
  assert.equal(compatibleCapture.fallbacks, undefined);
  assert.equal(compatibleCapture.system, captured.params.system);

  console.log('PASS AI assistant: official SDK request shape, adaptive thinking, default fallback, bounded history, independent access token, SSE streaming, sanitized failures, rate/concurrency gates, compatible-upstream request shape (mock API; no billable call)');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
