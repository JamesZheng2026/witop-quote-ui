/**
 * V3-02: Reception State Machine
 * 覆盖小满 CRM AI Sales 的 4 种接待状态流转
 * 纯 JS，无 UI，无网络调用
 */

const STATES = {
  RECEPTION_OPEN: 'RECEPTION_OPEN',
  TRANSFER_HUMAN: 'TRANSFER_HUMAN',
  HUMAN_TAKEOVER: 'HUMAN_TAKEOVER',
  BLOCKED: 'BLOCKED'
}

const LABELS = {
  [STATES.RECEPTION_OPEN]: '接待中',
  [STATES.TRANSFER_HUMAN]: '转人工',
  [STATES.HUMAN_TAKEOVER]: '人工已接手',
  [STATES.BLOCKED]: '已拦截'
}

const EVENTS = {
  TRANSFER_TO_HUMAN: 'transfer_to_human',
  AI_BLOCK: 'ai_block',
  HUMAN_TAKEOVER: 'human_takeover',
  CANCEL_TRANSFER: 'cancel_transfer',
  REOPEN: 'reopen'
}

const HISTORY_LIMIT = 50

// 状态流转表
// key: currentState, value: { event: { nextState, allowed: true } }
const TRANSITIONS = {
  [STATES.RECEPTION_OPEN]: {
    [EVENTS.TRANSFER_TO_HUMAN]: { nextState: STATES.TRANSFER_HUMAN, allowed: true },
    [EVENTS.AI_BLOCK]: { nextState: STATES.BLOCKED, allowed: true }
  },
  [STATES.TRANSFER_HUMAN]: {
    [EVENTS.HUMAN_TAKEOVER]: { nextState: STATES.HUMAN_TAKEOVER, allowed: true },
    [EVENTS.CANCEL_TRANSFER]: { nextState: STATES.RECEPTION_OPEN, allowed: true }
  },
  [STATES.HUMAN_TAKEOVER]: {
    // 无自动出口；人工手动关闭会话
  },
  [STATES.BLOCKED]: {
    [EVENTS.REOPEN]: { nextState: STATES.RECEPTION_OPEN, allowed: true }
  }
}

class ReceptionStateMachine {
  /**
   * @param {string|null} initialState
   * @param {object} data - 询盘数据（必须提供）
   */
  constructor(initialState, data) {
    if (arguments.length < 2) {
      throw new TypeError('ReceptionStateMachine requires (initialState, data)')
    }
    this._state = initialState || STATES.RECEPTION_OPEN
    this._data = data
    this._history = []

    this._pushHistory(null, 'init', this._state)
  }

  /** @returns {string} */
  getState() {
    return this._state
  }

  /** @returns {string} 中文状态标签 */
  getStateLabel() {
    return LABELS[this._state] || this._state
  }

  /**
   * 检查当前状态是否允许该事件
   * @param {string} event
   * @returns {boolean}
   */
  canTrigger(event) {
    const transitions = TRANSITIONS[this._state] || {}
    return !!(transitions[event])
  }

  /**
   * 执行事件触发
   * @param {string} event
   * @returns {{ ok: boolean, newState?: string, newLabel?: string, reason?: string }}
   */
  trigger(event) {
    const transitions = TRANSITIONS[this._state] || {}

    // 无对应流转规则
    if (!transitions[event]) {
      return { ok: false, reason: 'INVALID_TRANSITION' }
    }

    const t = transitions[event]
    const prevState = this._state
    this._state = t.nextState
    this._pushHistory(prevState, event, this._state)

    return { ok: true, newState: this._state, newLabel: this.getStateLabel() }
  }

  /** @returns {object} 完整快照 */
  snapshot() {
    return {
      state: this._state,
      label: this.getStateLabel(),
      availableTriggers: this.getAvailableTriggers(),
      history: this._history
    }
  }

  /** @returns {Array} 状态变更历史 */
  getHistory() {
    return this._history
  }

  /** @returns {string[]} 当前状态可用事件列表 */
  getAvailableTriggers() {
    const transitions = TRANSITIONS[this._state] || {}
    return Object.keys(transitions)
  }

  /** 向 history 追加一条记录，自动截断上限 */
  _pushHistory(from, event, to) {
    this._history.push({ from, event, to, ts: Date.now() })
    if (this._history.length > HISTORY_LIMIT) {
      this._history.shift()
    }
  }
}

// UMD-lite: 同时支持 Node (测试) 和浏览器 (index.html 加载)
;(function (root) {
  var exp = { ReceptionStateMachine: ReceptionStateMachine, STATES: STATES, EVENTS: EVENTS, LABELS: LABELS }
  if (typeof module !== 'undefined' && module.exports) module.exports = exp
  else { root.ReceptionStateMachine = ReceptionStateMachine; root.RECEPTION_STATES = STATES; root.RECEPTION_EVENTS = EVENTS; root.RECEPTION_LABELS = LABELS }
})(typeof window !== 'undefined' ? window : globalThis)
