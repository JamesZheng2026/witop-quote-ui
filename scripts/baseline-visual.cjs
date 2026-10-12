#!/usr/bin/env node
// V3-01b 视觉 QA: 截 3 张图 (列表 + 抽屉 + 触发规则), 1440x1000, 浅色
// 用 Chrome headless + 远程调试协议 (不需要 puppeteer)
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT_DIR = path.join(__dirname, '../reports/v3-01b-visual');
const HTML = 'file://' + path.resolve(__dirname, '../index.html');
fs.mkdirSync(OUT_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

let nextId = 1;
const WebSocket = global.WebSocket;

(async () => {
  const userDataDir = `/tmp/chrome-v3-01b-${Date.now()}`;
  const chrome = spawn(CHROME, [
    '--headless',  // 旧 headless 模式, JS 渲染更稳
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--window-size=1440,1000',
    `--user-data-dir=${userDataDir}`,
    '--remote-debugging-port=9222',
    'about:blank'  // 先打开空白, 再 Page.navigate 切到目标 URL
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  chrome.stderr.on('data', d => process.stderr.write('[chrome] ' + d));
  chrome.on('exit', (code) => console.error('Chrome exit code=' + code));

  let debugInfo;
  for (let i = 0; i < 50; i++) {
    try { debugInfo = await getJson('http://127.0.0.1:9222/json/version'); break; }
    catch (e) { await sleep(300); }
  }
  if (!debugInfo) { console.error('Chrome 启动超时'); chrome.kill(); process.exit(1); }
  console.log('Chrome 启动:', debugInfo.Browser);

  // 用 fetch 拿 tab list
  const tabs = await getJson('http://127.0.0.1:9222/json');
  const tab = tabs[0];
  const sock = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    sock.addEventListener('open', () => resolve());
    sock.addEventListener('error', e => reject(e));
  });

  const pending = new Map();
  sock.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });

  function send(method, params = {}) {
    const id = nextId++;
    sock.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }

  await send('Page.enable');
  await send('Runtime.enable');

  // 等 loadEventFired 再切到目标
  const loadDone = new Promise(resolve => {
    const handler = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.method === 'Page.loadEventFired') resolve();
    };
    sock.addEventListener('message', handler);
  });
  // Page.navigate 切到目标
  await send('Page.navigate', { url: HTML });
  await loadDone;

  async function evalJs(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      const ed = r.exceptionDetails;
      const msg = (ed.exception && (ed.exception.description || ed.exception.value)) || ed.text || JSON.stringify(ed);
      throw new Error('JS 异常: ' + msg);
    }
    return r.result.value;
  }

  async function screenshot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const out = path.join(OUT_DIR, name);
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
    console.log('截图:', out, '(' + fs.statSync(out).size + ' bytes)');
  }

  // 等待 document.body 不为空 (inline script 已执行)
  for (let i = 0; i < 30; i++) {
    const probe = await evalJs(`({ classes: document.body.className, hasNav: !!document.getElementById('nav-reception-workbench') })`);
    if (probe.hasNav && probe.classes) {
      console.log('DOM 就绪 (' + (i*0.5) + 's):', JSON.stringify(probe));
      break;
    }
    await sleep(500);
  }
  // 再等表格渲染完成
  await sleep(800);

  // 探针: 确认 DOM 已就绪
  const probe = await evalJs(`
    ({
      hasNav: !!document.getElementById('nav-reception-workbench'),
      hasTable: !!document.getElementById('reception-table-body'),
      rowCount: document.querySelectorAll('#reception-table-body tr').length,
      bodyClass: document.body.className,
      readyState: document.readyState
    })
  `);
  console.log('DOM 探针:', JSON.stringify(probe));

  // === 截图 1: 接待工作台列表 (含 stepper + stat-card 今日增量 + 表格 + 状态徽章) ===
  // IIFE 内函数不挂 window, 改用 click 触发 nav
  await evalJs(`document.getElementById('nav-reception-workbench').click(); 'ok'`);
  await sleep(800);
  await screenshot('01-list.png');

  // === 截图 2: 接待详情抽屉 ===
  // 点表格里 "查看详情" 按钮 - 通过 dispatch event 模拟
  await evalJs(`
    const btn = document.querySelector('#reception-table-body button[onclick*="openReceptionDetail"]');
    if (btn) { btn.click(); 'ok'; } else { 'no button'; }
  `);
  await sleep(900);
  await screenshot('02-detail-drawer.png');

  // 关闭抽屉 (Esc 键模拟)
  await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 'ok'`);
  await sleep(400);
  // 强关
  await evalJs(`
    const d = document.getElementById('reception-drawer');
    if (d) { d.classList.add('hidden'); if (d.hidePopover) try { d.hidePopover(); } catch(e){} }
    'ok'
  `);
  await sleep(400);

  // === 截图 3: 触发规则抽屉 ===
  await evalJs(`document.getElementById('nav-reception-triggers').click(); 'ok'`);
  await sleep(600);
  await screenshot('03-trigger-rules.png');

  // 收集 pageerror
  // 重连拿 console + exception
  const errors = await evalJs(`(window.__pageErrors || []).join('\\n') || 'none'`);
  console.log('pageerror:', errors);

  sock.close();
  chrome.kill();
  await sleep(300);
  execSync(`rm -rf ${userDataDir}`);
  console.log('=== V3-01b 视觉 QA 完成 ===');
  console.log('输出目录:', OUT_DIR);
  process.exit(0);
})().catch(e => { console.error('错误:', e); process.exit(1); });
