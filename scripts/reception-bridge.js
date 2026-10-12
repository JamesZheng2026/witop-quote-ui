/**
 * V3-02 Bridge: 将 state.js 的业务状态机接到 V3-01b 的 UI 枚举
 *
 * 责任:
 *   - 业务枚举 (RECEPTION_OPEN/TRANSFER_HUMAN/HUMAN_TAKEOVER/BLOCKED) ↔ UI 枚举 (reception/handoff/handled/blocked) 双向映射
 *   - 每条询盘 = 一个 ReceptionStateMachine 实例
 *   - localStorage 持久化 (key: reception_state_v1)
 *   - 触发事件 → 写 store → 重渲染 reception view → 写 history
 *   - F5 刷新自动恢复
 *
 * 不改: state.js 业务逻辑, index.html 既有 RECEPTION_STATUSES
 */
(function () {
  'use strict'

  if (typeof window === 'undefined') {
    return // 仅浏览器
  }

  // ---- 1. 业务枚举 ↔ UI 字符串映射 ----
  // UI 枚举定义在 index.html (V3-01b): ['reception', 'handoff', 'handled', 'blocked']
  // 业务枚举来自 state.js: RECEPTION_OPEN/TRANSFER_HUMAN/HUMAN_TAKEOVER/BLOCKED
  var STATE_TO_UI = {}
  var UI_TO_STATE = {}
  if (window.RECEPTION_STATES) {
    STATE_TO_UI[window.RECEPTION_STATES.RECEPTION_OPEN] = 'reception'
    STATE_TO_UI[window.RECEPTION_STATES.TRANSFER_HUMAN] = 'handoff'
    STATE_TO_UI[window.RECEPTION_STATES.HUMAN_TAKEOVER] = 'handled'
    STATE_TO_UI[window.RECEPTION_STATES.BLOCKED] = 'blocked'
    UI_TO_STATE.reception = window.RECEPTION_STATES.RECEPTION_OPEN
    UI_TO_STATE.handoff = window.RECEPTION_STATES.TRANSFER_HUMAN
    UI_TO_STATE.handled = window.RECEPTION_STATES.HUMAN_TAKEOVER
    UI_TO_STATE.blocked = window.RECEPTION_STATES.BLOCKED
  }

  function toUiState(businessState) {
    return STATE_TO_UI[businessState] || 'reception'
  }
  function toBusinessState(uiState) {
    return UI_TO_STATE[uiState] || (window.RECEPTION_STATES ? window.RECEPTION_STATES.RECEPTION_OPEN : 'RECEPTION_OPEN')
  }

  // ---- 2. UI event name → 业务 event name ----
  // index.html 已用 'transfer_to_human'/'human_takeover' 作为 onclick 的高阶动作;
  // state.js 的 EVENTS 暴露 5 个, 取值是小写: transfer_to_human/ai_block/human_takeover/cancel_transfer/reopen
  // bridge 直接用 UI 字符串即可, 业务键名 = UI 字符串 (V3-02 状态机按小写字符串定义 transition)
  var UI_TO_EVENT = {
    transfer_to_human: 'transfer_to_human',
    ai_block: 'ai_block',
    human_takeover: 'human_takeover',
    cancel_transfer: 'cancel_transfer',
    reopen: 'reopen'
  }

  // ---- 3. Store: 询盘 id → state machine instance + history ----
  var STORE_KEY = 'reception_state_v1'
  var _store = {} // { [inquiryId]: { businessState, history, updatedAt } }

  function loadFromStorage() {
    try {
      var raw = localStorage.getItem(STORE_KEY)
      if (!raw) return {}
      var parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (e) {
      console.warn('[reception-bridge] loadFromStorage failed:', e)
      return {}
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(_store))
    } catch (e) {
      console.warn('[reception-bridge] saveToStorage failed:', e)
    }
  }

  function getInquiryState(inquiryId) {
    if (!_store[inquiryId]) {
      _store[inquiryId] = {
        businessState: window.RECEPTION_STATES ? window.RECEPTION_STATES.RECEPTION_OPEN : 'RECEPTION_OPEN',
        history: [],
        updatedAt: Date.now()
      }
    }
    return _store[inquiryId]
  }

  // 初始化时从 localStorage 恢复
  _store = loadFromStorage()

  // ---- 4. 触发器 ----
  /**
   * @param {string} inquiryId
   * @param {string} uiEvent  UI 侧事件名 (transfer_to_human / ai_block / human_takeover / cancel_transfer / reopen)
   * @param {object} [payload] { actor, note }
   * @returns {{ok: boolean, error?: string, state?: string, history?: Array}}
   */
  function dispatchTrigger(inquiryId, uiEvent, payload) {
    if (!window.ReceptionStateMachine) {
      return { ok: false, error: 'ReceptionStateMachine not loaded' }
    }
    var businessEvent = UI_TO_EVENT[uiEvent]
    if (!businessEvent) {
      return { ok: false, error: 'unknown event: ' + uiEvent }
    }

    var current = getInquiryState(inquiryId)
    var sm = new window.ReceptionStateMachine(
      current.businessState,
      Object.assign({ inquiryId: inquiryId }, payload || {})
    )

    var result = sm.trigger(businessEvent)
    if (!result || !result.ok) {
      return { ok: false, error: (result && (result.reason || result.error)) || 'trigger rejected' }
    }

    current.businessState = result.newState
    current.history = sm.getHistory()
    current.updatedAt = Date.now()
    saveToStorage()

    // 触发 UI 重渲染 (若已挂载)
    if (typeof window.renderReceptionWorkbench === 'function') {
      try { window.renderReceptionWorkbench() } catch (e) { console.warn('[reception-bridge] render failed:', e) }
    }
    if (typeof window.updateReceptionStepper === 'function') {
      try { window.updateReceptionStepper(toUiState(current.businessState)) } catch (e) { /* optional */ }
    }

    return {
      ok: true,
      state: result.newState,
      label: result.newLabel,
      uiState: toUiState(result.newState),
      history: current.history
    }
  }

  // ---- 5. 查询接口 ----
  function getUiState(inquiryId) {
    return toUiState(getInquiryState(inquiryId).businessState)
  }

  function getHistory(inquiryId) {
    return getInquiryState(inquiryId).history || []
  }

  function listByUiState(uiState) {
    var business = toBusinessState(uiState)
    return Object.keys(_store)
      .filter(function (id) { return _store[id].businessState === business })
      .map(function (id) { return { id: id, history: _store[id].history, updatedAt: _store[id].updatedAt } })
  }

  function reset() {
    _store = {}
    saveToStorage()
  }

  // ---- 6. 暴露 ----
  window.ReceptionBridge = {
    toUiState: toUiState,
    toBusinessState: toBusinessState,
    dispatchTrigger: dispatchTrigger,
    getUiState: getUiState,
    getHistory: getHistory,
    listByUiState: listByUiState,
    reset: reset,
    STORE_KEY: STORE_KEY,
    _store: function () { return _store } // 只读
  }

  // 调试钩子
  if (typeof window !== 'undefined') {
    window.__receptionBridgeDebug = function () { return { store: _store, map: STATE_TO_UI } }
  }
})()
