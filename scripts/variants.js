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

  // ---- 2. 视图 A：极简信息密度 ----
  function renderA() {
    var inquiries = (window.MOCK_INQUIRIES || []).slice(0, 12)
    var counts = {
      total: (window.MOCK_INQUIRIES || []).length,
      quoting: (window.MOCK_INQUIRIES || []).filter(function (i) { return i.status === 'Quoting' || i.status === 'Quoted' }).length,
      handoff: (window.MOCK_RECEPTION || []).filter(function (r) { return r.receptionStatus === 'handoff' }).length,
    }
    return ''
      + '<div class="grid grid-cols-3 gap-4 mb-6">'
      +   '<div class="card p-5"><div class="text-xs text-slate-500 dark:text-slate-400 mb-1">询盘总数</div>'
      +     '<div class="text-3xl font-bold text-slate-900 dark:text-white">' + counts.total + '</div>'
      +     '<div class="text-xs text-slate-500 mt-1">今日 +' + todayPlus() + '</div></div>'
      +   '<div class="card p-5"><div class="text-xs text-slate-500 dark:text-slate-400 mb-1">报价中</div>'
      +     '<div class="text-3xl font-bold text-slate-900 dark:text-white">' + counts.quoting + '</div>'
      +     '<div class="text-xs text-slate-500 mt-1">Quoting / Quoted</div></div>'
      +   '<div class="card p-5"><div class="text-xs text-slate-500 dark:text-slate-400 mb-1">待人工</div>'
      +     '<div class="text-3xl font-bold text-slate-900 dark:text-white">' + counts.handoff + '</div>'
      +     '<div class="text-xs text-slate-500 mt-1">V3 接待 · 转人工</div></div>'
      + '</div>'
      + '<div class="card overflow-hidden">'
      +   '<div class="px-5 py-3 border-b border-slate-200 dark:border-slate-600">'
      +     '<h2 class="font-semibold text-sm text-slate-700 dark:text-slate-200">最近询盘 · 前 12 条</h2>'
      +   '</div>'
      +   '<div class="overflow-x-auto"><table class="data-table w-full text-sm">'
      +     '<thead><tr><th>ID</th><th>Company</th><th>Country</th><th>Channel</th><th>Status</th><th>Last Activity</th></tr></thead>'
      +     '<tbody>'
      +       inquiries.map(function (i) {
              var d = i.lastActivityAt ? fmtMs(i.lastActivityAt) : (i.date || '—')
              return '<tr class="cursor-pointer" onclick="showView(\'inquiry-detail\')">'
                + '<td class="text-slate-500">' + escHtml(i.id) + '</td>'
                + '<td class="font-medium text-slate-900 dark:text-white">' + escHtml(i.company) + '</td>'
                + '<td>' + escHtml(i.country) + '</td>'
                + '<td>' + escHtml(i.channel || '—') + '</td>'
                + '<td><span class="status-pill">' + escHtml(i.status) + '</span></td>'
                + '<td class="text-slate-500 text-xs">' + escHtml(d) + '</td>'
                + '</tr>'
            }).join('')
      +     '</tbody></table></div></div>'
  }

  // ---- 3. 视图 B：OKKI 风格 4 段工作台 ----
  function renderB() {
    var recs = window.MOCK_RECEPTION || []
    var segs = [
      { key: 'reception', label: '询盘接入', color: '#3B82F6' },
      { key: 'handoff',   label: '已接待',   color: '#10B981' },
      { key: 'handled',   label: '交付人工', color: '#F59E0B' },
      { key: 'blocked',   label: '人工已接手', color: '#8B5CF6' },
    ]
    var segsHtml = segs.map(function (s) {
      var list = recs.filter(function (r) { return r.receptionStatus === s.key })
      var n = list.length
      var top3 = list.slice(0, 3).map(function (r) {
        return '<div class="border border-slate-200 dark:border-slate-600 rounded-md p-3 mb-2 text-xs">'
          + '<div class="flex items-center justify-between mb-1">'
          +   '<span class="font-medium text-slate-900 dark:text-white">' + escHtml(r.company) + '</span>'
          +   '<span class="text-slate-400">' + escHtml(r.country || '') + '</span>'
          + '</div>'
          + '<div class="text-slate-500">' + escHtml(r.lastContactAt || '') + ' · ' + escHtml(r.channel || '') + '</div>'
          + '<div class="text-slate-600 dark:text-slate-300 mt-1">' + escHtml((r.summary || '').slice(0, 50)) + (r.summary && r.summary.length > 50 ? '…' : '') + '</div>'
          + '</div>'
      }).join('')
      return '<div class="rounded-lg p-4 flex-1 min-w-0" style="background:#F5F6F8;border:1px solid #E5E7EB">'
        + '<div class="flex items-center gap-2 mb-3">'
        +   '<span style="width:8px;height:8px;border-radius:9999px;background:' + s.color + '"></span>'
        +   '<span class="text-sm font-semibold text-slate-700">' + s.label + '</span>'
        + '</div>'
        + '<div class="flex items-baseline gap-2 mb-1">'
        +   '<span style="font-size:24px;font-weight:700;color:#1A2332">' + n + '</span>'
        +   '<span class="text-xs text-slate-500">+ ' + todayPlus() + ' 今日</span>'
        + '</div>'
        + '<div class="mt-2 max-h-48 overflow-y-auto">' + (top3 || '<div class="text-xs text-slate-400">— 无 —</div>') + '</div>'
        + '</div>'
    }).join('')

    return '<div class="card p-5 mb-6"><div class="grid grid-cols-4 gap-3">' + segsHtml + '</div></div>'
      + '<div class="card overflow-hidden">'
      +   '<div class="px-5 py-3 border-b border-slate-200 dark:border-slate-600 flex items-center justify-between">'
      +     '<h2 class="font-semibold text-sm text-slate-700 dark:text-slate-200">接待卡片列表</h2>'
      +     '<button class="btn btn-secondary btn-sm" onclick="showView(\'reception-workbench\')">完整工作台</button>'
      +   '</div>'
      +   '<div class="overflow-x-auto"><table class="data-table w-full text-sm">'
      +     '<thead><tr><th>ID</th><th>公司</th><th>国家</th><th>渠道</th><th>状态</th><th>最近沟通</th></tr></thead>'
      +     '<tbody>'
      +       recs.slice(0, 10).map(function (r) {
              return '<tr class="cursor-pointer" onclick="showView(\'reception-workbench\')">'
                + '<td class="text-slate-500">' + escHtml(r.id) + '</td>'
                + '<td class="font-medium text-slate-900 dark:text-white">' + escHtml(r.company) + '</td>'
                + '<td>' + escHtml(r.country || '—') + '</td>'
                + '<td>' + escHtml(r.channel || '—') + '</td>'
                + '<td>' + escHtml(r.receptionStatus) + '</td>'
                + '<td class="text-slate-500 text-xs">' + escHtml(r.lastContactAt || '—') + '</td>'
                + '</tr>'
            }).join('')
      +     '</tbody></table></div></div>'
  }

  // ---- 4. 视图 C：AI 报价分析主导 ----
  function renderC() {
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

  // ---- 5. 切换器 + 三容器渲染 ----
  function switcherHtml() {
    return '<div class="flex items-center justify-between mb-5">'
      + '<div class="inline-flex rounded-md border border-slate-200 dark:border-slate-600 overflow-hidden" id="witop-abc-switcher">'
      +   '<button type="button" data-v="a" class="px-4 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 border-r border-slate-200 dark:border-slate-600">A · 极简</button>'
      +   '<button type="button" data-v="b" class="px-4 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 border-r border-slate-200 dark:border-slate-600">B · OKKI</button>'
      +   '<button type="button" data-v="c" class="px-4 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">C · AI分析</button>'
      + '</div>'
      + '<div class="text-xs text-slate-500"><span id="witop-now">—</span> · 今日 +' + todayPlus() + '</div>'
      + '</div>'
  }

  function applyVariantVisual(v) {
    document.querySelectorAll('#witop-abc-switcher button').forEach(function (btn) {
      var isActive = btn.getAttribute('data-v') === v
      btn.style.background = isActive ? '#2563eb' : 'transparent'
      btn.style.color = isActive ? '#fff' : ''
      if (isActive) {
        btn.style.borderBottom = '2px solid #2563eb'
      }
    })
    var map = { a: 'variant-a', b: 'variant-b', c: 'variant-c' }
    Object.keys(map).forEach(function (k) {
      var el = document.getElementById(map[k])
      if (el) el.classList.toggle('hidden', k !== v)
    })
  }

  function renderInto() {
    var aEl = document.getElementById('variant-a')
    var bEl = document.getElementById('variant-b')
    var cEl = document.getElementById('variant-c')
    if (aEl && !aEl.dataset.rendered) { aEl.innerHTML = renderA(); aEl.dataset.rendered = '1' }
    if (bEl && !bEl.dataset.rendered) { bEl.innerHTML = renderB(); bEl.dataset.rendered = '1' }
    if (cEl && !cEl.dataset.rendered) { cEl.innerHTML = renderC(); cEl.dataset.rendered = '1' }
  }

  function setVariant(v, opts) {
    if (!['a', 'b', 'c'].includes(v)) v = 'a'
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
    try {
      var p = new URLSearchParams(location.search)
      var v = p.get('v')
      if (v && ['a', 'b', 'c'].includes(v)) return v
    } catch (e) {}
    try {
      var s = localStorage.getItem('witop_abc_variant')
      if (s && ['a', 'b', 'c'].includes(s)) return s
    } catch (e) {}
    return 'a'
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
