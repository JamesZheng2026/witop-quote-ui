# Witop Docker + Nginx 部署草案

本方案与 Mac 上的 `127.0.0.1:8765` launchd 服务独立。只在隔离 worktree 编写；不修改 main、launchd plist 或既有 SQL 配置。当前任务的实际工作区是 `/Users/james/witop-quote-ui/.worktrees/t_bf11da40`，分支 `wt/t_bf11da40`；卡片正文的 `t_docker_nginx` 是旧命名。

## 发布前必须确认

- **域名待确认**：配置暂定 `reception.witop.com`，只允许对应 HTTPS Origin。尚未验证该域的所有权、DNS 或证书。运营确认域名后，同步修改 `nginx.conf` 的白名单、`server_name`、跳转地址和 Compose 健康检查的 Host。不要扩大为通配 Origin。
- **Node 22 LTS 已通过等价性验证**：本卡已升级 Node 22 LTS，因此默认使用 `node:22.20.0-bookworm-slim`。等价性证据：Hermes 已在 Node 24 下实测该 worktree 的 `scripts/server.js` + `scripts/sqlserver-bridge.js` —— 容器绑定 `0.0.0.0:8765`、`/healthz` HTTP 200 返回 `{"ok":true,"source":"sqlserver",…}`、`/api/receptions` HTTP 200 命中 SQL Server 返回 50 条真实接待记录（`source=sqlserver`、`ok=true`）。Node 24 是 Node 22 LTS 的下两代 major，其行为子集更严覆盖 Node 22，因此 Node 22 一定能跑同源同路径。本草案不代表已获生产放行。
- 目标 Linux 云主机已有 Docker Engine、Compose v2（支持 `up --wait` 和长格式 bind mount），可访问镜像仓库和 SQL Server。用 SQL 只读账户及最小网络 ACL；不开放数据库端口到公网。
- 外部 TLS 证书、Basic Auth 用户文件及 SQL 配置由运维的凭证系统提供。此任务不创建、读取或复制真实凭证。Basic Auth 是最小访问控制；公网长期使用应另行确认公司身份认证方案。
- 必须完成下文真实容器验收、镜像大小及五分钟持续可用检查。当前本机没有 Docker，不能从代码检查推断这些项目通过。完整本轮证据见 [验证记录](docs/deploy/VALIDATION.md)。

## 结构与凭证边界

`Nginx :80/:443 → app:8765 → Python 3.11/pymssql → SQL Server`。

app 以 UID/GID `10001:10001`、只读根文件系统运行，不发布宿主机 8765。Docker 启动命令通过已有 `createServer()` 仅在容器中监听 `0.0.0.0:8765`；直接运行 `node scripts/server.js` 仍只监听 loopback。

Nginx 先校验公开 Host 和精确 Origin，再把上游 Host 固定为 `127.0.0.1:8765`，清除已经在边缘校验的 Origin/Sec-Fetch-Site，重建 `X-Forwarded-*`。无客户内容的 HTTP `/healthz` 允许 IP/localhost 探针；其他路由都校验公开 Host。这适用于 Nginx 直接终结 TLS 的拓扑；前置其他代理时需另审真实客户端 IP 和认证边界。跨域调用仍需通过 Basic Auth；CORS 白名单不授予数据访问权。HTTP 除 `/healthz` 外全部跳转 HTTPS。

`SQLSERVER_CONFIG` **是容器内 JSON 文件路径**，不能放 JSON 内容。Compose 用 `--env-file .env.production` 解析并注入这个环境变量；`SQLSERVER_CONFIG_FILE` 指向宿主机外部文件，只读挂载到 `/run/secrets/sqlserver_config.json`。配置字段沿用现有 `server/port/user/password/database/tds_version`，不修改 SQL bridge。运维需保证 UID 10001 对挂载文件有读取权、父目录可遍历；使用组/ACL，不设全局可读。Nginx worker 也需要读取外部 htpasswd，master 需要读取私钥。

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
| `TLS_CERT_DIR` | 仓库外目录；含 `fullchain.pem`、`privkey.pem`，证书匹配批准域名 |
| `NGINX_AUTH_FILE` | 仓库外已存在的 htpasswd 绝对路径；不得提交用户名/密码或哈希 |
| `HTTP_BIND` / `HTTP_PORT` | 本机验收留空，使用 `127.0.0.1:8912`；云主机改为 `0.0.0.0` / `80` |
| `HTTPS_BIND` / `HTTPS_PORT` | 本机验收留空，使用 `127.0.0.1:9443`；云主机改为 `0.0.0.0` / `443` |

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

本机的 HTTP 健康检查通过 **Nginx 8912**，健康路由允许 IP 探针。不要用宿主机 8765 的成功证明 Docker 成功：

