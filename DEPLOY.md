# Witop Docker + Nginx 部署草案

本方案与 Mac 上的 `127.0.0.1:8765` launchd 服务独立。只在隔离 checkout 编写；不修改 main、launchd plist 或既有 SQL 配置。当前分支为 `wt/t_bf11da40`；本次 B 方案在群授权目录内的独立 clone 修改，不操作原 worktree。

## 发布前必须确认

- **B 方案已确认：纯 HTTP 内网**。无需域名、DNS 或 TLS 证书；访问走 VPN 或 SSH 隧道。默认仅绑定 `127.0.0.1:80`，远程访问时只绑定已确认的 VPN/内网 IP，防火墙仅允许授权客户端。不得直接向公网发布 HTTP。Basic Auth 不加密密码和客户数据，传输保护由 VPN/SSH 提供；后续对外开放时须另行配置并验收 TLS 与访问控制。
- **实际 Node 22 验证通过，容器待验**：默认镜像统一到 `node:22.23.3-bookworm-slim`，并固定官方多架构 manifest digest。使用经官方 SHA-256 校验的 macOS ARM64 Node `v22.23.3`，直接运行同一 worktree 的 `server.js` 和 `sqlserver-bridge.js`，在临时 loopback 端口验证 `/healthz` HTTP 200、`ok=true/source=sqlserver`；`/api/receptions` HTTP 200 返回 50 条真实 SQL 记录，时间字段保持字符串；首页 HTTP 200。健康检查 72 断言、v4 HTTP/UI 与 SQL 夹具、B 视图和 channel 历史回归均通过。未混用 main bridge，未改动现有 8765。此前 Node 24 的结果不能证明 Node 22 兼容；本次通过的是实际 Node 22 的宿主机验证，Linux 镜像内 Node/Python、容器冷启动和完整 Nginx 验收仍待执行。
- 目标 Linux 云主机已有 Docker Engine、Compose v2（支持 `up --wait` 和长格式 bind mount），可访问镜像仓库和 SQL Server。用 SQL 只读账户及最小网络 ACL；不开放数据库端口到公网。
- 外部 Basic Auth 用户文件及 SQL 配置由运维的凭证系统提供。此任务不创建、读取或复制真实凭证。Basic Auth 是最小访问控制，不能替代 VPN/SSH 传输保护。
- 必须完成下文真实容器验收、镜像大小及五分钟持续可用检查。当前本机没有 Docker，不能从代码检查推断这些项目通过。完整本轮证据见 [验证记录](docs/deploy/VALIDATION.md)。

## 结构与凭证边界

`VPN/SSH → Nginx HTTP :80 → app:8765 → Python 3.11/pymssql → SQL Server`。

app 以 UID/GID `10001:10001`、只读根文件系统运行，不发布宿主机 8765。Docker 启动命令通过已有 `createServer()` 仅在容器中监听 `0.0.0.0:8765`；直接运行 `node scripts/server.js` 仍只监听 loopback。

Nginx 使用 `server_name _` 接收 IP 请求，不要求固定域名。Origin 为空时允许 CLI/页面导航；存在时必须与当前 `http://Host:端口` 完全一致，拒绝其他 Origin（包括 `null`）和 `Sec-Fetch-Site: cross-site`，不开放跨域 CORS。随后把上游 Host 固定为 `127.0.0.1:8765`，清除已校验的 Origin/Sec-Fetch-Site，重建 `X-Forwarded-*`。无客户内容的 `/healthz` 免认证，其余数据及页面需要 Basic Auth。首页和 API 直接使用 HTTP，不跳转 HTTPS、不发送 HSTS。

`SQLSERVER_CONFIG` **是容器内 JSON 文件路径**，不能放 JSON 内容。Compose 用 `--env-file .env.production` 解析并注入这个环境变量；`SQLSERVER_CONFIG_FILE` 指向宿主机外部文件，只读挂载到 `/run/secrets/sqlserver_config.json`。配置字段沿用现有 `server/port/user/password/database/tds_version`，不修改 SQL bridge。运维需保证 UID 10001 对挂载文件有读取权、父目录可遍历；使用组/ACL，不设全局可读。Nginx worker 也需要读取外部 htpasswd。

Dockerfile 采用 Node/Python wheel/runtime 多阶段构建，只复制 Node 可执行文件和明确列出的运行文件；pymssql 固定 `2.3.13`、只使用二进制 wheel（包含 FreeTDS）。目标架构没有对应 wheel 时构建会失败，需审核后补支持，不能悄悄换源或编译版本。`.dockerignore` 默认排除全部文件，再开放运行文件；`.gitignore` 排除环境文件、SQL JSON、证书/私钥和 htpasswd。真实秘密始终放仓库外。

