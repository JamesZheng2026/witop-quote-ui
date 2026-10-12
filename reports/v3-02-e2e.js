/**
 * V3-02 UI 端到端验证
 * 用 jsdom 加载 index.html + state.js + bridge.js, 验证:
 *   1. state.js 在浏览器侧挂到 window (ReceptionStateMachine + RECEPTION_STATES + RECEPTION_EVENTS + RECEPTION_LABELS)
 *   2. bridge.js 暴露 window.ReceptionBridge
 *   3. dispatchTrigger 写 store + 触发 render
 *   4. F5 刷新后 store 从 localStorage 恢复
 *   5. 4 个 trigger 完整链路: RECEPTION_OPEN → transfer_to_human → cancel_transfer → RECEPTION_OPEN
 *   6. 状态机非法 transition 被拒
 *   7. V3-04: stepper DOM / live list + detail / reload / real onclick (10 added assertions)
 */
const { JSDOM, VirtualConsole } = require('/Users/james/.hermes/hermes-agent/node_modules/jsdom')
const path = require('path')
const fs = require('fs')

// Exercise this checkout, in the same script order as the real page.
const WT = path.resolve(__dirname, '..')
const indexHtml = fs.readFileSync(path.join(WT, 'index.html'), 'utf8')
const stripped = indexHtml
  .replace(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/, '')
  .replace(/<script>\s*tailwind\.config[\s\S]*?<\/script>/m, '<!-- tailwind config stripped for jsdom -->')
  .replace(/<link[^>]*>/g, '')
  .replace(/<script src="scripts\/(state|reception-bridge)\.js"><\/script>/g,
    (_, name) => '<script>' + fs.readFileSync(path.join(WT, 'scripts', name + '.js'), 'utf8') + '</script>')

// Install shared storage before any scripts run, so a second DOM is a real reload.
let _storageData = {}
const stub = {
  getItem: k => Object.prototype.hasOwnProperty.call(_storageData, k) ? _storageData[k] : null,
  setItem: (k, v) => { _storageData[k] = String(v) },
  removeItem: k => { delete _storageData[k] },
  clear: () => { _storageData = {} },
  key: i => Object.keys(_storageData)[i] || null,
  get length () { return Object.keys(_storageData).length }
}
const runtimeErrors = []
function loadPage() {
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => runtimeErrors.push(error.message))
  virtualConsole.on('warn', message => runtimeErrors.push(String(message)))
  return new JSDOM(stripped, {
    url: 'http://localhost:8081/', runScripts: 'dangerously', pretendToBeVisual: true,
    virtualConsole,
    beforeParse(w) { Object.defineProperty(w, 'localStorage', { value: stub, configurable: true }) }
  })
}
const dom = loadPage()
const { window } = dom

let pass = 0, fail = 0
function assert(name, cond, detail) {
  if (cond) { console.log('  ✓', name); pass++ }
  else { console.log('  ✗', name, detail || ''); fail++ }
}

console.log('[ 1. 加载检查 ]')
assert('ReceptionStateMachine 挂到 window', typeof window.ReceptionStateMachine === 'function')
assert('RECEPTION_STATES.RECEPTION_OPEN === "RECEPTION_OPEN"', window.RECEPTION_STATES && window.RECEPTION_STATES.RECEPTION_OPEN === 'RECEPTION_OPEN')
assert('RECEPTION_STATES.HUMAN_TAKEOVER === "HUMAN_TAKEOVER"', window.RECEPTION_STATES && window.RECEPTION_STATES.HUMAN_TAKEOVER === 'HUMAN_TAKEOVER')
assert('ReceptionBridge 暴露', typeof window.ReceptionBridge === 'object')
assert('ReceptionBridge.dispatchTrigger 是函数', typeof window.ReceptionBridge.dispatchTrigger === 'function')

console.log('[ 2. 业务 ↔ UI 映射 ]')
assert('RECEPTION_OPEN → reception', window.ReceptionBridge.toUiState('RECEPTION_OPEN') === 'reception')
assert('TRANSFER_HUMAN → handoff', window.ReceptionBridge.toUiState('TRANSFER_HUMAN') === 'handoff')
assert('HUMAN_TAKEOVER → handled', window.ReceptionBridge.toUiState('HUMAN_TAKEOVER') === 'handled')
assert('BLOCKED → blocked', window.ReceptionBridge.toUiState('BLOCKED') === 'blocked')
assert('reception → RECEPTION_OPEN', window.ReceptionBridge.toBusinessState('reception') === 'RECEPTION_OPEN')

