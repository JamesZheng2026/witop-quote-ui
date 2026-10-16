# 接待工作台 v4

本地入口已实现，字段契约以 Hermes 于 2026-10-16 19:29 的独立 SQL 实测为依据（卡片评论 #431、原始文件 `/tmp/sqlserver_real_evidence.txt`）。该证据证明外部握手和 schema；本实现的端到端 SQL/HTTP 渲染尚待审核环境验证。

## 启动

在此 worktree 根目录执行：

```sh
node scripts/server.js
```

服务仅绑定 `127.0.0.1:8765`，首页默认打开 v4。只读端点为 `/api/receptions`。
浏览器不读取 SQL 凭证，也不调用小满 API。普通静态服务器不提供此端点，页面会显示连接错误。

桥优先使用 `~/.hermes/hermes-agent/venv/bin/python`，不存在时使用 `python3`。
运行环境需已具备 pymssql。可用 `SQLSERVER_PYTHON` 指定已有解释器。
配置默认读取 `~/.hermes/scripts/sqlserver_config.json`，可用 `SQLSERVER_CONFIG` 指定外部配置路径。
配置字段沿用既有脚本的 `server/port/user/password/database/tds_version`。
请勿把配置复制进仓库或浏览器资源。

## 查询与字段

每次请求读取 `INFORMATION_SCHEMA.COLUMNS`，只接受唯一 schema 中的 `wa_chat_message`。
列名仅从发现的 schema 中选择并转义；HTTP 不接受 SQL 或列名。
按“归属人 + 会话标识”分组，取每组最近一条消息及消息条数，默认返回最近 50 个会话和全表会话数。
消息正文最多 4,000 字符；会话标识与归属人不截断。并发请求共享一次查询。

固定映射来自上述真实 schema，运行时校验列名和类型，不再猜测候选字段：

| 用途 | 列 | 类型 |
| --- | --- | --- |
| 会话 | session_id | int |
| 消息时间 | send_time | nvarchar(50) |
| 空消息时间回退 | create_at | nvarchar(50) |
| 归属人 | agent | nvarchar(50) |
| 正文 | msg_content | nvarchar |
| 同时间排序 | id | int |

时间值原样作为字符串返回，不转 datetime、不推断时区；空 `send_time` 使用 `create_at`。
按已提供的固定宽度 `YYYY-MM-DD HH:mm:ss` 字符串倒序，同时间按 `id` 倒序。
契约不匹配返回 `SQL_MAPPING_REQUIRED`，不生成示例数据。
界面显示“会话 <session_id>”，不把会话编号当作客户姓名或手机号。
同一 session 在不同 agent 下分别显示；该分组含义和全表窗口查询性能仍需业务审核与实际联调确认。
完整脱敏 schema 及证据归属见 `reports/v4-sql-schema.md`。

只读诊断与五条记录的脱敏核验命令：

```sh
node scripts/sqlserver-bridge.js --diagnostics
node scripts/sqlserver-bridge.js
```

前者输出握手、schema、总消息数；后者仅输出五条记录的哈希 ID、消息数与字段存在性，不输出联系人、归属人或正文。
HTTP 接口需要向本机页面提供真实会话内容，诊断端点不通过 HTTP 暴露。

## 页面行为与边界

- 56px 深蓝侧栏，6 个导航项与 1 个添加按钮；键盘可操作。
- 四段为“输入配置 → 接待分配 → 服务完成 → 信息记录”。点击分配段筛选已有关联归属人的会话。
- 配置段表示读取成功的数据源数量；信息记录段表示已载入会话数；分配统计仅基于本次载入的最近 50 个会话。
- 卡片提供会话编号、归属人、WhatsApp 来源、时间、消息数与最近消息，可搜索、筛选、排序和查看消息。
- 未确认消息表提供服务完成状态，因此完成数为 `—`；没有把归属人推断为“人工接手”或“服务完成”，也没有生成 AI 概要。
- 添加按钮展示只读入口说明。新增会话仍来自原消息源；没有数据库写入或分配变更功能。
- 读取失败会清空旧卡片及详情，显示固定错误文案，允许重试；没有 mock 回退。
- 旧演示与本地状态机保留在标注“演示”的导航入口，和 v4 数据互相独立。

## 本地验证

使用已有 jsdom 安装，不在验证时自动下载依赖：

```sh
NODE_PATH=/Users/james/witop-quote-ui/reports/node_modules bash scripts/verify-b-only.sh
NODE_PATH=/Users/james/witop-quote-ui/reports/node_modules node reports/test-v4.cjs
node reports/test-v4-sql.cjs
git diff --check
```

新增测试使用注入的 UI/HTTP 数据与 Python 驱动夹具，不连接真实 SQL Server。
HTTP 检查为进程内请求处理测试，不证明端口监听或浏览器访问成功。
交付状态及剩余验收见 `reports/v4-handoff.md`。
