# Witop 接待工作台 Stage 1 正式验收报告

归档日期：2026-10-27（Asia/Shanghai）。验收事实窗口：2026-10-26/27，来自 Hermes 实测及任务卡 `t_b89797cc` 的授权事实底座 [S1]。

**验收结论：卡片所记录版本的部署、真实 SQL 数据读取、访问认证和 AI 流式调用链路通过 Stage 1 验收；长期公网入口、长期 AI 凭据和发布可追溯标识仍未收口。** 本报告归档该窗口的结果，不证明阅读时的线上状态；本次仅执行仓库只读核对和文档检查，没有重跑生产请求、部署、回滚或通知。

## 验收对象与版本标识

| 对象 | 验收记录 | 来源与复核入口 |
| --- | --- | --- |
| 生产 workflow / run | `production-deploy` / `40315544601` | [S1]；[Actions run][run] |
| run head 完整 SHA | `341695e322330a8b535f158111a66b1c80c564e2` | [S1]；run 详情；固定源码 [S2] |
| 主线一致性 | 验收时 `origin/main` = 本地 `main` = run head，短 SHA `341695e` | [S1]；本次本地引用复核亦一致，见下方命令 |
| 已验收 app 镜像 | `witop-production:2026.10.26-provider-agnostic` | [S1]；run 的 `Build Docker image` 日志 |
| 镜像大小 / 短 Image ID | `456 MB` / `22824827cb93` | [S1]；大小为原记录展示值，未提供精确字节数；短 ID 不是完整 digest |
| 运行容器 | `witop-production-app-1`；`Up 5 hours (healthy)` | [S1]；运行时长仅是验收窗口快照，不是持续可用承诺 |
| 容器端口映射 | `127.0.0.1:8765->8765/tcp` | [S1]；[S2] 的生产 Compose `ports` |
| 应用包版本 | `package.json` 为 `0.9.0` | [S1]、[S2]；该版本号不能单独识别本次部署 |
| 容器内容一致性 | 容器内 `server.js`、`assistant.js`、`index.html` 的 SHA-256 与 main 匹配 | [S1]；原始容器散列值未随卡片提供，下表仅补充固定源码参考值 |

本次在任务工作树执行 `git rev-parse HEAD origin/main main`，三行实际输出均为：

```text
341695e322330a8b535f158111a66b1c80c564e2
341695e322330a8b535f158111a66b1c80c564e2
341695e322330a8b535f158111a66b1c80c564e2
```

本次执行 `shasum -a 256 scripts/server.js scripts/assistant.js index.html` 的实际输出如下。它们是 [S2] 源文件的本地核对结果，不是本次容器取证输出：

```text
846ebad452b03bf84390c1fa78079a1815ca56091b2aa4fa339f5a066a8b7869  scripts/server.js
a7f221964413c40f1e5d4f62882bfc0e86acf22d04a2c2c7f09eb5f5c0d384ab  scripts/assistant.js
66deedaadb5fdb2e469f91fe44d17bc195304089556f0cdf137d940e15d0486e  index.html
```

## 部署与运行证据

| 链路 | 验收结果 | 来源与日志位置 |
| --- | --- | --- |
| Validate inputs | `success` | [S1]；[run][run] → `Validate inputs` |
| Preflight：Docker 与端口占用排查 | `success` | [S1]；run → `Preflight (Docker daemon + port 8765 survey)` |
| Deploy + SQL | `success` | [S1]；run → `Deploy + SQL (connectivity, build, compose up)` |
| Smoke | `success` | [S1]；run → `Smoke (real routes, local loopback)` |
| Finalize | `success`；钉钉通知 `errcode=0` | [S1]；run → `Finalize (DingTalk notify)` → `Notify DingTalk` |

Stage 1 在自托管 Mac Studio runner 本地构建镜像并通过生产 Compose 启动，不以 registry 发布为交付前提。部署根目录为 `/Users/james/witop-prod`，生产配置为 `/Users/james/witop-prod/docker-compose.prod.yml`。宿主机 nginx 配置位置为 `/opt/homebrew/etc/nginx/servers/witop-stage1.conf`；生产 Compose 仅含 app，nginx 不在该 Compose 内 [S2]。

