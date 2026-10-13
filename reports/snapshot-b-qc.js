// reports/snapshot-b-qc.js — B 视图质检升级专项截图
// 直接等 #variant-b 出现内容（不依赖切换器渲染）
const puppeteer = require('puppeteer-core')
const fs = require('fs')
const path = require('path')

const BASE = process.env.BASE || 'http://127.0.0.1:8766'
const OUT_DIR = path.join(__dirname, 'abc-views')

;(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })

  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })

  const errs = []
  page.on('pageerror', function (e) { errs.push('[pageerror] ' + e.message) })
  page.on('console', function (m) {
    var t = m.text()
    if (m.type() === 'error' && !/favicon|tailwindcss/i.test(t)) errs.push('[console.error] ' + t)
  })

  // 默认 URL 就是 ?v=b(B 是当前主视图);也强制设 localStorage
  await page.evaluateOnNewDocument(function () {
    try { localStorage.setItem('witop.variant', 'b') } catch (e) {}
  })
  const url = BASE + '/index.html?v=b&_=' + Date.now()
  console.log('navigate', url)
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 20000 })

  // 等 B 视图渲染(renderInto 把它写到 #variant-b)
  await page.waitForFunction(function () {
    var el = document.getElementById('variant-b')
    return el && el.children.length > 0
  }, { timeout: 10000 })
  // 让 Tailwind CDN 把样式跑完
  await new Promise(function (r) { setTimeout(r, 600) })

  const out = path.join(OUT_DIR, 'b-qc.png')
  await page.screenshot({ path: out, fullPage: false })
  console.log('->', out)

  // 顺手取一下 B 视图的统计数字 + 表头列,做证据
  const evidence = await page.evaluate(function () {
    var host = document.getElementById('variant-b')
    if (!host) return { error: 'no #variant-b' }
    var cards = host.querySelectorAll('.rounded-2xl > .grid > div')
    var cardLabels = []
    cards.forEach(function (c) {
      var label = c.querySelector('.text-sm') ? c.querySelector('.text-sm').innerText : ''
      var big = c.querySelector('[style*="font-size:32px"]') ? c.querySelector('[style*="font-size:32px"]').innerText : ''
      cardLabels.push(label + ' = ' + big)
    })
    var ths = host.querySelectorAll('th')
    var headers = []
    ths.forEach(function (th) { headers.push(th.innerText.trim()) })
    var qcMeta = ''
    host.querySelectorAll('div').forEach(function (d) {
      var t = d.innerText || ''
      if (t.indexOf('三方质检：') === 0 && t.length < 200) qcMeta = t
    })
    return { cardLabels: cardLabels, headers: headers, qcMeta: qcMeta }
  })
  console.log('evidence:', JSON.stringify(evidence, null, 2))
  console.log('errors:', errs.length ? errs : 'none')
  await browser.close()
})().catch(function (e) { console.error(e); process.exit(1) })