## 环境文件与本地隔离验收

在本 worktree 或云端经审核的部署目录运行。先复制**空模板**，本地填写所有必填项；不要把真实值粘进命令、评论、报告或 Git：

```sh
cp .env.production.example .env.production
chmod 600 .env.production
# 用本机编辑器填写；不要 source 此文件，不输出配置内容。
```

| 变量 | 填写规则 |
| --- | --- |
| `WITOP_APP_IMAGE` | 已批准的 `registry/repository:git-<完整提交 SHA>` 或 `registry/repository@sha256:<digest>`；不使用 latest |
| `NGINX_IMAGE` | 已批准的官方 Nginx Alpine 版本，生产固定 digest |
| `SQLSERVER_CONFIG` | 必须填 `/run/secrets/sqlserver_config.json` |
| `SQLSERVER_CONFIG_FILE` | 仓库外、已存在 SQL JSON 的绝对路径 |
| `NGINX_AUTH_FILE` | 仓库外已存在的 htpasswd 绝对路径；不得提交用户名/密码或哈希 |
| `HTTP_BIND` / `HTTP_PORT` | 默认 `127.0.0.1:80`；远程访问仅绑定 VPN/内网 IP、端口 `80`，配合防火墙限制；本机端口冲突时用 `8912` |

下文固定项目名，避免操作其他 Compose 栈。裸 `docker compose config` 不会自动读取 `.env.production`；必须带 `--env-file`。`config -q` 验证解析但不打印配置，避免将潜在秘密写入日志。[Compose 环境变量规则](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)

下列运维命令使用 Bash；先执行 `set -euo pipefail`，使 curl、jq 或 Compose 任一步失败都停止。确认当前 shell 未导出同名旧部署变量（它们优先于环境文件）；尤其不要让旧 `WITOP_APP_IMAGE` 覆盖此次选择。不要开启 `set -x`。

```sh
docker compose --project-name witop-production --env-file .env.production config -q
docker compose --project-name witop-production --env-file .env.production build app
docker compose --project-name witop-production --env-file .env.production run --rm --no-deps app \
  sh -ec 'node --version; python3 --version; python3 -c "import pymssql; print(pymssql.__version__)"; id'
```

`nginx -t` 解析上游 `app`，因此 app 尚未启动时先启动 app、待 healthy 后再执行 Nginx 检查：

```sh
docker compose --project-name witop-production --env-file .env.production up -d --no-build --wait --wait-timeout 180 app
docker compose --project-name witop-production --env-file .env.production run --rm --no-deps nginx -t
# 计时从此处开始，记录到栈 healthy 为止的实际秒数。
time docker compose --project-name witop-production --env-file .env.production up -d --no-build --wait --wait-timeout 180
docker compose --project-name witop-production --env-file .env.production ps
```

首次启动时间还应另记录“app 启动 → 整栈 healthy”的总时间，避免把已启动 app 的热启动当作冷启动。app 的 `/healthz` 每次经现有只读查询确认 SQL 成功，成功返回 `{ "ok": true, "source": "sqlserver", "ts": "<UTC ISO 时间>" }`，失败返回 HTTP 503、`ok: false` 及固定错误码；不包含会话/客户内容，也不缓存成功状态。并发健康/API 请求共享同一次查询。健康检查每分钟执行，30 秒 SQL bridge 超时小于 35 秒健康检查超时；代价是已有聚合查询的周期性负载，需在目标库验收。

下列验收通过 **Nginx HTTP 80**，健康路由允许 IP 探针。若隔离验收改用了 `HTTP_PORT=8912`，对应替换所有 URL 端口；在远端通过 VPN 使用 `http://<内网IP>:80`，或经 SSH 本地端口转发。不要用宿主机 8765 的成功证明 Docker 成功：

```sh
curl --fail --silent --show-error http://127.0.0.1:80/healthz \
  | jq -e '.ok == true and .source == "sqlserver" and (.ts | type == "string")'
# 整整 5 分钟，含 t=0、t=300，共 11 次。任一错误停止。
bash -euo pipefail <<'SH'
for i in {0..10}; do
  curl --fail --silent --show-error http://127.0.0.1:80/healthz \
    | jq -e '.ok == true and .source == "sqlserver"' >/dev/null
  if [ "$i" -lt 10 ]; then sleep 30; fi
done
SH
```

API 验收通过同一容器的 HTTP 80 入口。在工作机的仓库外配置权限 0600 的 curl 配置（`user = "..."`），在当前 shell 设置 `WITOP_CURL_AUTH_FILE` 指向它（仅验收工具使用，不注入容器）；不要将密码放命令行。远端调用须通过 VPN 或 SSH 隧道，浏览器访问 `http://<内网IP>`。

