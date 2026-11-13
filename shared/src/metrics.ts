/**
 * 指标层：全站唯一的指标桶与派生指标实现（迁移自原型 derive/deriveG/cell7/g6/zero/addM）。
 * 铁律：任何视图/图表/导出禁止内联比率公式，一律引用本文件。
 */

import type { GoogleCell, GoogleCtyCell, MetaCell, MetaDay, SiteKey } from './contract';

/** 基础指标桶（聚合中间态；原型 zero()） */
export interface Metrics {
  spend: number;
  impressions: number;
  clicks: number;
  orders: number;
  /** 转化价值 GMV（Meta 桶=value；Google 桶=vs） */
  value: number;
  atc: number;
  ckt: number;
  /** Google·Shopify 口径 GMV（Google 专属，Meta 恒 0） */
  vs: number;
  /** Google·Ads 后台口径 GMV（Google 专属，Meta 恒 0） */
  va: number;
  /** CVR 分母：Meta 桶=全部点击（可选挂载）；Google 国家桶=unified_interactions */
  inter: number;
  /** 行级占比（可选挂载；账号定位表。总计=Σ占比（同表分母一致时=100%）） */
  spendPct?: number;
  ordersPct?: number;
  valuePct?: number;
}

export function zero(): Metrics {
  return {
    spend: 0,
    impressions: 0,
    clicks: 0,
    orders: 0,
    value: 0,
    atc: 0,
    ckt: 0,
    vs: 0,
    va: 0,
    inter: 0,
  };
}

/** 原地累加（原型 addM；占比字段守卫透传：任一侧挂载才引入，避免 0 值污染） */
export function addMetrics(a: Metrics, b: Metrics): Metrics {
  a.spend += b.spend;
  a.impressions += b.impressions;
  a.clicks += b.clicks;
  a.orders += b.orders;
  a.value += b.value;
  a.atc += b.atc;
  a.ckt += b.ckt;
  a.vs += b.vs || 0;
  a.va += b.va || 0;
  a.inter += b.inter || 0;
  if (b.spendPct != null || a.spendPct != null) a.spendPct = (a.spendPct || 0) + (b.spendPct || 0);
  if (b.ordersPct != null || a.ordersPct != null) a.ordersPct = (a.ordersPct || 0) + (b.ordersPct || 0);
  if (b.valuePct != null || a.valuePct != null) a.valuePct = (a.valuePct || 0) + (b.valuePct || 0);
  return a;
}

/** 求和并派生（总计口径：Σ求和 + 比率=Σ分子/Σ分母，对齐观远） */
export function sumMetrics(list: Metrics[]): Metrics {
  const t = zero();
  for (const m of list) addMetrics(t, m);
  return t;
}

/** Meta cell（7/8 元）→ Metrics（原型 cell7 内字段映射部分） */
export function metaCellToMetrics(cell: MetaCell): Metrics {
  const m = zero();
  m.spend = cell[0];
  m.impressions = cell[1];
  m.clicks = cell[2];
  m.orders = cell[3];
  m.value = cell[4];
  m.atc = cell[5];
  m.ckt = cell[6];
  if (cell.length > 7) m.inter = cell[7];
  return m;
}

/** Google cell（6 元 / 国家 7 元）→ Metrics（原型 g6；inter=unified_interactions，0 值天保留 0） */
export function googleCellToMetrics(cell: GoogleCell | GoogleCtyCell): Metrics {
  const m = zero();
  m.spend = cell[0];
  m.impressions = cell[1];
  m.clicks = cell[2];
  m.orders = cell[3];
  m.vs = cell[4];
  m.va = cell[5];
  m.value = cell[4];
  m.inter = cell.length > 6 ? cell[6] : cell[2];
  return m;
}

/**
 * Meta 日桶按站点过滤聚合（原型 cell7：忽略 A 键，仅累计选中站点的分站点值）。
 * @param sites 选中站点（显示名小写，如 ['shopify','shoplazza']）；空数组视为不限（全部站点）
 * @returns 无任何命中数据时 null
 */
export function metaDayToMetrics(day: MetaDay | undefined, sites: string[]): Metrics | null {
  if (!day) return null;
  /* 原型 cell7：选中多个站点 → 不过滤（含 unknown）；单站点 → 按选中集合过滤 */
  const all = sites.length > 1;
  const allow: Record<string, 1> | null = all ? null : {};
  if (!all) for (const s of sites) allow![s.toLowerCase()] = 1;

  const sum: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  let any = false;
  let len = 7;
  for (const k of Object.keys(day)) {
    if (k === 'A') continue;
    if (allow && !allow[k]) continue;
    const v = day[k as SiteKey];
    if (!v) continue;
    any = true;
    if (v.length > len) len = v.length;
    for (let i = 0; i < v.length; i++) sum[i] += v[i];
  }
  if (!any) return null;
  const m = zero();
  m.spend = sum[0];
  m.impressions = sum[1];
  m.clicks = sum[2];
  m.orders = sum[3];
  m.value = sum[4];
  m.atc = sum[5];
  m.ckt = sum[6];
  if (len > 7) m.inter = sum[7]; // Meta SPU 8 元桶：全部点击（CVR 分母口径）
  return m;
}

