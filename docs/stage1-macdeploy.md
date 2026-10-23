# Stage 1 — 本机生产部署（Mac Studio）

`production-deploy.yml` v0.8 在自托管 Mac Studio runner 上**本机 build + compose up**，
不再 SSH 到远程 ECS，也不推 / 拉任何 registry 镜像。

## 拓扑

```
浏览器
  │  http://<mac-studio>:8913/     (Basic Auth)
  ▼
宿主机 nginx  /opt/homebrew/etc/nginx/servers/witop-stage1.conf   listen 8913
  │  proxy_pass → 127.0.0.1:8765   (Host 头改写)
  ▼
docker 容器  witop-production  (compose service: app)   127.0.0.1:8765
  │  SQLSERVER_CONFIG=/run/secrets/sqlserver_config.json  (bind mount, ro)
  ▼
SQL Server  221.2.76.114:5001   database=Agent   user=agent_agent
```

要点：

- **8765 只 publish 到 loopback**（`ports: ["127.0.0.1:8765:8765"]`），compose 里**没有** nginx
  service。宿主机 nginx 是唯一入口，workflow 不碰它。
- **8913 不进 CI smoke**：没有 Basic Auth 头会返回 401，smoke 打的是 `127.0.0.1:8765`。
- 部署根目录 `/Users/james/witop-prod`（runner 是 uid 501 = james，`$HOME` 下免 sudo 写不了 `/opt`）。

## macOS runner 上的 Docker 接法

与 `staging-deploy.yml` v2 同一套，已验证：

| 项 | 值 | 原因 |
|---|---|---|
| `DOCKER_HOST` | `unix:///Users/james/.docker/run/docker.sock` | 默认 context 指向 `/var/run/docker.sock`，macOS 上不存在 |
| `docker/setup-buildx-action` | **不用** | buildx 每次拉基础镜像都调 osxkeychain helper；launchd runner 没有 keychain session，build 会失败 |
| `~/.docker/config.json` | 部署前删除 | 残留 `credsStore=osxkeychain` 会让拉取失败 |

## 密钥处理

`SQLSERVER_CONFIG_JSON`（production environment secret）只在运行期落到宿主机文件：

```
/Users/james/witop-prod/secrets/sqlserver_config.json    mode 0600
```

bind-mount 进容器 `/run/secrets/sqlserver_config.json`（只读）。容器只拿到**路径**，
拿不到值；workflow 只打印路径和 `stat` 权限，**不回显内容**。SQL 探测走
`SQLCMDPASSWORD` 环境变量传密码，不进 argv。

## 端口 8765 的占用者

部署前会执行（幂等）：

```sh
launchctl bootout gui/$(id -u)/com.witop.reception-v4 || true
```

然后等 8765 释放，最多 15s；仍被占用则失败并打印占用进程。
注意：停掉它之后，**手工隧道演示用的裸 node 进程会消失**，8765 由容器接管，隧道链路本身不变。

## 已知风险（Stage 1 不修）

- `/healthz` 冷启动约 **4.5s**（Python 每请求 spawn 进程）。镜像 `HEALTHCHECK` 给了
  35s timeout，compose / 部署等待逻辑按此设置；**smoke 的 `curl --max-time` 不得小于 35s**
  （现为 `SMOKE_MAX_TIME: "40"`）。
- 冷启动慢的根因（常驻 python worker）留给后续阶段。

## 相关文件

| 路径 | 作用 |
|---|---|
| `.github/workflows/production-deploy.yml` | v0.8 部署编排 |
| `docker-compose.prod.yml` | Stage 1 单 service compose |
| `/opt/homebrew/etc/nginx/servers/witop-stage1.conf` | 宿主机 nginx，**不由本流程修改** |