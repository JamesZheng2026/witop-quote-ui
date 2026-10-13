#!/usr/bin/env bash
# Verify the current worktree; dependencies must be provisioned separately.
set -euo pipefail
B_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$B_ROOT"
node scripts/test-state.js
node reports/test-channel-preserve.cjs
node <<'JS'
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('index.html', 'utf8');
const source = fs.readFileSync('scripts/variants.js', 'utf8');
assert(!/variant-a|variant-c|renderA|renderC/.test(html + source), 'No retired views');
assert(!/方案/.test(source), 'No legacy view wording');
assert(!/B\s*方案|方案切换|variant-switcher/.test(html), 'No legacy selector');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
try {
  const w = dom.window;
  w.fetch = () => Promise.resolve({ ok: false });
  w.eval(fs.readFileSync('scripts/mock-data.js', 'utf8'));
  w.eval(source);
  w.witopRenderVariants();
  const dashboard = w.document.getElementById('view-dashboard');
  const b = w.document.getElementById('variant-b');
  assert.equal(dashboard.querySelectorAll('h1').length, 1);
  assert.equal(dashboard.querySelector('h1').textContent, '接待工作台');
  assert(!b.classList.contains('hidden') && b.children.length > 0, 'Visible workbench');
  assert.equal(b.querySelectorAll('thead th').length, 8, 'Eight columns');
  assert(b.textContent.includes('三方质检：销售自评 · 技术复核 · AI 质检 · 品控终审'),
    'QC parties label per James D1 final spec (third-stage)');
  assert(b.textContent.includes('AI 质检 · 品控终审'), 'Third-stage label per D1');
  assert.equal(b.querySelectorAll('.grid > div').length, 4, 'Four cards');
  const records = w.MOCK_RECEPTION;
  assert.deepEqual([...new Set(records.map(r => r.qcStatus))].sort(),
    ['failed', 'in_review', 'passed', 'pending']);
  assert.equal(b.querySelectorAll('tbody tr').length, records.length);
  const labels = { pending: '待质检', in_review: '质检中', passed: '已通过', failed: '未通过' };
  for (const row of b.querySelectorAll('tbody tr')) {
    const record = records.find(r => r.id === row.cells[0].textContent);
    assert.equal(row.cells.length, 8);
    assert.equal(row.cells[6].textContent, labels[record.qcStatus]);
  }
  const rec9 = records.find(r => r.id === 'REC-009');
  assert.equal(rec9.receptionStatus, 'handled');
  assert.equal(rec9.qcStatus, 'passed');
  w.witopSetVariant('a', { skipUrl: true, skipStorage: true, skipLog: true });
  assert.equal(w.witopGetVariant(), 'b');
  assert.equal(b.querySelectorAll('tbody tr').length, records.length, 'Stable rerender');
  console.log('verify-b-only: PASS (structure, wording, QC states, REC-009, compatibility)');
} finally { dom.window.close(); }
JS
