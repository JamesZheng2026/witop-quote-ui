// Verify text-only changes against the card's main baseline.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const acorn = require('/Users/james/.hermes/hermes-agent/node_modules/acorn');
const { JSDOM } = require('/Users/james/.hermes/hermes-agent/node_modules/jsdom');
const root = path.resolve(__dirname, '..');
const baseline = execFileSync('git', ['show', '9029a50:index.html'], { cwd: root, encoding: 'utf8' });
const current = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const before = new JSDOM(baseline).window.document;
const after = new JSDOM(current).window.document;
let pass = 0;
function check(name, fn) { fn(); pass++; console.log('PASS ' + name); }
function tags(doc) {
  return [...doc.querySelectorAll('*')].map(el => [el.tagName, [...el.attributes].filter(a => a.name !== 'aria-label').map(a => [a.name, a.value])]);
}
check('HTML structure, IDs, CSS classes, data-v3 and handlers unchanged', () => assert.deepEqual(tags(after), tags(before)));
check('only drawer close accessible label changed', () => {
  const labels = doc => [...doc.querySelectorAll('[aria-label]')].filter(el => el.dataset.v3 !== 'drawer-close').map(el => el.getAttribute('aria-label'));
  assert.deepEqual(labels(after), labels(before));
});
check('styles and remote dependencies unchanged', () => {
  for (const selector of ['style', 'script[src]', 'link']) {
    assert.deepEqual([...after.querySelectorAll(selector)].map(e=>e.outerHTML), [...before.querySelectorAll(selector)].map(e=>e.outerHTML));
  }
});
check('all A2 views, sidebars, print and status history unchanged', () => {
  for (const selector of ['aside', '#view-dashboard', '#view-inquiries', '#view-inquiry-detail', '#view-quote-panel', '#view-settings', '#view-quality-report', '#print-view', '#inquiry-status-popover']) {
    assert.equal(after.querySelector(selector).outerHTML, before.querySelector(selector).outerHTML, selector);
  }
});
function structure(node) {
  if (Array.isArray(node)) return node.map(structure);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (['start', 'end', 'raw'].includes(key)) continue;
    out[key] = node.type === 'Literal' && typeof node.value === 'string' && key === 'value' ? '<text>' : structure(value);
  }
  return out;
}
check('inline JavaScript changes are string literals only', () => {
  const scripts = doc => [...doc.querySelectorAll('script:not([src])')].map(e => structure(acorn.parse(e.textContent, { ecmaVersion: 'latest' })));
  assert.deepEqual(scripts(after), scripts(before));
});
check('state machine and bridge identical to main baseline', () => {
  for (const file of ['scripts/state.js', 'scripts/reception-bridge.js']) {
    assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), execFileSync('git', ['show', '9029a50:' + file], { cwd: root, encoding: 'utf8' }));
  }
});
console.log('Scope: ' + pass + ' PASS / 0 FAIL');
