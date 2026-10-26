# Claude 在线优化助手

## 当前能力

网页侧新增“Claude 优化助手”入口。管理员输入页面、流程或交互优化需求后，服务端通过官方 `@anthropic-ai/sdk` 调用 `claude-opus-5-5`，并用 SSE 将回复实时返回浏览器。

当前版本采用**提案模式**：Claude 输出需求理解、优化方案、影响范围、验收标准和执行状态。它没有文件、Shell、Git、数据库写入或部署工具，不会把公网输入直接写入生产代码，也不得声称已完成修改或部署。

代码变更仍必须经过：

1. 独立 Git 分支；
2. 自动化测试；
3. PR 审核；
4. GitHub `production` Environment 人工审批；
5. 部署后 smoke 与运行态验收。

## 安全边界

- AI 接口除现有 Basic Auth 外，还要求独立的 `X-Witop-AI-Access` 口令。
- 独立口令只保存在当前页面内存中，不写入 `localStorage`、URL、请求正文或 Claude 对话。
- 浏览器只把用户在 AI 输入框中主动输入的文字发送给 Claude；不会自动附带客户聊天、SQL 数据或页面存量内容。
- 疑似 Authorization/Bearer、常见 API Key、密码、邮箱和电话会在服务端先脱敏，再进入 Claude 请求。
- Claude API Key 与 AI 访问口令都通过只读 secret 文件注入容器，不写入镜像、仓库、Compose 命令行或日志。
- 用户消息最多 4,000 字符；Claude 历史回复最多 20,000 字符；每次最多 20 条、总计最多 50,000 字符。
- 单实例只允许一个并发生成；同一 AI 访问口令每 5 分钟最多 12 次请求。
- 服务端错误只返回固定错误码，不返回 SDK、网络、凭证或上游响应详情。
- 现有 Basic Auth 凭证曾经暴露，因此在完成凭证轮换或更强身份认证前，不得给该公网入口增加代码写入、Shell、Git push 或自动部署能力。

## Claude API 配置

实现使用：

- 官方 SDK：`@anthropic-ai/sdk`（由根目录 `package-lock.json` 锁定）
- 模型：`claude-opus-5-5`
- 思考：`thinking: { type: "adaptive" }`
- 交互档位：`output_config.effort: "low"`
- 流式响应：SSE
- 拒绝回退：`fallbacks: "default"` + `server-side-fallback-2026-07-01`

生产环境需要在 GitHub Environment `production` 中配置：

- `ANTHROPIC_API_KEY`
- `WITOP_AI_ACCESS_TOKEN`（16–256 字符，必须与 Basic Auth 密码不同）

workflow 将秘密分别写到部署目录的受保护文件，再只读挂载到：

- `/run/secrets/anthropic_api_key`
- `/run/secrets/ai_access_token`

不要在 Issue、PR、文档、workflow 日志或群聊中粘贴秘密值。

## 本地运行

先在仓库外创建两个权限为 `0600` 的文件，再只把**文件路径**放入环境变量：

```bash
ANTHROPIC_API_KEY_FILE=/absolute/external/path/anthropic_api_key \
WITOP_AI_ACCESS_TOKEN_FILE=/absolute/external/path/ai_access_token \
node scripts/server.js
```

不要把真实秘密放在命令行参数或 `.env.production.example` 中。

用 Docker 本地起栈时，基础 `docker-compose.yml` 不含任何 Claude 凭证，因此 CI、staging 和只连 SQL 的场景可以无秘密启动。需要助手的本地环境叠加覆盖文件：

```bash
docker compose -f docker-compose.yml -f docker-compose.ai.yml up -d
```

`docker-compose.ai.yml` 额外要求 `ANTHROPIC_API_KEY_FILE` / `ANTHROPIC_API_KEY_SOURCE` / `WITOP_AI_ACCESS_TOKEN_FILE` / `WITOP_AI_ACCESS_TOKEN_SOURCE` 四个路径变量，缺失时同样 fail-closed。生产使用自包含的 `docker-compose.prod.yml`，不使用该覆盖文件。

## 验证

以下测试全部使用注入的 mock 客户端，不调用真实 Claude API、不会产生 API 费用：

```bash
npm --prefix reports run test:assistant
npm --prefix reports run test:live
```

生产 smoke 只验证未携带独立访问口令时 `/api/assistant/chat` 返回 401；不会发起计费模型请求。
