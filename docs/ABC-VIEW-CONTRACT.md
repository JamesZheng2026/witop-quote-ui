# A/B/C 三视图契约 — Witop 客户系统静态原型

> 目标：在同一份 mock 数据上验证三种信息架构的实际使用感受，再决定主线采用哪一种。
> 工作区：`.worktrees/witop-abc-demo-views/`（基于 main@8b89e90，独立分支 `feat/witop-abc-demo-views`）
> 不动主线 `main`，不动 v3-* worktree。

## 1. 切换与隔离

- 顶部固定切换器：A | B | C，三个 pill 按钮
- 选择持久化：`localStorage.witop_abc_variant`
- URL 同步：`?v=a|b|c` 参数优先于 localStorage，方便分享
- 三视图**共享同一份数据**（`window.MOCK_INQUIRIES` / `window.MOCK_RECEPTION`），不创建新的 mock
- 不破坏现有 sidebar 的 8 个 view：dashboard / inquiries / inquiry-detail / quote-panel / settings / quality-report / reception-workbench / trigger drawer
- A/B/C 切换只控制主页主区域（dashboard 视图），其他 7 个 view 行为不变
- 切换不重载页面，仅替换主区域 DOM

## 2. A — 极简信息密度（克制型）

参考：Linear、Supabase Dashboard、Obsidian 风格

- 顶部：`A | B | C` 切换 + 当前时间 + 今日新增
- 主体：3 列 KPI（询盘数 / 报价中 / 待人工）+ 一张主列表
- 主列表：紧凑表格 6 列（ID / Company / Country / Channel / Status / Last Activity）
- 不放图表、不放 funnel、不放活动 feed
- 配色：`#0F172A` sidebar + `#FFFFFF` 主区 + 1px `#E5E7EB` 边框
- 字号：body 14px、表格 13px
- 关键交互：行点击 → 进 inquiry-detail（保持现有行为）
- 强调"数据驱动、克制、立即可用"

## 3. B — OKKI 风格 4 段工作台

参考：`reports/okki-capture-2026-10-10/`（小满 CRM AI Sales 实测截图）

- 顶部：`A | B | C` 切换 + 总览
- 4 段卡片：询盘接入（蓝）/ 已接待（绿）/ 交付人工（橙）/ 人工已接手（紫）
- 每段：数字 + 今日增量 + 列表前 3 条
- 列表项：渠道 | 最近沟通 | 归属人 | 状态 | 概要
- 右侧抽屉：点行滑出 40-50% 视口宽度，详情区含需求模型 + AI 概要 + 建议
- 配色：与 V3-01b OKKI 样式基线一致（`#1A2332` 侧栏、`#3B82F6` 蓝、`#10B981` 绿、`#F59E0B` 橙、`#8B5CF6` 紫）
- 字号：阶段卡数字 20-24px 加粗、卡片 12px 间距
- 强调"模仿小满、看板驱动"

## 4. C — AI 报价分析主导

参考：日报/分析报告风格，三栏并列

- 顶部：`A | B | C` 切换 + 询盘选择器
- 三栏并排：
  - 左（30%）：询盘快照（公司/国家/产品/qty/周期/用途）
  - 中（40%）：AI 报价轨迹（材料/工艺/物流/合规/利润五项分项，每项 `amount` + `?` 悬停看 `reason`）
  - 右（30%）：质检 5 维（防飞单 / 沟通态度 / 问题解决 / 需求理解 / 产品知识，每维 0-100 分 + 等级 A/B/C/D）
- 底部：Risk Flags 红字卡 + Citations 绿字卡
- 配色：中性灰 + 单色强调（cyan/teal 表示"分析"语义）
- 字体：等宽数字突出金额
- 强调"分析视角、AI 决策可解释"

## 5. 切换器

```
[ A | B | C ]   < 当前 16:42  ·  今日 +12 >
```

- 选中样式：底部 2px 蓝色 underline
- 切换不触发网络请求、不重渲染 sidebar
- 切换后写 localStorage + 更新 URL

## 6. 缓存修复

- HTML `<head>` 加 `<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">` + Pragma + Expires
- 静态资源文件名加版本号 hash：
  - `scripts/state.js?v=<git-sha-short>-<ts>`
  - `scripts/reception-bridge.js?v=...`
  - `scripts/mock-data.js?v=...`
- 启动时 `console.info('Witop build:', { sha, ts, variant })` 输出当前版本号
- 静态服务用 Python http.server 没法改 header，meta + URL hash 双保险
- 强制刷新方式：浏览器硬刷新（Cmd+Shift+R）或访问 `?v=a&_=<ts>`

## 7. OKKI 接入（探路阶段）

- 用现有 sandbox 凭证：base `https://api-sandbox.xiaoman.cn`
- 探路目标：1-2 个只读接口（客户列表 / 跟进动态），不替换 mock
- 验证通路：返回 200 / 字段映射 / 限流 / 错误码
- 输出：原始响应 + 字段映射建议 + 切换开关（off=mock, on=okki）
- **不直接替换 mock**：等 James 确认字段和限流后再做

## 8. 验收

- A/B/C 三视图各自独立 DOM 容器（`#variant-a` / `#variant-b` / `#variant-c`），单选可见
- 切换时间 < 100ms
- 切换后 sidebar 状态、URL、localStorage 三者一致
- 浏览器控制台能看到 `Witop build:` 信息
- `verify-channel-preserve.sh` 仍 PASS
- 新增 `scripts/verify-abc-views.sh`：切换器 + 三个容器存在 + 静态资源可访问
- OKKI 探路输出文件 `docs/OKKI-PROBE-RESULT.md` + 原始响应 `docs/okki-raw-response.json`
- Puppeteer 截图三视图入仓 `reports/abc-views/<variant>.png`
