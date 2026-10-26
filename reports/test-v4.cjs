#!/usr/bin/env node
'use strict';
// Injected fixtures test behavior only. This is never evidence of a real SQL connection.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { JSDOM, VirtualConsole } = require('jsdom');
const { createServer } = require('../scripts/server');
const { attachConversationRefs } = require('../scripts/sqlserver-bridge');
const ROOT = path.resolve(__dirname, '..');
const records = [
  { id: 'SQL-111111111111111111111111', contact: '<img src=x onerror=alert(1)>', assignee: 'Alice', channel: 'whatsapp',
    lastContactAt: '2026-10-15T09:00:00', latestMessage: '<script>window.injected=true</script>', latestMessageRedacted: true,
    messageCount: 3, serviceStatus: null },
  { id: 'SQL-222222222222222222222222', contact: 'Fixture contact', assignee: null, channel: 'whatsapp',
    lastContactAt: '2026-10-16T09:00:00', latestMessage: 'Test message', messageCount: 1, serviceStatus: null }
];
const payload = { ok: true, source: 'sqlserver', total: 10, records, fetchedAt: '2026-10-16T09:30:00Z' };
const historyPayload = { ok: true, source: 'sqlserver', conversationId: records[0].id,
  messages: [
    { id: 'MSG-111111111111111111111111', sentAt: '2026-10-15T08:58:00', text: '<img src=x onerror=alert(2)>', redacted: false,
      participantLabel: '尾号 1234', senderType: 0, messageType: 1 },
    { id: 'MSG-222222222222222222222222', sentAt: '2026-10-15T09:00:00', text: 'password=[已脱敏]', redacted: true,
      participantLabel: '尾号 5678', senderType: 1, messageType: 1 }
  ], total: 2, limit: 50, hasMore: false, nextCursor: null, order: 'ascending', directionAvailable: false,
  fetchedAt: '2026-10-16T09:30:00Z' };
const tick = () => new Promise(resolve => setImmediate(resolve));

async function request(server, url, { method = 'GET', headers = {} } = {}) {
  const req = new EventEmitter();
  Object.assign(req, { url, method, headers: { host: '127.0.0.1:8765', ...headers } });
  return new Promise(resolve => {
    const outputHeaders = {};
    const res = {
      setHeader(key, value) { outputHeaders[key] = value; },
      writeHead(status, values = {}) { this.status = status; Object.assign(outputHeaders, values); },
      end(data) { resolve({ status: this.status, headers: outputHeaders, body: String(data) }); }
    };
    server.emit('request', req, res);
  });
}

