// reports/snapshot-abc-views.js
// 启动 puppeteer-core 连系统 Chrome，截 A/B/C 三视图各一张
// 输出：reports/abc-views/a.png, b.png, c.png + build-info console 收集
const puppeteer = require('puppeteer-core')
const fs = require('fs')
const path = require('path')

const BASE = process.env.BASE || 'http://127.0.0.1:8766'
const OUT_DIR = path.join(__dirname, 'abc-views')

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })

  const consoleMsgs = []
  page.on('console', function (msg) {
    consoleMsgs.push('[' + msg.type() + '] ' + msg.text())
  })
  page.on('pageerror', function (err) {
    consoleMsgs.push('[pageerror] ' + err.message)
  })

  for (const v of ['a', 'b', 'c']) {
    const url = BASE + '/index.html?v=' + v
    console.log('navigate', url)
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 })
    // 等待切换器
    await page.waitForSelector('#witop-abc-switcher', { timeout: 5000 })
    // 等待对应 variant 可见
    const visible = await page.evaluate(function (vv) {
      var el = document.getElementById('variant-' + vv)
      return el && !el.classList.contains('hidden') && el.children.length > 0
    }, v)
    if (!visible) {
      throw new Error('variant-' + v + ' not visible or empty')
    }
    // 给图表/字体一点时间
    await new Promise(function (r) { setTimeout(r, 400) })
    const out = path.join(OUT_DIR, v + '.png')
    await page.screenshot({ path: out, fullPage: false })
    console.log('  -> ' + out)
  }

  console.log('--- console messages ---')
  consoleMsgs.forEach(function (m) { console.log(m) })

  await browser.close()
  console.log('OK')
})().catch(function (err) {
  console.error('FAIL', err.stack || err.message)
  process.exit(1)
})
