'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { querySqlServer, conversationRefFor, messageCursorFor } = require('./sqlserver-bridge');
const { createClaudeAssistant, validateMessages, AssistantError } = require('./assistant');
const ROOT = path.resolve(__dirname, '..');
const STATIC = new Set(['index.html', 'scripts/state.js', 'scripts/reception-bridge.js',
  'scripts/okki-adapter.js', 'scripts/variants.js', 'scripts/build-info.json']);
const SQL_ERRORS = new Set(['SQL_CONNECT_FAILED', 'SQL_DRIVER_MISSING', 'SQL_CONFIG_MISSING', 'SQL_MAPPING_REQUIRED',
  'SQL_SCHEMA_AMBIGUOUS', 'SQL_QUERY_FAILED', 'SQL_BRIDGE_FAILED', 'SQL_BRIDGE_INVALID_RESPONSE', 'SQL_BUSY']);

function integerParameter(url, name, fallback, { min, max }) {
  const values = url.searchParams.getAll(name);
  if (values.length === 0) return fallback;
  if (values.length !== 1 || !/^\d+$/.test(values[0])) return null;
  const value = Number(values[0]);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

function createAssistantAccessVerifier(tokenFile = process.env.WITOP_AI_ACCESS_TOKEN_FILE) {
  let expectedPromise;
  return async supplied => {
    if (!tokenFile) throw new AssistantError('AI_ACCESS_NOT_CONFIGURED');
    if (typeof supplied !== 'string' || supplied.length < 16 || supplied.length > 256) return false;
    if (!expectedPromise) {
      expectedPromise = fs.readFile(tokenFile, 'utf8').then(raw => raw.trim()).catch(() => {
        expectedPromise = null;
        throw new AssistantError('AI_ACCESS_NOT_CONFIGURED');
      });
    }
    const expected = await expectedPromise;
    if (expected.length < 16 || expected.length > 256) throw new AssistantError('AI_ACCESS_NOT_CONFIGURED');
    const actualBuffer = Buffer.from(supplied);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
  };
}

function createAssistantRateLimiter({ limit = 12, windowMs = 5 * 60 * 1000 } = {}) {
  const attempts = new Map();
  return key => {
    const now = Date.now();
    const recent = (attempts.get(key) || []).filter(stamp => stamp > now - windowMs);
    if (recent.length >= limit) {
      attempts.set(key, recent);
      return Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
    }
    recent.push(now);
    attempts.set(key, recent);
    return 0;
  };
}

function readJsonBody(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
    if (type !== 'application/json') return reject(new AssistantError('AI_UNSUPPORTED_MEDIA_TYPE'));
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) return reject(new AssistantError('AI_REQUEST_TOO_LARGE'));
    let size = 0;
    const chunks = [];
    let settled = false;
    const fail = code => {
      if (settled) return;
      settled = true;
      reject(new AssistantError(code));
    };
    req.on('data', chunk => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buffer.length;
      if (size > maxBytes) return fail('AI_REQUEST_TOO_LARGE');
      chunks.push(buffer);
    });
    req.on('aborted', () => fail('AI_REQUEST_ABORTED'));
    req.on('error', () => fail('AI_INVALID_REQUEST'));
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new AssistantError('AI_INVALID_REQUEST')); }
    });
  });
}

function sse(res, event, data) {
  res.write('event: ' + event + '\n');
  res.write('data: ' + JSON.stringify(data) + '\n\n');
}

