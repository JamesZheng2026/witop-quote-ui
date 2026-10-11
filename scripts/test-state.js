/**
 * V3-02: ReceptionStateMachine 单测
 * 目标: 15+ 断言，全部 PASS
 */
const { ReceptionStateMachine, STATES, EVENTS, LABELS } = require('./state')

let passed = 0, failed = 0

function assert(condition, msg) {
  if (condition) {
    passed++
    console.log(`  ✓ ${msg}`)
  } else {
    failed++
    console.error(`  ✗ FAIL: ${msg}`)
  }
}

function section(name) {
  console.log(`\n[ ${name} ]`)
}

const MOCK_DATA = { id: 'INQ-TEST-001' }

// ─── 3.1 基本行为 ───────────────────────────────────────────────
section('3.1 构造函数 & 基本行为')

let sm = new ReceptionStateMachine(null, MOCK_DATA)
assert(sm.getState() === STATES.RECEPTION_OPEN,
  '构造函数 default → RECEPTION_OPEN')

assert(sm.getStateLabel() === '接待中',
  'getStateLabel() → 接待中')

const snap = sm.snapshot()
assert(snap.state === STATES.RECEPTION_OPEN,
  'snapshot().state 正确')
assert(snap.label === '接待中',
  'snapshot().label 正确')
assert(Array.isArray(snap.availableTriggers),
  'snapshot().availableTriggers 是数组')
assert(Array.isArray(snap.history),
  'snapshot().history 是数组')
assert(snap.history[0].event === 'init',
  'snapshot().history[0].event === init')

// ─── 3.2 合法流转 ───────────────────────────────────────────────
section('3.2 合法状态流转')

sm = new ReceptionStateMachine(STATES.RECEPTION_OPEN, MOCK_DATA)
let result = sm.trigger(EVENTS.TRANSFER_TO_HUMAN)
assert(result.ok === true,
  'RECEPTION_OPEN → transfer_to_human → ok')
assert(result.newState === STATES.TRANSFER_HUMAN,
  '流转后状态 = TRANSFER_HUMAN')
assert(sm.getState() === STATES.TRANSFER_HUMAN,
  'getState() 返回新状态')

sm = new ReceptionStateMachine(STATES.RECEPTION_OPEN, MOCK_DATA)
result = sm.trigger(EVENTS.AI_BLOCK)
assert(result.ok === true,
  'RECEPTION_OPEN → ai_block → ok')
assert(sm.getState() === STATES.BLOCKED,
  '流转后状态 = BLOCKED')

sm = new ReceptionStateMachine(STATES.TRANSFER_HUMAN, MOCK_DATA)
result = sm.trigger(EVENTS.HUMAN_TAKEOVER)
assert(result.ok === true,
  'TRANSFER_HUMAN → human_takeover → ok')
assert(sm.getState() === STATES.HUMAN_TAKEOVER,
  '流转后状态 = HUMAN_TAKEOVER')

sm = new ReceptionStateMachine(STATES.TRANSFER_HUMAN, MOCK_DATA)
result = sm.trigger(EVENTS.CANCEL_TRANSFER)
assert(result.ok === true,
  'TRANSFER_HUMAN → cancel_transfer → ok')
assert(sm.getState() === STATES.RECEPTION_OPEN,
  '取消转人工回到 RECEPTION_OPEN')

sm = new ReceptionStateMachine(STATES.BLOCKED, MOCK_DATA)
result = sm.trigger(EVENTS.REOPEN)
assert(result.ok === true,
  'BLOCKED → reopen → ok')
assert(sm.getState() === STATES.RECEPTION_OPEN,
  'reopen 后状态 = RECEPTION_OPEN')

// ─── 3.3 非法流转 ───────────────────────────────────────────────
section('3.3 非法流转 & 错误处理')

sm = new ReceptionStateMachine(STATES.RECEPTION_OPEN, MOCK_DATA)
result = sm.trigger(EVENTS.HUMAN_TAKEOVER)
assert(result.ok === false,
  'RECEPTION_OPEN 时 human_takeover → INVALID_TRANSITION')
assert(result.reason === 'INVALID_TRANSITION',
  'reason = INVALID_TRANSITION')
assert(sm.getState() === STATES.RECEPTION_OPEN,
  '非法触发后状态不变')

sm = new ReceptionStateMachine(STATES.RECEPTION_OPEN, MOCK_DATA)
result = sm.trigger(EVENTS.CANCEL_TRANSFER)
assert(result.ok === false,
  'RECEPTION_OPEN 时 cancel_transfer → INVALID_TRANSITION')
