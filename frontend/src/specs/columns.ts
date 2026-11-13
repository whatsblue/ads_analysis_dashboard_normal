/**
 * 列定义与口径提示（全站唯一，13 视图共用；迁移自原型 METRIC_GROUPS、COL 系列、G 系列、TH_TIP、PCT_COLS）。
 * 铁律：视图禁止内联列定义，一律引用本文件；比率值一律来自 shared/metrics 派生结果。
 */
import { fmtInt, fmtMoney, fmtPct, fmtRoas } from '@ads/shared';

export interface ColDef {
  k: string;
  name: string;
  fmt: (v: number | null | undefined) => string;
}

/** 表头分组：[组名, 底色类, 指标键列表] */
export type GroupMap = [string, string, string[]][];

export const COL_NAME: Record<string, string> = {
  spend: '花费',
  impressions: '展示',
  clicks: '点击',
  orders: '订单',
  value: '转化价值',
  cpm: 'CPM',
  cpc: 'CPC',
  ctr: 'CTR',
  cvr: 'CVR',
  cpa_atc: '单次加购',
  cpa_ckt: '单次结帐',
  cpa_ord: '单次购买',
  roas: 'ROAS',
  aov: '客单价',
  spend_pct: '花费占比',
  orders_pct: '订单占比',
  value_pct: '转化价值占比',
};

export const COL_FMT: Record<string, (v: number | null | undefined) => string> = {
  spend: fmtMoney,
  impressions: fmtInt,
  clicks: fmtInt,
  orders: fmtInt,
  value: fmtMoney,
  cpm: fmtMoney,
  cpc: fmtMoney,
  ctr: fmtPct,
  cvr: fmtPct,
  cpa_atc: fmtMoney,
  cpa_ckt: fmtMoney,
  cpa_ord: fmtMoney,
  roas: fmtRoas,
  aov: fmtMoney,
  spend_pct: fmtPct,
  orders_pct: fmtPct,
  value_pct: fmtPct,
};

function col(k: string): ColDef {
  return { k, name: COL_NAME[k], fmt: COL_FMT[k] };
}

/** Meta 标准四组（原型 METRIC_GROUPS） */
export const METRIC_GROUPS: GroupMap = [
  ['投放规模', 'g0', ['spend', 'impressions', 'clicks', 'orders', 'value']],
  ['流量效率', 'g1', ['cpm', 'cpc', 'ctr']],
  ['转化效果', 'g2', ['cvr', 'cpa_atc', 'cpa_ckt', 'cpa_ord']],
  ['投产回报', 'g3', ['roas', 'aov']],
];

export const STD_COLS: ColDef[] = METRIC_GROUPS.flatMap((g) => g[2].map(col));

/** 占比三列（drawTable 通用挂载：分母=所在表总计，总计行 Σ=100%） */
export const PCT_COLS = {
  spend_pct: { k: 'spend_pct', name: '花费占比', fmt: fmtPct },
  orders_pct: { k: 'orders_pct', name: '订单占比', fmt: fmtPct },
  value_pct: { k: 'value_pct', name: '转化价值占比', fmt: fmtPct },
} as const satisfies Record<string, ColDef>;

/** 默认勾选「显示占比」的表（其余默认关闭） */
export const PCT_DEF: Record<string, 1> = { m2a: 1, m5: 1, m5b: 1 };

/** 在锚点列后插入一列 */
function insertAfter(base: ColDef[], anchor: string, extra: ColDef): ColDef[] {
  const out: ColDef[] = [];
  for (const c of base) {
    out.push(c);
    if (c.k === anchor) out.push(extra);
  }
  return out;
}

/** m2a 账号排行：花费/订单/转化价值 后各插占比列（分母=Meta 全部账号合计） */
export const M2A_COLS: ColDef[] = insertAfter(
  insertAfter(insertAfter(STD_COLS, 'spend', PCT_COLS.spend_pct), 'orders', PCT_COLS.orders_pct),
  'value',
  PCT_COLS.value_pct,
);
export const M2A_GMAP: GroupMap = [
  ['投放规模', 'g0', ['spend', 'spend_pct', 'impressions', 'clicks', 'orders', 'orders_pct', 'value', 'value_pct']],
  ['流量效率', 'g1', ['cpm', 'cpc', 'ctr']],
  ['转化效果', 'g2', ['cvr', 'cpa_atc', 'cpa_ckt', 'cpa_ord']],
  ['投产回报', 'g3', ['roas', 'aov']],
];

