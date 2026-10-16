# t_bf11da40 本地交付与验证记录

日期：2026-10-16（Asia/Shanghai）。本地部署草案已写入；**生产部署验收未完成**。

## 工作区与范围

- 实际工作区：`/Users/james/witop-quote-ui/.worktrees/t_bf11da40`
- 分支：`wt/t_bf11da40`
- 基线及当前 HEAD：`e05a21d7d89f550e2d22849083871e5809d68613`
- 任务实时 `workspace_path` 优先于正文旧路径 `t_docker_nginx`。`completion_contract=local-only`，没有 commit、push、PR、镜像发布、merge 或生产部署；PR URL 不适用本轮交付。
- 初始 worktree 干净。只在本 worktree 改文件；没有操作 main、launchd、真实 SQLSERVER_CONFIG 或正在运行的宿主机 8765。
- `visual_skipped=true`。没有浏览器视觉 QA、真实 SQL 握手或业务内容抽样证据。

改动文件：

| 文件 | 作用 |
| --- | --- |
| `Dockerfile` | Node 18 + Python 3.11 + pymssql 2.3.13；三阶段；UID/GID 10001；容器专用 bind 与健康探针 |
| `docker-compose.yml` | app + Nginx；env-file 变量解析；外部只读 SQL/TLS/认证挂载；app 不占宿主机 8765 |
| `.env.production.example` | 所有部署可配置变量及验收 curl 路径的空模板，无真实值 |
| `.dockerignore` | 构建上下文默认排除、逐文件开放；scripts 目录开放后再次排除其内容再逐个开放 |
| `.gitignore` | 环境、SQL 配置、证书私钥、htpasswd 保护 |
| `nginx.conf` | TLS、80→443（仅健康路由例外）、精确 Host/Origin、Basic Auth、forwarded headers、健康反代 |
| `scripts/server.js` | 只增加健康路由及其成功/失败投影；沿用既有并发共享查询和校验，API 响应契约不变 |
| `DEPLOY.md` | 域名/运行时风险、CI/CD 计划、配置、启动与真实验收命令 |
| `docs/deploy/ROLLBACK.md` | 明确选择上一稳定镜像并 up 重建；来源校验 + 实际内容抽样 |
| `docs/deploy/test-healthz.cjs` | 健康响应、无缓存、SQL 故障/恢复、隐私、访问校验、并发与可选真实监听测试 |
| `docs/deploy/VALIDATION.md` | 本记录 |

## 已执行且通过

本机运行测试使用 Node `v24.20.0`，Python 系统版本 `3.14.7`；未验证镜像内 Node 18/Python 3.11。已有 jsdom 安装来自主仓 `reports/node_modules`，没有安装依赖或修改该目录。

```text
$ node --check scripts/server.js
$ node --check docs/deploy/test-healthz.cjs
# 均 exit 0，无输出

$ node docs/deploy/test-healthz.cjs
PASS healthz: 68 assertions (fixtures; real SQL/container readiness unverified)

$ NODE_PATH=/Users/james/witop-quote-ui/reports/node_modules node reports/test-v4.cjs
PASS HTTP: bounded read-only API, no-store, Host/Origin, static allowlist, sanitized errors, query coalescing (in-process requests)
PASS v4 UI: default entry, six nav + add, four stages, cards, safe text, detail, search/filter/sort, error/empty/retry, no mock fallback (injected fixtures)

$ node reports/test-v4-sql.cjs
PASS SQL bridge: real-schema contract, unchanged nvarchar time, bounded query, agent/contact partition, stable IDs, no fabricated completion, private CLI evidence, sanitized errors (driver fixture; real SQL unverified)

$ NODE_PATH=/Users/james/witop-quote-ui/reports/node_modules bash scripts/verify-b-only.sh
# 下列为输出中的结果行：
结果: 39 PASS / 0 FAIL
=== Summary: PASS 3 / FAIL 0 ===
verify-b-only: PASS (structure, wording, QC states, REC-009, compatibility, Issue#9 Bug1 sync)

$ git diff --check
# exit 0，无输出
```

