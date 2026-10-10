# Witop AI Quote UI

Witop Decor 客户经营平台 — AI 询盘报价处理模块

## 功能模块

- [x] Dashboard：统计看板 + 漏斗图 + 快速筛选
- [x] Inquiry List：可排序/筛选的询盘列表
- [x] AI Quote Processing：买家背景 + 产品规格 + AI 报价明细 + 批准/拒绝/编辑
- [x] AI Quote Settings：margin% / 材料单价 / 人工费 / 物流 / AI 模型配置
- [x] Quality Report：质检统计 + 审批通过/拒绝分析
- [x] Export/Print：打印格式报价单

## 技术栈

- 单文件 HTML + Vanilla JS + CSS
- localStorage 持久化（数据接入前）
- `// TODO:` 标注数据接入和 AI 报价接入位置

## 数据接入

数据库就绪后，配置以下接口：

```
GET  /api/inquiries          询盘列表
GET  /api/inquiries/:id     询盘详情
POST /api/quotes             创建报价
PUT  /api/quotes/:id         更新报价状态
GET  /api/quality-report     质检报告
```

## 运行方式

直接在浏览器打开 `index.html`
