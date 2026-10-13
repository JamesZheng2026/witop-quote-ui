// scripts/okki-adapter.js — OKKI (小满) 真实询盘数据接入适配层
// 设计目标：在不替换 mock 的前提下，提供 okki=on/off 开关和数据形态适配
// 探路状态：等待 James 提供 OKKI sandbox 凭证 + 端点选择
//   - 沙箱环境：https://api-sandbox.xiaoman.cn（官方文档确认这就是正式环境域名）
//   - 凭证：尚未提供
//
// 使用方式：
//   <script src="scripts/okki-adapter.js?v=..."></script>
//   window.okkiConfig = { enabled: false, base: 'https://api-sandbox.xiaoman.cn', token: '...' }
//   window.witopDataSource = window.okkiConfig.enabled ? window.okkiAdapter : window.mockAdapter
//
// 提供：
//   window.okkiAdapter.listInquiries(opts) → Promise<Inquiry[]>
//   window.okkiAdapter.listReception(opts) → Promise<Reception[]>
//   window.okkiAdapter.ping()             → Promise<{ok, status, ms, body?}>
//
// 字段映射（待 James 确认 OKKI 实际响应后回填）：
//   INQ.id              ← okki.inquiry.id / number
//   INQ.company         ← okki.contact.company
//   INQ.country         ← okki.contact.country
//   INQ.product         ← okki.product.name
//   INQ.intent          ← okki.ai.intent_level
//   INQ.status          ← okki.status (NEW/REVIEWED/QUOTING/QUOTED/NEGOTIATING/WON/LOST)
//   INQ.qty             ← okki.spec.qty
//   INQ.date            ← okki.created_at
//   ...
//
// 风险与边界：
//   1. 真实数据可能含敏感客户信息，禁止写入仓库、截图、日志
//   2. 限流：OKKI 公开限流 60 req/min，超出需退避
//   3. 离线 fallback：网络失败时返回 mock + console.warn
//   4. CORS：浏览器直连 OKKI 需要服务端代理或 OKKI 启用 CORS；待验证
(function () {
  'use strict'

  if (typeof window === 'undefined') return

  var DEFAULT_BASE = 'https://api-sandbox.xiaoman.cn'

  function getConfig() {
    return window.okkiConfig || { enabled: false, base: DEFAULT_BASE, token: null }
  }

  function headers(cfg) {
    var h = { 'Accept': 'application/json' }
    if (cfg.token) h['Authorization'] = 'Bearer ' + cfg.token
    return h
  }

  async function http(path, opts) {
    opts = opts || {}
    var cfg = getConfig()
    var url = cfg.base + path
    var t0 = Date.now()
    try {
      var resp = await fetch(url, {
        method: opts.method || 'GET',
        headers: Object.assign(headers(cfg), opts.headers || {}),
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      })
      var ms = Date.now() - t0
      var body = null
      try { body = await resp.json() } catch (e) { body = null }
      return { ok: resp.ok, status: resp.status, ms: ms, body: body }
    } catch (err) {
      return { ok: false, status: 0, ms: Date.now() - t0, error: err.message }
    }
  }

  // ---- ping ----
  async function ping() {
    // 试探端点：常见 health/ping/login（具体路径等 James 提供）
    return await http('/api/v1/health', { method: 'GET' })
  }

  // ---- listInquiries（字段映射占位）----
  async function listInquiries(opts) {
    opts = opts || {}
    var qs = new URLSearchParams()
    if (opts.from) qs.set('from', opts.from)
    if (opts.to) qs.set('to', opts.to)
    if (opts.status) qs.set('status', opts.status)
    if (opts.limit) qs.set('limit', String(opts.limit))
    var path = '/api/v1/inquiries' + (qs.toString() ? '?' + qs.toString() : '')
    var r = await http(path)
    if (!r.ok) {
      console.warn('[okki] listInquiries fallback to mock:', r.status, r.error || '')
      return (window.MOCK_INQUIRIES || []).slice()
    }
    // 字段映射占位：等待真实响应后回填
    return (r.body && r.body.data) || []
  }

  // ---- listReception（占位）----
  async function listReception(opts) {
    opts = opts || {}
    var path = '/api/v1/reception' + (opts.limit ? '?limit=' + opts.limit : '')
    var r = await http(path)
    if (!r.ok) {
      console.warn('[okki] listReception fallback to mock:', r.status, r.error || '')
      return (window.MOCK_RECEPTION || []).slice()
    }
    return (r.body && r.body.data) || []
  }

  window.okkiAdapter = {
    ping: ping,
    listInquiries: listInquiries,
    listReception: listReception,
    config: getConfig,
  }
})()
