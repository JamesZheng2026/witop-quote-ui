// scripts/variants.js — 接待工作台
// 数据源：window.MOCK_INQUIRIES（A2 主列表）+ window.MOCK_RECEPTION（V3-01 接待）
// 使用现有 mock，仅替换 dashboard 主区域。
(function () {
  'use strict'

  if (typeof window === 'undefined') return

  // ---- 0. build 版本号输出（缓存修复 #3） ----
  function logBuild() {
    fetch('scripts/build-info.json?_=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (info) {
        if (!info) return
        var qs = new URLSearchParams(location.search)
        console.info('%cWitop build', 'color:#2563eb;font-weight:600', {
          sha: info.sha,
          ts: info.ts,
          builtAt: info.builtAt,
          variant: window.witopGetVariant ? window.witopGetVariant() : '?',
          urlTs: qs.get('_') || null,
        })
      })
      .catch(function () { /* offline / file:// — silent */ })
  }

  // ---- 1. 工具 ----
  function escHtml(s) {
    if (s === null || s === undefined) return ''
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }
  function fmtMs(ts) {
    if (!ts) return '—'
    var d = new Date(ts)
    if (isNaN(d.getTime())) return '—'
    return d.toISOString().slice(0, 16).replace('T', ' ')
  }
  function todayPlus() {
    // 模拟"今日 +N" 数字
    return Math.floor(Math.random() * 8) + 1
  }
  function nowHHmm() {
    var d = new Date()
    var h = String(d.getHours()).padStart(2, '0')
    var m = String(d.getMinutes()).padStart(2, '0')
    return h + ':' + m
  }

  // ---- 视图 A / C 已物理移除：James 2026-10-13 确认仅保留 AI 接待工作台 ----

  // ---- 4. 接待状态与渠道中文映射 ----
  var RECEPTION_STATUS_LABELS = {
    reception: '接待中',
    handoff: '转人工',
    handled: '交付人工',
    blocked: '已拦截'
  }
  var CHANNEL_LABELS = {
    email: '邮件',
    whatsapp: 'WhatsApp',
    mixed: '邮件+WhatsApp'
  }
  function channelLabel(c) {
    return CHANNEL_LABELS[c] || c || ''
  }

  // ---- 5. 视图 B：OKKI 风格 4 段工作台（最终版） ----
  // 三方质检（销售自评 → 技术复核 → AI 质检/品控终审）
  // 第四段由 qcStatus==='passed' 驱动，紫色 #8B5CF6 保留
  var QC_PARTIES = [
    { key: 'sales',   label: '销售自评' },
    { key: 'tech',    label: '技术复核' },
    { key: 'quality', label: 'AI 质检 · 品控终审' }
  ]
  var QC_PARTIES_LABEL = QC_PARTIES.map(function (p) { return p.label }).join(' · ')

  // B 视图配色（深色工作台风格，对齐 James 截图）
  var B_TOTAL = 128
  var B_GRADE = { S: 3, A: 5, B: 9, C: 4 }
  var B_TRENDS = [
    { label: '本周', delta: '+12%', up: true },
    { label: '新增', delta: '+8',   up: true },
    { label: '今日', delta: '+5',   up: true },
    { label: '环比', delta: '-1.2%', up: false },
  ]

  function renderB() {
    var recs = window.MOCK_RECEPTION || []
    var segs = [
      { key: 'reception', label: '询盘总数', color: '#3B82F6', filterFn: function (r) { return r.receptionStatus === 'reception' }, big: B_TOTAL, trend: B_TRENDS[0] },
      { key: 'handoff',   label: 'S / A 级', color: '#10B981', filterFn: function (r) { return r.receptionStatus === 'handoff' },   big: B_GRADE.S + B_GRADE.A, trend: B_TRENDS[1] },
      { key: 'handled',   label: '已发报价', color: '#F59E0B', filterFn: function (r) { return r.receptionStatus === 'handled' },   big: 62,  trend: B_TRENDS[2] },
      { key: 'qcPassed',  label: '质检通过', color: '#8B5CF6', filterFn: function (r) { return r.qcStatus === 'passed' },           big: 28.9, trend: B_TRENDS[3], suffix: '%' },
    ]
    // 全局三方质检统计：用于 qcPassed 卡下方 + 表头小注
    var qcCounts = {
      inReview: recs.filter(function (r) { return r.qcStatus === 'in_review' }).length,
      pending:  recs.filter(function (r) { return r.qcStatus === 'pending'  }).length,
      passed:   recs.filter(function (r) { return r.qcStatus === 'passed'   }).length,
      failed:   recs.filter(function (r) { return r.qcStatus === 'failed'   }).length
    }

    // 顶部 4 卡 — 深蓝灰圆角 + 白色大数字 + 趋势
    var segsHtml = segs.map(function (s) {
      var list = recs.filter(s.filterFn)
      var n = list.length
      var qcMeta = (s.key === 'qcPassed')
        ? '<div class="text-xs text-slate-400 mt-2 leading-relaxed">'
          + '三方质检：' + QC_PARTIES_LABEL + '<br/>'
          + '质检中 ' + qcCounts.inReview + ' · 待审 ' + qcCounts.pending
          + ' · 已通过 ' + qcCounts.passed + ' · 未通过 ' + qcCounts.failed
          + '</div>'
        : ''
      var top3 = list.slice(0, 2).map(function (r) {
        return '<div class="rounded-md p-3 mb-2 text-xs" style="background:rgba(255,255,255,0.04);border:1px solid rgba(148,163,184,0.15)">'
          + '<div class="flex items-center justify-between mb-1">'
          +   '<span class="font-medium text-white">' + escHtml(r.company) + '</span>'
          +   '<span class="text-slate-400">' + escHtml(r.country || '') + '</span>'
          + '</div>'
          + '<div class="text-slate-500">' + escHtml(r.lastContactAt || '') + ' · ' + escHtml(channelLabel(r.channel)) + '</div>'
          + '</div>'
      }).join('')
      var trendHtml = '<div class="flex items-center gap-2 mt-1">'
        + '<span class="text-xs text-slate-400">' + escHtml(s.trend.label) + '</span>'
        + '<span class="text-xs font-semibold" style="color:' + (s.trend.up ? '#10B981' : '#EF4444') + '">' + escHtml(s.trend.delta) + '</span>'
        + '</div>'
      return '<div class="rounded-2xl p-5 flex-1 min-w-0" style="background:#1E293B;border:1px solid #334155">'
        + '<div class="flex items-center gap-2 mb-3">'
        +   '<span style="width:8px;height:8px;border-radius:9999px;background:' + s.color + '"></span>'
        +   '<span class="text-sm text-slate-300">' + s.label + '</span>'
        + '</div>'
        + '<div class="flex items-baseline gap-1">'
        +   '<span style="font-size:32px;font-weight:700;color:#F8FAFC;line-height:1.1">' + s.big + (s.suffix || '') + '</span>'
        + '</div>'
        + trendHtml
        + qcMeta
        + '<div class="mt-3 max-h-40 overflow-y-auto">' + (top3 || '<div class="text-xs text-slate-500">— 无 —</div>') + '</div>'
        + '</div>'
    }).join('')

    // 质检状态颜色映射
    var qcStatusColor = { pending: '#94a3b8', in_review: '#F59E0B', passed: '#10B981', failed: '#EF4444' }
    var qcStatusLabel = { pending: '待质检', in_review: '质检中', passed: '已通过', failed: '未通过' }
    var qcStatusBg    = { pending: 'rgba(148,163,184,0.12)', in_review: 'rgba(245,158,11,0.12)', passed: 'rgba(16,185,129,0.12)', failed: 'rgba(239,68,68,0.12)' }
    // 客户分级 S/A/B/C 胶囊
    var gradeColor = { S: { bg: 'rgba(244,63,94,0.12)', fg: '#FB7185' }, A: { bg: 'rgba(245,158,11,0.12)', fg: '#FBBF24' }, B: { bg: 'rgba(59,130,246,0.12)', fg: '#60A5FA' }, C: { bg: 'rgba(148,163,184,0.12)', fg: '#94A3B8' } }
    function gradePill(g) {
      var c = gradeColor[g] || gradeColor.C
      return '<span style="display:inline-block;padding:2px 10px;border-radius:9999px;font-size:11px;font-weight:600;background:' + c.bg + ';color:' + c.fg + '">' + escHtml(g) + '</span>'
    }
    // 意向 冷/温/热 胶囊
    var intentColor = { hot: { bg: 'rgba(124,45,18,0.40)', fg: '#FB923C' }, warm: { bg: 'rgba(69,26,3,0.40)', fg: '#FB923C' }, cold: { bg: 'rgba(30,41,59,0.60)', fg: '#94A3B8' } }
    function intentPill(it) {
      var c = intentColor[it] || intentColor.cold
      var label = it === 'hot' ? '热' : it === 'warm' ? '温' : '冷'
      return '<span style="display:inline-block;padding:2px 10px;border-radius:9999px;font-size:11px;font-weight:600;background:' + c.bg + ';color:' + c.fg + '">' + label + '</span>'
    }
    // 状态（已发报价/AI筛选中等）胶囊
    function statusPill(text) {
      return '<span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:11px;font-weight:500;background:rgba(148,163,184,0.10);color:#CBD5E1">' + escHtml(text) + '</span>'
    }
    // 质检状态胶囊（带前置色点）
    function qcPill(qc) {
      var c = qcStatusColor[qc] || '#94A3B8'
      var bg = qcStatusBg[qc] || qcStatusBg.pending
      var text = qcStatusLabel[qc] || qc
      return '<span style="display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:9999px;font-size:11px;font-weight:600;background:' + bg + ';color:' + c + '">'
        + '<span style="width:6px;height:6px;border-radius:50%;background:' + c + '"></span>' + escHtml(text) + '</span>'
    }

    var tableRows = recs.map(function (r) {
      var qc = r.qcStatus || 'pending'
      var recLabel = RECEPTION_STATUS_LABELS[r.receptionStatus] || r.receptionStatus
      return '<tr class="cursor-pointer" onclick="showView(\'reception-workbench\')" style="border-bottom:1px solid rgba(148,163,184,0.08)">'
        + '<td style="padding:14px 16px;color:#94A3B8;font-size:12px">' + escHtml(r.id) + '</td>'
        + '<td style="padding:14px 16px;color:#F8FAFC;font-weight:500">' + escHtml(r.company) + '</td>'
        + '<td style="padding:14px 16px;color:#CBD5E1">' + escHtml(r.country || '—') + '</td>'
        + '<td style="padding:14px 16px">' + gradePill(r.grade || 'C') + '</td>'
        + '<td style="padding:14px 16px">' + intentPill(r.intent || 'cold') + '</td>'
        + '<td style="padding:14px 16px">' + statusPill(recLabel) + '</td>'
        + '<td style="padding:14px 16px">' + qcPill(qc) + '</td>'
        + '<td style="padding:14px 16px;color:#94A3B8;font-size:12px;white-space:nowrap">' + escHtml(r.lastContactAt || '—') + '</td>'
        + '</tr>'
    }).join('')

    // S/A/B/C 顶部统计胶囊（点击 = 筛选）
    function gradeChip(g) {
      var n = B_GRADE[g] || 0
      var c = gradeColor[g]
      return '<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:9999px;font-size:12px;font-weight:600;background:' + c.bg + ';color:' + c.fg + ';border:1px solid rgba(148,163,184,0.12)">'
        + escHtml(g) + ' ' + n + '</span>'
    }

    return ''
      // 顶部 4 卡 — 圆角深蓝灰
      + '<div class="rounded-2xl p-5 mb-6" style="background:#1E293B;border:1px solid #334155">'
      +   '<div class="grid grid-cols-4 gap-4">' + segsHtml + '</div>'
      + '</div>'
      // 接待卡片列表
      + '<div class="rounded-2xl overflow-hidden" style="background:#1E293B;border:1px solid #334155">'
      +   '<div class="px-5 py-4 flex flex-wrap items-center justify-between gap-3" style="border-bottom:1px solid #334155">'
      +     '<div>'
      +       '<h2 class="font-semibold text-base text-white">最近询盘</h2>'
      +       '<p class="text-xs text-slate-400 mt-1">三方质检：' + QC_PARTIES_LABEL + ' · 任方未通过即不进入"质检通过"</p>'
      +     '</div>'
      +     '<div class="flex items-center gap-2">'
      +       gradeChip('S') + gradeChip('A') + gradeChip('B') + gradeChip('C')
      +     '</div>'
      +   '</div>'
      +   '<div class="overflow-x-auto"><table class="w-full" style="border-collapse:collapse">'
      +     '<thead><tr style="background:rgba(15,23,42,0.5)">'
      +       '<th style="padding:12px 16px;text-align:left;font-size:11px;font-weight:600;color:#94A3B8;text-transform:uppercase;letter-spacing:0.05em">编号</th>'
      +       '<th style="padding:12px 16px;text-align:left;font-size:11px;font-weight:600;color:#94A3B8;text-transform:uppercase;letter-spacing:0.05em">客户</th>'
      +       '<th style="padding:12px 16px;text-align:left;font-size:11px;font-weight:600;color:#94A3B8;text-transform:uppercase;letter-spacing:0.05em">国家</th>'
      +       '<th style="padding:12px 16px;text-align:left;font-size:11px;font-weight:600;color:#94A3B8;text-transform:uppercase;letter-spacing:0.05em">分级</th>'
      +       '<th style="padding:12px 16px;text-align:left;font-size:11px;font-weight:600;color:#94A3B8;text-transform:uppercase;letter-spacing:0.05em">意向</th>'
      +       '<th style="padding:12px 16px;text-align:left;font-size:11px;font-weight:600;color:#94A3B8;text-transform:uppercase;letter-spacing:0.05em">状态</th>'
      +       '<th style="padding:12px 16px;text-align:left;font-size:11px;font-weight:600;color:#94A3B8;text-transform:uppercase;letter-spacing:0.05em">质检状态</th>'
      +       '<th style="padding:12px 16px;text-align:left;font-size:11px;font-weight:600;color:#94A3B8;text-transform:uppercase;letter-spacing:0.05em">更新</th>'
      +     '</tr></thead>'
      +     '<tbody>' + tableRows + '</tbody></table></div></div>'
  }

  // 工作台时间栏
  function renderBHeader() {
    return '<div class="flex items-center justify-between mb-5">'
      + '<div class="text-xs text-slate-400">维特普装饰 · AI 接待工作台</div>'
      + '<div class="text-xs text-slate-500"><span id="witop-now">—</span> · 今日 +' + todayPlus() + '</div>'
      + '</div>'
  }

  function applyVariantVisual(v) {
    // 仅 AI 接待工作台，无切换逻辑
  }

  function renderInto() {
    var bEl = document.getElementById('variant-b')
    if (bEl) {
      if (!bEl.dataset.rendered) {
        var host = document.getElementById('witop-abc-host')
        if (host && !host.dataset.rendered) {
          host.innerHTML = renderBHeader()
          host.dataset.rendered = '1'
        }
        bEl.innerHTML = renderB()
        bEl.dataset.rendered = '1'
      }
      // 关键：必须取消 hidden，否则 B 视图永远不可见
      bEl.classList.remove('hidden')
    }
  }

  function setVariant(v, opts) {
    // 强制 B，忽略其他参数
    v = 'b'
    var skipUrl = opts && opts.skipUrl
    var skipStorage = opts && opts.skipStorage
    var skipLog = opts && opts.skipLog
    if (!skipUrl) {
      try {
        var url = new URL(location.href)
        url.searchParams.set('v', v)
        history.replaceState(null, '', url.toString())
      } catch (e) { /* file:// — silent */ }
    }
    if (!skipStorage) {
      try { localStorage.setItem('witop_abc_variant', v) } catch (e) {}
    }
    renderInto()
    var now = document.getElementById('witop-now')
    if (now) now.textContent = nowHHmm()
    if (!skipLog) logBuild()
  }

  function getVariant() {
    // 始终返回 B
    return 'b'
  }

  // Issue #9 Bug 1: 接待状态变化后,主动刷新 B 视图(首页工作台)的统计与列表
  // 原来 renderInto() 依赖 bEl.dataset.rendered 幂等缓存,导致 REC-002 转人工后
  // 首页状态不同步;这里暴露一个强制重渲染入口,reception-bridge 会调用。
  function refreshBoard() {
    var bEl = document.getElementById('variant-b')
    var host = document.getElementById('witop-abc-host')
    if (bEl) delete bEl.dataset.rendered
    if (host) delete host.dataset.rendered
    renderInto()
    var now = document.getElementById('witop-now')
    if (now) now.textContent = nowHHmm()
  }

  // 暴露
  window.witopSetVariant = setVariant
  window.witopGetVariant = getVariant
  window.witopRenderVariants = renderInto
  window.witopRefreshBoard = refreshBoard
  window.witopRenderSwitcher = function () {
    // 兼容 index.html 的工作台初始化入口
    renderInto()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      if (window.witopRenderSwitcher) window.witopRenderSwitcher()
    })
  } else {
    // 等 showView 流程就绪再 mount，由 index.html 显式调用更稳
  }
})()