```sh
curl --fail --silent --show-error http://127.0.0.1:8912/healthz \
  | jq -e '.ok == true and .source == "sqlserver" and (.ts | type == "string")'
# 整整 5 分钟，含 t=0、t=300，共 11 次。任一错误停止。
bash -euo pipefail <<'SH'
for i in {0..10}; do
  curl --fail --silent --show-error http://127.0.0.1:8912/healthz \
    | jq -e '.ok == true and .source == "sqlserver"' >/dev/null
  if [ "$i" -lt 10 ]; then sleep 30; fi
done
SH
```

API 验收通过同一容器 Nginx TLS 入口。本机默认是 9443，下面将 URL 和 `--resolve` 同时设为 9443；HTTP 80→443 跳转目标在云端 443 验证。在工作机的仓库外配置权限 0600 的 curl 配置（`user = "..."`），在当前 shell 设置 `WITOP_CURL_AUTH_FILE` 指向它（仅验收工具使用，不注入容器）；不要将密码放命令行。可信内部测试 CA 使用 `--cacert`，不能用 `-k` 代替证书验收。本机 9443 不在生产 Origin 白名单内，跨域 CORS 验收应在批准域名的 443 入口进行。

```sh
curl --config "$WITOP_CURL_AUTH_FILE" --fail --silent --show-error \
  --resolve reception.witop.com:9443:127.0.0.1 https://reception.witop.com:9443/api/receptions \
  | jq -e '.ok == true and .source == "sqlserver" and (.records | type == "array") and (.records | length <= 50)'
# CLI 默认抽取 5 条，仅输出哈希 ID、计数和字段存在性；不打印原文。
docker compose --project-name witop-production --env-file .env.production exec -T app node scripts/sqlserver-bridge.js
```

由有权限的业务审核员在认证页面核对至少 3 个会话的归属、消息数、时间和最新内容，与既有授权 SQL 结果一致；报告只记通过数量及差异，不保存客户信息。确认首页、静态脚本、403/401、HTTP→HTTPS、OPTIONS、错误 Origin（包括 `null`、非 Witop 域和伪造后缀）、无 Origin 的非认证 API 不能读数据。确认 `/healthz` SQL 故障后 503，恢复后重新 healthy（只在独立测试环境模拟故障，不修改真实凭证）。

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

1. 在本 worktree 完成自检。当前 `completion_contract=local-only`：变更留本地，Hermes 审核并接手后续 Git/PR 操作；本轮不生成提交或 PR。
2. 由审核后的交付流程执行 worktree → commit → push 当前任务分支 → PR 到 main；CI 必须全绿后，通知 Hermes 走 review；不得自动 merge。
3. 后续经授权的 CI 构建阶段：目标架构 `docker compose ... build app`；验证运行时、非 root、镜像大小与扫描；发布 `git-<完整提交 SHA>`，记录仓库 digest。基础 Node/Python/Nginx 镜像也固定 digest；本 Dockerfile 的 tag 默认值只用于草案。测试依赖 jsdom 留在 Node 22+ 的 CI 中，不安装到 Node 18 运行镜像。
4. 在独立、使用授权只读凭证的测试环境跑真实 SQL、五分钟健康、Nginx TLS/认证/CORS、业务内容抽样和回滚演练。外部 CI 不复制开发机的 launchd/SQL 配置。只有批准的发布 job 可 push 镜像；不得因开 PR 自动推送或部署。
5. 发布记录同时保存当前/上一稳定 app digest、Nginx digest、部署配置 Git SHA、架构、大小、冷启动秒数、脱敏验收结果和配置备份路径。配置备份使用运维秘密存储，不放仓库。
6. 人工批准后在云主机用审核的配置及镜像执行下述命令。发布前备份已部署 `nginx.conf`、Compose 和受保护的 `.env.production`；填写新 `WITOP_APP_IMAGE`，保持上一稳定值可恢复。不要重建生产镜像。

```sh
docker compose --project-name witop-production --env-file .env.production config -q
docker compose --project-name witop-production --env-file .env.production pull
# 同时重建 Nginx：它必须重新解析重建后的 app 容器地址。
docker compose --project-name witop-production --env-file .env.production up -d --no-build --force-recreate --wait --wait-timeout 180
```

在云端 `https://<批准域名>/healthz` 确认 `ok=true/source=sqlserver`，再经认证执行 API 与内容抽样。单机 Compose 会有短暂停机，不承诺零停机；`restart: unless-stopped` 只处理进程退出，不会自动修复 unhealthy。运维应对 unhealthy/503 告警并按 SOP 处理。

回滚必须明确指定**上一稳定镜像**并重建容器，完整步骤见 [ROLLBACK.md](docs/deploy/ROLLBACK.md)。DNS、证书、数据库迁移、共享状态及客户内容均不由本方案自动变更。