/** m5/m5b 国家维度：花费后插花费占比（g0 无 orders_pct/value_pct，对齐原型） */
export const M5B_COLS: ColDef[] = insertAfter(STD_COLS, 'spend', PCT_COLS.spend_pct);
export const M5B_GMAP: GroupMap = [
  ['投放规模', 'g0', ['spend', 'spend_pct', 'impressions', 'clicks', 'orders', 'value']],
  ['流量效率', 'g1', ['cpm', 'cpc', 'ctr']],
  ['转化效果', 'g2', ['cvr', 'cpa_atc', 'cpa_ckt', 'cpa_ord']],
  ['投产回报', 'g3', ['roas', 'aov']],
];

/* ================= Google 列组（双口径 vs=Shopify 归因 / va=Ads 后台） ================= */

/** Google 通用 10 列（大盘/渠道对比） */
export const G_COLS: ColDef[] = [
  { k: 'spend', name: '花费', fmt: fmtMoney },
  { k: 'impressions', name: '展示', fmt: fmtInt },
  { k: 'clicks', name: '点击', fmt: fmtInt },
  { k: 'orders', name: '订单(Shopify)', fmt: fmtInt },
  { k: 'vs', name: '转化价值(Shopify)', fmt: fmtMoney },
  { k: 'va', name: '转化价值(Google)', fmt: fmtMoney },
  { k: 'cpc', name: 'CPC', fmt: fmtMoney },
  { k: 'ctr', name: 'CTR', fmt: fmtPct },
  { k: 'roas_s', name: 'ROAS(Shopify)', fmt: fmtRoas },
  { k: 'roas_a', name: 'ROAS(Google)', fmt: fmtRoas },
];

/** Google SPU 排行 11 列：订单/转化价值取平台口径（g6 桶位 value=vs，派生用 std derive） */
export const G_SPU_COLS: ColDef[] = [
  { k: 'spend', name: '花费', fmt: fmtMoney },
  { k: 'clicks', name: '点击', fmt: fmtInt },
  { k: 'orders', name: '订单', fmt: fmtInt },
  { k: 'value', name: '转化价值', fmt: fmtMoney },
  { k: 'cpm', name: 'CPM', fmt: fmtMoney },
  { k: 'cpc', name: 'CPC', fmt: fmtMoney },
  { k: 'ctr', name: 'CTR', fmt: fmtPct },
  { k: 'cvr', name: 'CVR', fmt: fmtPct },
  { k: 'cpa_ord', name: '单次购买', fmt: fmtMoney },
  { k: 'roas', name: 'ROAS', fmt: fmtRoas },
  { k: 'aov', name: '客单价', fmt: fmtMoney },
];

/** Google 账号/年龄/Campaign 12 列（Shopify 单口径；G_CMP_COLS/G_AGE_COLS 为其列名变体） */
export const G_ACC_COLS: ColDef[] = [
  { k: 'spend', name: '花费', fmt: fmtMoney },
  { k: 'impressions', name: '展示', fmt: fmtInt },
  { k: 'clicks', name: '点击', fmt: fmtInt },
  { k: 'orders', name: '订单(Shopify)', fmt: fmtInt },
  { k: 'vs', name: '转化价值(Shopify)', fmt: fmtMoney },
  { k: 'cpm', name: 'CPM', fmt: fmtMoney },
  { k: 'cpc', name: 'CPC', fmt: fmtMoney },
  { k: 'ctr', name: 'CTR', fmt: fmtPct },
  { k: 'cvr', name: 'CVR', fmt: fmtPct },
  { k: 'cpa_ord', name: '单次购买', fmt: fmtMoney },
  { k: 'roas_s', name: 'ROAS(Shopify)', fmt: fmtRoas },
  { k: 'aov', name: '客单价', fmt: fmtMoney },
];

