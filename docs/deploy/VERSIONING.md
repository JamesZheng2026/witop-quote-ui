# 版本与构建追溯

`package.json` 是应用版本号的唯一来源，格式为 `MAJOR.MINOR.PATCH`；
当前 `package-lock.json` 尚未同步的例外及后续统一计划见“已知遗留”。
不兼容变更递增 MAJOR，兼容的新能力递增 MINOR，兼容的问题修复递增 PATCH；
递增上位时将下位归零。workflow 头部仅引用本文件与 package.json，不另存版本号。
本次按协调者裁定从 `0.9.0` 升至 `0.10.0`。

## Tag 与 Release

- Tag 命名为 `vX.Y.Z`，必须与该提交的 package.json 版本一致。
- `341695e` 是 v0.9.0 的历史生产基线（run `40315544601`）。协调者可在获批后补
  `v0.9.0` 事后锚点，Release 备注须写明“事后打标，代码未变”。本次修复不创建 tag。
- v0.10.0 的目标是本次修复合并后的 merge commit。James 决定生产部署及打标时间；
  顺序为合并、通过 production environment 审批并部署、核对 loopback 与公网的构建
  元数据、再为已验收提交打 tag / 创建 GitHub Release。Release 不得提前发布。

## 构建元数据契约

在 checkout 根目录、每次 `docker build` 前运行 `node scripts/build.js`。
脚本将 Git 工作目录固定到脚本所属 checkout，读取 `git rev-parse --short HEAD`，
生成 `scripts/build-info.json`：`sha` 是当前 checkout 的短 SHA，`ts` 是构建生成时的
Unix 毫秒时间，`builtAt` 是同一时刻的 ISO 时间。workflow 还核对完整 HEAD 等于
本次 run 的 `github.sha`；两个 workflow 均按此 SHA checkout（`fetch-depth: 1`），
防止排队期间分支移动造成错误归属。

Git 信息缺失、SHA 无效或源目录仅位于另一仓库内部时，脚本覆盖旧文件为
`sha: "unknown"`（附本次时间），随后非零退出。生产与 staging 的生成步骤使用
`set -euo pipefail`，失败会停止后续构建。Git 中仅保留 `unknown`、空时间的占位文件，
不得提交本地生成值。Dockerfile 的 allowlist 会复制生成结果，无需在镜像内运行 Git。

本地验证示例（独立 worktree；测试容器仅使用 8799，不替换生产容器）：

```sh
node scripts/build.js
git rev-parse --short HEAD
DOCKER_HOST=unix:///Users/james/.docker/run/docker.sock docker build -t witop-production:version-test .
DOCKER_HOST=unix:///Users/james/.docker/run/docker.sock docker run --rm -d --name witop-version-test -p 127.0.0.1:8799:8765 witop-production:version-test
curl --fail --silent --show-error http://127.0.0.1:8799/scripts/build-info.json
DOCKER_HOST=unix:///Users/james/.docker/run/docker.sock docker stop witop-version-test
```

测试后将 build-info.json 恢复为占位内容。未提交的工作区变更不会产生新 SHA；
本地结果只证明生成机制，正式版本需从合并后的干净 checkout 构建。

## 运行时版本判定规则

**运行时 build 标识唯一可信来源 = `GET /scripts/build-info.json`。**
镜像 tag（如 `witop-production:2026.10.26-provider-agnostic`）是**人类可读标签**，可被复用、可被覆盖，**不是**机器可验证锚点。
判定线上版本必须比对 `build-info.sha` 与该次部署 run 的 head SHA 前 7 位；不一致即视为**版本标识失效**，按事故处理，不得仅凭镜像 tag 判断。

## 生产验收与证据

部署由 James 授权并通过 `production` environment 审批。保存本次 run 的完整
head SHA、构建步骤生成的 JSON 和时间，以及以下两条路径的真实响应：

1. `GET http://127.0.0.1:8765/scripts/build-info.json`。
2. 经当前 quick tunnel `GET https://ruby-turn-representatives-novelty.trycloudflare.com/scripts/build-info.json`，使用现有
   Basic Auth；凭据只走批准的安全机制，不进入命令行、日志或报告。

上述入口为 Hermes 在 2026-10-27 复核记录的地址，随 cloudflared 重启变化；验收前确认当时的 quick tunnel 地址。
正式域名 `quote.witop.com.cn` 仍为 NXDOMAIN（Hermes，2026-10-27）；named tunnel 与固定 TLS 证书尚未落地。域名切换后必须重跑本项验收。

对每份响应验证：`sha` 等于本次 checkout 的 `git rev-parse --short HEAD`，且是
run 完整 head SHA 的前缀；`ts` / `builtAt` 与构建步骤的 JSON 一致，
`new Date(ts).toISOString() === builtAt`，并在本次构建时间窗口内。
未知 SHA、时间不符、HTTP 失败或两条路径不一致均不能验收。Basic Auth 的原有
未认证 401、已认证 200 行为必须保留，不得为探测绕过认证。

## 已知遗留与交付边界

`.github/workflows/docker-build.yml` 的 PR / 主干 buildx CI 本次未改，仍未运行
元数据生成步骤；它构建的镜像会包含占位 `unknown`，不能用于正式版本追溯。
直接运行 Docker 构建也不会自动生成元数据，操作者必须先运行上述脚本。
这两条入口的强制生成留待后续任务。本次仅修复 production / staging 构建入口。

- `package.json` 已为 `0.10.0`，但 `package-lock.json` 的 `version` 与
  `packages[""].version` 仍为 `0.9.0`。Hermes 已实测该组合下 `npm ci --omit=dev`
  exit 0（`added 8 packages, 0 vulnerabilities`），Docker 构建也通过，故不是阻断项。
  本卡不改 lock 文件；后续独立任务统一两个版本字段，重跑 npm ci 与 Docker 构建。
- `docs/stage1-macdeploy.md` 第 3 行仍称 `production-deploy.yml` v0.8、第 72 行仍写
  “v0.8 部署编排”。本卡不改该文件；后续同步为本版本规则引用，不得当作有效版本号。
- `production-deploy.yml` 的 `WITOP_AI_MODEL` 默认仍为 `claude-opus-5-5`，
  `WITOP_AI_BASE_URL` 默认仍为 `https://api.anthropic.com`。据 Hermes 本次复核，生产
  实际值由 `production` environment vars 覆盖为 DeepSeek 兼容端点 + `deepseek-chat`，
  更改默认值不影响当前生产，但默认值与“上游可配置”口径不符；后续任务统一默认值与说明。

本地检查不代表真实生产或公网验收通过；tag、Release、生产部署均需后续授权。
