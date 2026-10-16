# SQL Server 外部证据与字段契约

来源：任务 t_c67d2504 评论 #431（Hermes），实测时间 2026-10-16 19:29；原始证据 `/tmp/sqlserver_real_evidence.txt`。
这是 Hermes 主进程的独立查询结果，不是本轮 Codex 对桥或 HTTP 端点的实测结果。
评论记录：连接 1.20s，总耗时 2.41s，pymssql 2.4.4，Microsoft SQL Server 2012，消息总数 620,412。
评论还提供了五行脱敏样本；本报告仅保留 schema，不复制客户消息或标识。

原文件和评论中可见 schema 实际为以下 **16 列**；“21 字段”的文字与可见列表不一致，不能据此声明额外字段已验证。

```text
[OK] wa_chat_message schema:
     id                        int                     NOT NULL
     source_id                 int                     NOT NULL
     session_id                int                     NOT NULL
     msg_unique_id             nvarchar       (200)    NOT NULL
     sender_type               tinyint                 NOT NULL
     sender_phone              nvarchar       (50)     NOT NULL
     msg_type                  tinyint                 NOT NULL
     msg_content               nvarchar                NOT NULL
     quote_msg_id              nvarchar       (200)    NOT NULL
     send_time                 nvarchar       (50)     NOT NULL
     read_status               tinyint                 NOT NULL
     send_status               tinyint                 NOT NULL
     inquiry_keyword           nvarchar       (500)    NOT NULL
     robot_reply               tinyint                 NOT NULL
     create_at                 nvarchar       (50)     NOT NULL
     agent                     nvarchar       (50)     NOT NULL
```

桥固定读取 session_id、agent、msg_content、send_time、create_at、id。
send_time/create_at 按字符串保留；空 send_time 回退 create_at，不转为 datetime。
无已验证服务完成字段，保持未知。

剩余验证：在审核环境运行本工作区桥的诊断与脱敏五条记录查询，再启动服务核验真实 `/api/receptions` 和浏览器布局。
