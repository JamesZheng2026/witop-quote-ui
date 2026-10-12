# A2 任务书 — 询盘详情 + AI 报价升级

## 分支与工作区
- 分支：`feat/a2-inquiry-detail-and-ai-quote`（已切，从 `main` 干净起，HEAD=f6b793b）
- 工作区：`/Users/james/witop-quote-ui/`
- 远程：**不要 push**，GitHub 写操作仍冻结
- 不依赖 OKKI / 数据库，全部 mock

## 已知基线
- A1 修复在独立分支 `fix/html-issues-round1`（HEAD=e7ee8c7），**不要 cherry-pick 进 A2**
- 当前 A2 分支 index.html 仍含旧 `adj-Saudi Arabia`（带空格），A1 才修这个；A2 不要碰这条 A1 已处理的 ID
- 已暴露 PAT 列表：**不要在任何 shell、commit、PR、KB 中重复 token 值或前缀**

## 现有代码地图（1270 行单页 index.html）
- L84-111 sidebar（5 view：dashboard / inquiries / quote-panel / settings / report）
- L116-231 dashboard（统计 + funnel + recent table）
- L233-307 inquiries list + filters
- L309-481 quote panel（左侧 buyer info，右侧 quote + edit/reject/approve）
- L483-596 settings（pricing rules / labor&logistics / region adj / AI model）
- L598-647 quality report
- L657-1268 script（data layer + render + generateMockQuote）

## A2 必须交付的 6 块

### 1. 询盘详情视图（新独立 view `inquiry-detail`）
- 入口：inquiries list 行点击 → 现在进 quote-panel，**改为先进详情**，再点 "Generate Quote" 才进 quote-panel
- 内容（左侧主区）：
  - Header：ID / Company / Country / Intent badge / Status dot / Date
  - 客户快照卡片：contact / email / history（import history） / notes
  - 产品规格卡：product / qty / thickness / width / length / surface / color
  - 报价历史时间线：横线竖节点，每个节点显示 date/amount/status/reason；空状态友好提示
  - AI 处理轨迹：状态机当前位置 + 全部历史 transition（如 New→Reviewed→Quoted）+ 操作人 + 时间戳
- 内容（右侧侧栏）：
  - Quick actions：`Generate Quote`（无 quote 时显示）/ `Edit Quote` / `View Quote History` / `Mark Reviewed` / `Reject`
  - Metadata 卡：source channel / first response due / last activity / risk flags（空数据 mock）
- 视觉：保持现有 tailwind 风格，不引新依赖
- 全部 mock 数据，不引新字段到 MOCK_INQUIRIES 之外；新字段用 `inq.activities[]` 数组追加

### 2. AI 报价引擎升级（重点）
- 新增 `aiQuoteEngine.js`（独立 IIFE，挂到 window，或直接 inline 到 index.html script 块）
- 接口：`quoteInquiry(inq, settings, opts) → Promise<QuoteResult>`
- 三个可插拔 provider：
  - `mockProvider`（默认）：保留现有 `generateMockQuote` 逻辑，但**升级为带分项理由**
  - `rulesProvider`：基于 `settings` + inquiry qty/country 计算分项（材料/工艺/物流/合规/利润），每项带 `reason` 字段
  - `llmProvider`：HTTP POST 占位（不实际调用），返回 mock + warning "LLM provider not configured"
- 路由：`settings.aiProvider = 'mock' | 'rules' | 'llm'`
- QuoteResult schema：
  ```
  {
    material: { amount, reason, confidence, sourceQuotes: [] },
    craft:    { amount, reason, confidence },        // 新增：工艺
    logistics:{ amount, reason, confidence, containerCount },
    compliance:{ amount, reason, confidence },       // 新增：合规/CE/SGS/LC
    margin:   { amount, percent, reason, min: 5, max: 50 },
    subtotal, total, unitPrice,
    overallConfidence,                  // 0-1
    riskFlags: ['high-quantity-low-margin', ...],
    citations: [{ field, value, source: 'mock|rules' }],
    provider: 'mock|rules|llm',
    generatedAt, processingMs
  }
  ```
- UI 渲染：左列金额，右列 `?` 图标 hover 显示 `reason`；底部新加 `Risk Flags` 卡（红字）+ `Citations` 卡（绿字）
- 拒绝/编辑/重新生成时分别记录 `activities[]` 条目：`type=quote_generated|quote_edited|quote_approved|quote_rejected`

