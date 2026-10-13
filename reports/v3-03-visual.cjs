// Run with Node 22+: isolated Chrome, current worktree, real local scripts.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const out = path.join(__dirname, 'v3-03-visual');
fs.mkdirSync(out, { recursive: true });
const profile = fs.mkdtempSync('/private/tmp/witop-v303-');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--remote-debugging-port=0', '--user-data-dir=' + profile,
  'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });
let diagnostics = '';
chrome.stderr.on('data', d => { diagnostics += d; });
let sock;
(async () => {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; !fs.existsSync(portFile) && i < 60; i++) await sleep(250);
  if (!fs.existsSync(portFile)) throw new Error('Chrome startup failed: ' + diagnostics.slice(-1200));
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const tabs = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
  sock = new WebSocket(tabs[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    sock.addEventListener('open', resolve, { once: true });
    sock.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map(), errors = [], checks = [];
  sock.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails);
    if (pending.has(msg.id)) {
      const { resolve, reject, timer } = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(timer);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    }
  });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const key = ++id;
      const timer = setTimeout(() => { pending.delete(key); reject(new Error(method + ' timed out')); }, 20000);
      pending.set(key, { resolve, reject, timer });
      sock.send(JSON.stringify({ id: key, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async function check(name, expression) {
    if (!(await evaluate(expression))) throw new Error('FAIL ' + name);
    checks.push(name); console.log('PASS ' + name);
  }
  async function screenshot(name) {
    const result = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(out, name), Buffer.from(result.data, 'base64'));
  }
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: pathToFileURL(path.join(root, 'index.html')).href });
  for (let i = 0; i < 80; i++) {
    if (await evaluate("document.readyState === 'complete' && typeof ReceptionBridge === 'object' && typeof showView === 'function'")) break;
    await sleep(250);
  }
  await evaluate("document.documentElement.classList.remove('dark'); showView('reception-workbench')");
  await check('real worktree scripts loaded', "typeof ReceptionBridge.dispatchTrigger === 'function' && MOCK_RECEPTION.length === 14");
  await check('Tailwind stylesheet loaded', "getComputedStyle(document.getElementById('view-dashboard')).display === 'none' && getComputedStyle(document.getElementById('view-reception-workbench')).paddingTop === '24px'");
  await check('four Chinese tabs and stage subtitles', "['接待中','转人工','人工已接手','已拦截'].every(t => document.getElementById('reception-tabs').innerText.includes(t)) && [...document.querySelectorAll('[data-v3=stepper-sub]')].map(e=>e.innerText).join('/') === '客户进入/AI 处理中/转交销售/销售跟进'");
  await check('four Chinese today subtitles', "[...document.querySelectorAll('[data-v3=stat-delta]')].every(e => e.innerText === '+0 今日')");
  await screenshot('01-list.png');
  await evaluate("openReceptionDetail('REC-001')");
  await check('Chinese drawer accessible label and requirements', "document.querySelector('[data-v3=drawer-close]').getAttribute('aria-label') === '关闭接待详情' && document.getElementById('reception-requirements-grid').innerText.includes('商业楼宇大堂') && document.getElementById('reception-requirements-grid').innerText.includes('进口商 / 批发商')");
  await check('Chinese demo actions', "[...document.querySelectorAll('#reception-actions-list button')].every(e=>e.innerText.includes('演示 (Mock)'))");
  await screenshot('02-detail-drawer.png');
  await evaluate("closeReceptionDetail(); openReceptionTriggerDrawer()");
  await check('Chinese trigger idle and disabled labels', "document.getElementById('reception-trigger-status').innerText === '禁用' && document.getElementById('reception-trigger-saving').innerText === '空闲'");
  await screenshot('03-trigger-rules.png');
  await evaluate("document.getElementById('reception-trigger-drawer').classList.add('hidden'); setReceptionTab('blocked'); openReceptionDetail('REC-014'); setReceptionChannel('backtrace')");
  await check('Chinese blocked reason and spam prompt', "document.getElementById('reception-channel-backtrace-body').innerText.includes('域名注册不足 90 天，AI 背调未通过') && document.getElementById('reception-channel-backtrace-body').innerText.includes('无外部垃圾信息标记')");
  await screenshot('04-blocked-backtrace.png');
  await evaluate("closeReceptionDetail(); MOCK_RECEPTION.filter(r=>r.receptionStatus==='reception').forEach(r=>receptionForwardHandoff(r.id)); setReceptionTab('reception')");
  await check('real empty state in row and footer', "document.getElementById('reception-table-body').innerText.includes('当前分类暂无客户') && !document.getElementById('reception-empty').hidden && document.getElementById('reception-empty').innerText === '当前分类暂无客户。'");
  await check('bridge UI transitions keep counts in sync', "receptionCounts().reception === 0 && receptionCounts().handoff === 8 && document.getElementById('reception-count-reception').innerText === '(0)'");
  await screenshot('05-empty-state.png');
  if (errors.length) throw new Error('Browser exceptions: ' + JSON.stringify(errors));
  fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ root, viewport: '1440x1000', checks, exceptions: errors, profile }, null, 2) + '\n');
  console.log('Browser: ' + checks.length + ' PASS / 0 FAIL; 5 screenshots; 0 runtime exceptions');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { if (sock) sock.close(); chrome.kill(); });
