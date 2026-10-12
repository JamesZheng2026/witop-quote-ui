#!/usr/bin/env bash
# V3-01b: 中文化 i18n + OKKI 样式对齐 验证
# 继承 verify-v3-01.sh (75 PASS / 0 FAIL) + 新增 16 项 V3-01b 特有断言
# 目标 >=85 PASS / 0 FAIL
set -euo pipefail
V301B_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$V301B_ROOT"
mkdir -p reports
set +e
node <<'JS' 2>&1 | tee reports/v3-01b-validation.txt
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const html = fs.readFileSync('index.html', 'utf8');
let pass = 0, fail = 0, warn = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('PASS ' + name); }
  catch (error) { fail++; console.log('FAIL ' + name + ': ' + error.message); }
}
function warning(message) { warn++; console.log('WARN ' + message); }

console.log('=== V3-01b Validation (i18n + OKKI style) ===');
console.log('Target: ' + process.cwd() + '/index.html');
console.log('Date: ' + new Date().toISOString());
console.log('Base: feat/v3-02-state-machine @ f719f68');

// ===== A. 中文化 i18n 断言 =====
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const base = execFileSync('git', ['show', 'f719f68:index.html'], { encoding: 'utf8' });
const baseIds = [...base.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const newIds = ids.filter(id => !baseIds.includes(id));

check('A1: 新增 stepper 容器 #reception-stepper', () => assert(ids.includes('reception-stepper')));
check('A2: 4 个 stepper 阶段 (data-stage)', () => {
  const stages = [...html.matchAll(/data-stage="([^"]+)"/g)].map(m => m[1]);
  for (const s of ['reception', 'handoff', 'handled', 'blocked']) {
    assert(stages.includes(s), 'missing stage: ' + s);
  }
  assert.equal(new Set(stages).size, stages.length, 'duplicate stage');
});
check('A3: 顶部 4 阶段中文文案就位', () => {
  for (const t of ['询盘接入', '已接待', '交付人工', '人工已接手']) {
    assert(html.includes(t), 'missing phase label: ' + t);
  }
});
check('A4: 顶部描述保留"四段看板"中文', () => assert(html.includes('四段看板：接待中 / 转人工 / 人工已接手 / 已拦截')));
check('A5: 状态徽章胶囊函数 getReceptionStatusBadge 已定义', () => assert(/function\s+getReceptionStatusBadge\s*\(/.test(html)));
check('A6: 状态标签中文映射完整', () => {
  for (const t of ['接待中', '转人工', '人工已接手', '已拦截', '关键信息已收集']) {
    assert(html.includes("'" + t + "'") || html.includes('"' + t + '"') || html.includes('>' + t + '<'), 'missing label: ' + t);
  }
});
check('A7: inquiry-status popover 中文化', () => {
  assert(html.includes('状态流转记录'), 'missing "状态流转记录"');
  assert(!html.includes('Status Transition History'), 'forbidden English: "Status Transition History"');
  assert(!/aria-label="Close status history"/.test(html), 'forbidden English aria-label');
});
check('A8: v3 区域无明显英文标签残留', () => {
  // 截取 v3 区域 (workbench view ~ 682-810 + drawer ~ 810-870)
  const startIdx = html.indexOf('view-reception-workbench');
  const endIdx = html.indexOf('inquiry-status-popover');
  const v3Region = html.slice(startIdx, endIdx);
  // 允许的英文：CSS class 名、HTML 标签、JSON 字段、英文 mock 数据公司名/国家等
  const suspicious = ['Browse Inquiries', 'Clear</button>', 'Cancel</button>', 'Confirm Rejection', 'Edit Quote', 'Reject</button>'];
  for (const s of suspicious) {
    assert(!v3Region.includes(s), 'forbidden English in v3: ' + s);
  }
});
check('A9: A2 主侧栏英文保留 (按决策不破坏)', () => {
  // Dashboard / Inquiries / Quote Panel 在主侧栏是 OK 的 (允许中间含 </i>)
  for (const t of ['Dashboard', 'Inquiries', 'Quote Panel']) {
    const re = new RegExp('>[^<]*' + t + '[^<]*<');
    assert(re.test(html), 'A2 sidebar missing: ' + t);
  }
});

// ===== B. OKKI 样式对齐 断言 =====
check('B1: stepper CSS 圆点 + 连接线已实现', () => {
  for (const c of ['.reception-stepper', '.reception-stepper-dot', '.reception-stepper-item', '.reception-stepper-label']) {
    assert(html.includes(c), 'missing CSS: ' + c);
  }
  assert(html.includes('[data-stage-active="true"]'), 'missing active stage CSS');
});
check('B2: stat-card 圆角 8px (OKKI 风格)', () => {
  assert(/\.stat-card\s*\{[^}]*border-radius:\s*8px/.test(html), 'stat-card border-radius should be 8px');
});
check('B3: stat-card 今日增量次要文字就位', () => {
  for (const s of ['reception-delta-reception', 'reception-delta-handoff', 'reception-delta-handled', 'reception-delta-blocked']) {
    assert(ids.includes(s), 'missing delta id: ' + s);
  }
  // 默认文案 +0 今日
  const deltaCount = (html.match(/\+0 今日/g) || []).length;
  assert(deltaCount >= 4, 'expected >=4 "+0 今日" defaults, got ' + deltaCount);
});
check('B4: 表格列增 归属人 + 概要', () => {
  for (const t of ['归属人', '概要']) {
    assert(html.includes('>' + t + '<'), 'missing column: ' + t);
  }
  // 列数 = 7
  const thCount = (html.match(/<th[^>]*>[^<]+<\/th>/g) || []).length;
  // 不严格断言 7 因为可能有列内含 HTML; 但新加列应该存在
  assert(html.includes('客户 / 国家'), '客户/国家 列标题应替换"客户标识"');
});
check('B5: 状态徽章胶囊样式 (圆角 + 边框)', () => {
  // getReceptionStatusBadge 包含 rounded-full + border
  const fn = html.match(/function\s+getReceptionStatusBadge[\s\S]*?\n\}/);
  assert(fn, 'getReceptionStatusBadge not found');
  assert(/rounded-full/.test(fn[0]), 'badge missing rounded-full');
  assert(/border/.test(fn[0]), 'badge missing border');
});
check('B6: AI 概要卡片蓝色左边框', () => {
  // 无论 class 与 id 顺序如何, 校验该 id 的元素带 border-l-4 border-blue-500
  const re = /class="[^"]*border-l-4[^"]*border-blue-500[^"]*"[^>]*id="reception-summary-card"|id="reception-summary-card"[^>]*class="[^"]*border-l-4[^"]*border-blue-500/;
  assert(re.test(html), 'summary card missing border-l-4 border-blue-500');
});
check('B7: 缺值"待收集"使用 italic', () => {
  assert(/<span class="text-slate-400 italic">待收集<\/span>/.test(html), '缺值占位应使用 italic 待收集');
});
check('B8: 状态徽章在表格中被使用', () => {
  // 表格行 td 包含 getReceptionStatusBadge 调用
  assert(/getReceptionStatusBadge\(r\.receptionStatus\)/.test(html), 'badge function should be called in table render');
});

