'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { querySqlServer } = require('./sqlserver-bridge');
const ROOT = path.resolve(__dirname, '..');
const STATIC = new Set(['index.html', 'scripts/state.js', 'scripts/reception-bridge.js',
  'scripts/okki-adapter.js', 'scripts/variants.js', 'scripts/build-info.json']);

function createServer({ query = querySqlServer } = {}) {
  let pending;
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
    // Loopback binding plus Host/Origin checks prevent DNS rebinding and cross-site reads.
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json(403, { error: 'HOST_REJECTED' });
    if (req.headers.origin && req.headers.origin !== 'http://' + host) return json(403, { error: 'ORIGIN_REJECTED' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: 'ORIGIN_REJECTED' });
    if (req.method !== 'GET') return json(405, { error: 'READ_ONLY' });
    let url;
    try { url = new URL(req.url, 'http://' + host); }
    catch { return json(400, { error: 'INVALID_URL' }); }
    if (url.pathname === '/api/receptions') {
      // One bounded shared query at a time. Refreshes do not spawn unbounded DB clients.
      try {
        if (!pending) pending = Promise.resolve().then(() => query({ limit: 50 })).finally(() => { pending = null; });
        return json(200, await pending);
      } catch (error) {
        const allowed = new Set(['SQL_CONNECT_FAILED', 'SQL_DRIVER_MISSING', 'SQL_CONFIG_MISSING', 'SQL_MAPPING_REQUIRED',
          'SQL_SCHEMA_AMBIGUOUS', 'SQL_QUERY_FAILED', 'SQL_BRIDGE_FAILED', 'SQL_BRIDGE_INVALID_RESPONSE']);
        return json(503, { source: 'sqlserver', error: allowed.has(error.message) ? error.message : 'SQL_QUERY_FAILED' });
      }
    }
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!STATIC.has(file)) return json(404, { error: 'NOT_FOUND' });
    try {
      const content = await fs.readFile(path.join(ROOT, file));
      res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' :
        file.endsWith('.json') ? 'application/json' : 'text/javascript; charset=utf-8' });
      res.end(content);
    } catch { json(404, { error: 'NOT_FOUND' }); }
  });
}

module.exports = { createServer };
if (require.main === module) {
  const port = Number(process.env.PORT || 8765);
  const server = createServer();
  server.on('error', error => { console.error('LOCAL_SERVER_START_FAILED ' + error.code); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log('接待工作台 http://127.0.0.1:' + server.address().port));
}