验收链路为：公网 HTTPS quick tunnel → 宿主机 nginx `8913`（Basic Auth）→ `127.0.0.1:8765` app → 共享 SQL / AI 上游 [S1、S2]。CI smoke 直接访问 loopback `8765`，其通过不能独自证明 nginx 认证或公网链路；后两者由 [S1] 的独立实测记录支持。

## 运行时行为验收

下表均为 [S1] 的历史实测记录。认证接口的响应仅归档状态与脱敏结论，不收录客户消息、参与者标识或请求认证值。

| 请求 / 入口 | 观察结果 | 证据边界 |
| --- | --- | --- |
| `GET /healthz` | HTTP `200`，`{"ok":true,"source":"sqlserver"}`；免 Basic Auth | 证明该次真实 SQL 健康查询成功 |
| `GET /api/receptions` | 未认证 `401`；正确认证后 `200`，返回真实 `wa_chat_message` 数据 | 认证结论适用于经 nginx 的入口；不把 loopback 直连当作认证入口 |
| `GET /api/receptions/{id}/messages` | `200`，多条真实消息；参与者已掩码 | 卡片未给出具体样本 ID 或计数，本文不补造 |
| `POST /api/assistant/chat` | 缺少 `X-Witop-AI-Access` 为 `401`；携带有效访问凭据为 SSE `200` | AI 访问门与 Basic Auth 是不同校验 |
| AI 完整流式调用 | 实际模型 `deepseek-chat`，模式 `proposal-only`，内容逐字流出至 `done` | 证明当次上游调用与流结束，不代表长期服务或写入业务数据的验收 |
| 公网 quick tunnel `/healthz` | `200` | 验收 URL 见下；仅临时入口 |
| 公网 quick tunnel `/` 与 `/api/receptions` | 正确认证后均为 `200` | 不代表正式域名可用 |

验收时公网 URL：`https://ruby-turn-representatives-novelty.trycloudflare.com` [S1]。地址会随 `cloudflared` 重启变化；该 URL 仅用于定位历史验收对象，不作为稳定服务地址。

## 安全边界

### Basic Auth 与 AI 访问控制

nginx 从 `127.0.0.1:8913` 反代到 `127.0.0.1:8765`，Basic Auth 用户名为 `stage1`；`/healthz` 豁免，其余已验收页面/API 经认证访问 [S1]。app 发布端口仅绑定 loopback [S2]。AI 请求另需 `X-Witop-AI-Access`；本文不保存任何认证头值。

| 受保护对象 | 仅供定位的文件引用 | 权限及来源 |
| --- | --- | --- |
| Basic Auth 认证文件 | `/Users/james/.witop-stage1/htpasswd` | `0600`，[S1]；未读取文件内容 |
| AI 访问凭据文件 | `/Users/james/.witop-stage1/ai_access_token` | `0600`，[S1]；未读取文件内容 |
| 容器部署所用 SQL 配置 | `SQLSERVER_CONFIG_FILE` 指向 `/Users/james/witop-prod/secrets/sqlserver_config.json`；容器内 `SQLSERVER_CONFIG` 指向 `/run/secrets/sqlserver_config.json` | workflow 声明落盘 `0600`、Compose 声明只读挂载 [S2]；本次未检查宿主机文件 |

卡片记录的访问凭据来源路径与 workflow 的部署暂存路径属于不同位置；本文不推断两者当前内容相同。路径及配置字段可归档，密码、哈希、上游 Key、访问凭据和完整认证请求不得进入报告、Git、argv 或评论。复核只保留状态码、模型、流结束、权限与脱敏结果。

### SQL Plan A 与审批门

生产 workflow 使用共享数据库 `Agent`、账户名 `agent_agent`；SQL 连通性门执行只读 `SELECT 1;`。该流程不创建数据库，不执行数据库备份或恢复；应用读取 `wa_chat_message`。连通性探针仅传递 `SQLCMDPASSWORD` 环境变量名，引用的环境配置项名为 `MSSQL_SA_PASSWORD`，不将值放入 argv；命令输出受抑制 [S2]。本文未审计实际数据库授权，连通性通过不等于已独立验证账户全部权限。

