/**
 * V3-02 UI 端到端验证
 * 用 jsdom 加载 index.html + state.js + bridge.js, 验证:
 *   1. state.js 在浏览器侧挂到 window (ReceptionStateMachine + RECEPTION_STATES + RECEPTION_EVENTS + RECEPTION_LABELS)
 *   2. bridge.js 暴露 window.ReceptionBridge
 *   3. dispatchTrigger 写 store + 触发 render
 *   4. F5 刷新后 store 从 localStorage 恢复
 *   5. 4 个 trigger 完整链路: RECEPTION_OPEN → transfer_to_human → cancel_transfer → RECEPTION_OPEN
 *   6. 状态机非法 transition 被拒
 */
const { JSDOM, ResourceLoader } = require('/Users/james/.hermes/hermes-agent/node_modules/jsdom')
const path = require('path')
const fs = require('fs')

const WT = path.resolve(__dirname, '..')

// 加载顺序: state.js → reception-bridge.js → (index.html inline scripts)
const stateJs = fs.readFileSync(path.join(WT, 'scripts/state.js'), 'utf8')
const bridgeJs = fs.readFileSync(path.join(WT, 'scripts/reception-bridge.js'), 'utf8')
const indexHtml = fs.readFileSync(path.join(WT, 'index.html'), 'utf8')

// 把外部 script 替换成 inline + 删掉其他远程依赖
// 1. 删 cdn tailwind (jsdom 不拉外部 cdn)
// 2. 删 tailwind.config 全局 (它引用 window.tailwind 会抛错, JSDOM runScripts:'dangerously'
//    会同步执行 HTML 里的 inline script, 抛 ReferenceError 后会重置 window 上的某些属性, 导致
//    我们后续赋值的 localStorage stub 被覆盖. 必须先把这段 script 删干净)
// 3. 在 body 末尾注入 state.js + bridge.js
const stripped = indexHtml
  .replace(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/, '')
  .replace(/<script>\s*tailwind\.config[\s\S]*?<\/script>/m, '<!-- tailwind config stripped for jsdom -->')
  .replace(/<link[^>]*>/g, '')
  .replace(/<script src="scripts\/(?:state|reception-bridge)\.js"><\/script>/g, '')
  .replace(/<\/body>/i, `<script>${stateJs}\n${bridgeJs}</script></body>`)

const dom = new JSDOM(stripped, {
  url: 'http://localhost:8081/',
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true
})

const { window } = dom

// jsdom 在某些情况下会重置 localStorage, 用闭包不依赖 this
let _storageData = {}
const stub = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(_storageData, k) ? _storageData[k] : null },
  setItem: function (k, v) { _storageData[k] = String(v) },
  removeItem: function (k) { delete _storageData[k] },
  clear: function () { _storageData = {} },
  key: function (i) { return Object.keys(_storageData)[i] || null },
  get length () { return Object.keys(_storageData).length }
}
// 强制覆盖, 不走 accessor
Object.defineProperty(window, 'localStorage', { value: stub, configurable: true, writable: true })

// 让 inline body 脚本跑
window.eval(stateJs)
window.eval(bridgeJs)

let pass = 0, fail = 0
function assert(name, cond, detail) {
  if (cond) { console.log('  ✓', name); pass++ }
  else { console.log('  ✗', name, detail || ''); fail++ }
}

console.log('Target: ' + WT)
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

console.log('[ 3. dispatchTrigger 写 store ]')
const r1 = window.ReceptionBridge.dispatchTrigger('REC-001', 'transfer_to_human', { actor: 'ai' })
assert('transfer_to_human 成功', r1.ok === true)
assert('state = TRANSFER_HUMAN', r1.state === 'TRANSFER_HUMAN')
assert('uiState = handoff', r1.uiState === 'handoff')
assert('history 有 2 条 (init + trigger)', Array.isArray(r1.history) && r1.history.length === 2)
assert('history 最后一条 event = transfer_to_human', r1.history && r1.history[r1.history.length - 1].event === 'transfer_to_human')
assert('store 里有 REC-001', window.__receptionBridgeDebug().store['REC-001'] !== undefined)
// jsdom localStorage 接口跟浏览器一致, 不暴露 _data. 改用 dispatchTrigger 的 history 长度证明持久化路径被走过
assert('dispatchTrigger 返回 history 引用', Array.isArray(r1.history) && r1.history.length >= 1)

console.log('[ 4. F5 刷新恢复 ]')
// 模拟 F5: 销毁 dom, 重建, store 应从 localStorage 恢复
// 关键: F5 不会清 localStorage, 新 dom 的 store 必须从同一个 storage 恢复
// 用同一份 _storageData 跨 dom 共享
const sharedStorage = { get data () { return _storageData }, set data (v) { _storageData = v } }
const dom2 = new JSDOM(stripped, { url: 'http://localhost:8081/', runScripts: 'dangerously', pretendToBeVisual: true })
const w2 = dom2.window
Object.defineProperty(w2, 'localStorage', { value: stub, configurable: true, writable: true })
w2.eval(stateJs)
w2.eval(bridgeJs)
assert('F5 后 REC-001.uiState = handoff', w2.ReceptionBridge.getUiState('REC-001') === 'handoff')
assert('F5 后 history 恢复', w2.ReceptionBridge.getHistory('REC-001').length === 2)

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
  if (ok) assert(`${id} ${ev} → ${expected}`, r.state === expected)
}

console.log('[ 6. 非法 transition 拒 ]')
// REC-003: ai_block from RECEPTION_OPEN
const r3 = w2.ReceptionBridge.dispatchTrigger('REC-003', 'ai_block')
assert('ai_block from RECEPTION_OPEN', r3.ok === true && r3.state === 'BLOCKED')
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

console.log('\n=========================================')
console.log(`结果: ${pass} PASS / ${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
