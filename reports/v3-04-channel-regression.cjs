#!/usr/bin/env node
/**
 * V3-04 channel regression e2e:
 *   打开 REC-002 详情 -> 切到 WhatsApp -> 触发 transfer_to_human
 *   验证: WhatsApp 频道不被详情刷新重置回 email
 *
 * Two-phase:
 *   Phase A — buggy commit (4bb22a5) without patch: WhatsApp 应当被重置 → reproduces bug
 *   Phase B — patched (current worktree HEAD): WhatsApp 应当保持 → 修复有效
 */
const { JSDOM } = require('jsdom');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repo = '/Users/james/witop-quote-ui/.worktrees/t_2594ba6c';

function source(file) {
  return fs.readFileSync(path.join(repo, file), 'utf8');
}
function gitSource(rev, file) {
  return execFileSync('git', ['show', rev + ':' + file], { cwd: repo, encoding: 'utf8' });
}

function runScenario(indexHtml, label) {
  // 把 index.html 转为可执行：去掉外部 CDN / link / 把同源 scripts 注入 inline
  const html = indexHtml
    .replace(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/, '')
    .replace(/<script>\s*tailwind\.config[\s\S]*?<\/script>/m, '')
    .replace(/<link[^>]*>/g, '')
    .replace(/<script src="scripts\/(state|reception-bridge)\.js"><\/script>/g,
      (_, name) => '<script>' + source('scripts/' + name + '.js') + '</script>');

  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously' });
  const w = dom.window;
  w.showView('reception-workbench');
  w.openReceptionDetail('REC-002');
  w.setReceptionChannel('whatsapp');

  const whatsappPane = w.document.getElementById('reception-channel-pane-whatsapp');
  const emailPane = w.document.getElementById('reception-channel-pane-email');
  const beforeWhatsappVisible = whatsappPane && !whatsappPane.classList.contains('hidden');
  const beforeEmailVisible = emailPane && !emailPane.classList.contains('hidden');

  // 触发 transfer_to_human — 内部会调用 renderReceptionWorkbench() 重渲染详情
  w.ReceptionBridge.dispatchTrigger('REC-002', 'transfer_to_human');

  const afterWhatsappVisible = whatsappPane && !whatsappPane.classList.contains('hidden');
  const afterEmailVisible = emailPane && !emailPane.classList.contains('hidden');
  const subtitle = w.document.getElementById('reception-drawer-subtitle').textContent;

  dom.window.close();
  return { label, beforeWhatsappVisible, beforeEmailVisible, afterWhatsappVisible, afterEmailVisible, subtitle };
}

// Phase A: 拿 4bb22a5 (无 patch) — 复现 bug
const buggy = runScenario(gitSource('4bb22a5', 'index.html'), 'buggy-4bb22a5');
// Phase B: 当前 worktree 状态 (with patch)
const patched = runScenario(source('index.html'), 'patched-current');

const result = { buggy, patched };
console.log(JSON.stringify(result, null, 2));

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ FAIL: ${name}`); }
}

console.log('\n[ Phase A — buggy reproduction ]');
check('A1: before WhatsApp visible', buggy.beforeWhatsappVisible);
check('A2: after WhatsApp hidden (bug reproduces)', !buggy.afterWhatsappVisible);
check('A3: after email visible (regressed)', buggy.afterEmailVisible);

console.log('\n[ Phase B — patched ]');
check('B1: before WhatsApp visible', patched.beforeWhatsappVisible);
check('B2: after WhatsApp still visible (patch effective)', patched.afterWhatsappVisible);
check('B3: subtitle contains 转人工', patched.subtitle.includes('转人工'));

console.log(`\n=== Summary: PASS ${pass} / FAIL ${fail} ===`);
process.exitCode = fail > 0 ? 1 : 0;
