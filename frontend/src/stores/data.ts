/**
 * 数据仓库：manifest/dims 首屏加载 + 月分片按需加载重建内存桶 + 全部聚合查询函数。
 * 语义对齐原型 REAL 覆盖层（cell7/g6/aggDimRange/chDaily/gTotDate/collectTop/subRowsAt 等）：
 * - Meta 维度桶（camp/spu/ctry/age/ctype/sub/ad）不受账号筛选影响（直接遍历桶）
 * - 账号筛选仅作用于：Meta 大盘(m1)/账号(m2a) 与 Google 大盘(gm1)/账号(gm2)
 * - 大盘渠道页签（channel 桶）天然不含账号维度
 * - 站点过滤语义见 shared/metaDayToMetrics（多站=不过滤含 unknown；单站=过滤）
 * v3 月分片：ensureForRange() 按选中区间∪环比区间加载缺失月份，深合并重建全部内存桶；
 * 聚合函数仍是同步读内存桶（API 签名不变，视图零改动）。
 */
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import {
  addMetrics,
  googleCellToMetrics,
  metaDayToMetrics,
  sumMetrics,
  zero,
  type ChannelData,
  type Dims,
  type GoogleBucket,
  type GoogleCmpData,
  type GoogleDimData,
  type GoogleTypeData,
  type Manifest,
  type MetaBucket,
  type MetaCreativeData,
  type MetaDimData,
  type Metrics,
  type MonthSlice,
} from '@ads/shared';
import { dateRange } from '@ads/shared';
import { loadDims, loadManifest, loadSlice } from '@/data';
import { emptyBuckets, mergeSlices, neededMonths } from '@/data/merge';
import { useFilterStore } from './filter';
import { adCodeOf } from '@/specs/columns';

/** Meta 维度路由（原型 DIM_SRC） */
export type MetaDim = 'camp' | 'spu' | 'ctry' | 'age' | 'ctype';

export interface TopGroup {
  key: string;
  label: string;
  name: string;
  type: string;
  code: string;
  items: number[];
  m: Metrics;
}

export interface OvCalc {
  meta: Metrics;
  goog: Metrics;
  edm: Metrics;
  gmv: number;
  siteSpend: number;
}