console.log('[ V3-04 初始 seed ]')
window.showView('reception-workbench')
assert('F2: 保留 seed 的 5/3/3/3 初始分布，总数 14',
  JSON.stringify(window.receptionCounts()) === JSON.stringify({ reception: 5, handoff: 3, handled: 3, blocked: 3, total: 14 }))

console.log('[ 3. dispatchTrigger 写 store ]')
const r1 = window.ReceptionBridge.dispatchTrigger('REC-001', 'transfer_to_human', { actor: 'ai' })
assert('transfer_to_human 成功', r1.ok === true)
assert('state = TRANSFER_HUMAN', r1.state === 'TRANSFER_HUMAN')
assert('uiState = handoff', r1.uiState === 'handoff')
assert('history 有 2 条 (init + trigger)', Array.isArray(r1.history) && r1.history.length === 2)
assert('history 最后一条 event = transfer_to_human', r1.history && r1.history[r1.history.length - 1].event === 'transfer_to_human')
assert('store 里有 REC-001', window.__receptionBridgeDebug().store['REC-001'] !== undefined)
// Retain the original history assertion; V3-04 below checks actual storage and DOM.
assert('dispatchTrigger 返回 history 引用', Array.isArray(r1.history) && r1.history.length >= 1)

assert('F1: trigger 后 stepper 仅 handoff 激活',
  window.document.querySelectorAll('[data-stage-active="true"]').length === 1 &&
  window.document.querySelector('[data-stage="handoff"]').getAttribute('data-stage-active') === 'true')
assert('F2: bridge 改动同步列表和计数，seed 不变',
  !window.document.querySelector('#reception-table-body [data-record-id="REC-001"]') &&
  window.receptionCounts().reception === 4 && window.receptionCounts().handoff === 4 &&
  window.MOCK_RECEPTION.find(r => r.id === 'REC-001').receptionStatus === 'reception')
window.openReceptionDetail('REC-001')
assert('F2: 详情读 bridge 的最新状态', window.document.getElementById('reception-drawer-subtitle').textContent.includes('转人工'))
window.closeReceptionDetail()

console.log('[ 4. F5 刷新恢复 ]')
const dom2 = loadPage()
const w2 = dom2.window
assert('F5 后 REC-001.uiState = handoff', w2.ReceptionBridge.getUiState('REC-001') === 'handoff')
assert('F5 后 history 恢复', w2.ReceptionBridge.getHistory('REC-001').length === 2)

w2.showView('reception-workbench')
w2.setReceptionTab('handoff')
assert('F2: 完整重载后列表、徽章、计数和 stepper 从新状态恢复',
  !!w2.document.querySelector('#reception-table-body [data-record-id="REC-001"] [data-status="handoff"]') &&
  w2.document.getElementById('reception-count-handoff').textContent === '(4)' &&
  w2.document.querySelector('[data-stage="handoff"]').getAttribute('data-stage-active') === 'true')

console.log('[ 5. 4 trigger 完整链路 ]')
// REC-002 走完整流程
const flow = [
  ['REC-002', 'transfer_to_human', true, 'TRANSFER_HUMAN'],
  ['REC-002', 'human_takeover', true, 'HUMAN_TAKEOVER'],
  // HUMAN_TAKEOVER 无自动出口 - 应被拒
  ['REC-002', 'transfer_to_human', false, null],
  // reopen 不适用于 HUMAN_TAKEOVER
  ['REC-002', 'reopen', false, null]
]
for (const [id, ev, ok, expected] of flow) {
  const r = w2.ReceptionBridge.dispatchTrigger(id, ev)
  assert(`${id} ${ev} ok=${r.ok}`, r.ok === ok, JSON.stringify(r))
  if (ok) assert(`${id} ${ev} → ${expected}`, r.state === expected &&
    w2.document.querySelector('[data-stage="' + r.uiState + '"]').getAttribute('data-stage-active') === 'true')
}

console.log('[ 6. 非法 transition 拒 ]')
// REC-003: ai_block from RECEPTION_OPEN
const r3 = w2.ReceptionBridge.dispatchTrigger('REC-003', 'ai_block')
assert('ai_block from RECEPTION_OPEN', r3.ok === true && r3.state === 'BLOCKED' &&
  w2.document.querySelector('[data-stage="blocked"]').getAttribute('data-stage-active') === 'true')