部署 job 受 `environment: production` 审批门保护；Finalize 也引用 production 环境，配置 `deployment: false`。`workflow_dispatch`、人工批准及串行部署机制见固定源码 [S2]。本任务仅归档，不触发这些流程，不修改真实配置或凭据。

## 未收口项清单

以下均为**未收口**；事实状态按 [S1] 的验收窗口归档。右栏是后续收口所需证据，不是已完成事项。

| 未收口项 | 已知事实 | 收口所需证据 |
| --- | --- | --- |
| 正式域名与稳定公网入口 | `quote.witop.com.cn` 为 `NXDOMAIN`；公网使用 quick tunnel，地址随重启变化 | 正式 DNS 解析、稳定入口及认证后的端到端验证；workflow 的 environment URL 不能代替实际 DNS/HTTP 验证 |
| 长期 AI 凭据 | 当前**临时借用** DeepSeek 兼容凭据，实际模型 `deepseek-chat` | 独立长期商用 Key 的授权配置及完整 AI 调用验证；不归档 Key 值 |
| 运行时 build-info 陈旧 | `GET /scripts/build-info.json` 为 `sha=8b89e90`、`builtAt=2026-10-13`；不能用于识别本次运行版本 | 修复卡 `t_974511e0` 在 [S1] 窗口为进行中；需修复合入、重新构建部署并核对接口 SHA 与 run head |
| Git tag / GitHub Release 缺失 | `package.json` 为 `0.9.0`，git tag 数 `0`，GitHub Release 为空 | 发布记录关联完整源码 SHA、镜像完整 ID / digest、配置与验收报告；本任务不创建 tag 或 Release |
| 上一稳定回滚目标与演练证据不完整 | [S1] 未给出本次部署之前的完整 Image ID、稳定配置快照或实际回滚演练结果 | 从 run 的回滚快照及受控记录补齐目标，核对镜像保留情况，在独立授权操作中完成恢复与业务验证 |

build-info 原因由 [S1] 指出：`scripts/build.js` 从未被任何 workflow 调用。本次固定源码中检索 `.github/workflows` 未发现 `scripts/build.js` 或 `npm run build` 调用；Dockerfile 直接复制仓库内 `scripts/build-info.json`。该 JSON 的本地值亦为 `sha=8b89e90`、`builtAt=2026-10-13T01:57:02.765Z` [S2]。本次未读取修复卡的最新状态，也未更改构建流程。

## 回滚指引

### 目标与证据限制

已验收恢复基准是本报告记录的源码 `341695e322330a8b535f158111a66b1c80c564e2` 与镜像 `witop-production:2026.10.26-provider-agnostic`，短 Image ID 为 `22824827cb93` [S1]。若后续版本失败，该基准可供授权操作者核对候选目标；必须先取得完整 Image ID 并确认镜像仍在本机，不能仅凭可变标签或短 ID 恢复。本文没有本次部署之前的上一稳定镜像值，不能为它补填名称或宣称回滚演练通过。

### 当前 workflow 的自动回滚范围

固定源码 [S2] 的 `Capture rollback state` 在替换运行容器前记录 `OLD_APP_CONTAINER_ID`、`OLD_APP_IMAGE`、`OLD_APP_IMAGE_ID`、旧容器运行状态及旧 launchd 运行状态。回滚快照在 job 环境中传递，日志包含摘要；源码存在该逻辑不代表本次失败分支实际执行。

`Roll back failed deployment` 仅在 deploy job 内发生失败时运行，且为 `continue-on-error: true`：

- 未完成快照时跳过恢复；有旧容器时优先按旧完整 Image ID 重建并核对实际 Image ID。
- 有此前运行的 launchd 时可尝试恢复该服务；该分支同样需要已捕获状态。
- 脚本检查监听端口恢复，但没有执行完整健康、业务数据与 AI 验收；后续 smoke job 失败也不会自动回到已结束的 deploy job 触发回滚。
- SQL 配置与 AI 凭据在快照前已写入，生产 Compose 文件也已被复制；此机制不恢复旧凭据或旧 Compose，不执行数据库回滚。