### 3. 商机状态机（显式）
- 状态枚举：`New → Reviewed → Quoting → Quoted → Negotiating → Won | Lost`（在 `STATUSES` 数组里更新）
- `transitionInquiry(id, fromState, toState, actor, note)`：合法 transition 校验，非法则抛错并 UI 提示
- `inq.activities[]` 每条 = `{ts, type, fromState, toState, actor, note}`
- 商机列表 view 暂不新增独立页，但**在 inquiries 列表加 status column 的下钻 popover**，显示完整 transition 轨迹
- 接受 quote 自动从 `Quoting` → `Quoted`；reject 走 `Lost` 路径（带 reason 写入 activities）

### 4. 质检报告
- 新 view `quality-report`（**已存在，扩展**）
- 评分卡：每条 quote record 算 4 维分（0-100）
  - response_time_score：`25 - parseInt(processingTime)`，clamp 0-25
  - completeness_score：所有必要分项都非 0 → 25
  - price_reasonableness_score：`margin.percent` 在 [10, 35] → 25
  - risk_word_score：notes/reason 命中风险词列表（"ASAP"/"urgent"/"cheap"/"lowest"/"敏感"）→ 扣分
- 4 维总分 = 等级 A/B/C/D
- 每条记录可展开看扣分点
- 顶部 4 个 stat card 加一个 `Avg. Quality Score`
- 导出 JSON 按钮：把当前 quoteRecords + 评分 dump 到下载

### 5. 模型供应商抽象
- `aiProviders` 路由表（对象）：
  ```
  {
    mock:   { label:'Mock',   fn: mockProvider,   needsKey:false },
    rules:  { label:'Rules',  fn: rulesProvider,  needsKey:false },
    openai: { label:'OpenAI', fn: llmProvider,    needsKey:true,  baseUrl:'https://api.openai.com/v1' },
    anthropic:{ label:'Anthropic', fn: llmProvider, needsKey:true, baseUrl:'https://api.anthropic.com' },
    openrouter:{label:'OpenRouter', fn: llmProvider, needsKey:true, baseUrl:'https://openrouter.ai/api/v1' },
    minimax:{label:'MiniMax', fn: llmProvider,    needsKey:true,  baseUrl:'https://api.minimax.chat/v1' }
  }
  ```
- settings 加 `aiProvider` 选择 + `aiApiKey` 输入（**只存内存，不写 localStorage**；placeholder 提示"This key stays in memory only"）
- llmProvider：未配置 key 时直接 throw `Error('API key not configured')` 并在 UI 显示对应提示
- **禁止**在代码、log、KB、commit 中出现任何真实 API key

### 6. 验证脚本
- `scripts/verify-a2.sh`：在 A1 脚本基础上扩展，新增检查：
  - `inquiry-detail` view 存在且有必需 DOM 节点
  - `aiQuoteEngine` / `quoteInquiry` 符号在 window 上
  - `aiProviders` 至少 3 个 provider
  - `STATUSES` 含 Negotiating/Won/Lost
  - `transitionInquiry` 函数存在
  - 所有新增 `<button>` 都有 `type="button"`
  - 新增 ID 无重复、无空格
- 报告输出 `reports/a2-validation.txt`

## 提交规范
- 一个 commit：`feat(ui): A2 inquiry detail + AI quote engine v2 (mock+rules+llm, abstractable)`
- commit body 列出 6 块对应 + 已知遗留（指向 A1 的 fix 分支）
- **不 push**；commit 后报告 `git log --oneline -3` 和 `git diff --stat HEAD~1` 给 Hermes

## 不要做
- ❌ push 到 origin
- ❌ 写 PAT / API key / token 到任何位置
- ❌ 改 README
- ❌ cherry-pick A1
- ❌ 引新 CDN 依赖
- ❌ 动 OKKI / database 字段
- ❌ 删除现有 MOCK_INQUIRIES 字段

## 交付时回给 Hermes
1. `git log --oneline -3` 输出
2. `git diff --stat HEAD~1` 输出
3. `bash scripts/verify-a2.sh` 输出（含 reports/a2-validation.txt 路径）
4. 浏览器自检清单（不需截图，列"已查 X 个 view 渲染正常"）
5. 已知遗留 / 下一轮 TODO
6. KB 归档：写入 `/Users/james/JamesVault/_codex-memory/inbox/2026-10-10-A2-交付报告-001.md`（如 kb 工具不可用，输出 markdown 文本即可）
