'use strict';

// SQL fixtures only. --listen also checks a real ephemeral HTTP socket;
// neither mode connects to SQL Server or to the existing 8765 service.
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter, once } = require('node:events');
const { createServer } = require('../../scripts/server');

const payload = { ok: true, source: 'sqlserver', records: [{ latestMessage: 'PRIVATE_FIXTURE_MESSAGE' }], total: 1 };
let checks = 0;
function check(value, expected, message) {
  assert.deepEqual(value, expected, message);
  checks++;
}
function request(server, url, { method = 'GET', headers = {} } = {}) {
  const req = new EventEmitter();
  Object.assign(req, { url, method, headers: { host: '127.0.0.1:8765', ...headers } });
  return new Promise(resolve => {
    const outputHeaders = {};
    server.emit('request', req, {
      setHeader(key, value) { outputHeaders[key] = value; },
      writeHead(status, values) { this.status = status; Object.assign(outputHeaders, values); },
      end(body) { resolve({ status: this.status, headers: outputHeaders, body: JSON.parse(body) }); }
    });
  });
}
async function unit() {
  let calls = 0;
  const server = createServer({ query: async options => { check(options, { mode: 'receptions', limit: 50, offset: 0 }); calls++; return payload; } });
  const before = Date.now();
  const health = await request(server, '/healthz');
  check(health.status, 200);
  check(Object.keys(health.body).sort(), ['ok', 'source', 'ts']);
  check(health.body.ok, true);
  check(health.body.source, 'sqlserver');
  check(Number.isFinite(Date.parse(health.body.ts)) && Date.parse(health.body.ts) >= before, true);
  check(health.headers['Cache-Control'], 'no-store');
  check(JSON.stringify(health.body).includes('PRIVATE_FIXTURE_MESSAGE'), false);
  await request(server, '/healthz');
  check(calls, 2, 'Health reads fresh SQL rather than caching success');
  const api = await request(server, '/api/receptions');
  check(api.body, payload, 'Existing API contract unchanged');

  const callsBeforeRejection = calls;
  for (const options of [
    { method: 'POST' }, { method: 'HEAD' },
    { headers: { host: 'app:8765' } },
    { headers: { host: 'attacker.invalid' } },
    { headers: { origin: 'https://reception.witop.com' } },
    { headers: { 'sec-fetch-site': 'cross-site' } }
  ]) {
    check((await request(server, '/healthz', options)).status, options.method ? 405 : 403);
  }
  check(calls, callsBeforeRejection, 'Rejected health requests do not query SQL');
  check((await request(server, '/healthz-extra')).status, 404);

  for (const code of ['SQL_CONNECT_FAILED', 'SQL_DRIVER_MISSING', 'SQL_CONFIG_MISSING', 'SQL_MAPPING_REQUIRED',
    'SQL_SCHEMA_AMBIGUOUS', 'SQL_QUERY_FAILED', 'SQL_BRIDGE_FAILED', 'SQL_BRIDGE_INVALID_RESPONSE', 'PRIVATE_FIXTURE_SECRET']) {
    const failing = createServer({ query: async () => { throw new Error(code); } });
    const failed = await request(failing, '/healthz');
    check(failed.status, 503);
    check(failed.body.ok, false);
    check(failed.body.error, code.startsWith('SQL_') ? code : 'SQL_QUERY_FAILED');
    check(JSON.stringify(failed).includes('PRIVATE_FIXTURE_SECRET'), false);
  }
  for (const value of [{ ok: true, source: 'mock' }, { ok: false, source: 'sqlserver' }]) {
    const invalid = createServer({ query: async () => value });
    const response = await request(invalid, '/healthz');
    check(response.status, 503);
    check(response.body.error, 'SQL_BRIDGE_INVALID_RESPONSE');
  }
  let failing = false;
  const changing = createServer({ query: async () => {
    if (failing) throw new Error('SQL_CONNECT_FAILED');
    return payload;
  } });
  check((await request(changing, '/healthz')).status, 200);
  failing = true;
  check((await request(changing, '/healthz')).status, 503, 'SQL failure is visible immediately after success');
  failing = false;
  check((await request(changing, '/healthz')).status, 200, 'Recovery is visible');

  let concurrent = 0, release;
  const shared = createServer({ query: () => { concurrent++; return new Promise(resolve => { release = resolve; }); } });
  const requests = Array.from({ length: 20 }, (_, i) => request(shared, i % 2 ? '/healthz' : '/api/receptions'));
  await new Promise(resolve => setImmediate(resolve));
  check(concurrent, 1, 'Health and API share one in-flight bounded query');
  release(payload);
  const responses = await Promise.all(requests);
  check(responses.every(r => r.status === 200), true);
  check(responses.filter((_, i) => i % 2).every(r => !('records' in r.body)), true);
  const next = request(shared, '/healthz');
  await new Promise(resolve => setImmediate(resolve));
  check(concurrent, 2, 'The in-flight query slot is released');
  release(payload);
  check((await next).status, 200);
}

async function socket() {
  let fail = false;
  const server = createServer({ query: async () => {
    if (fail) throw new Error('PRIVATE_FIXTURE_SECRET');
    return payload;
  } });
  const start = performance.now();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const get = route => new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: route, agent: false }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    }).on('error', reject);
  });
  try {
    const health = await get('/healthz');
    check(health.status, 200);
    check(health.body.source, 'sqlserver');
    check((await get('/api/receptions')).body, payload);
    fail = true;
    check((await get('/healthz')).status, 503);
    console.log(`PASS ephemeral HTTP: success + SQL failure + unchanged API; fixture startup_ms=${(performance.now() - start).toFixed(1)} (not Docker or real SQL)`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

(async () => {
  await unit();
  if (process.argv.includes('--listen')) await socket();
  console.log(`PASS healthz: ${checks} assertions (fixtures; real SQL/container readiness unverified)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