### 授权操作者的恢复核对顺序

1. 从 [run][run] 的 `Capture rollback state` 日志与受控发布记录取得目标完整 Image ID、对应配置和可用性证明；保留当前镜像与配置，禁止先清理历史镜像。
2. 以 `/Users/james/witop-prod/docker-compose.prod.yml` 和既有受保护路径为准，在授权环境中将 `WITOP_APP_IMAGE` 显式指向已核对的完整稳定 Image ID，再通过生产 Compose 重建 app。恢复凭据或配置需单独确认有效性，不以旧版本覆盖现行凭据。
3. 核对容器实际 Image ID、healthy、`/healthz` 的真实 SQL 结果、nginx 认证门、真实会话/消息脱敏抽样和 AI 流结束。记录实际起止时间、停机及差异；不能用端口监听代替完整回滚成功结论。

以上为待授权操作指引，本任务未执行。现有 [ROLLBACK.md](ROLLBACK.md) 面向 Linux app+nginx 双服务栈，其 HTTP 端口、镜像获取及 Compose 命令不能直接套用本次 Mac 单 app 栈；本次拓扑以 [Stage 1 部署说明](../stage1-macdeploy.md) 和 [S2] 为准。

## 证据来源与复核入口

| 编号 | 来源 | 可复核内容与限制 |
| --- | --- | --- |
| S1 | Kanban `codex-tech` → `t_b89797cc` → 正文「已核实的验收事实（Hermes 于 2026-10-26/27 实测）」及「已知未收口项」 | 运行、HTTP/SSE、公网、DNS、凭据使用性质与通知事实的归档依据；卡片无父依赖、开始时无评论；原始响应、容器完整散列和完整 Image ID 未附于正文 |
| S2 | [固定源码提交][source]；归档工作树 `/Users/james/witop-quote-ui/.worktrees/t_b89797cc`，分支 `wt/t_b89797cc` | 本次本地只读核对的 workflow、生产 Compose、Stage 1 部署说明、源文件散列、包版本与 build-info；不是本次生产探测 |
| S3 | [生产 Actions run][run] 的 job / step 日志 | 原始部署日志入口；本文 job 结果引用 [S1]，本次未重新下载远端日志；复核者需在有权限时读取并脱敏留存 |

S3 的具体定位：`Build Docker image` 查 tag 与大小，`Verify deployed image digest` 查完整预期/实际 Image ID，`Capture rollback state` 查替换前摘要，`Probe real routes on loopback` 查 smoke，`Notify DingTalk` 查通知结果；步骤名称来自 [S2]。生产 app 运行日志由 Docker 管理，可在授权主机以 `docker logs --tail 200 witop-production-app-1` 定位；不在仓库保存未经脱敏的输出。本文没有杜撰宿主机日志文件位置或已下载的 Actions artifact。

可供后续授权复核的只读命令（本节为复核入口，除前文明确列出的本地结果外，本次未执行）：

```sh
gh run view 40315544601 --repo JamesZheng2026/witop-quote-ui \
  --json headSha,status,conclusion,jobs
docker image inspect witop-production:2026.10.26-provider-agnostic \
  --format 'id={{.Id}} bytes={{.Size}}'
docker inspect witop-production-app-1 \
  --format 'image={{.Image}} health={{.State.Health.Status}} ports={{json .HostConfig.PortBindings}}'
git show 341695e322330a8b535f158111a66b1c80c564e2:package.json
git tag --list
gh release list --repo JamesZheng2026/witop-quote-ui
dig quote.witop.com.cn
```

认证请求复核须由授权操作者使用仓库外受保护配置，不在命令参数、报告或卡片中粘贴认证值。复核时如现状已变化，追加带时间与来源的新记录，不把本报告历史快照改写成未经取证的当前结论。

[run]: https://github.com/JamesZheng2026/witop-quote-ui/actions/runs/40315544601
[source]: https://github.com/JamesZheng2026/witop-quote-ui/tree/341695e322330a8b535f158111a66b1c80c564e2