```sh
curl --config "$WITOP_CURL_AUTH_FILE" --fail --silent --show-error \
  http://127.0.0.1:80/api/receptions \
  | jq -e '.ok == true and .source == "sqlserver" and (.records | type == "array") and (.records | length <= 50)'
# CLI 默认抽取 5 条，仅输出哈希 ID、计数和字段存在性；不打印原文。
docker compose --project-name witop-production --env-file .env.production exec -T app node scripts/sqlserver-bridge.js
```

由有权限的业务审核员在认证页面核对至少 3 个会话的归属、消息数、时间和最新内容，与既有授权 SQL 结果一致；报告只记通过数量及差异，不保存客户信息。确认认证后首页和静态脚本通过 HTTP 直接返回 200、没有 HTTPS 跳转/HSTS；未认证 API 为 401，同源 Origin（含端口）允许、不同主机/端口/协议及 `null` Origin 为 403，跨站 Fetch 为 403，同源 OPTIONS 为 204。无 Origin 的非认证 API 仍不能读数据。确认 `/healthz` SQL 故障后 503，恢复后重新 healthy（只在独立测试环境模拟故障，不修改真实凭证）。

记录镜像实际字节数和启动时间；大小门槛为未压缩本地 app 镜像 **< 800,000,000 bytes**。镜像大小不能由 Dockerfile 估算代替，目标架构需分别测量：

```sh
bash -euo pipefail <<'SH'
app_id=$(docker compose --project-name witop-production --env-file .env.production images -q app)
test -n "$app_id"
size=$(docker image inspect "$app_id" --format '{{.Size}}')
printf 'app_image_bytes=%s\n' "$size"
test "$size" -lt 800000000
SH
# 仅结束本次隔离测试栈；不要在生产发布后执行 down。
docker compose --project-name witop-production --env-file .env.production down
```

## CI、镜像版本与发布流程

当前 `.github/workflows/lint.yml` 只含语法、空白和 channel-preserve 回归，**没有镜像构建/推送/部署 job**。本卡只起草流程，不改 CI，也不自动发布。

1. 初始草案按任务卡 `completion_contract=local-only` 留在本地。James 后续指令“推进上线”后，继续在本 worktree 完成实际 Node 22 自检并准备 PR；生产主机、VPN/SSH 访问路径及容器验收条件仍需补齐。
2. 由审核后的交付流程执行 worktree → commit → push 当前任务分支 → PR 到 main；CI 必须全绿后，通知 Hermes 走 review；不得自动 merge。
3. 后续经授权的 CI 构建阶段：目标架构 `docker compose ... build app`；验证运行时、非 root、镜像大小与扫描；发布 `git-<完整提交 SHA>`，记录仓库 digest。Node 基础镜像已固定多架构 digest；发布前还需固定 Python/Nginx digest。测试依赖 jsdom 留在测试环境中，不安装到生产运行镜像。
4. 在独立、使用授权只读凭证的测试环境跑真实 SQL、五分钟健康、Nginx HTTP/认证/同源校验、业务内容抽样和回滚演练。外部 CI 不复制开发机的 launchd/SQL 配置。只有批准的发布 job 可 push 镜像；不得因开 PR 自动推送或部署。
5. 发布记录同时保存当前/上一稳定 app digest、Nginx digest、部署配置 Git SHA、架构、大小、冷启动秒数、脱敏验收结果和配置备份路径。配置备份使用运维秘密存储，不放仓库。
6. 人工批准后在云主机用审核的配置及镜像执行下述命令。发布前备份已部署 `nginx.conf`、Compose 和受保护的 `.env.production`；填写新 `WITOP_APP_IMAGE`，保持上一稳定值可恢复。不要重建生产镜像。

```sh
docker compose --project-name witop-production --env-file .env.production config -q
docker compose --project-name witop-production --env-file .env.production pull
# 同时重建 Nginx：它必须重新解析重建后的 app 容器地址。
docker compose --project-name witop-production --env-file .env.production up -d --no-build --force-recreate --wait --wait-timeout 180
```

在云端经 VPN/SSH 访问 `http://<内网IP>:80/healthz` 确认 `ok=true/source=sqlserver`，再经认证执行 API 与内容抽样。单机 Compose 会有短暂停机，不承诺零停机；`restart: unless-stopped` 只处理进程退出，不会自动修复 unhealthy。运维应对 unhealthy/503 告警并按 SOP 处理。

回滚必须明确指定**上一稳定镜像**并重建容器，完整步骤见 [ROLLBACK.md](docs/deploy/ROLLBACK.md)。本次不要求域名或证书，不涉及数据库迁移、共享状态及客户内容变更。
