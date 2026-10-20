# feat/witop-abc-demo-views

> 目的：在 Witop 客户系统静态原型上同时落地三个 James 已批准的需求：
> A. 可点击 A/B/C demo 视图切换
> B. 刷新问题修复（no-cache + 文件名 hash）
> C. OKKI 真实询盘数据接入（探路 + 适配层，待凭证）

## 1. 访问方式

- 本机：`http://127.0.0.1:8766/index.html`
- 局域网候选：`http://172.16.163.1:8766/index.html` / `http://172.16.16.139:8766/index.html`
- A/B/C 切换：`?v=a` / `?v=b` / `?v=c`（URL 优先，否则 localStorage，再否则 a）

## 2. 验证

```bash
# 服务在 0.0.0.0:8766 跑（PID 见 lsof）
bash scripts/verify-abc-views.sh http://127.0.0.1:8766
# PASS=25 FAIL=0
```

state 机回归：39 PASS / 0 FAIL（未受影响）

## 3. 截图

- `reports/abc-views/a.png` — 极简（3 KPI + 12 条询盘表）
- `reports/abc-views/b.png` — OKKI 4 段（蓝/绿/橙/紫）
- `reports/abc-views/c.png` — AI 分析三栏（询盘快照 + 报价分项 + 质检 5 维）

刷新 `node reports/snapshot-abc-views.js` 重新生成。

## 4. 关键文件

| 路径 | 作用 |
|------|------|
| `index.html` | 加 cache meta + scripts?v= + dashboard 改为切换器 + 三容器 |
| `scripts/variants.js` | A/B/C 三个视图实现 + 切换器 + logBuild |
| `scripts/build.js` | 生成 `scripts/build-info.json`（sha + ts） |
| `scripts/okki-adapter.js` | OKKI 接入适配层（ping / listInquiries / listReception + offline fallback） |
| `scripts/verify-abc-views.sh` | 25 项验证（cache meta / 容器 / 静态资源 / 函数签名） |
| `reports/snapshot-abc-views.js` | Puppeteer 截图三视图 |
| `docs/ABC-VIEW-CONTRACT.md` | A/B/C 三个视图的契约、配色、对比维度 |
| `docs/OKKI-PROBE-RESULT.md` | OKKI 接入探路状态（待凭证） |

## 5. 已知阻塞

- **OKKI 真实数据未接入**：等待 James 提供 sandbox 凭证（base + token）。
  适配层已就绪，开关 `window.okkiConfig.enabled = true` 即生效。
- **jsdom 30.1.2 未装**：`reports/node_modules/` 缺失导致 channel-preserve guard 失败，
  与本 worktree 改动无关；AGENTS.md 允许 `jsdom-unavailable=true` 不阻塞。

## 6. 与 V3-* worktree 的关系

- 主线 `main` 干净（HEAD=8b89e90），未动
- v3-01 / v3-01b / v3-02 等 worktree 未动
- 验证脚本独立：`verify-abc-views.sh` 不影响 `verify-v3-*.sh`

## 7. Git

```
b084f54 feat(witop-abc): A/B/C demo views + cache fix + OKKI adapter
8b89e90 Merge pull request #7 from JamesZheng2026/ci/lint-workflow  (main)
```

worktree 路径：`/Users/james/witop-quote-ui/.worktrees/witop-abc-demo-views/`
分支：`feat/witop-abc-demo-views`