// REC-003: 再次 transfer_to_human (BLOCKED 不接受) - 应拒
const r4 = w2.ReceptionBridge.dispatchTrigger('REC-003', 'transfer_to_human')
assert('transfer_to_human from BLOCKED 拒', r4.ok === false)
// REC-003: reopen 接受
const r5 = w2.ReceptionBridge.dispatchTrigger('REC-003', 'reopen')
assert('reopen from BLOCKED', r5.ok === true && r5.state === 'RECEPTION_OPEN')

console.log('[ 7. 未知 event 拒 ]')
const r6 = w2.ReceptionBridge.dispatchTrigger('REC-004', 'unknown_event')
assert('unknown event 拒', r6.ok === false)

console.log('[ 8. cancel_transfer 回退 ]')
w2.ReceptionBridge.dispatchTrigger('REC-005', 'transfer_to_human')
const r7 = w2.ReceptionBridge.dispatchTrigger('REC-005', 'cancel_transfer')
assert('cancel_transfer → RECEPTION_OPEN', r7.ok === true && r7.state === 'RECEPTION_OPEN')

console.log('[ V3-04 按钮与恢复 ]')
w2.setReceptionTab('reception')
w2.openReceptionDetail('REC-004')
w2.document.querySelector('[data-record-id="REC-004"] button[onclick^="receptionForwardHandoff"]').click()
const stored = () => JSON.parse(stub.getItem(w2.ReceptionBridge.STORE_KEY))
assert('F3: 真正 onclick 同步 store/storage/history/列表/已打开详情，seed 不变',
  w2.ReceptionBridge.getUiState('REC-004') === 'handoff' && stored()['REC-004'].businessState === 'TRANSFER_HUMAN' &&
  stored()['REC-004'].history.at(-1).event === 'transfer_to_human' &&
  !w2.document.querySelector('#reception-table-body [data-record-id="REC-004"]') &&
  w2.document.getElementById('reception-drawer-subtitle').textContent.includes('转人工') &&
  w2.MOCK_RECEPTION.find(r => r.id === 'REC-004').receptionStatus === 'reception')
w2.closeReceptionDetail()
w2.setReceptionTab('handoff')
w2.document.querySelector('[data-record-id="REC-004"] button[onclick^="receptionRevert"]').click()
assert('F3: 恢复按钮走 cancel_transfer 并持久化和更新 stepper',
  stored()['REC-004'].businessState === 'RECEPTION_OPEN' && stored()['REC-004'].history.at(-1).event === 'cancel_transfer' &&
  w2.ReceptionBridge.getUiState('REC-004') === 'reception' &&
  w2.document.querySelector('[data-stage="reception"]').getAttribute('data-stage-active') === 'true')
w2.receptionRevert('REC-006')
assert('F3: 初始 handoff seed 可合法恢复，不默认为 reception',
  stored()['REC-006'].history.at(-1).event === 'cancel_transfer' &&
  stored()['REC-006'].businessState === 'RECEPTION_OPEN' && w2.receptionList('reception').some(r => r.id === 'REC-006'))
w2.setReceptionTab('blocked')
w2.document.querySelector('[data-record-id="REC-012"] button[onclick^="receptionRevert"]').click()
assert('F3: 初始 blocked seed 用 reopen 恢复，清除派生拦截状态',
  stored()['REC-012'].history.at(-1).event === 'reopen' &&
  stored()['REC-012'].businessState === 'RECEPTION_OPEN' &&
  !w2.receptionList('all').find(r => r.id === 'REC-012').blockedReason)
const beforeReject = stub.getItem(w2.ReceptionBridge.STORE_KEY)
const rejected = w2.receptionForwardHandoff('REC-009')
assert('F3: 非法 UI 操作不回退直写 Mock，所有脚本无错误',
  rejected.ok === false && stub.getItem(w2.ReceptionBridge.STORE_KEY) === beforeReject &&
  w2.ReceptionBridge.getUiState('REC-009') === 'handled' &&
  w2.MOCK_RECEPTION.find(r => r.id === 'REC-009').receptionStatus === 'handled' && runtimeErrors.length === 0,
  runtimeErrors.join('; '))

dom.window.close()
dom2.window.close()
console.log('\n=========================================')
console.log(`结果: ${pass} PASS / ${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