function createServer({ query = querySqlServer, assistant = createClaudeAssistant(),
  verifyAssistantAccess = createAssistantAccessVerifier(), limitAssistant = createAssistantRateLimiter(),
  limitAssistantAuth = createAssistantRateLimiter({ limit: 30 }) } = {}) {
  let pendingReceptions;
  let assistantBusy = false;
  let historyActive = 0;
  const historyQueue = [];
  const conversationRefs = new Map();
  const messageCursors = new Map();
  const rememberConversations = result => {
    const now = Date.now();
    for (const [id, entry] of conversationRefs) {
      if (entry.expiresAt <= now) conversationRefs.delete(id);
    }
    for (const record of result.records || []) {
      const conversation = conversationRefFor(result, record.id);
      if (!conversation) continue;
      conversationRefs.delete(record.id);
      conversationRefs.set(record.id, { conversation, expiresAt: now + 15 * 60 * 1000 });
    }
    while (conversationRefs.size > 500) conversationRefs.delete(conversationRefs.keys().next().value);
    return result;
  };
  const exposeMessageCursor = (result, conversationId) => {
    const now = Date.now();
    for (const [token, entry] of messageCursors) {
      if (entry.expiresAt <= now) messageCursors.delete(token);
    }
    const cursor = messageCursorFor(result);
    let token = null;
    if (result.hasMore && cursor) {
      token = crypto.randomBytes(24).toString('hex');
      messageCursors.set(token, { conversationId, cursor, expiresAt: now + 15 * 60 * 1000 });
      while (messageCursors.size > 1000) messageCursors.delete(messageCursors.keys().next().value);
    }
    result.nextCursor = token;
    return result;
  };
  const loadReceptions = () => {
    if (!pendingReceptions) {
      pendingReceptions = Promise.resolve().then(() => query({ mode: 'receptions', limit: 50, offset: 0 }))
        .then(rememberConversations)
        .finally(() => { pendingReceptions = null; });
    }
    return pendingReceptions;
  };
  const runHistoryQueue = () => {
    while (historyActive < 2 && historyQueue.length) {
      const task = historyQueue.shift();
      historyActive++;
      Promise.resolve().then(() => query(task.options)).then(task.resolve, task.reject).finally(() => {
        historyActive--;
        runHistoryQueue();
      });
    }
  };
  const loadMessages = options => new Promise((resolve, reject) => {
    if (historyQueue.length >= 20) return reject(new Error('SQL_BUSY'));
    historyQueue.push({ options, resolve, reject });
    runHistoryQueue();
  });
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
    let url;
    try { url = new URL(req.url, 'http://' + host); }
    catch { return json(400, { error: 'INVALID_URL' }); }
    if (url.pathname === '/api/assistant/chat') {
      if (url.search) return json(400, { error: 'INVALID_QUERY' });
      if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
      const peer = String((req.socket && req.socket.remoteAddress) || req.headers['x-forwarded-for'] || 'unknown');
      const authRetryAfter = limitAssistantAuth(peer);
      if (authRetryAfter) {
        res.setHeader('Retry-After', String(authRetryAfter));
        return json(429, { error: 'AI_RATE_LIMITED' });
      }
      const accessToken = req.headers['x-witop-ai-access'];
      let authorized;
      try { authorized = await verifyAssistantAccess(accessToken); }
      catch (error) {
        return json(503, { error: error instanceof AssistantError ? error.code : 'AI_ACCESS_NOT_CONFIGURED' });
      }
      if (!authorized) return json(401, { error: 'AI_ACCESS_REQUIRED' });
      const rateKey = crypto.createHash('sha256').update(accessToken).digest('hex');
      const retryAfter = limitAssistant(rateKey);
      if (retryAfter) {
        res.setHeader('Retry-After', String(retryAfter));
        return json(429, { error: 'AI_RATE_LIMITED' });
      }
      if (assistantBusy) return json(429, { error: 'AI_BUSY' });
      assistantBusy = true;
      let heartbeat;
      try {
        let body;
        try { body = await readJsonBody(req); }
        catch (error) {
          const code = error instanceof AssistantError ? error.code : 'AI_INVALID_REQUEST';
          const status = code === 'AI_UNSUPPORTED_MEDIA_TYPE' ? 415 : code === 'AI_REQUEST_TOO_LARGE' ? 413 : 400;
          return json(status, { error: code });
        }
        if (!body || typeof body !== 'object' || Array.isArray(body) ||
            Object.keys(body).some(key => key !== 'messages')) return json(400, { error: 'AI_INVALID_REQUEST' });
        let messages;
        try { messages = validateMessages(body.messages); }
        catch { return json(400, { error: 'AI_INVALID_REQUEST' }); }
        const controller = new AbortController();
        let completed = false;
        req.once('aborted', () => controller.abort());
        res.once('close', () => { if (!completed) controller.abort(); });
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no'
        });
        if (typeof res.flushHeaders === 'function') res.flushHeaders();
        sse(res, 'meta', { model: assistant.model, mode: 'proposal-only' });
        heartbeat = setInterval(() => { if (!completed && !res.destroyed) res.write(': keepalive\n\n'); }, 15000);
        if (typeof heartbeat.unref === 'function') heartbeat.unref();
        try {
          const usage = await assistant.stream(messages, {
            signal: controller.signal,
            onText: text => {
              if (!controller.signal.aborted && typeof text === 'string' && text) sse(res, 'delta', { text });
            }
          });
          if (!controller.signal.aborted) {
            sse(res, 'done', { model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
            completed = true;
            res.end();
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            const allowed = new Set(['AI_NOT_CONFIGURED', 'AI_AUTH_FAILED', 'AI_CONFIGURATION_ERROR', 'AI_RATE_LIMITED',
              'AI_TEMPORARY_UNAVAILABLE', 'AI_REFUSED', 'AI_RESPONSE_TRUNCATED', 'AI_INCOMPLETE_RESPONSE',
              'AI_INVALID_REQUEST', 'AI_FAILED']);
            const code = error instanceof AssistantError && allowed.has(error.code) ? error.code : 'AI_FAILED';
            sse(res, 'error', { error: code });
            completed = true;
            res.end();
          }
        }
        return;
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        assistantBusy = false;
      }
    }
    if (req.method !== 'GET') return json(405, { error: 'READ_ONLY' });
    const health = url.pathname === '/healthz';
    if (health || url.pathname === '/api/receptions') {
      if (url.search) return json(400, { error: 'INVALID_QUERY' });
      // One bounded shared query at a time. Refreshes do not spawn unbounded DB clients.
      try {
        const result = await loadReceptions();
        if (!health) return json(200, result);
        if (result.ok !== true || result.source !== 'sqlserver') throw new Error('SQL_BRIDGE_INVALID_RESPONSE');
        return json(200, { ok: true, source: 'sqlserver', ts: new Date().toISOString() });
      } catch (error) {
        return json(503, { ...(health ? { ok: false, ts: new Date().toISOString() } : {}),
          source: 'sqlserver', error: SQL_ERRORS.has(error.message) ? error.message : 'SQL_QUERY_FAILED' });
      }
    }
    const history = url.pathname.match(/^\/api\/receptions\/(SQL-[a-f0-9]{24})\/messages$/);
    if (history) {
      if ([...url.searchParams.keys()].some(name => !['limit', 'cursor'].includes(name))) return json(400, { error: 'INVALID_QUERY' });
      const limit = integerParameter(url, 'limit', 50, { min: 1, max: 100 });
      const cursorValues = url.searchParams.getAll('cursor');
      if (limit === null || cursorValues.length > 1) return json(400, { error: 'INVALID_QUERY' });
      const stored = conversationRefs.get(history[1]);
      if (!stored || stored.expiresAt <= Date.now()) {
        conversationRefs.delete(history[1]);
        return json(404, { error: 'CONVERSATION_NOT_FOUND' });
      }
      let cursor;
      if (cursorValues.length) {
        const token = cursorValues[0];
        const cursorEntry = /^[a-f0-9]{48}$/.test(token) ? messageCursors.get(token) : undefined;
        if (!cursorEntry || cursorEntry.expiresAt <= Date.now() || cursorEntry.conversationId !== history[1]) {
          messageCursors.delete(token);
          return json(400, { error: 'INVALID_CURSOR' });
        }
        cursor = cursorEntry.cursor;
      }
      const conversation = stored.conversation;
      try {
        const result = await loadMessages({ mode: 'messages', limit, conversation, cursor });
        if (result.ok !== true || result.source !== 'sqlserver' || result.conversationId !== history[1]) {
          throw new Error('SQL_BRIDGE_INVALID_RESPONSE');
        }
        return json(200, exposeMessageCursor(result, history[1]));
      } catch (error) {
        return json(503, { source: 'sqlserver', error: SQL_ERRORS.has(error.message) ? error.message : 'SQL_QUERY_FAILED' });
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

module.exports = { createServer, createAssistantAccessVerifier, createAssistantRateLimiter };
if (require.main === module) {
  const port = Number(process.env.PORT || 8765);
  const server = createServer();
  server.on('error', error => { console.error('LOCAL_SERVER_START_FAILED ' + error.code); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log('接待工作台 http://127.0.0.1:' + server.address().port));
}
