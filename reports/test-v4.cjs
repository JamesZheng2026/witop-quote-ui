#!/usr/bin/env node
'use strict';
// Injected fixtures test behavior only. This is never evidence of a real SQL connection.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { JSDOM, VirtualConsole } = require('jsdom');
const { createServer } = require('../scripts/server');
const ROOT = path.resolve(__dirname, '..');
const records = [
  { id: 'SQL-test-1', contact: '<img src=x onerror=alert(1)>', assignee: 'Alice', channel: 'whatsapp',
    lastContactAt: '2026-10-15T09:00:00', latestMessage: '<script>window.injected=true</script>', messageCount: 3, serviceStatus: null },
  { id: 'SQL-test-2', contact: 'Fixture contact', assignee: null, channel: 'whatsapp',
    lastContactAt: '2026-10-16T09:00:00', latestMessage: 'Test message', messageCount: 1, serviceStatus: null }
];
const payload = { ok: true, source: 'sqlserver', total: 10, records, fetchedAt: '2026-10-16T09:30:00Z' };
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
  const server = createServer({ query: async ({ limit }) => { calls++; assert.equal(limit, 50); return payload; } });
  const response = await request(server, '/api/receptions');
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), payload);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal((await request(server, '/api/receptions', { method: 'POST' })).status, 405);
  assert.equal((await request(server, '/api/receptions', { headers: { host: 'attacker.invalid' } })).status, 403);
  assert.equal((await request(server, '/api/receptions', { headers: { origin: 'https://attacker.invalid' } })).status, 403);
  assert.equal((await request(server, '/api/receptions', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal(calls, 1, 'Rejected requests never query SQL');
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
  const dom = new JSDOM(raw, { url: 'http://127.0.0.1:8765/', runScripts: 'dangerously', virtualConsole,
    beforeParse(w) {
      w.fetch = async url => {
        if (url !== '/api/receptions') return { ok: false };
        apiCalls++;
        return next;
      };
    }
  });
  try {
    const w = dom.window, d = w.document;
    await tick();
    assert.equal(apiCalls, 1);
    assert(!d.getElementById('view-reception-live').classList.contains('hidden'), 'v4 is default entry');
    assert.equal(d.querySelectorAll('.v4-sidebar nav .sidebar-item').length, 6);
    assert.equal(d.querySelectorAll('.v4-sidebar .add-btn').length, 1);
    assert.equal(d.querySelectorAll('[data-live-stage]').length, 4);
    assert.deepEqual([...d.querySelectorAll('[data-live-stage]')].map(n => n.firstChild.textContent), ['输入配置','接待分配','服务完成','信息记录']);
    assert.equal(d.querySelectorAll('.live-card').length, 2);
    assert.equal(d.getElementById('live-record-count').textContent, '2');
    assert.equal(d.getElementById('live-assigned-count').textContent, '1');
    assert(d.getElementById('live-source').textContent.includes('2 / 10'));
    assert.equal(d.querySelectorAll('#live-cards img, #live-cards script').length, 0, 'Untrusted SQL text is never HTML');
    assert.equal(w.injected, undefined);
    assert.equal(d.querySelector('.live-card').dataset.liveRecordId, 'SQL-test-2');
    d.getElementById('live-sort').value = 'asc';
    d.getElementById('live-sort').dispatchEvent(new w.Event('change'));
    assert.equal(d.querySelector('.live-card').dataset.liveRecordId, 'SQL-test-1');
    d.querySelector('.live-preview button').click();
    assert.equal(d.getElementById('live-detail-message').textContent, records[0].latestMessage);
    assert(d.getElementById('live-detail').hasAttribute('open'));
    d.querySelector('[data-live-stage="assignment"]').click();
    assert.equal(d.querySelectorAll('.live-card').length, 1);
    d.querySelector('[data-live-stage="records"]').click();
    d.getElementById('live-search').value = 'fixture';
    d.getElementById('live-search').dispatchEvent(new w.Event('input'));
    assert.equal(d.querySelectorAll('.live-card').length, 1);
    d.getElementById('live-search').value = '';
    next = { ok: false, json: async () => ({ error: 'SQL_QUERY_FAILED', detail: 'PRIVATE_CREDENTIAL_TEXT' }) };
    d.getElementById('live-refresh').click();
    await tick();
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
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
  global.console.log('PASS v4 UI: default entry, six nav + add, four stages, cards, safe text, detail, search/filter/sort, error/empty/retry, no mock fallback (injected fixtures)');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
