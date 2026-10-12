# V3-02 接待状态机扩展 — 任务卡

**任务编号**：V3-02  
**所属模块**：接待工作台  
**分支**：`feat/v3-02-state-machine`  
**基线**：`feat/v3-01-reception-skeleton` @ `18f8617`  
**工作区**：`.worktrees/v3-02-state-machine/`  
**日期**：2026-10-12

---

## 1. 任务目标

在 `scripts/state.js` 中实现接待状态机模块，完整覆盖小满 CRM 的 4 种接待状态流转，支持接待工作台 view 的状态筛选与 badge 更新。

**交付物**：纯 JS 状态机 + Node 单测，无 UI、无网络调用。

---

## 2. 接待状态机规格

### 2.1 状态枚举

| 状态 key | 中文 | 说明 |
|---|---|---|
| `RECEPTION_OPEN` | 接待中 | AI 正在接待，尚未转人工或被拦截 |
| `TRANSFER_HUMAN` | 转人工 | 客户触发转人工，等待人工接手 |
| `HUMAN_TAKEOVER` | 人工已接手 | 人工已接单，进入人工跟进阶段 |
| `BLOCKED` | 已拦截 | AI 判定为无效询盘/黑名单，已拦截 |

### 2.2 状态流转规则

```
RECEPTION_OPEN
  ├── [触发: 客户点击"转人工"]  → TRANSFER_HUMAN
  ├── [触发: AI 判定拦截]      → BLOCKED
  └── [触发: 超时/无回复 15天] → BLOCKED

TRANSFER_HUMAN
  ├── [触发: 人工点击"接手"]   → HUMAN_TAKEOVER
  └── [触发: 取消转人工]       → RECEPTION_OPEN

HUMAN_TAKEOVER
  └── [无自动出口；人工手动关闭会话]

BLOCKED
  └── [触发: 解除拦截/重新开放] → RECEPTION_OPEN
```

### 2.3 API 设计

```js
// 初始化状态机
const sm = new ReceptionStateMachine(initialState, initialData)

// 当前状态
sm.getState()        // → 'RECEPTION_OPEN' | 'TRANSFER_HUMAN' | 'HUMAN_TAKEOVER' | 'BLOCKED'

// 状态标签（用于 UI）
sm.getStateLabel()    // → '接待中' | '转人工' | '人工已接手' | '已拦截'

// 可用触发
sm.getAvailableTriggers()  // → ['transfer_to_human', 'ai_block', ...]

// 执行触发
sm.canTrigger(event)    // → boolean（当前状态是否允许此事件）
sm.trigger(event)       // → { ok: true, newState, newLabel } | { ok: false, reason }

// 完整状态快照
sm.snapshot()  // → { state, label, availableTriggers, history: [{from, event, to, ts}] }

// 历史记录
sm.getHistory()  // → [{from, event, to, ts}, ...]
```

### 2.4 数据结构

```js
// 询盘记录中的状态字段
{
  id: 'INQ-001',
  status: 'RECEPTION_OPEN',      // 当前状态 key
  statusLabel: '接待中',          // UI 显示用
  statusHistory: [               // 状态变更历史（用于审计）
    { from: null, event: 'init', to: 'RECEPTION_OPEN', ts: 1699999999000 }
  ],
  transferToHumanAt: null,       // 转人工时间戳
  humanTakeoverAt: null,        // 人工接手时间戳
  blockedAt: null,              // 拦截时间戳
  blockedReason: null,          // 拦截原因
  lastActivityAt: 1699999999000 // 最近活动时间
}
```

### 2.5 边界条件

1. **非法事件**：当前状态不允许触发该事件时，`trigger()` 返回 `{ok: false, reason: 'INVALID_TRANSITION'}`
2. **重复事件**：已在目标状态时触发对应事件（如 RECEPTION_OPEN 时再次 `transfer_to_human`），返回 `{ok: false, reason: 'ALREADY_IN_STATE'}`
3. **null/undefined 输入**：`new ReceptionStateMachine(null, data)` 默认 RECEPTION_OPEN；无 data 时抛 TypeError
4. **history 增长上限**：最多保留 50 条，超出时删除最早的

---

## 3. 测试覆盖要求（≥15 条断言）

### 3.1 状态机基本行为

- [ ] 构造函数默认状态为 RECEPTION_OPEN
- [ ] `getState()` 返回当前状态 key
- [ ] `getStateLabel()` 返回对应中文
- [ ] `snapshot()` 包含 state / label / availableTriggers / history

### 3.2 合法流转

- [ ] RECEPTION_OPEN → `transfer_to_human` → TRANSFER_HUMAN
- [ ] RECEPTION_OPEN → `ai_block` → BLOCKED
- [ ] TRANSFER_HUMAN → `human_takeover` → HUMAN_TAKEOVER
- [ ] TRANSFER_HUMAN → `cancel_transfer` → RECEPTION_OPEN
- [ ] BLOCKED → `reopen` → RECEPTION_OPEN

### 3.3 非法流转（错误处理）

- [ ] RECEPTION_OPEN 时 `human_takeover` → INVALID_TRANSITION
- [ ] RECEPTION_OPEN 时 `cancel_transfer` → INVALID_TRANSITION
- [ ] HUMAN_TAKEOVER 时任何非 null 事件 → INVALID_TRANSITION（HUMAN_TAKEOVER 无自动出口）
- [ ] BLOCKED 时 `ai_block` → ALREADY_IN_STATE

### 3.4 历史记录

- [ ] 每次 `trigger()` 成功时 history 追加一条记录
- [ ] `trigger()` 返回 `{ok: false}` 时 history 不变
- [ ] history 超过 50 条时自动截断最早的

### 3.5 辅助方法

- [ ] `canTrigger()` 与 `trigger()` 结果一致
- [ ] `getHistory()` 返回与 snapshot().history 一致的引用

---

## 4. 文件结构

```
scripts/
  state.js           # 状态机模块（唯一产物）
  test-state.js      # Node 单测（≥15 断言）
```

**注意**：不在 `index.html` 中引入或调用本模块；本卡只交付纯状态机。

---

## 5. 验收命令

```bash
cd /Users/james/witop-quote-ui/.worktrees/v3-02-state-machine
node scripts/test-state.js
# 期望: 15+ PASS / 0 FAIL
```

---

## 6. 风险与约束

| 风险 | 缓解 |
|---|---|
| 状态机与 UI 耦合 | 仅交付 state.js；UI 接入在后续卡片 |
| 状态枚举与 A2 既有字段冲突 | A2 无状态机模块；state.js 全新的 scripts/ 子路径 |
| 历史记录内存泄漏 | 50 条上限硬限制 |
| 不破坏 A2 | 回归运行 `cd /Users/james/witop-quote-ui && bash .worktrees/v3-02-state-machine/../v3-01-reception-skeleton/scripts/verify-a2.sh` |

---

## 7. 完成标准

1. `scripts/state.js` 存在，导出 `ReceptionStateMachine`
2. `scripts/test-state.js` 存在，可独立运行
3. `node scripts/test-state.js` → **15+ PASS / 0 FAIL**
4. `bash .worktrees/v3-01-reception-skeleton/scripts/verify-a2.sh` → **50 PASS / 0 FAIL**（回归）
5. 工作区干净，无意外文件