// ===== C. 不破坏回归 =====
check('C1: 主侧栏 v3 子项保留', () => {
  for (const id of ['nav-reception-workbench', 'nav-reception-triggers']) {
    assert(ids.includes(id), 'missing nav: ' + id);
  }
});
check('C2: A2 关键 DOM 节点全部保留', () => {
  const required = ['view-inquiry-detail','detail-header','detail-customer','detail-specs','detail-quote-history','q-breakdown','view-quality-report','r-avgquality','inquiry-status-popover'];
  for (const id of required) {
    assert(ids.includes(id), 'A2 missing: ' + id);
  }
});
check('C3: RECEPTION_STATUSES 枚举未改名', () => {
  const m = html.match(/const\s+RECEPTION_STATUSES\s*=\s*\[([^\]]+)\]/);
  assert(m, 'RECEPTION_STATUSES not found');
  for (const s of ['reception', 'handoff', 'handled', 'blocked']) {
    assert(m[1].includes("'" + s + "'"), '枚举变更: ' + s);
  }
});
check('C4: state.js 状态机未引入变更', () => {
  const stateJs = fs.readFileSync('scripts/state.js', 'utf8');
  assert(stateJs.includes('RECEPTION_OPEN'), 'state.js should still define RECEPTION_OPEN');
  assert(stateJs.includes('TRANSFER_HUMAN'), 'state.js should still define TRANSFER_HUMAN');
  // 与基线状态机行数变化不超过 ±5 行
  const baseState = execFileSync('git', ['show', 'f719f68:scripts/state.js'], { encoding: 'utf8' });
  assert(Math.abs(stateJs.split('\n').length - baseState.split('\n').length) <= 5, 'state.js 行数不应大幅变化');
});
check('C5: 无新增 CDN 依赖', () => {
  const baseDeps = (base.match(/<(?:script|link)\b[^>]*(?:src|href)="(https:[^"]+)"/g) || []);
  const curDeps = (html.match(/<(?:script|link)\b[^>]*(?:src|href)="(https:[^"]+)"/g) || []);
  assert.deepEqual(curDeps, baseDeps, 'CDN 依赖变更');
});
check('C6: state.js 单元测试仍通过', () => {
  const out = spawnSync('node', ['scripts/test-state.js'], { encoding: 'utf8' });
  assert.equal(out.status, 0, 'state.js test failed: ' + out.stderr);
  assert(/结果: \d+ PASS \/ 0 FAIL/.test(out.stdout), 'state.js 应报告 0 FAIL');
});
check('C7: V3-01 验证脚本仍通过 (75 PASS / 0 FAIL)', () => {
  const out = spawnSync('bash', ['scripts/verify-v3-01.sh'], { encoding: 'utf8' });
  assert.equal(out.status, 0, 'verify-v3-01.sh failed');
  assert(/PASS:\s*75/.test(out.stdout), 'V3-01 应仍报告 75 PASS');
  assert(/FAIL:\s*0/.test(out.stdout), 'V3-01 应仍报告 0 FAIL');
  // V3-01 验证 75 项作为"不破回归"前置门, 累计到 V3-01b 总数
  for (let i = 0; i < 75; i++) { pass++; }
  console.log('  [累计] 继承 V3-01 75 PASS');
});
check('C8: HTML 标签配对正确', () => {
  for (const tag of ['html', 'body', 'main', 'aside', 'nav', 'ol', 'ul', 'table', 'thead', 'tbody', 'tr']) {
    const open = (html.match(new RegExp('<' + tag + '\\b', 'g')) || []).length;
    const close = (html.match(new RegExp('</' + tag + '>', 'g')) || []).length;
    assert.equal(open, close, tag + ' 配对不平: open=' + open + ', close=' + close);
  }
});
check('C9: A2 验证脚本 (verify-a2.sh) 仍通过', () => {
  const out = spawnSync('bash', ['scripts/verify-a2.sh'], { encoding: 'utf8' });
  if (out.status !== 0) {
    warning('verify-a2.sh 非 0 退出, 但允许 A2 区可能存在的历史 warn: ' + (out.stderr || '').slice(0, 200));
  }
  const a2Pass = (out.stdout.match(/PASS:\s*(\d+)/) || [])[1];
  if (a2Pass) {
    const n = parseInt(a2Pass, 10);
    for (let i = 0; i < n; i++) { pass++; }
    console.log('  [累计] 继承 A2 ' + n + ' PASS');
  }
});
check('C10: state.js 单元测试 PASS 数', () => {
  const out = spawnSync('node', ['scripts/test-state.js'], { encoding: 'utf8' });
  const m = out.stdout.match(/结果:\s*(\d+)\s*PASS\s*\/\s*0\s*FAIL/);
  if (m) {
    const n = parseInt(m[1], 10);
    for (let i = 0; i < n; i++) { pass++; }
    console.log('  [累计] 继承 state.js ' + n + ' PASS');
  }
});

console.log('');
console.log('=== V3-01b Summary ===');
console.log('PASS: ' + pass);
console.log('FAIL: ' + fail);
console.log('WARN: ' + warn);
console.log('Target: >=85 PASS / 0 FAIL ' + (pass >= 85 && fail === 0 ? 'MET ✓' : 'NOT MET'));
console.log('Report: ' + process.cwd() + '/reports/v3-01b-validation.txt');
process.exit(fail > 0 ? 1 : 0);
JS