/** Campaign 明细：ROAS(Shopify) → ROAS */
export const G_CMP_COLS: ColDef[] = G_ACC_COLS.map((c) =>
  c.k === 'roas_s' ? { k: 'roas_s', name: 'ROAS', fmt: fmtRoas } : c,
);

/** 年龄段明细：订单/转化价值/ROAS 不带 Shopify 后缀（对齐观远年龄维度） */
export const G_AGE_COLS: ColDef[] = G_ACC_COLS.map((c) => {
  if (c.k === 'orders') return { k: 'orders', name: '订单', fmt: fmtInt };
  if (c.k === 'vs') return { k: 'vs', name: '转化价值', fmt: fmtMoney };
  if (c.k === 'roas_s') return { k: 'roas_s', name: 'ROAS', fmt: fmtRoas };
  return c;
});

/** 广告类型明细 13 列（双口径） */
export const G_DUAL_COLS: ColDef[] = [
  { k: 'spend', name: '花费', fmt: fmtMoney },
  { k: 'impressions', name: '展示', fmt: fmtInt },
  { k: 'clicks', name: '点击', fmt: fmtInt },
  { k: 'orders', name: '订单', fmt: fmtInt },
  { k: 'vs', name: '转化价值(Shopify)', fmt: fmtMoney },
  { k: 'va', name: '转化价值(Google)', fmt: fmtMoney },
  { k: 'cpm', name: 'CPM', fmt: fmtMoney },
  { k: 'cpc', name: 'CPC', fmt: fmtMoney },
  { k: 'ctr', name: 'CTR', fmt: fmtPct },
  { k: 'cvr', name: 'CVR', fmt: fmtPct },
  { k: 'cpa_ord', name: '单次购买', fmt: fmtMoney },
  { k: 'roas_s', name: 'ROAS(Shopify)', fmt: fmtRoas },
  { k: 'roas_a', name: 'ROAS(Google)', fmt: fmtRoas },
];

/** Google 表头三组（订单/双口径转化价值归投放规模；CVR/单次购买归流量效率；双 ROAS/客单价归投产回报） */
export const G_GROUP_DEF: GroupMap = [
  ['投放规模', 'g0', ['spend', 'impressions', 'clicks', 'orders', 'value', 'vs', 'va']],
  ['流量效率', 'g1', ['cpm', 'cpc', 'ctr', 'cvr', 'cpa_ord']],
  ['投产回报', 'g3', ['roas_s', 'roas_a', 'roas', 'aov']],
];

/** 表头口径提示（悬浮显示；std=Meta 文案，g=Google 文案，互不出现对方渠道内容） */
export const TH_TIP: Record<string, { std: string; g: string }> = {
  spend: { std: '已花费金额(USD)：Meta Ads 后台', g: '已花费金额(USD)：Google Ads 后台' },
  impressions: { std: '展示次数（Meta 广告后台）', g: '展示次数（Google Ads 后台）' },
  clicks: { std: '点击量：Meta＝全部点击（Meta 广告后台）', g: '点击量（Google Ads 点击）' },
  orders: { std: '订单：Meta 广告后台购物次数（7天点击+1天浏览）', g: '订单：Shopify 后台订单（Google 归因）' },
  value: { std: '转化价值：Meta 广告后台', g: '转化价值：Shopify 归因收入' },
  cpm: { std: 'CPM＝花费÷展示×1000', g: 'CPM＝花费÷展示×1000' },
  cpc: { std: 'CPC＝花费÷点击量', g: 'CPC＝花费÷点击量' },
  ctr: { std: 'CTR＝点击量÷展示量', g: 'CTR＝点击量÷展示量' },
  cvr: { std: 'CVR＝订单÷全部点击（Meta 口径）', g: 'CVR＝Shopify 订单÷点击' },
  cpa_atc: { std: '单次加购＝花费÷加购人数', g: '单次加购＝花费÷加购人数（Google 无此口径，显示为空）' },
  cpa_ckt: { std: '单次结账＝花费÷发起结账人数', g: '单次结账＝花费÷发起结账人数（Google 无此口径，显示为空）' },
  cpa_ord: { std: '单次购买＝花费÷购物次数', g: '单次购买＝花费÷购买次数' },
  roas: { std: 'ROAS＝转化价值÷花费（Meta 广告后台口径）', g: 'ROAS＝Shopify 归因收入÷花费' },
  aov: { std: '客单价＝转化价值÷订单', g: '客单价＝转化价值÷订单' },
  vs: { std: '', g: '转化价值(Shopify)：attribution 归因，考核口径' },
  va: { std: '', g: '转化价值(Google)：Ads 后台平台回传，投放优化用' },
  roas_s: { std: '', g: 'ROAS＝Shopify 归因收入÷花费（考核口径）' },
  roas_a: { std: '', g: 'ROAS＝Ads 后台转化价值÷花费（投放参考）' },
};