assert(sm.getState() === STATES.RECEPTION_OPEN,
  '非法触发后状态不变')

sm = new ReceptionStateMachine(STATES.HUMAN_TAKEOVER, MOCK_DATA)
result = sm.trigger(EVENTS.TRANSFER_TO_HUMAN)
assert(result.ok === false,
  'HUMAN_TAKEOVER 时任意事件 → INVALID_TRANSITION')
assert(sm.getState() === STATES.HUMAN_TAKEOVER,
  '非法触发后状态不变')

sm = new ReceptionStateMachine(STATES.BLOCKED, MOCK_DATA)
result = sm.trigger(EVENTS.AI_BLOCK)
assert(result.ok === false,
  'BLOCKED 时 ai_block → ALREADY_IN_STATE（无该流转）')
assert(result.reason === 'INVALID_TRANSITION',
  'reason = INVALID_TRANSITION（未定义流转视为非法）')

// ─── 3.4 历史记录 ───────────────────────────────────────────────
section('3.4 历史记录')

sm = new ReceptionStateMachine(STATES.RECEPTION_OPEN, MOCK_DATA)
const initLen = sm.getHistory().length
sm.trigger(EVENTS.TRANSFER_TO_HUMAN)
assert(sm.getHistory().length === initLen + 1,
  'trigger() 成功时 history 增长 1 条')
assert(sm.getHistory()[sm.getHistory().length - 1].event === EVENTS.TRANSFER_TO_HUMAN,
  'history 最后一条 event 正确')

const beforeFail = sm.getHistory().length
sm.trigger(EVENTS.REOPEN)  // TRANSFER_HUMAN 不允许 reopen → 非法触发
assert(sm.getHistory().length === beforeFail,
  'trigger() 返回 {ok:false} 时 history 不变')

// getHistory === snapshot().history 引用一致
assert(sm.getHistory() === sm.snapshot().history,
  'getHistory() 与 snapshot().history 引用一致')

// ─── 3.5 辅助方法 ───────────────────────────────────────────────
section('3.5 辅助方法')

sm = new ReceptionStateMachine(STATES.RECEPTION_OPEN, MOCK_DATA)
assert(sm.canTrigger(EVENTS.TRANSFER_TO_HUMAN) === true,
  'RECEPTION_OPEN 时 canTrigger(transfer_to_human) = true')
assert(sm.canTrigger(EVENTS.HUMAN_TAKEOVER) === false,
  'RECEPTION_OPEN 时 canTrigger(human_takeover) = false')

const triggers = sm.getAvailableTriggers()
assert(triggers.includes(EVENTS.TRANSFER_TO_HUMAN),
  'getAvailableTriggers() 包含 transfer_to_human')
assert(triggers.includes(EVENTS.AI_BLOCK),
  'getAvailableTriggers() 包含 ai_block')
assert(triggers.length === 2,
  'RECEPTION_OPEN 可用触发数 = 2')

// 初始状态传入字符串
sm2 = new ReceptionStateMachine('TRANSFER_HUMAN', MOCK_DATA)
assert(sm2.getState() === 'TRANSFER_HUMAN',
  '显式传入初始状态生效')

// ─── 边界条件 ─────────────────────────────────────────────────
section('边界: TypeError & 历史截断')

try {
  new ReceptionStateMachine(null)
  assert(false, '无 data 参数应抛 TypeError')
} catch (e) {
  assert(e instanceof TypeError,
    '缺少 data 参数抛 TypeError')
}

// history 截断
const MAX_DATA = { id: 'INQ-LIMIT' }
const smLong = new ReceptionStateMachine(STATES.RECEPTION_OPEN, MAX_DATA)
for (let i = 0; i < 55; i++) {
  // 反复在 RECEPTION_OPEN / TRANSFER_HUMAN 之间切换以累积 history
  if (smLong.getState() === STATES.RECEPTION_OPEN) {
    smLong.trigger(EVENTS.TRANSFER_TO_HUMAN)
  } else {
    smLong.trigger(EVENTS.CANCEL_TRANSFER)
  }
}
assert(smLong.getHistory().length === 50,
  'history 超过 50 条时自动截断到 50 条')

// ─── 摘要 ─────────────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`)
console.log(`结果: ${passed} PASS / ${failed} FAIL`)

if (failed > 0) {
  process.exit(1)
}
