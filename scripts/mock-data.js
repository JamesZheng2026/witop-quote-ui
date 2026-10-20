// V3-01 Reception Workbench mock data (mirror of MOCK_RECEPTION in index.html).
// qcStatus: 质检状态，独立于 receptionStatus
//   pending   — 待质检
//   in_review — 质检中
//   passed    — 质检通过
//   failed    — 质检未通过
// Duplicated here so the verify script can read it independently of the page bundle.
// Per V3-01 spec: data is fully local and never loaded over the network; safe to keep
// the page in sync by maintaining these two representations together.

const MOCK_RECEPTION_DATA = [
  // ---- 接待中 (5) ----
  {
    id: 'REC-001', company: 'Atlas Bay Holdings', country: 'UAE', channel: 'email',
    receptionStatus: 'reception', qcStatus: 'pending', lastContactAt: '2026-10-11 09:42',
    qty: '3,200 sqm', usage: 'Commercial tower lobby', cycle: '60 days',
    customization: 'Custom walnut color + matching trim', overseasMode: 'Importer / wholesaler',
    summary: '买家倾向 8mm 共挤板，需要 60 天内交付，目的港 Jebel Ali。已确认数量与用途，等待报价。'
  },
  {
    id: 'REC-002', company: 'Northwind Interiors', country: 'UK', channel: 'mixed',
    receptionStatus: 'reception', qcStatus: 'pending', lastContactAt: '2026-10-11 11:18',
    qty: '1,500 sqm', usage: 'Hotel guest-room renovation', cycle: '45 days',
    customization: '—', overseasMode: '—',
    summary: '酒店翻新项目，预算偏紧；待收集定制需求与海外经营模式。'
  },
  {
    id: 'REC-003', company: 'Greenline Trading FZE', country: 'UAE', channel: 'whatsapp',
    receptionStatus: 'reception', qcStatus: 'pending', lastContactAt: '2026-10-11 12:05',
    qty: '待收集', usage: '—', cycle: '—', customization: '—', overseasMode: '—',
    summary: 'WhatsApp 来询，缺基础字段。建议下一步：礼貌回访补全采购数量与用途。'
  },
  {
    id: 'REC-004', company: 'Riyadh Stone & Decor', country: 'Saudi Arabia', channel: 'email',
    receptionStatus: 'reception', qcStatus: 'pending', lastContactAt: '2026-10-10 16:30',
    qty: '500 sqm', usage: '—', cycle: '—', customization: '—', overseasMode: '—',
    summary: '首次来询；用途/周期未确认。'
  },
  {
    id: 'REC-005', company: 'Cairo Decorative Panels', country: 'Egypt', channel: 'mixed',
    receptionStatus: 'reception', qcStatus: 'pending', lastContactAt: '2026-10-10 14:11',
    qty: '4,200 sqm', usage: 'Government project · payment via LC', cycle: '90 days',
    customization: 'SGS inspection required', overseasMode: 'Government procurement',
    summary: '历史老客户；本周复访谈细节。'
  },
  // ---- 转人工 (3) ----
  {
    id: 'REC-006', company: 'Hanoi Construction Materials', country: 'Vietnam', channel: 'whatsapp',
    receptionStatus: 'handoff', qcStatus: 'in_review', lastContactAt: '2026-10-11 10:55',
    qty: '300 sqm', usage: 'Sample order · interior design showcase', cycle: '21 days',
    customization: 'Matte black + custom edging', overseasMode: '—',
    summary: '客诉倾向高（议价 + 期望快速样品），AI 已触发转人工。'
  },
  {
    id: 'REC-007', company: 'Pacific Coast Flooring', country: 'USA', channel: 'email',
    receptionStatus: 'handoff', qcStatus: 'in_review', lastContactAt: '2026-10-11 08:20',
    qty: '3,200 sqm', usage: 'Residential SPC project', cycle: '45 days',
    customization: 'Click system, Grey Oak', overseasMode: 'Distributor',
    summary: '美国分销商；要求 SGS + 样品，AI 转人工等销售评估区域风险。'
  },
  {
    id: 'REC-008', company: 'Lagos Premium Interiors', country: 'Nigeria', channel: 'mixed',
    receptionStatus: 'handoff', qcStatus: 'in_review', lastContactAt: '2026-10-10 22:48',
    qty: '400 sqm', usage: 'Hotel lobby decoration', cycle: '—',
    customization: '—', overseasMode: '—',
    summary: '缺关键字段（周期 / 海外经营模式），AI 转人工等销售直接对接。'
  },
  // ---- 交付人工 / 质检中 (3) ----
  {
    id: 'REC-009', company: 'Kingfisher Supplies Ltd', country: 'UK', channel: 'email',
    receptionStatus: 'handled', qcStatus: 'passed', lastContactAt: '2026-10-11 07:05',
    qty: '1,800 sqm', usage: 'Hotel fit-out', cycle: '21 days',
    customization: '12mm High Gloss White', overseasMode: 'UK retailer',
    summary: '质检通过：销售已发出 21 天加急方案，等待客户回复。',
  },
  {
    id: 'REC-010', company: 'Manila Hardware Corp', country: 'Philippines', channel: 'whatsapp',
    receptionStatus: 'handled', qcStatus: 'passed', lastContactAt: '2026-10-10 18:33',
    qty: '2,000 sqm', usage: 'Residential complex', cycle: '30 days',
    customization: 'UV Coating Natural Oak', overseasMode: 'Reseller',
    summary: '质检通过：已转销售并完成规格确认，等待 PI 出具。'
  },
  {
    id: 'REC-011', company: 'Bavaria Baustoffe GmbH', country: 'Germany', channel: 'email',
    receptionStatus: 'handled', qcStatus: 'passed', lastContactAt: '2026-10-10 11:14',
    qty: '8,000 sqm', usage: 'Apartment complex', cycle: '75 days',
    customization: 'CE-marked SPC, Click system', overseasMode: 'EU distributor',
    summary: '质检通过：大单 — 销售已分段排产 + CE 文档准备中。'
  },
  // ---- 质检未通过 (3) ----
  {
    id: 'REC-012', company: 'Spam Sender — Invest.co', country: 'unknown', channel: 'email',
    receptionStatus: 'blocked', qcStatus: 'failed', lastContactAt: '2026-10-11 06:12',
    qty: '—', usage: '—', cycle: '—', customization: '—', overseasMode: '—',
    summary: '质检未通过：邮件来源被标记为批量推广模板。'
  },
  {
    id: 'REC-013', company: 'Coin-Bot / Trade Crypto Signals', country: 'unknown', channel: 'whatsapp',
    receptionStatus: 'blocked', qcStatus: 'failed', lastContactAt: '2026-10-11 03:50',
    qty: '—', usage: '—', cycle: '—', customization: '—', overseasMode: '—',
    summary: '质检未通过：来自非白名单号段，含加密/资金类话术。'
  },
  {
    id: 'REC-014', company: 'Generic Africa Importer', country: 'Egypt', channel: 'email',
    receptionStatus: 'blocked', qcStatus: 'failed', lastContactAt: '2026-10-10 17:00',
    qty: '—', usage: '—', cycle: '—', customization: '—', overseasMode: '—',
    summary: '质检未通过：买家背景检查未通过（公司域名注册 < 90 天）。'
  }
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MOCK_RECEPTION_DATA };
}