async function main() {
  let calls = 0;
  const serverPayload = attachConversationRefs({ ...payload, _conversationRefs: {
    [records[0].id]: { chatKey: 'fixture-1', ownerName: 'Alice' },
    [records[1].id]: { chatKey: 'fixture-2', ownerName: '' }
  } });
  const server = createServer({ query: async options => {
    calls++;
    if (options.mode === 'messages') {
      assert.deepEqual(options, { mode: 'messages', limit: 50, conversation: { chatKey: 'fixture-1', ownerName: 'Alice' }, cursor: undefined });
      return historyPayload;
    }
    assert.deepEqual(options, { mode: 'receptions', limit: 50, offset: 0 });
    return serverPayload;
  } });
  const response = await request(server, '/api/receptions');
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), payload);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal((await request(server, '/api/receptions', { method: 'POST' })).status, 405);
  assert.equal((await request(server, '/api/receptions', { headers: { host: 'attacker.invalid' } })).status, 403);
  assert.equal((await request(server, '/api/receptions', { headers: { origin: 'https://attacker.invalid' } })).status, 403);
  assert.equal((await request(server, '/api/receptions', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal(calls, 1, 'Rejected requests never query SQL');
  const historyResponse = await request(server, '/api/receptions/' + records[0].id + '/messages?limit=50');
  assert.equal(historyResponse.status, 200);
  assert.deepEqual(JSON.parse(historyResponse.body), historyPayload);
  assert.equal(calls, 2);
  assert.equal((await request(server, '/api/receptions/' + records[0].id + '/messages?limit=0')).status, 400);
  assert.equal((await request(server, '/api/receptions/' + records[0].id + '/messages?limit=50&limit=20')).status, 400);
  assert.equal((await request(server, '/api/receptions/' + records[0].id + '/messages?offset=0')).status, 400);
  assert.equal((await request(server, '/api/receptions/' + records[0].id + '/messages?cursor=invalid')).status, 400);
  assert.equal((await request(server, '/api/receptions/' + records[0].id + '/messages?unknown=1')).status, 400);
  assert.equal((await request(server, '/api/receptions/SQL-ffffffffffffffffffffffff/messages')).status, 404);
  assert.equal(calls, 2, 'Invalid history requests never query SQL');
  const coldServer = createServer({ query: async () => { throw new Error('must not run'); } });
  assert.equal((await request(coldServer, '/api/receptions/' + records[0].id + '/messages')).status, 404,
    'History references are available only after the bounded reception snapshot loads');
  let snapshotCalls = 0;
  const retainedServer = createServer({ query: async options => {
    if (options.mode === 'messages') return historyPayload;
    snapshotCalls++;
    return snapshotCalls === 1 ? attachConversationRefs({ ...payload, _conversationRefs: {
      [records[0].id]: { chatKey: 'fixture-1', ownerName: 'Alice' }
    } }) : { ok: true, source: 'sqlserver', total: 0, records: [], fetchedAt: '2026-10-16T09:31:00Z' };
  } });
  assert.equal((await request(retainedServer, '/api/receptions')).status, 200);
  assert.equal((await request(retainedServer, '/healthz')).status, 200);
  assert.equal((await request(retainedServer, '/api/receptions/' + records[0].id + '/messages')).status, 200,
    'A health refresh does not invalidate a card already rendered in another client');
  let cursorSeen;
  const pagedServer = createServer({ query: async options => {
    if (options.mode === 'receptions') return attachConversationRefs({ ...payload, _conversationRefs: {
      [records[0].id]: { chatKey: 'fixture-1', ownerName: 'Alice' }
    } });
    cursorSeen = options.cursor;
    return options.cursor ? historyPayload : attachConversationRefs({ ...historyPayload, messages: historyPayload.messages.slice(1),
      hasMore: true, nextCursor: null, _nextCursor: { sentAt: '2026-10-15T09:00:00', messageKey: 2 } });
  } });
  await request(pagedServer, '/api/receptions');
  const firstPage = JSON.parse((await request(pagedServer, '/api/receptions/' + records[0].id + '/messages?limit=50')).body);
  assert.match(firstPage.nextCursor, /^[a-f0-9]{48}$/);
  assert.equal(Object.hasOwn(firstPage, '_nextCursor'), false);
  assert.equal((await request(pagedServer, '/api/receptions/' + records[0].id + '/messages?limit=50&cursor=' + firstPage.nextCursor)).status, 200);
  assert.deepEqual(cursorSeen, { sentAt: '2026-10-15T09:00:00', messageKey: 2 }, 'Opaque cursor resumes by stable SQL keyset');
  for (const name of ['/.git/config', '/scripts/server.js', '/scripts/sqlserver-bridge.js', '/reports/test-v4.cjs', '/../scripts/sqlserver_config.json']) {
    assert.equal((await request(server, name)).status, 404, name);
  }
  assert.equal((await request(server, '/')).status, 200);
  const failing = createServer({ query: async () => { throw new Error('PRIVATE_CREDENTIAL_TEXT'); } });
  const failed = await request(failing, '/api/receptions');
  assert.equal(failed.status, 503);
  assert.deepEqual(JSON.parse(failed.body), { source: 'sqlserver', error: 'SQL_QUERY_FAILED' });
  let release;
  let concurrent = 0;
  const coalesced = createServer({ query: () => { concurrent++; return new Promise(resolve => { release = resolve; }); } });
  const first = request(coalesced, '/api/receptions');
  const second = request(coalesced, '/api/receptions');
  await tick();
  assert.equal(concurrent, 1);
  release(payload);
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
  console.log('PASS HTTP: bounded read-only API, no-store, Host/Origin, static allowlist, sanitized errors, query coalescing (in-process requests)');

  let next = { ok: true, json: async () => payload };
  let historyNext = { ok: true, json: async () => historyPayload };
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(String(error)));
  let raw = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  raw = raw.replace(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/, '')
    .replace(/<script>\s*tailwind\.config[\s\S]*?<\/script>/m, '')
    .replace(/<link\b[^>]*>/g, '')
    .replace(/<script src="scripts\/([a-z-]+)\.js(?:\?[^"]*)?"><\/script>/g,
      (_, name) => '<script>' + fs.readFileSync(path.join(ROOT, 'scripts', name + '.js'), 'utf8') + '</script>');
  let apiCalls = 0;
  let historyApiCalls = 0;
  let assistantApiCalls = 0;
  let lastAssistantRequest;
  const dom = new JSDOM(raw, { url: 'http://127.0.0.1:8765/', runScripts: 'dangerously', virtualConsole,
    beforeParse(w) {
      w.TextDecoder = TextDecoder;
      w.fetch = async (url, options = {}) => {
        if (url === '/api/receptions') {
          apiCalls++;
          return next;
        }
        if (url === '/api/receptions/' + records[0].id + '/messages?limit=50') {
          historyApiCalls++;
          return historyNext;
        }
        if (url === '/api/assistant/chat') {
          assistantApiCalls++;
          lastAssistantRequest = options;
          const chunks = [
            'event: meta\ndata: {"model":"claude-opus-5-5","mode":"proposal-only"}\n\nevent: delta\ndata: {"text":"需求理解\\n"}\n\n',
            'event: delta\ndata: {"text":"优化方案"}\n\nevent: done\ndata: {"model":"claude-opus-5-5","inputTokens":10,"outputTokens":5}\n\n'
          ].map(value => new TextEncoder().encode(value));
          let index = 0;
          return { ok: true, body: { getReader: () => ({ read: async () => index < chunks.length ?
            { value: chunks[index++], done: false } : { value: undefined, done: true } }) } };
        }
        return { ok: false, json: async () => ({ error: 'NOT_FOUND' }) };
      };
    }
  });
  try {
    const w = dom.window, d = w.document;
    await tick();
    assert.equal(apiCalls, 1);
    assert(!d.getElementById('view-reception-live').classList.contains('hidden'), 'v4 is default entry');
    assert.equal(d.querySelectorAll('.v4-sidebar nav .sidebar-item').length, 7);
    assert.equal(d.querySelectorAll('.v4-sidebar .add-btn').length, 1);
    assert.equal(d.querySelectorAll('[data-live-stage]').length, 4);
    assert.deepEqual([...d.querySelectorAll('[data-live-stage]')].map(n => n.firstChild.textContent), ['输入配置','接待分配','服务完成','信息记录']);
    assert([...d.querySelectorAll('[data-live-stage]')].every(n => n.getAttribute('aria-controls') === 'live-cards'));
    assert.equal(d.querySelectorAll('.live-card').length, 2);
    assert.equal(d.getElementById('live-record-count').textContent, '2');
    assert.equal(d.getElementById('live-assigned-count').textContent, '1');
    assert(d.getElementById('live-source').textContent.includes('2 / 10'));
    assert.equal(d.getElementById('live-results').textContent, '显示 2 条，共载入 2 条');
    assert.equal(d.getElementById('live-reset').hidden, true);
    assert.equal(d.querySelectorAll('#live-cards img, #live-cards script').length, 0, 'Untrusted SQL text is never HTML');
    assert.equal(w.injected, undefined);
    assert.equal(d.querySelector('.live-card').dataset.liveRecordId, records[1].id);
    d.getElementById('live-sort').value = 'asc';
    d.getElementById('live-sort').dispatchEvent(new w.Event('change'));
    assert.equal(d.querySelector('.live-card').dataset.liveRecordId, records[0].id);
    assert.match(d.querySelector('.live-preview .live-meta').textContent, /已脱敏/);
    const detailButton = d.querySelector('.live-preview button');
    assert.equal(detailButton.textContent, '查看聊天记录');
    detailButton.click();
    await tick();
    assert.equal(historyApiCalls, 1);
    assert.equal(d.querySelectorAll('#live-detail-message .live-message').length, 2);
    assert.equal(d.querySelector('#live-detail-message .live-message-text').textContent, historyPayload.messages[0].text);
    assert.equal(d.querySelectorAll('#live-detail-message img, #live-detail-message script').length, 0, 'History text is never HTML');
    assert.equal(d.querySelectorAll('#live-detail-message .live-redacted').length, 1);
    assert.equal(d.getElementById('live-detail-history-status').textContent, '已显示 2 / 2 条');
    assert(d.getElementById('live-detail').hasAttribute('open'));
    assert.equal(d.activeElement, d.getElementById('live-detail-close'));
    d.getElementById('live-detail-close').click();
    assert(!d.getElementById('live-detail').hasAttribute('open'));
    assert.equal(d.activeElement, detailButton, 'Detail close restores focus to its trigger');
    historyNext = { ok: false, json: async () => ({ error: 'SQL_QUERY_FAILED' }) };
    detailButton.click();
    await tick();
    assert.equal(d.getElementById('live-detail-history-status').textContent, '完整记录载入失败，仅显示最近消息');
    assert.equal(d.querySelector('#live-detail-message .live-message-text').textContent, records[0].latestMessage);
    assert.equal(d.querySelectorAll('#live-detail-message script').length, 0);
    d.querySelector('[data-live-stage="assignment"]').click();
    assert.equal(d.querySelectorAll('.live-card').length, 1);
    assert.equal(d.getElementById('live-results').textContent, '显示 1 条，共载入 2 条（已筛选）');
    assert.equal(d.getElementById('live-reset').hidden, false);
    d.querySelector('[data-live-stage="records"]').click();
    d.getElementById('live-search').value = 'fixture';
    d.getElementById('live-search').dispatchEvent(new w.Event('input'));
    assert.equal(d.querySelectorAll('.live-card').length, 1);
    assert.equal(d.getElementById('live-results').textContent, '显示 1 条，共载入 2 条（已筛选）');
    d.getElementById('live-reset').click();
    assert.equal(d.querySelectorAll('.live-card').length, 2);
    assert.equal(d.getElementById('live-search').value, '');
    assert.equal(d.getElementById('live-filter').value, 'all');
    assert.equal(d.getElementById('live-reset').hidden, true);
    let releaseRefresh;
    next = new Promise(resolve => { releaseRefresh = resolve; });
    d.getElementById('live-refresh').click();
    assert.equal(d.getElementById('live-refresh').textContent, '刷新中…');
    assert.equal(d.getElementById('live-refresh').getAttribute('aria-busy'), 'true');
    releaseRefresh({ ok: false, json: async () => ({ error: 'SQL_QUERY_FAILED', detail: 'PRIVATE_CREDENTIAL_TEXT' }) });
    await tick();
    assert.equal(d.getElementById('live-refresh').textContent, '刷新数据');
    assert.equal(d.querySelectorAll('.live-card').length, 0, 'No stale or mock fallback on failure');
    assert.equal(d.getElementById('live-detail-message').textContent, '', 'Stale detail cleared');
    assert(!d.getElementById('live-detail').hasAttribute('open'));
    assert.equal(d.getElementById('live-source').dataset.error, 'true');
    assert(!d.getElementById('view-reception-live').textContent.includes('PRIVATE_CREDENTIAL_TEXT'));
    assert.equal(d.getElementById('live-config-count').textContent, '—');
    next = { ok: true, json: async () => ({ ...payload, records: [], total: 0 }) };
    d.getElementById('live-refresh').click();
    await tick();
    assert.equal(d.getElementById('live-record-count').textContent, '0');
    assert.equal(d.getElementById('live-source').dataset.error, 'false');
    next = { ok: true, json: async () => ({ ...payload, source: 'mock' }) };
    d.getElementById('live-refresh').click();
    await tick();
    assert.equal(d.getElementById('live-source').dataset.error, 'true', 'Reject non-SQL source');

    d.getElementById('nav-ai-assistant').click();
    assert(!d.getElementById('view-ai-assistant').classList.contains('hidden'));
    d.getElementById('assistant-access').value = 'IN_MEMORY_ACCESS_TOKEN_1234';
    d.getElementById('assistant-input').value = '<img src=x onerror=alert(3)> 优化手机布局';
    d.getElementById('assistant-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    await tick();
    assert.equal(assistantApiCalls, 1);
    assert.equal(lastAssistantRequest.method, 'POST');
    assert.equal(lastAssistantRequest.headers['X-Witop-AI-Access'], 'IN_MEMORY_ACCESS_TOKEN_1234');
    assert(!lastAssistantRequest.body.includes('IN_MEMORY_ACCESS_TOKEN_1234'), 'Access token is never sent to Claude request body');
    assert.deepEqual(JSON.parse(lastAssistantRequest.body), { messages: [{ role: 'user', content: '<img src=x onerror=alert(3)> 优化手机布局' }] });
    assert.equal(d.querySelectorAll('#assistant-thread .assistant-message').length, 2);
    assert.equal(d.querySelector('[data-role="assistant"]').textContent, '需求理解\n优化方案');
    assert.equal(d.querySelectorAll('#assistant-thread img, #assistant-thread script').length, 0, 'Assistant thread renders text only');
    assert.equal(d.getElementById('assistant-model').textContent, 'claude-opus-5-5');
    assert.match(d.getElementById('assistant-status').textContent, /分支、测试和审批/);
    d.getElementById('assistant-clear').click();
    assert.equal(d.querySelectorAll('#assistant-thread .assistant-message').length, 0);
    assert(d.getElementById('assistant-empty'));
    assert.equal(d.getElementById('assistant-access').value, 'IN_MEMORY_ACCESS_TOKEN_1234');
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
  global.console.log('PASS v4 UI: default entry, navigation, four stages, cards, safe full-history dialog, streamed Claude assistant text, search/filter/sort, error/empty/retry, no mock fallback (injected fixtures)');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