也按现有 CI 规则运行全部 `scripts/*.sh` 的 `bash -n`、`scripts/*.js` / `reports/*.cjs` / `docs/deploy/*.cjs` 的 `node --check`，全部通过：

```sh
bash -euo pipefail -c 'for f in scripts/*.sh; do bash --noprofile --norc -n "$f"; done; for f in scripts/*.js reports/*.cjs docs/deploy/*.cjs; do node --check "$f"; done; git diff --check; echo "PASS shell/JS syntax and git diff --check"'
```

实际输出：`PASS shell/JS syntax and git diff --check`。

另对全部未跟踪交付文件逐一执行 `git diff --no-index --check -- /dev/null <文件>`，确认无空白错误输出；tracked diff 的 `git diff --check` 也通过。

Python/PyYAML 离线检查通过：两项服务结构、所有 Compose 变量在空模板中存在、无 app 宿主端口、挂载只读且不自动创建源路径、Nginx 等待 app healthy、构建允许列表指向存在的文件。`git check-ignore` 确认 `.env.production`、SQL JSON、证书/私钥、htpasswd 被忽略，模板未被忽略。Node `vm.Script` 检查 Dockerfile 两个嵌入式 JS 命令语法，确认三阶段和非 root 声明。**这些检查不等同于 Dockerfile 构建、Compose/Nginx 原生解析或实际镜像用户验证。**

## 无法完成的验证与实际失败

```text
$ docker compose --project-name witop-production --env-file .env.production.example config -q
zsh:1: command not found: docker

$ node docs/deploy/test-healthz.cjs --listen
Error: listen EPERM: operation not permitted 127.0.0.1
```

沙箱外重跑 `node docs/deploy/test-healthz.cjs --listen` 的申请被拒绝，工具返回 `Rejected("rejected by user")`。没有绕过拒绝。该失败只涉及测试的随机本机端口，不是原有 8765 服务；测试使用注入数据，即使通过也不能证明真实 SQL。

`command -v docker/nginx/colima/podman/nerdctl` 未发现可执行文件，常见 Docker Desktop/Homebrew Docker 路径也不存在。没有安装或启动 Docker。

| 验收项 | 当前结果 |
| --- | --- |
| Compose 原生配置解析 | 未运行成功：无 Docker；空模板还需运维填写合法值 |
| `docker compose build` | 未执行：无 Docker |
| 镜像大小 < 800MB | **未知**，未构建，不能估计替代测量 |
| 镜像 Node 18/Python 3.11/pymssql/UID | Dockerfile 已声明并含构建断言；**运行未验证** |
| Compose up/down 与实际启动秒数 | 未执行；**未知** |
| Nginx `-t`、TLS、重定向、认证/CORS | 配置已写；**运行未验证** |
| `/healthz` curl 结果 | **无**；只有进程内 SQL 夹具响应验证 |
| 真实 SQL、50 会话、API 内容抽样 | 未验证；没有访问真实配置/客户数据 |
| 五分钟持续健康 | 未执行；DEPLOY.md 提供 11 次首尾覆盖的循环 |
| 真实稳定镜像回滚演练 | 未执行；SOP 已写 |
| PR 与远端 CI | 本轮 local-only 未创建/运行 |

## 接续条件

Hermes/运维在有 Docker 的授权隔离环境中，确认真实域名、证书与访问认证，提供外部只读 SQL 配置挂载；按 DEPLOY.md 完成原生解析、构建、字节数、冷启动、Nginx curl/认证/CORS、真实 SQL 内容抽样和五分钟检查。随后由审核交付流程处理 Git/PR/远端 CI 并通知 Hermes review。不得把本地夹具 PASS 当生产验收 PASS。

发布仍需处理 Node 18 EOL、基础镜像 digest 固定、目标架构 wheel 可用性、只读挂载权限、SQL 聚合查询负载、证书续期和单机重建停机窗口。未发生数据库/消息源变更。
