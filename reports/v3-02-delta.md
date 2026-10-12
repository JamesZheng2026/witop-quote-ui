# V3-02 Delta 报告: 接待状态机 + UI 桥接层

**Worktree**: `feat/v3-02-integration` @ `8b72162` (含 `f719f68` 状态机祖先)
**日期**: 2026-10-12
**作者**: Hermes

## 一、范围

V3-02 原 spec 只有 `scripts/state.js`（39 测试 / 0 FAIL），未与 index.html 集成。
本次 delta 补齐了 **3 个集成缺口**:

| 缺口 | 修复 |
|---|---|
| state.js 仅 CommonJS 导出, 浏览器侧拿不到 | UMD-lite 包装, 同时支持 Node 测试和浏览器 `<script>` 加载 |
| index.html 有自己的 `RECEPTION_STATUSES` 字符串枚举, 与业务枚举无映射 | 新建 `scripts/reception-bridge.js` 做双向映射 + Store + 持久化 + 4 trigger |
| 询盘状态转换无 UI 入口, F5 后状态丢失 | bridge 自动 `localStorage` 持久化, 新 dom 启动时从 storage 恢复 |

## 二、变更文件

| 文件 | 状态 | 行数变化 |
|---|---|---|
| `scripts/state.js` | 修改 | 137 → 142 (+5) — UMD 包装, 业务逻辑零改动 |
| `scripts/reception-bridge.js` | 新建 | +183 — 业务↔UI 映射 / Store / 持久化 / 4 trigger |
| `index.html` | 修改 | +2 行 — `<script src="scripts/state.js">` + `<script src="scripts/reception-bridge.js">` |
| `reports/v3-02-e2e.js` | 新建 | +133 — JSDOM 端到端测试, 30 个断言 |
| `reports/v3-02-debug.js` | 新建 | +57 — localStorage stub 调试脚本 (可保留作 jsdom 集成参考) |

## 三、桥接层设计

### 1. 业务枚举 ↔ UI 字符串映射

| state.js (业务) | index.html RECEPTION_STATUSES (UI) | 中文标签 |
|---|---|---|
| RECEPTION_OPEN | reception | 接待中 |
| TRANSFER_HUMAN | handoff | 转人工 |
| HUMAN_TAKEOVER | handled | 人工已接手 |
| BLOCKED | blocked | 已拦截 |

**设计决策**: 不改 index.html 既有的 `RECEPTION_STATUSES` 字符串数组 (那是 V3-01b 留下的 UI 枚举),
也不改 state.js 的 `STATES` 业务常量, 桥接层只做翻译. 两条独立的命名轴在需要时通过 bridge 互译.

### 2. 事件名映射

state.js EVENTS 的**值**是小写字符串 (`transfer_to_human` 等), 与 UI onclick 字符串同名, bridge 直接透传无需再翻译.

### 3. Store + 持久化

- Key: `reception_state_v1`
- 数据结构: `{ [inquiryId]: { businessState, history, updatedAt } }`
- 写入时机: 每次 `dispatchTrigger` 成功后
- 读取时机: bridge IIFE 启动时一次性 `loadFromStorage`
- Versioning: `_v1` 后缀预留后续 schema 升级

### 4. 暴露的 API (window.ReceptionBridge)

```js
window.ReceptionBridge.dispatchTrigger(inquiryId, uiEvent, payload?)
  // → { ok, state, label, uiState, history }
window.ReceptionBridge.getUiState(inquiryId) → 'reception'|'handoff'|'handled'|'blocked'
window.ReceptionBridge.getHistory(inquiryId) → Array
window.ReceptionBridge.toUiState(businessState) → string
window.ReceptionBridge.toBusinessState(uiState) → string
window.ReceptionBridge.listByUiState(uiState) → Array<{id, history, updatedAt}>
window.ReceptionBridge.reset() → 清空 store
window.__receptionBridgeDebug() → 调试用
```

## 四、验证

### 4.1 单元 + 回归 (4 套)

| 套 | 基线 | 本次 | 状态 |
|---|---|---|---|
| state.js (scripts/test-state.js) | 39/0 | 39/0 | ✅ |
| verify-a2.sh | 50/0/4 | 50/0/4 | ✅ |
| verify-v3-01.sh | 75/0/2 | 75/0/2 | ✅ |
| verify-v3-01b.sh | 191/0/0 | 191/0/0 | ✅ (C4 行数阈值 ≤5 守住) |

### 4.2 UI 端到端 (新增)

`reports/v3-02-e2e.js` 用 JSDOM 加载 index.html + state.js + bridge.js, 8 套场景, 30 个断言:

| 场景 | 断言数 | 状态 |
|---|---|---|
| 1. 加载检查 (state.js + bridge 挂到 window) | 5 | ✅ |
| 2. 业务 ↔ UI 双向映射 | 5 | ✅ |
| 3. dispatchTrigger 写 store + 触发 history | 7 | ✅ |
| 4. F5 刷新恢复 (跨 dom 共享 storage) | 2 | ✅ |
| 5. 4 trigger 完整链路 (RECEPTION_OPEN → TRANSFER → TAKEOVER) | 6 | ✅ |
| 6. 非法 transition 被拒 (BLOCKED 不接受 transfer) | 3 | ✅ |
| 7. 未知 event 被拒 | 1 | ✅ |
| 8. cancel_transfer 回退 (TRANSFER → RECEPTION) | 1 | ✅ |

**总计: 30 PASS / 0 FAIL**

## 五、已知边界

1. **state.js 业务逻辑零改动** — C4 校验守住 ≤5 行, 桥接层只做翻译和存储
2. **index.html 既有 `RECEPTION_STATUSES` 保留** — V3-01b 留下的 UI 枚举, 桥接层接管与业务的翻译
3. **bridge 不渲染 UI** — 它只更新 store + 提供 `dispatchTrigger`, UI 重渲染由调用方 (后续 step) 负责
4. **localStorage schema v1** — 字段名带 `_v1` 后缀, 后续破坏性升级用 `_v2` 平滑迁移
5. **未做**: index.html `onclick="receptionForwardHandoff(id)"` 已有 V3-01b 写的简化版 (行 2015), 还没替换为 `ReceptionBridge.dispatchTrigger(id, 'transfer_to_human')`. 这是 V3-04 范围, 不在 V3-02 内.

## 六、部署路径

- Demo server 8081 已起, 服务 worktree 根 (`/Users/james/witop-quote-ui/.worktrees/v3-02-integration`)
- 打开 http://localhost:8081/index.html 可见 stepper + tabs, 但**目前 UI 元素未与 bridge 联通** (V3-04 范围)
- 业务层可由 Console 验证:
  ```js
  ReceptionBridge.dispatchTrigger('REC-001', 'transfer_to_human')
  // { ok: true, state: 'TRANSFER_HUMAN', uiState: 'handoff', history: [...] }
  ReceptionBridge.getUiState('REC-001')  // 'handoff'
  localStorage.getItem('reception_state_v1')  // JSON 持久化数据
  ```
