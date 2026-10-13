# OKKI 接入探路结果

**日期**：2026-10-13
**执行人**：Hermes
**工作区**：`/Users/james/witop-quote-ui/.worktrees/witop-abc-demo-views`
**分支**：`feat/witop-abc-demo-views`
**状态**：⏸️ **待 James 提供凭证后继续**

---

## 1. 目标

在 Witop 静态原型中接入 OKKI（小满）真实询盘数据，作为"切到真实数据"的开关，
不直接替换 mock。需验证：API 通路、字段映射、限流、错误降级。

## 2. 已完成

- ✅ 适配层骨架：`scripts/okki-adapter.js`
  - `ping()` — 探活
  - `listInquiries(opts)` — 询盘列表
  - `listReception(opts)` — 接待列表
  - 离线 fallback 到 mock（网络失败 → `console.warn` + mock）
  - 字段映射占位（INQ.id / company / country / product / status / qty / date）
  - Bearer Token 头，window.okkiConfig.enabled 开关
- ✅ 引用入口：`index.html` 引入 `scripts/okki-adapter.js?v=<build>`
- ✅ 验证脚本：`scripts/verify-abc-views.sh` 扩展为可对 adapter 做存在性检查

## 3. 未完成（待 James 提供）

- ❌ **凭证**：sandbox token / app_key / app_secret 尚未提供
  - 期望位置：env / 1Password / 直接告知
  - 注入方式：`window.okkiConfig = { enabled: true, base, token }`
- ❌ **端点选择**：
  - 询盘列表：`/api/v1/inquiries`（占位）
  - 接待列表：`/api/v1/reception`（占位）
  - 实际路径需查 OKKI 开放平台文档或调通后再确认
- ❌ **真实响应 → INQ 字段映射**：等待首次 200 响应后回填
- ❌ **CORS / 代理策略**：浏览器直连 OKKI 是否允许跨域；如不允许需要本地代理

## 4. 已知风险

- 真实数据可能含敏感客户信息（PII），禁止写入仓库 / 截图 / 日志 / Langfuse
- 公开限流 ~60 req/min，超出需指数退避
- 切到 okki=on 后若 OKKI 挂，原型不可用 → 保留 off=mock 兜底

## 5. 验收标准

接通后需提供：
1. 浏览器控制台 `okkiAdapter.ping()` 返回 `{ok:true, status:200, ms:<500}`
2. `okkiAdapter.listInquiries({limit:5})` 返回 ≥1 条真实数据
3. dashboard 三个 variant 在 okki=on 时显示真实数据，off 时显示 mock
4. 网络断开时自动回退 mock + 控制台 warn
5. 截图不包含真实客户名 / 邮箱 / 电话

## 6. 下一步

**等待 James 提供**：
- OKKI sandbox 凭证（base + token）
- 或：指定一个已就绪的 OKKI 开放平台账号，Hermes 按其文档接入
