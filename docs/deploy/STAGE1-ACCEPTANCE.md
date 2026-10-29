# Stage 1 正式验收报告

- **报告日期**: 2026-10-29
- **验收范围**: Witop Quote UI — Stage 1（Mac Studio 本机部署 + 公网 quick tunnel）
- **结论**: ✅ **通过**
- **对应版本**: `v0.10.0`（tag → `ec87e30e1f77c32037c4b66ad128e44ccb6b93aa`）
- **最终生产 run**: `40900472952` — https://github.com/JamesZheng2026/witop-quote-ui/actions/runs/40900472952
- **前序生产 run**: `40315544601`（v0.9.0 线，head `341695e`）

---

## 1. 部署链路

### 1.1 最终生产部署（v0.10.0）

| Job | 结论 |
|---|---|
| Validate inputs | success |
| Preflight (Docker daemon + port 8765 survey) | success |
| Deploy + SQL (connectivity, build, compose up) | success |
| Smoke (real routes, local loopback) | success |
| Finalize (DingTalk notify) | success |

钉钉通知 `errcode=0`。

### 1.2 运行时

| 项 | 值 |
|---|---|
| 镜像 | `witop-production:2026.10.29-ec87e30` |
| 容器 | `witop-production-app-1`，healthy |
| 端口绑定 | `127.0.0.1:8765->8765/tcp`（仅回环） |
| 部署根目录 | `/Users/james/witop-prod` |
| 主机 nginx | `127.0.0.1:8913 → 127.0.0.1:8765`，Basic Auth |
| 公网入口 | `https://ruby-turn-representatives-novelty.trycloudflare.com`（quick tunnel，**非固定地址**） |

### 1.3 数据库

共享 SQL 数据库 Plan A：

| 项 | 值 |
|---|---|
| 数据库 | `Agent` |
| 用户 | `agent_agent` |
| 地址 | `221.2.76.114:5001` |
| `tds_version` | `7.0` |
| 门禁动作 | 仅 `SELECT 1` 连通性检查 |

密码经 `SQLCMDPASSWORD` 环境变量传给 `sqlcmd`，未进入 argv 或日志。

---

## 2. 功能验收

### 2.1 完整聊天记录

- 端点 `GET /api/receptions/{id}/messages`
- 使用**真实 SQL**，数据来自 `wa_chat_message`
- 采用**私有 keyset 游标分页**，避免新增消息导致重复或漏读
- 服务端脱敏：邮箱、电话、Authorization/Bearer、常见 API Key、密码
- 失败时回退显示最近一条消息
- 实测：返回真实多条消息（本次抽样 26 条），参与者已掩码（`尾号 5282`），`redacted` 标记逐条生效
- 列表接口实测：`GET /api/receptions` → `ok:true, source:sqlserver, table:wa_chat_message, records:50, total:37039`

### 2.2 AI 优化助手

- 端点 `POST /api/assistant/chat`，SSE 流式返回
- 独立 `X-Witop-AI-Access` 口令（与 Basic Auth 密码**不同**）
- 实施请求限流、单并发、固定错误码、输入脱敏
- **不自动读取**客户聊天或 SQL 数据
- **proposal-only**：只生成可审核方案，不授予 Shell / Git push / 生产写入权限
- 缺少必要配置时 **fail-closed**
- 生产实际模型：`deepseek-chat`（DeepSeek 兼容端点），上游由 `WITOP_AI_BASE_URL` / `WITOP_AI_MODEL` 运行时配置
- 实测：无 token → 401（nginx 层）；正确 token → SSE 200，`meta` 事件声明 `{"model":"deepseek-chat","mode":"proposal-only"}`，内容逐字 `delta` 流出至 `done` 事件（本次实测 129 行 / 1615 字节，`inputTokens:252 outputTokens:41`）
- 请求体契约：`{"messages":[{"role":"user","content":"…"}]}`。传 `{"message":"…"}` 返回 `400 AI_INVALID_REQUEST`（`validateMessages` 要求数组、role 白名单、user 收尾）

### 2.3 认证边界

| 路径 | 无认证 | 带认证 |
|---|---|---|
| `/healthz` | 200（免 Basic Auth） | 200 |
| `/` | 401 | 200 |
| `/api/receptions` | 401 | 200 |

---

## 3. 版本身份验收（本次核心收口项）

**问题**：`scripts/build-info.json` 原为被 git 跟踪的静态文件，最后写入于 2026-10-13，任何构建步骤都不会重新生成它。线上容器内文件与公网 `GET /scripts/build-info.json` 均自报 `sha: 8b89e90`、`builtAt: 2026-10-13`，而运行中的镜像实际构建自 `341695e` —— 对外自报的身份指向一个早已不存在的提交。

**修复**：构建期由 `scripts/build.js` 从拥有该脚本的 checkout 读取 SHA 并写入元数据；取不到 SHA 时写 `unknown` 并**非零退出**（fail-closed），不再静默沿用陈旧文件。两个 deploy workflow 在 `docker build` 前生成元数据，并断言 checkout 的 HEAD 等于本次 run 的 `github.sha`。

### 实测证据

