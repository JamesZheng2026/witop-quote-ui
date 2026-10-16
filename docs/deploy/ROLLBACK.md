# Docker + Nginx 回滚 SOP

适用：独立 Linux 云主机的 `witop-production` Compose 栈。不得操作 Mac 的 8765 launchd 服务、main checkout 或 SQL 数据。此栈只读 SQL，无数据库回滚步骤。

全部命令在 Bash 中执行，先设置 `set -euo pipefail`，保证 curl 失败不会被后面的 jq 掩盖；不要开启 `set -x`。

## 1. 选定上一稳定版本

从发布记录取**已验证稳定**的 app 镜像完整引用，例如 `registry/repository@sha256:<上一稳定 digest>` 或不可变 `git-<完整提交 SHA>` 标签。不能凭时间猜标签，不能用 `latest`，也不能把“拉取最新”当回滚。确认目标架构、仓库访问及镜像仍存在，记录当前失败版本和回滚目标。

取同一发布记录中的 Compose、Nginx 配置 Git SHA、Nginx digest 和受保护环境备份。若这些文件也随失败发布改变，在**云端部署目录**恢复对应稳定配置；不要 reset 开发工作区或改动 main。保留当前配置供诊断。不要用旧配置覆盖凭证轮换；秘密文件只由运维秘密系统恢复或保持当前有效版本。

## 2. 显式固定目标并重建

用编辑器将云端 `.env.production` 的 `WITOP_APP_IMAGE` 改成上一步的**完整稳定引用**，必要时同步稳定 `NGINX_IMAGE`。保存权限 0600；不要在终端输出文件。先检查 shell 中没有旧值覆盖文件：`unset WITOP_APP_IMAGE NGINX_IMAGE`（只清本次 shell 的部署变量）。`SQLSERVER_CONFIG` 继续是只读容器文件路径，不能填入实际 JSON。

```sh
docker compose --project-name witop-production --env-file .env.production config -q
# 先获取明确的稳定镜像；此时尚未停服务。
docker compose --project-name witop-production --env-file .env.production pull app nginx
# up 会按指定镜像重建；Nginx 一同重建以重新解析 app 地址。
docker compose --project-name witop-production --env-file .env.production up -d --no-build --force-recreate --wait --wait-timeout 180
docker compose --project-name witop-production --env-file .env.production ps
docker compose --project-name witop-production --env-file .env.production images
```

**禁止 `docker compose pull && restart` 作为回滚方案**：没有指定上一稳定镜像，且 restart 不会把现有容器切换到目标镜像。不要先 `down` 或 prune；保留可用容器和历史镜像，直到回滚验收完成。

## 3. 校验来源与实际内容

在目标主机本地运行下列 HTTP 80 检查；远端监控经 VPN 使用 `http://<内网IP>:80`，或通过 SSH 隧道转发。B 方案无需域名或 TLS；若使用非默认端口，必须同步替换 URL。`WITOP_CURL_AUTH_FILE` 指向仓库外权限 0600 的 curl 用户认证配置，不能在命令行写密码。

```sh
curl --fail --silent --show-error http://127.0.0.1:80/healthz \
  | jq -e '.ok == true and .source == "sqlserver" and (.ts | type == "string")'
curl --config "$WITOP_CURL_AUTH_FILE" --fail --silent --show-error http://127.0.0.1:80/api/receptions \
  | jq -e '.ok == true and .source == "sqlserver" and (.records | type == "array") and (.records | length <= 50)'
docker compose --project-name witop-production --env-file .env.production exec -T app node scripts/sqlserver-bridge.js
```

必须继续做内容抽样：授权审核员在认证页面选至少 3 个会话，逐一核对归属、消息数、时间、最新消息与授权 SQL 结果；确认新鲜数据，不能只检查 `source` 字符串。记录样本数及通过/差异，不把客户内容或标识写进日志/卡片。

持续 5 分钟、每 30 秒检查一次健康（含首尾 11 次），确认 `source: sqlserver`、无 503、容器 healthy、首页可用、静态资源正常、未认证 API 是 401、非同源 Origin 是 403、认证后 HTTP 首页直接返回 200 且没有 HTTPS 跳转或 HSTS。循环和 HTTP 验收细节见 [DEPLOY.md](../../DEPLOY.md)。将实际运行的 app Image ID/digest 与上一步稳定镜像核对；单有 `images` 中的标签不足以证明内容一致。

## 4. 失败处理与记录

健康或内容验收失败：停止后续发布，不标记回滚成功；检查脱敏错误码、挂载可读性、数据库网络、VPN/SSH 访问路径与认证文件和 Nginx 上游解析。凭证/数据库故障不会由镜像回滚自动修复。不要恢复到未经验证的新镜像，不修改真实秘密来做测试。

向 Hermes 提交旧/目标/实际运行 digest、配置 SHA、开始结束时间、停机时间、五分钟健康结果、API/业务抽样结论及剩余风险，走 review 后再结束事件。不得自动 merge、自动发布或清理旧镜像。