export const useDataStore = defineStore('data', () => {
  const manifest = ref<Manifest | null>(null);
  const dims = ref<Dims | null>(null);
  const loadError = ref('');
  /** 当前筛选区间（∪环比）所需月分片已就绪；false 时 App 层显示加载遮罩 */
  const rangeReady = ref(true);

  // 已加载月分片（month → slice）与契约文件内存形态（非响应式：查询函数同步读）
  const slices = new Map<string, MonthSlice>();
  let channel: ChannelData | null = null;
  let metaAccB: Record<string, MetaBucket> | null = null;
  let metaCampB: Record<string, MetaBucket> | null = null;
  let metaSpuB: Record<string, MetaBucket> | null = null;
  let metaDimB: MetaDimData | null = null;
  let creativeB: MetaCreativeData | null = null;
  let metaAdB: Record<string, MetaBucket> | null = null;
  let gAccB: Record<string, GoogleBucket> | null = null;
  let gDimB: GoogleDimData | null = null;
  let gSpuB: Record<string, GoogleBucket> | null = null;
  let gTypeB: GoogleTypeData | null = null;
  let gCmpB: GoogleCmpData | null = null;

  const filter = useFilterStore();
  const cache = new Map<string, unknown>();

  function ck(key: string): string {
    return `${key}|v${filter.applied.version}`;
  }
  function memo<T>(key: string, fn: () => T): T {
    const k = ck(key);
    if (cache.has(k)) return cache.get(k) as T;
    if (cache.size > 4000) cache.clear();
    const v = fn();
    cache.set(k, v);
    return v;
  }

  /** 首屏：manifest（契约校验）+ dims + 默认区间月分片，并初始化筛选默认区间 */
  async function init(): Promise<void> {
    if (manifest.value) return;
    const m = await loadManifest();
    const d = await loadDims();
    manifest.value = m;
    dims.value = d;
    const accounts = metaAccounts.value;
    const gAcc = gAccounts.value;
    filter.setAccountUniverse(accounts, gAcc);
    filter.initDefaults(m.range.viewStart, m.range.viewEnd, accounts, gAcc);
    await ensureForRange();
    // 区间/环比变更 → 增量补载缺失月分片；加载期间 rangeReady=false，App 层遮罩
    watch(
      () => filter.applied.version,
      () => {
        void ensureForRange().catch((e) => {
          console.error('[data] 月分片加载失败', e);
          loadError.value = e instanceof Error ? e.message : String(e);
          rangeReady.value = true;
        });
      },
    );
  }

  /** 选中区间 ∪ 环比区间 → 应加载月列表（manifest.months 交集） */
  function needMonths(): string[] {
    const a = filter.applied;
    const ranges = [{ start: a.start, end: a.end }, ...filter.cmpRanges];
    return neededMonths(ranges, manifest.value?.months ?? []);
  }

  /** 补载缺失月分片并重建全部内存桶（增量：已有分片不重复拉取） */
  async function ensureForRange(): Promise<void> {
    const missing = needMonths().filter((m) => !slices.has(m));
    if (!missing.length) {
      rangeReady.value = true;
      return;
    }
    rangeReady.value = false;
    try {
      const loaded = await Promise.all(missing.map(async (m) => [m, await loadSlice(m)] as const));
      for (const [m, sl] of loaded) slices.set(m, sl);
      rebuildBuckets();
      rangeReady.value = true;
    } catch (e) {
      rangeReady.value = true;
      throw e;
    }
  }

  /** 重建式合并：全部内存桶按已加载分片（月升序）深合并重建，语义与 v2 单快照同构 */
  function rebuildBuckets(): void {
    const b = emptyBuckets();
    mergeSlices(b, [...slices.entries()].sort(([x], [y]) => (x < y ? -1 : 1)).map(([, sl]) => sl));
    channel = b.channel;
    metaAccB = b.metaAcc as unknown as Record<string, MetaBucket>;
    metaCampB = b.metaCamp as unknown as Record<string, MetaBucket>;
    metaSpuB = b.metaSpu as unknown as Record<string, MetaBucket>;
    metaDimB = b.metaDim as unknown as MetaDimData;
    creativeB = b.metaCreative as unknown as MetaCreativeData;
    metaAdB = b.metaAd as unknown as Record<string, MetaBucket>;
    gAccB = b.googleAcc as unknown as Record<string, GoogleBucket>;
    gDimB = b.googleDim as unknown as GoogleDimData;
    gSpuB = b.googleSpu as unknown as Record<string, GoogleBucket>;
    gTypeB = b.googleType as unknown as GoogleTypeData;
    gCmpB = b.googleCmp as unknown as GoogleCmpData;
  }

  /** 兼容入口（视图 tab 切换调用；分片模式下全部结构已随区间就绪） */
  async function ensure(..._files: string[]): Promise<void> {
    void _files;
    if (!rangeReady.value) await ensureForRange();
  }

  /* ================= 派生枚举（对齐原型 REAL 枚举替换） ================= */

  /** 只读监控账号不入筛选候选（数仓内花费恒 0） */
  const metaAccounts = computed(() => (dims.value?.metaAccounts ?? []).filter((a) => !a.includes('Read-Only')));
  const gAccounts = computed(() => (dims.value?.gAccounts ?? []).filter((a) => !a.includes('Read-Only')));
  const metaCampaigns = computed(() => dims.value?.metaCampaigns ?? []);
  const gCampaigns = computed(() => dims.value?.gCampaigns ?? []);
  const spus = computed(() => dims.value?.spus ?? []);
  /** SPU→投放账号映射（m3 账号联动；meta_spu 窗口行推导） */
  const spuAccs = computed(() => dims.value?.spuAccs ?? {});
  /** SPU=UNKNOWN（未归属产品聚合行）不入枚举 */
  const gSpus = computed(() => (dims.value?.gSpus ?? []).filter((k) => !/^unknown$/i.test(k)));
  const countries = computed(() => dims.value?.countries ?? []);
  const ages = computed(() => dims.value?.ages ?? []);
  const types = computed(() => dims.value?.types ?? []);
  const combos = computed(() => dims.value?.combos ?? []);
  const adList = computed(() => dims.value?.adList ?? []);
  const adIx = computed(() => {
    const m = new Map<string, number>();
    adList.value.forEach((a, i) => m.set(a[0], i));
    return m;
  });
  /** 美国键运行时探测（真实数据 'United States'；演示枚举 'United States of America'） */
  const usKey = computed(() => {
    const cs = countries.value;
    if (cs.includes('United States')) return 'United States';
    if (cs.includes('United States of America')) return 'United States of America';
    return 'United States';
  });

  /* ================= 基础取数 helper ================= */

  /** 站点键（filter.applied 已解析） */
  function siteKeys(): string[] {
    return filter.siteKeys;
  }

  function metaDayOf(bucket: MetaBucket | undefined, date: string): Metrics | null {
    return bucket ? metaDayToMetrics(bucket[date], siteKeys()) : null;
  }

  function gCellOf(cell: number[] | undefined): Metrics | null {
    return cell ? googleCellToMetrics(cell) : null;
  }

  /* ================= Meta 查询（账号筛选仅大盘/账号维度） ================= */

  /** 单账号单日（m1/m2 行、导出按日） */
  function metaAccDay(acc: string, date: string): Metrics {
    return metaDayOf(metaAccB?.[acc], date) ?? zero();
  }

  function metaAccRange(acc: string, s: string, e: string): Metrics {
    return memo(`maR|${acc}|${s}|${e}`, () => {
      const m = zero();
      for (const d of dateRange(s, e)) addMetrics(m, metaAccDay(acc, d));
      return m;
    });
  }

  /** Meta 大盘日聚合（账号过滤生效） */
  function metaTotDate(date: string): Metrics {
    return memo(`mTD|${date}`, () => {
      const t = zero();
      const allow = filter.applied.metaAccounts;
      for (const a of metaAccounts.value) {
        if (allow && !allow.includes(a)) continue;
        addMetrics(t, metaAccDay(a, date));
      }
      return t;
    });
  }

  function metaTotRange(s: string, e: string): Metrics {
    return memo(`mTR|${s}|${e}`, () => {
      const t = zero();
      for (const d of dateRange(s, e)) addMetrics(t, metaTotDate(d));
      return t;
    });
  }

  /** Meta 维度区间聚合（不受账号筛选影响；键→区间合计） */
  function dimBucket(dim: MetaDim): Record<string, MetaBucket> {
    switch (dim) {
      case 'camp':
        return metaCampB ?? {};
      case 'spu':
        return metaSpuB ?? {};
      case 'ctry':
        return metaDimB?.ctry ?? {};
      case 'age':
        return metaDimB?.age ?? {};
      case 'ctype':
        return creativeB?.ctype ?? {};
    }
  }

  function metaDimRange(dim: MetaDim, s: string, e: string): Record<string, Metrics> {
    return memo(`mDR|${dim}|${s}|${e}`, () => {
      const src = dimBucket(dim);
      const out: Record<string, Metrics> = {};
      const days = dateRange(s, e);
      for (const k of Object.keys(src)) {
        const m = zero();
        let any = false;
        for (const d of days) {
          const c = metaDayOf(src[k], d);
          if (c) {
            addMetrics(m, c);
            any = true;
          }
        }
        if (any) out[k] = m;
      }
      return out;
    });
  }

  function metaDimDate(dim: MetaDim, date: string): Record<string, Metrics> {
    return memo(`mDD|${dim}|${date}`, () => {
      const src = dimBucket(dim);
      const out: Record<string, Metrics> = {};
      for (const k of Object.keys(src)) {
        const c = metaDayOf(src[k], date);
        if (c) out[k] = c;
      }
      return out;
    });
  }

  /* ================= Google 查询 ================= */

  function gAccDay(acc: string, date: string): Metrics {
    return gCellOf(gAccB?.[acc]?.[date]) ?? zero();
  }

  function gAccRange(acc: string, s: string, e: string): Metrics {
    return memo(`gAR|${acc}|${s}|${e}`, () => {
      const m = zero();
      for (const d of dateRange(s, e)) addMetrics(m, gAccDay(acc, d));
      return m;
    });
  }

  /** Google 大盘日聚合（账号过滤生效；组合/类型/国家/SPU/年龄/Campaign 表无账号维不缩放） */
  function gTotDate(date: string): Metrics {
    return memo(`gTD|${date}`, () => {
      const t = zero();
      const allow = filter.applied.gAccounts;
      for (const a of gAccounts.value) {
        if (allow && !allow.includes(a)) continue;
        addMetrics(t, gAccDay(a, date));
      }
      return t;
    });
  }

  function gTotRange(s: string, e: string): Metrics {
    return memo(`gTR|${s}|${e}`, () => {
      const t = zero();
      for (const d of dateRange(s, e)) addMetrics(t, gTotDate(d));
      return t;
    });
  }

  /** typeBrand 组合桶（brandQ 空=全部；键 "type|brand"） */
  function gRowsRange(s: string, e: string, brandQ = ''): Record<string, Metrics> {
    return memo(`gRR|${s}|${e}|${brandQ}`, () => {
      const out: Record<string, Metrics> = {};
      const src = gTypeB?.typeBrand ?? {};
      const days = dateRange(s, e);
      for (const key of Object.keys(src)) {
        if (brandQ && key.split('|')[1] !== brandQ) continue;
        const m = zero();
        let any = false;
        for (const d of days) {
          const c = gCellOf(src[key]?.[d]);
          if (c) {
            addMetrics(m, c);
            any = true;
          }
        }
        if (any) out[key] = m;
      }
      return out;
    });
  }

  /** 广告类型聚合（brand 合并） */
  function gTypeAgg(s: string, e: string): Record<string, Metrics> {
    return memo(`gTA|${s}|${e}`, () => {
      const rows = gRowsRange(s, e);
      const out: Record<string, Metrics> = {};
      for (const key of Object.keys(rows)) {
        const ty = key.split('|')[0];
        (out[ty] ??= zero());
        addMetrics(out[ty], rows[key]);
      }
      return out;
    });
  }

  function gCtyDay(ct: string, date: string): Metrics {
    return gCellOf(gDimB?.ctry?.[ct]?.[date]) ?? zero();
  }

  function gCtyRange(ct: string, s: string, e: string): Metrics {
    return memo(`gCR|${ct}|${s}|${e}`, () => {
      const m = zero();
      for (const d of dateRange(s, e)) addMetrics(m, gCtyDay(ct, d));
      return m;
    });
  }

  function gSpuRange(spu: string, s: string, e: string): Metrics {
    return memo(`gSR|${spu}|${s}|${e}`, () => {
      const m = zero();
      const b = gSpuB?.[spu];
      if (b) for (const d of dateRange(s, e)) addMetrics(m, gCellOf(b[d]) ?? zero());
      return m;
    });
  }

  function gAgeDay(ag: string, date: string): Metrics {
    return gCellOf(gDimB?.age?.[ag]?.[date]) ?? zero();
  }

  function gAgeRange(ag: string, s: string, e: string): Metrics {
    return memo(`gGR|${ag}|${s}|${e}`, () => {
      const m = zero();
      for (const d of dateRange(s, e)) addMetrics(m, gAgeDay(ag, d));
      return m;
    });
  }

  function gCmpDay(cp: string, date: string): Metrics {
    return gCellOf(gCmpB?.[cp]?.[date]) ?? zero();
  }

  function gCmpRange(cp: string, s: string, e: string): Metrics {
    return memo(`gPR|${cp}|${s}|${e}`, () => {
      const m = zero();
      for (const d of dateRange(s, e)) addMetrics(m, gCmpDay(cp, d));
      return m;
    });
  }

  /* ================= 渠道归因（大盘页签；channel 桶无账号维） ================= */

  function chDaily(ch: 'Meta' | 'Google' | 'EDM', date: string): Metrics {
    if (!channel) return zero();
    if (ch === 'EDM') {
      // EDM=整站 EDM 归因（仅 Shopify）；无广告花费，桶值计入转化价值
      const v = channel.edm[date]?.[0] ?? 0;
      const m = zero();
      if (filter.applied.sites.includes('Shopify')) m.value = v;
      return m;
    }
    if (ch === 'Google') return gCellOf(channel.google[date]) ?? zero();
    return metaDayOf(channel.meta, date) ?? zero();
  }

  function chRange(ch: 'Meta' | 'Google' | 'EDM', s: string, e: string): Metrics {
    return memo(`chR|${ch}|${s}|${e}`, () => {
      const m = zero();
      for (const d of dateRange(s, e)) addMetrics(m, chDaily(ch, d));
      return m;
    });
  }

  /** 整站 GMV（易仓已付款 status=4）：按选中站点求和 */
  function gmvAt(d: string): number {
    if (!channel) return 0;
    const g = channel.gmv[d];
    if (!g) return 0;
    let s = 0;
    for (const st of filter.applied.sites) {
      const v = g[st.toLowerCase() as 'shopify' | 'shoplazza'];
      if (v) s += v[0];
    }
    return s;
  }

  /** 渠道归因总览计算（GMV 占比分母=各渠道 GMV 合计，视图中派生占比） */
  function ovCalc(s: string, e: string): OvCalc {
    return memo(`ov|${s}|${e}`, () => {
      const meta = chRange('Meta', s, e);
      const goog = chRange('Google', s, e);
      const edm = chRange('EDM', s, e);
      let gmv = 0;
      for (const d of dateRange(s, e)) gmv += gmvAt(d);
      return { meta, goog, edm, gmv, siteSpend: meta.spend + goog.spend };
    });
  }

  /* ================= 国家维度（美国/非美国） ================= */

  /** 地区聚合：'非美国'=全部国家合计−美国（特殊键） */
  function ctyAgg(o: Record<string, Metrics>, nm: string): Metrics {
    if (nm === '非美国') {
      const m = zero();
      for (const k of Object.keys(o)) {
        if (k !== usKey.value) addMetrics(m, o[k]);
      }
      return m;
    }
    return o[nm] ?? zero();
  }

  /** m3 SPU 候选（原型 spuCandidates REAL 语义）：站点/账号联动——
   *  已选账号时仅保留其投放过的 SPU（spuAccs 交集）；站点检查桶内所选站点花费>0 */
  function spuCandidates(): string[] {
    return memo('spuCand', () => {
      const sites = filter.siteKeys;
      const accs = filter.applied.metaAccounts;
      return spus.value.filter((s) => {
        if (accs && accs.length) {
          const a = spuAccs.value[s];
          if (!a || !a.some((x) => accs.includes(x))) return false;
        }
        const byD = metaSpuB?.[s];
        if (!byD) return false;
        for (const dt in byD) {
          const bk = byD[dt];
          for (const st of sites) {
            const v = bk[st as keyof typeof bk];
            if (v && v[0] > 0) return true;
          }
        }
        return false;
      });
    });
  }

  /* ================= 素材效率（m4） ================= */

  /** ad 级日取数（adList 索引；账号筛选不适用：ad 表无账号维） */
  function adMetrics(i: number, date: string): Metrics | null {
    return metaDayOf(metaAdB?.[String(i)], date);
  }

  function adAgg(i: number, s: string, e: string): Metrics {
    return memo(`adA|${i}|${s}|${e}`, () => {
      const m = zero();
      for (const d of dateRange(s, e)) {
        const c = adMetrics(i, d);
        if (c) addMetrics(m, c);
      }
      return m;
    });
  }

  /** Top 素材分组（复刻观远）：同编号（XSP/XPH 编码）多条广告求和；无编号按广告名独立成行；
   *  仅保留 orders>0，按订单降序 Top50。adNames=null 表示不过滤。 */
  function collectTop(s: string, e: string, adNames: string[] | null): TopGroup[] {
    return memo(`top|${s}|${e}|${adNames ? adNames.join(',') : '*'}`, () => {
      const groups: Record<string, TopGroup> = {};
      const list = adList.value;
      const days = dateRange(s, e);
      for (let i = 0; i < list.length; i++) {
        const name = list[i][0];
        if (adNames && !adNames.includes(name)) continue;
        const type = list[i][1];
        const cd = adCodeOf(name);
        const key = cd ? type + '|' + cd : name;
        const g = (groups[key] ??= { key, label: type, name, type, code: cd, items: [], m: zero() });
        g.items.push(i);
        for (const d of days) {
          const c = adMetrics(i, d);
          if (c) addMetrics(g.m, c);
        }
      }
      return Object.values(groups)
        .filter((g) => g.m.orders > 0)
        .sort((a, b) => b.m.orders - a.m.orders)
        .slice(0, 50);
    });
  }

  /** 子分类区间行（sub2=false 用 sub 桶/def.order；true 用 sub2 桶/alt.order；固定序展示） */
  function subRows(sub2: boolean, typeName: string, order: string[], s: string, e: string): { label: string; m: Metrics }[] {
    return memo(`sub|${sub2}|${typeName}|${order.join(',')}|${s}|${e}`, () => {
      const srcAll = sub2 ? creativeB?.sub2 : creativeB?.sub;
      const src = (srcAll?.[typeName] ?? {}) as Record<string, Record<string, Record<string, number[]>>>;
      const days = dateRange(s, e);
      const rows: { label: string; m: Metrics }[] = [];
      const seen = new Set<string>();
      const push = (lab: string): void => {
        if (seen.has(lab)) return;
        seen.add(lab);
        const b = src[lab];
        if (!b) return;
        const m = zero();
        let any = false;
        for (const d of days) {
          const c = metaDayToMetrics(b[d], siteKeys());
          if (c) {
            addMetrics(m, c);
            any = true;
          }
        }
        if (any) rows.push({ label: lab, m });
      };
      order.forEach(push);
      Object.keys(src).forEach(push);
      return rows;
    });
  }

  /** 子分类单日（导出按日） */
  function subDay(sub2: boolean, typeName: string, label: string, d: string): Metrics {
    const srcAll = sub2 ? creativeB?.sub2 : creativeB?.sub;
    const b = (srcAll?.[typeName] ?? {})[label];
    return metaDayToMetrics(b?.[d], siteKeys()) ?? zero();
  }

  /** 表总计（Σ行求和；比率列由 derive 现算） */
  function totalOf(rows: { m: Metrics }[]): Metrics {
    return sumMetrics(rows.map((r) => r.m));
  }

  return {
    manifest,
    dims,
    loadError,
    rangeReady,
    init,
    ensure,
    ensureForRange,
    metaAccounts,
    gAccounts,
    metaCampaigns,
    gCampaigns,
    spus,
    spuAccs,
    gSpus,
    countries,
    ages,
    types,
    combos,
    adList,
    adIx,
    usKey,
    metaAccDay,
    metaAccRange,
    metaTotDate,
    metaTotRange,
    metaDimRange,
    metaDimDate,
    gAccDay,
    gAccRange,
    gTotDate,
    gTotRange,
    gRowsRange,
    gTypeAgg,
    gCtyDay,
    gCtyRange,
    gSpuRange,
    gAgeDay,
    gAgeRange,
    gCmpDay,
    gCmpRange,
    chDaily,
    chRange,
    gmvAt,
    ovCalc,
    ctyAgg,
    adMetrics,
    adAgg,
    collectTop,
    spuCandidates,
    subRows,
    subDay,
    totalOf,
  };
});