| 来源 | sha | builtAt |
|---|---|---|
| run `40900472952` headSha | `ec87e30e1f77c32037c4b66ad128e44ccb6b93aa` | — |
| `GET http://127.0.0.1:8765/scripts/build-info.json` | `ec87e30` ✅ | `2026-10-29T15:21:43.847Z` |
| 公网 `GET /scripts/build-info.json`（带认证） | `ec87e30` ✅ | 同上 |
| 容器内 `/app/scripts/build-info.json` | `ec87e30` ✅ | 同上 |

**判定通过**：`build-info.sha` == run head SHA 前 7 位。

### fail-closed 路径验证

```
$ node scripts/build.js              # 正常 checkout → sha=341695e, EXIT=0
$ rm -rf .git && node scripts/build.js
  → sha=unknown, "Cannot determine this checkout SHA; refusing to build.", EXIT=1
$ 外层 git init + cd 内层 && node scripts/build.js
  → sha=unknown, EXIT=1
```

配合 workflow 的 `set -euo pipefail`，取不到 SHA 时构建直接失败。

---

## 4. 自动化测试

| 套件 | 结果 |
|---|---|
| `npm --prefix reports run test` | PASS 3 / FAIL 0 |
| `npm --prefix reports run test:live` | reception / v4 UI / SQL bridge / AI assistant 四组全 PASS |
| `npm --prefix reports run test:v4` | PASS |
| `npm --prefix reports run test:assistant` | PASS |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `actionlint`（两个 deploy workflow） | 无新增诊断 |
| `git diff --check` | 通过 |

### 硬约束断言（零命中）

```
ssh | ECS_* | GHCR_USERNAME | docker login|pull   → 零命中
CREATE DATABASE | ensure_db | BACKUP DATABASE | RESTORE VERIFYONLY → 零命中
```

保持不变：`environment: production` 审批闸、DingTalk 签名、SQL Plan A、`DOCKER_HOST=unix:///Users/james/.docker/run/docker.sock`、`APP_DIR=/Users/witop-prod`、compose 仅 `app` 服务、发布到 `127.0.0.1:8765`、smoke 走 loopback 8765。

---

## 5. 安全核验

- Basic Auth 已完成轮换：新密码仅保存在 `/Users/james/.witop-stage1/password` 与 `htpasswd`，权限 `0600`；仓库 secret `NGINX_AUTH_HTPASSWD` 已同步
- 仓库工作区无明文密码文件；全 git 历史 `apr1$` 哈希命中 **0** 次
- `tunnel.log` 与 nginx access log 未发现 `Authorization` / `stage1:` 痕迹
- SQL 密码、SSH 私钥、GHCR token、钉钉 webhook/secret、Basic Auth 密码、AI API Key、access token **均未**写入仓库、文档、PR、Issue、日志或群聊
- 秘密文件权限 `0600`；验证时使用请求头文件，避免秘密进入 argv

### 残留风险（已知且已止损）

- **旧 Basic Auth 密码仍存在历史群聊消息中**，无法通过本次轮换撤回；新密码已完成止损
- 当前 AI 上游使用**临时借用**的本机 DeepSeek 兼容凭据。长期商用应更换独立长期 Key —— 只需更新 Environment secret 与 `WITOP_AI_BASE_URL` / `WITOP_AI_MODEL`，**无需改动任何业务代码**

---

## 6. 未收口事项（本报告不覆盖）

| 项 | 状态 | 归属 |
|---|---|---|
| 正式域名 `quote.witop.com.cn` | **NXDOMAIN**，当前只有会漂的 quick tunnel 地址 | 需要域名账号权限：服务商配 A/CNAME → named tunnel → 固定 TLS 证书 |
| 独立长期 AI API Key | 待更换 | James 申请后更新 environment secret |
| `package-lock.json` 版本字段 | 仍为 `0.9.0`（`npm ci` 实测通过，非阻断） | 后续独立任务 |
| `docs/stage1-macdeploy.md` 第 3、72 行 | 仍写 `v0.8` | 后续独立任务 |
| `.github/workflows/docker-build.yml` | 构建镜像含占位 `unknown`，**不可**用于版本追溯 | 后续独立任务 |
| `production-deploy.yml` 的 AI 默认值 | 默认仍指向官方 Anthropic；生产由 environment vars 覆盖 | 后续独立任务 |

---

## 7. 证据索引

| 证据 | 位置 |
|---|---|
| 最终生产 run | https://github.com/JamesZheng2026/witop-quote-ui/actions/runs/40900472952 |
| staging run（ec87e30） | `40900117846` success |
| lint run | `40900117673` success |
| Docker build run | `40900117303` success |
| v0.10.0 Release | https://github.com/JamesZheng2026/witop-quote-ui/releases/tag/v0.10.0 |
| v0.9.0 Release（事后锚点） | https://github.com/JamesZheng2026/witop-quote-ui/releases/tag/v0.9.0 |
| 版本规则文档 | `docs/deploy/VERSIONING.md` |
| 回滚手册 | `docs/deploy/ROLLBACK.md` |
| PR #22（清理 Claude Sonnet 残留） | merge `e4576ea` |
| PR #23（真实 build-info + 版本规则） | merge `ec87e30` |
| PR #18 | 已关闭（历史遗留空壳 PR） |

---

*报告由 Hermes 实施并独立复核。所有结论基于上述真实命令输出，未使用模拟数据。*