/** 标准派生指标（Meta；原型 derive）。分母为 0 → NaN（展示层渲染 '—'） */
export interface DerivedMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  orders: number;
  value: number;
  cpm: number;
  cpc: number;
  ctr: number;
  cvr: number;
  cpa_atc: number;
  cpa_ckt: number;
  cpa_ord: number;
  roas: number;
  aov: number;
  spend_pct: number;
  orders_pct: number;
  value_pct: number;
}

export function derive(m: Metrics | null | undefined): DerivedMetrics | null {
  if (!m) return null;
  return {
    spend: m.spend,
    impressions: m.impressions,
    clicks: m.clicks,
    orders: m.orders,
    value: m.value,
    cpm: m.impressions ? (m.spend / m.impressions) * 1000 : NaN,
    cpc: m.clicks ? m.spend / m.clicks : NaN,
    ctr: m.impressions ? m.clicks / m.impressions : NaN,
    cvr: m.inter || m.clicks ? m.orders / (m.inter || m.clicks) : NaN,
    cpa_atc: m.atc ? m.spend / m.atc : NaN,
    cpa_ckt: m.ckt ? m.spend / m.ckt : NaN,
    cpa_ord: m.orders ? m.spend / m.orders : NaN,
    roas: m.spend ? m.value / m.spend : NaN,
    aov: m.orders ? m.value / m.orders : NaN,
    spend_pct: m.spendPct != null ? m.spendPct : NaN,
    orders_pct: m.ordersPct != null ? m.ordersPct : NaN,
    value_pct: m.valuePct != null ? m.valuePct : NaN,
  };
}

/** Google 双口径派生指标（原型 deriveG：roas_s=vs/spend, roas_a=va/spend） */
export interface DerivedGMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  orders: number;
  vs: number;
  va: number;
  inter: number;
  ctr: number;
  cpc: number;
  cpm: number;
  cvr: number;
  cpa_ord: number;
  roas_s: number;
  roas_a: number;
  aov: number;
  spend_pct: number;
  orders_pct: number;
  value_pct: number;
}

export function deriveG(m: Metrics | null | undefined): DerivedGMetrics | null {
  if (!m) return null;
  return {
    spend: m.spend,
    impressions: m.impressions,
    clicks: m.clicks,
    orders: m.orders,
    vs: m.vs,
    va: m.va,
    inter: m.inter || m.clicks,
    ctr: m.impressions ? m.clicks / m.impressions : NaN,
    cpc: m.clicks ? m.spend / m.clicks : NaN,
    cpm: m.impressions ? (m.spend / m.impressions) * 1000 : NaN,
    cvr: m.inter || m.clicks ? m.orders / (m.inter || m.clicks) : NaN,
    cpa_ord: m.orders ? m.spend / m.orders : NaN,
    roas_s: m.spend ? m.vs / m.spend : NaN,
    roas_a: m.spend ? m.va / m.spend : NaN,
    aov: m.orders ? m.vs / m.orders : NaN,
    spend_pct: m.spendPct != null ? m.spendPct : NaN,
    orders_pct: m.ordersPct != null ? m.ordersPct : NaN,
    value_pct: m.valuePct != null ? m.valuePct : NaN,
  };
}

/** 按表格模式派生（原型 deriveRow：t.mode==='g' ? deriveG : derive） */
export function deriveRow(mode: 'std' | 'g', m: Metrics | null | undefined) {
  return mode === 'g' ? deriveG(m) : derive(m);
}

/** 环比波动底色高亮：钱效率组（cvr/roas/aov 含 roas_s/roas_a）>5%；Meta 流量效率组（cpm/cpc/ctr）>10%（2026-11-06 定版） */
export const HL_CMP: Record<string, 1> = {
  cvr: 1,
  roas: 1,
  aov: 1,
  roas_s: 1,
  roas_a: 1,
  cpc: 1,
  cpm: 1,
  ctr: 1,
};
export const HL_TH: Record<string, number> = { cpc: 10, cpm: 10, ctr: 10 };

/** 环比波动是否高亮（阈值单位：百分比） */
export function cmpHL(cur: number | null | undefined, prev: number | null | undefined, th = 5): boolean {
  if (prev == null || isNaN(prev as number) || !prev) return false;
  if (cur == null || isNaN(cur as number)) return false;
  return Math.abs(((cur - prev) / prev) * 100) > th;
}
