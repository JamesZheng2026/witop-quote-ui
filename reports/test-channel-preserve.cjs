#!/usr/bin/env node
// Full application + state/bridge in jsdom; no browser or outbound resources.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const repo = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const twoPhase = args.length === 1 && args[0] === '--two-phase';
let revision;
if (args.length === 2 && args[0] === '--revision' && /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(args[1])) {
  revision = args[1];
} else if (args.length && !twoPhase) {
  console.error('Usage: node reports/test-channel-preserve.cjs [--two-phase | --revision <commit>]');
  process.exit(2);
}

function source(rev, file) {
  return rev
    ? execFileSync('git', ['show', `${rev}:${file}`], { cwd: repo, encoding: 'utf8' })
    : fs.readFileSync(path.join(repo, file), 'utf8');
}

function createApp(rev) {
  const html = source(rev, 'index.html')
    .replace(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/, '')
    .replace(/<script>\s*tailwind\.config[\s\S]*?<\/script>/m, '')
    .replace(/<link\b[^>]*>/g, '')
    .replace(/<script src="scripts\/(state|reception-bridge)\.js"><\/script>/g,
      (_, name) => '<script>' + source(rev, `scripts/${name}.js`) + '</script>');
  assert(!/<script\b[^>]*\bsrc=/.test(html), 'Harness must inline every application script');
  const errors = [];
  const virtualConsole = new VirtualConsole();
  // Include warnings: the bridge catches render exceptions and logs a warning.
  for (const event of ['jsdomError', 'error', 'warn']) {
    virtualConsole.on(event, error => errors.push(String(error)));
  }
  const dom = new JSDOM(html, {
    url: 'http://localhost/', runScripts: 'dangerously', virtualConsole
  });
  return { dom, w: dom.window, errors };
}

class ChannelRegression extends assert.AssertionError {}

function assertChannel(w, channel) {
  const actual = w.eval('receptionActiveChannel');
  if (actual !== channel) {
    throw new ChannelRegression({ message: `Expected active channel ${channel}, got ${actual}`, actual, expected: channel });
  }
  assert(!w.document.getElementById('reception-drawer').classList.contains('hidden'), 'Detail drawer stays open');
  for (const name of ['email', 'whatsapp', 'backtrace']) {
    // Re-query after rendering so detached/stale DOM references cannot pass.
    const pane = w.document.getElementById(`reception-channel-pane-${name}`);
    const tab = w.document.getElementById(`reception-channel-tab-${name}`);
    assert(pane && tab, `Missing ${name} pane/tab`);
    assert.equal(!pane.classList.contains('hidden'), name === channel, `${name} pane visibility`);
    assert.equal(tab.classList.contains('active'), name === channel, `${name} tab active state`);
  }
  assert(w.document.getElementById(`reception-channel-${channel}-body`).textContent.trim(), 'Selected pane has content');
}

const cases = {
  test_channel_persists_across_detail_refresh(w) {
    w.renderReceptionWorkbench();
    assertChannel(w, 'whatsapp');
  },
  test_channel_resets_on_detail_change(w) {
    w.openReceptionDetail('REC-005');
    assert(w.document.getElementById('reception-drawer-title').textContent.includes('REC-005'));
    assertChannel(w, 'email');
  },
  test_transfer_to_human_preserves_channel(w) {
    assert.equal(w.ReceptionBridge.getUiState('REC-002'), 'reception');
    const button = w.document.querySelector('[data-record-id="REC-002"] button[onclick^="receptionForwardHandoff"]');
    assert(button && !button.disabled, 'Actual enabled transfer button exists');
    button.click();
    assert.equal(w.ReceptionBridge.getUiState('REC-002'), 'handoff', 'Click performs real bridge transition');
    assert(w.document.getElementById('reception-drawer-subtitle').textContent.includes('转人工'), 'Detail status refreshed');
    assert.equal(w.ReceptionBridge.getHistory('REC-002').at(-1).event, 'transfer_to_human');
    assertChannel(w, 'whatsapp');
  }
};

function runCase(rev, test) {
  const { dom, w, errors } = createApp(rev);
  try {
    w.showView('reception-workbench');
    w.openReceptionDetail('REC-002');
    // Use the real channel-tab handler, including onclick wiring.
    w.document.getElementById('reception-channel-tab-whatsapp').click();
    assertChannel(w, 'whatsapp');
    test(w);
  } finally {
    dom.window.close();
    assert.deepEqual(errors, [], 'Application must not emit runtime errors/warnings');
  }
}

let pass = 0, fail = 0;
function runSuite(label, rev, expectBug = false) {
  console.log(`\n[ ${label} ]`);
  for (const [name, test] of Object.entries(cases)) {
    try {
      if (expectBug && name !== 'test_channel_resets_on_detail_change') {
        // Only the specific WhatsApp-to-email regression counts as a reproduced bug.
        assert.throws(() => runCase(rev, test), error =>
          error instanceof ChannelRegression && error.actual === 'email' && error.expected === 'whatsapp');
        console.log(`PASS ${name} (expected regression reproduced)`);
      } else {
        runCase(rev, test);
        console.log(`PASS ${name}`);
      }
      pass++;
    } catch (error) {
      fail++;
      console.error(`FAIL ${name}: ${error.stack}`);
    }
  }
}

if (twoPhase) {
  runSuite('Phase A: buggy 4bb22a5', '4bb22a5', true);
  runSuite('Phase B: patched b4a8040', 'b4a8040');
}
runSuite(revision || 'Current worktree', revision);
console.log(`\n=== Summary: PASS ${pass} / FAIL ${fail} ===`);
process.exitCode = fail ? 1 : 0;