/** Meta 国家维度趋势对比指标（12 项单选，原型 CTY_TREND_METRICS） */
export const CTY_TREND_METRICS: { k: string; name: string; fmt: (v: number | null | undefined) => string }[] = [
  { k: 'spend', name: '花费', fmt: fmtMoney },
  { k: 'orders', name: '订单', fmt: fmtInt },
  { k: 'value', name: '转化价值', fmt: fmtMoney },
  { k: 'cpm', name: 'CPM', fmt: fmtMoney },
  { k: 'cpc', name: 'CPC', fmt: fmtMoney },
  { k: 'ctr', name: 'CTR', fmt: fmtPct },
  { k: 'cvr', name: 'CVR', fmt: fmtPct },
  { k: 'cpa_atc', name: '单次加购', fmt: fmtMoney },
  { k: 'cpa_ckt', name: '单次结帐', fmt: fmtMoney },
  { k: 'cpa_ord', name: '单次购买', fmt: fmtMoney },
  { k: 'roas', name: 'ROAS', fmt: fmtRoas },
  { k: 'aov', name: '客单价', fmt: fmtMoney },
];

/** m4 素材子分类定义（真实数据源=creative.sub/sub2 分桶；order=固定展示序） */
export interface SubDef {
  key: 'kol' | 'xsp' | 'xph';
  name: string;
  t1: string;
  /** sub 桶的类型名（数据文件键） */
  typeName: string;
  order: string[];
  alt: { title: string; order: string[] };
}

export const SUB_DEFS: SubDef[] = [
  {
    key: 'kol',
    name: '红人素材',
    t1: '红人素材分类明细',
    typeName: '红人素材',
    order: ['图片', '视频', '其他'],
    alt: { title: '红人付费分类明细', order: ['付费红人', '非付费红人'] },
  },
  {
    key: 'xsp',
    name: '视频广告',
    t1: '视频是否AI分类明细',
    typeName: '视频广告',
    order: ['AI', '非AI'],
    alt: { title: '视频素材新旧分类明细', order: ['新素材', '复刻素材'] },
  },
  {
    key: 'xph',
    name: '图片广告',
    t1: '广告图是否AI分类明细',
    typeName: '图片广告',
    order: ['AI', '非AI'],
    alt: { title: '广告图素材新旧分类明细', order: ['新素材', '复刻素材', '其他'] },
  },
];

/** Google 广告类型显示名（桶键为小写英文，原型 G_TYPE_NAME） */
export const G_TYPE_NAME: Record<string, string> = {
  search: 'Search',
  shopping: 'Shopping',
  pmax: 'PMax',
  demandgen: 'Demand Gen',
  display: 'Display',
  video: 'Video',
};

export function gTypeName(k: string): string {
  return G_TYPE_NAME[k] || k;
}

/** 素材编号提取（复刻观远）：广告名内规范素材编码 XSP\d+/XPH\d+（大小写不敏感） */
export function adCodeOf(nm: string): string {
  const m = /(?:XSP|XPH)\d{3,}/i.exec(nm || '');
  return m ? m[0].toUpperCase() : '';
}
