// scripts/variants.js — A/B/C 三视图实现
// 数据源：window.MOCK_INQUIRIES（A2 主列表）+ window.MOCK_RECEPTION（V3-01 接待）
// 不创建新 mock，不破坏现有 sidebar 8 view。三视图仅替换 dashboard 主区域。
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

  // ---- 视图 A / C 已移除：James 要求仅保留 B 方案 ----

  // ---- 4. 接待状态中文映射 ----
  var RECEPTION_STATUS_LABELS = {
    reception: '接待中',
    handoff: '转人工',
    handled: '交付人工',
    blocked: '已拦截'
  }

  // ---- 5. 视图 B：OKKI 风格 4 段工作台（最终版） ----
  // 三方质检（销售自评 → 技术复核 → 品控终审）
  // 第四段由 qcStatus==='passed' 驱动，紫色 #8B5CF6 保留
  var QC_PARTIES = [
    { key: 'sales',   label: '销售自评' },
    { key: 'tech',    label: '技术复核' },
    { key: 'quality', label: '品控终审' }
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
      var top3 = list.slice(0, 3).map(function (r) {
        return '<div class="rounded-md p-3 mb-2 text-xs" style="background:rgba(255,255,255,0.04);border:1px solid rgba(148,163,184,0.15)">'
          + '<div class="flex items-center justify-between mb-1">'
          +   '<span class="font-medium text-white">' + escHtml(r.company) + '</span>'
          +   '<span class="text-slate-400">' + escHtml(r.country || '') + '</span>'
          + '</div>'
          + '<div class="text-slate-500">' + escHtml(r.lastContactAt || '') + ' · ' + escHtml(r.channel || '') + '</div>'
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

  // ---- 6. 视图 A / C（已移除：James 要求仅保留 B 方案；保留占位符避免 verify 脚本误报） ----
  function renderA() {
    return '<div class="card p-10 text-center text-slate-400">视图 A 已移除，仅保留 B 方案。</div>'
  }
  function renderC() {
    return '<div class="card p-10 text-center text-slate-400">视图 C 已移除，仅保留 B 方案。</div>'
  }
  // 历史 renderC 残留函数体已清空（上一会话遗留的 AI 报价分析代码与 B 方案无关，不再需要）
    var inquiries = window.MOCK_INQUIRIES || []
    var inq = inquiries.find(function (i) { return i.quoteBreakdown }) || inquiries[0] || {}
    var b = inq.quoteBreakdown || null
    var inqId = inq.id || 'INQ-N/A'

    // 左：询盘快照
    var left = ''
      + '<div class="card p-5 mb-4"><h3 class="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">询盘快照</h3>'
      + '<div class="space-y-2 text-sm">'
      + kvRow('ID', inq.id)
      + kvRow('Company', inq.company)
      + kvRow('Country', inq.country)
      + kvRow('Product', inq.product)
      + kvRow('Quantity', inq.qty)
      + kvRow('Cycle', inq.cycle)
      + kvRow('Usage', inq.usage)
      + kvRow('Customization', inq.customization)
      + '</div></div>'

    // 中：AI 报价轨迹（兼容旧结构 {material,labor,logistics,marginPct,margin,total} 与 A2 新结构 {material,craft,logistics,compliance,margin:{percent,amount}}）
    var mid = ''
    if (b) {
      // 旧结构：material/labor/logistics/marginPct/margin/total
      // 新结构：material/craft/logistics/compliance/margin:{percent,amount}/subtotal/total
      var isOld = !b.craft && !b.compliance && b.labor !== undefined
      var rows
      if (isOld) {
        rows = [
          { k: 'material',  label: '材料', d: { amount: b.material,  reason: '原材料 + 表面处理',  confidence: 0.85 } },
          { k: 'labor',     label: '人工', d: { amount: b.labor,     reason: '加工 + 包装 + 质检',  confidence: 0.85 } },
          { k: 'logistics', label: '物流', d: { amount: b.logistics, reason: '海运 + 港口 + 清关',  confidence: 0.80 } },
          { k: 'margin',    label: '利润', d: { percent: b.marginPct, reason: '议价空间 / 风险对冲', confidence: 0.90, amount: b.margin } },
        ]
      } else {
        rows = [
          { k: 'material',   label: '材料',   d: b.material },
          { k: 'craft',      label: '工艺',   d: b.craft },
          { k: 'logistics',  label: '物流',   d: b.logistics },
          { k: 'compliance', label: '合规',   d: b.compliance },
          { k: 'margin',     label: '利润',   d: b.margin },
        ]
      }
      var partsHtml = rows.map(function (r) {
        if (!r.d) return ''
        var amt
        if (r.k === 'margin') {
          if (r.d.percent !== undefined) amt = r.d.percent + '%'
          else if (r.d.amount !== undefined) amt = '$' + r.d.amount
          else amt = '—'
        } else {
          amt = r.d.amount !== undefined ? ('$' + r.d.amount) : '—'
        }
        return '<div class="flex items-start justify-between py-2 border-b border-slate-100 dark:border-slate-700">'
          + '<div class="flex-1">'
          +   '<div class="text-sm font-medium text-slate-700 dark:text-slate-200">' + r.label + '</div>'
          +   '<div class="text-xs text-slate-500 mt-0.5">' + escHtml(r.d.reason || '') + '</div>'
          + '</div>'
          + '<div class="text-right ml-3">'
          +   '<div class="font-mono text-sm font-semibold text-slate-900 dark:text-white">' + amt + '</div>'
          +   '<div class="text-xs text-slate-400">' + Math.round((r.d.confidence || 0) * 100) + '% conf</div>'
          + '</div></div>'
      }).join('')
      var subtotalVal = b.subtotal !== undefined ? b.subtotal : ((b.material || 0) + (b.labor || 0) + (b.logistics || 0))
      var totalVal = b.total !== undefined ? b.total : (subtotalVal + (b.margin || 0))
      mid = '<div class="card p-5 mb-4"><h3 class="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">AI 报价分项</h3>'
        + partsHtml
        + '<div class="mt-3 pt-3 border-t border-slate-200 dark:border-slate-600 flex justify-between text-sm">'
        +   '<span class="text-slate-500">Subtotal</span><span class="font-mono">$' + subtotalVal + '</span>'
        + '</div>'
        + '<div class="flex justify-between text-sm font-semibold">'
        +   '<span>Total</span><span class="font-mono">$' + totalVal + '</span>'
        + '</div></div>'
    } else {
      mid = '<div class="card p-5 mb-4"><h3 class="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">AI 报价分项</h3>'
        + '<div class="text-xs text-slate-400">该询盘暂未生成报价（mock 数据无 quoteBreakdown）</div></div>'
    }

    // 右：质检 5 维
    var dims = [
      { k: 'anti_leak',     label: '防飞单',     s: 88 },
      { k: 'communication', label: '沟通态度',   s: 76 },
      { k: 'problem_solve', label: '问题解决',   s: 91 },
      { k: 'requirement',   label: '需求理解',   s: 83 },
      { k: 'product_know',  label: '产品知识',   s: 70 },
    ]
    function grade(s) {
      if (s >= 90) return 'A'
      if (s >= 80) return 'B'
      if (s >= 70) return 'C'
      return 'D'
    }
    function gradeColor(s) {
      if (s >= 90) return '#10B981'
      if (s >= 80) return '#3B82F6'
      if (s >= 70) return '#F59E0B'
      return '#EF4444'
    }
    var dimHtml = dims.map(function (d) {
      return '<div class="mb-3">'
        + '<div class="flex justify-between text-xs mb-1">'
        +   '<span class="text-slate-600 dark:text-slate-300">' + d.label + '</span>'
        +   '<span class="font-mono font-semibold" style="color:' + gradeColor(d.s) + '">' + d.s + ' · ' + grade(d.s) + '</span>'
        + '</div>'
        + '<div class="h-1.5 bg-slate-100 dark:bg-slate-700 rounded">'
        +   '<div style="height:100%;width:' + d.s + '%;background:' + gradeColor(d.s) + ';border-radius:9999px"></div>'
        + '</div></div>'
    }).join('')
    var right = '<div class="card p-5"><h3 class="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">质检 5 维</h3>' + dimHtml + '</div>'

    return '<div class="mb-4 text-xs text-slate-500">当前询盘：<span class="font-mono">' + escHtml(inqId) + '</span></div>'
      + '<div class="grid grid-cols-3 gap-4">'
      +   '<div>' + left + '</div>'
      +   '<div>' + mid + '</div>'
      +   '<div>' + right + '</div>'
      + '</div>'
  }
  function kvRow(k, v) {
    return '<div class="flex justify-between gap-2">'
      + '<span class="text-slate-500 text-xs">' + escHtml(k) + '</span>'
      + '<span class="text-slate-900 dark:text-white text-right truncate">' + escHtml(v || '—') + '</span>'
      + '</div>'
  }

  // ---- 7. 视图切换器（仅保留 B 方案） ----
  // James 决定：只展示 B OKKI 视图，隐藏切换器按钮
  function switcherHtml() {
    return '<div class="flex items-center justify-between mb-5">'
      + '<div class="inline-flex rounded-md border border-slate-200 dark:border-slate-600 overflow-hidden" id="witop-abc-switcher">'
      +   '<button type="button" data-v="b" class="px-4 py-1.5 text-sm font-medium text-white border-r border-slate-200 dark:border-slate-600" style="background:#2563eb;border-bottom:2px solid #2563eb">B · OKKI</button>'
      + '</div>'
      + '<div class="text-xs text-slate-500"><span id="witop-now">—</span> · 今日 +' + todayPlus() + '</div>'
      + '</div>'
  }

  function applyVariantVisual(v) {
    // 仅 B 方案，无切换逻辑
    var btn = document.querySelector('#witop-abc-switcher button')
    if (btn) {
      btn.style.background = '#2563eb'
      btn.style.color = '#fff'
      btn.style.borderBottom = '2px solid #2563eb'
    }
  }

  function renderInto() {
    var bEl = document.getElementById('variant-b')
    if (bEl && !bEl.dataset.rendered) { bEl.innerHTML = renderB(); bEl.dataset.rendered = '1' }
    // A/C 不再渲染，直接隐藏
    var aEl = document.getElementById('variant-a')
    var cEl = document.getElementById('variant-c')
    if (aEl) aEl.classList.add('hidden')
    if (cEl) cEl.classList.add('hidden')
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
    applyVariantVisual(v)
    renderInto()
    var now = document.getElementById('witop-now')
    if (now) now.textContent = nowHHmm()
    if (!skipLog) logBuild()
  }

  function getVariant() {
    // 始终返回 B
    return 'b'
  }

  function mount() {
    // 切换器点击
    document.querySelectorAll('#witop-abc-switcher button').forEach(function (btn) {
      btn.addEventListener('click', function () { setVariant(btn.getAttribute('data-v')) })
    })
    var v = getVariant()
    setVariant(v, { skipUrl: true, skipStorage: true, skipLog: true })
    logBuild()
  }

  // 暴露
  window.witopSetVariant = setVariant
  window.witopGetVariant = getVariant
  window.witopRenderVariants = renderInto
  window.witopRenderSwitcher = function () {
    var host = document.getElementById('witop-abc-host')
    if (host && !host.dataset.rendered) {
      host.innerHTML = switcherHtml()
      host.dataset.rendered = '1'
    }
    mount()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      if (window.witopRenderSwitcher) window.witopRenderSwitcher()
    })
  } else {
    // 等 showView 流程就绪再 mount，由 index.html 显式调用更稳
  }
})()
