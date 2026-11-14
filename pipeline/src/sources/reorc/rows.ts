/**
 * 行→契约桶映射：SQL 主题行（queries.ts 固定别名）折叠为 RawDataset。
 * 防御规则：数值 NULL→0；站点白名单外→unknown；日期非 YYYY-MM-DD 抛错。
 * A 键（全站合计）在站点行入桶时同步累加，对齐 RD 预计算语义。
 */
import { CONTRACT_VERSION, addDays, monthsCover } from '@ads/shared';
import type {
  ChannelData,
  DateStr,
  Dims,
  GoogleBucket,
  GoogleCell,
  MetaBucket,
  MetaCell,
  MetaDay,
  SiteKey,
} from '@ads/shared';
import type { RawDataset } from '../types';
import type { Row } from './client';

export interface RowsByTopic {
  [topicId: string]: Row[] | undefined;
}

export interface RowsContext {
  genAt: string;
  /** 拉取窗口（滚动重算） */
  start: DateStr;
  end: DateStr;
  scope: string;
}

const SITE_KEYS: SiteKey[] = ['shopify', 'shoplazza', 'unknown'];

function num(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function siteKey(v: unknown): SiteKey {
  const s = String(v ?? '').toLowerCase();
  return SITE_KEYS.includes(s as SiteKey) ? (s as SiteKey) : 'unknown';
}

function dateStr(v: unknown, topic: string): DateStr {
  const s = String(v ?? '');
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) throw new Error(`主题 ${topic} 返回非法日期：${JSON.stringify(v)}`);
  return s.slice(0, 10);
}

function str(v: unknown): string {
  return String(v ?? '');
}

/** Meta 行 → 7/8 元 cell（inter 缺失 → 7 元，对齐 RD） */
function metaCell(row: Row): MetaCell {
  const cell: MetaCell = [num(row.spend), num(row.impressions), num(row.clicks), num(row.orders), num(row.value), num(row.atc), num(row.ckt)];
  if (row.inter !== null && row.inter !== undefined) cell.push(num(row.inter));
  return cell;
}

function googleCell(row: Row): GoogleCell {
  return [num(row.spend), num(row.impressions), num(row.clicks), num(row.orders), num(row.vs), num(row.va)];
}

/** Google 行 → 7 元 cell（v4：第 7 位 = unified_interactions；age 仍走 googleCell 6 元） */
function googleCell7(row: Row): GoogleCell {
  return [...googleCell(row), num(row.inter)];
}

/** 同索引累加，长度取 max（7+8 → 8） */
function addInto(dst: number[] | undefined, src: number[]): number[] {
  if (!dst) return src.slice();
  const out = dst.slice();
  while (out.length < src.length) out.push(0);
  for (let i = 0; i < src.length; i++) out[i] += src[i];
  return out;
}

/** 取 meta 维度桶的某日站点桶：bucket[dim][date] */
function metaDayOf(bucket: Record<string, MetaBucket>, dim: string, date: DateStr): MetaDay {
  const byDate = (bucket[dim] ??= {});
  return (byDate[date] ??= {});
}

/** 站点行入桶 + 累加 A（channel / 带 A 层的 meta 维度桶用） */
function putMetaDay(day: MetaDay, site: SiteKey, cell: MetaCell): void {
  day[site] = addInto(day[site], cell) as MetaCell;
  day.A = addInto(day.A, cell) as MetaCell;
}

/** 无 A 层站点桶（meta/creative 的 sub/sub2）：直接按站点键入桶 */
function putSiteOnly(target: Partial<Record<SiteKey, MetaCell>>, site: SiteKey, cell: MetaCell): void {
  target[site] = addInto(target[site], cell) as MetaCell;
}

/** 取 google 维度桶：bucket[dim] */
function googleBucketOf(bucket: Record<string, GoogleBucket>, dim: string): GoogleBucket {
  return (bucket[dim] ??= {});
}

export function rowsToDataset(rows: RowsByTopic, ctx: RowsContext): RawDataset {
  const channel: ChannelData = { meta: {}, google: {}, gmv: {}, edm: {} };
  const metaAcc: RawDataset['metaAcc'] = {};
  const metaCamp: RawDataset['metaCamp'] = {};
  const metaSpu: RawDataset['metaSpu'] = {};
  const metaDim: RawDataset['metaDim'] = { ctry: {}, age: {} };
  const metaCreative: RawDataset['metaCreative'] = { sub: {}, sub2: {}, ctype: {} };
  const metaAd: RawDataset['metaAd'] = {};
  const googleAcc: RawDataset['googleAcc'] = {};
  const googleDim: RawDataset['googleDim'] = { ctry: {}, age: {} };
  const googleSpu: RawDataset['googleSpu'] = {};
  const googleType: RawDataset['googleType'] = { typeBrand: {}, cmpNames: {} };

  // 维度枚举（保序 distinct）
  const seen = {
    metaAccounts: new Set<string>(),
    gAccounts: new Set<string>(),
    metaCampaigns: new Set<string>(),
    gCampaigns: new Set<string>(),
    spus: new Set<string>(),
    gSpus: new Set<string>(),
    spuAccs: new Map<string, Set<string>>(),
    types: new Set<string>(),
    countries: new Set<string>(),
    ages: new Set<string>(),
    combos: new Set<string>(),
    adList: new Map<string, [string, string, string]>(),
  };

  // ---- Meta 系列 ----
  for (const row of rows.meta_channel ?? []) {
    const date = dateStr(row.date, 'meta_channel');
    putMetaDay((channel.meta[date] ??= {}), siteKey(row.site), metaCell(row));
  }
  for (const row of rows.meta_acc ?? []) {
    const account = str(row.account);
    seen.metaAccounts.add(account);
    putMetaDay(metaDayOf(metaAcc, account, dateStr(row.date, 'meta_acc')), siteKey(row.site), metaCell(row));
  }
  for (const row of rows.meta_camp ?? []) {
    const campaign = str(row.campaign);
    seen.metaCampaigns.add(campaign);
    putMetaDay(metaDayOf(metaCamp, campaign, dateStr(row.date, 'meta_camp')), siteKey(row.site), metaCell(row));
  }
  for (const row of rows.meta_spu ?? []) {
    const spu = str(row.spu);
    const account = str(row.account);
    seen.spus.add(spu);
    if (!seen.spuAccs.has(spu)) seen.spuAccs.set(spu, new Set());
    seen.spuAccs.get(spu)!.add(account);
    putMetaDay(metaDayOf(metaSpu, spu, dateStr(row.date, 'meta_spu')), siteKey(row.site), metaCell(row));
  }
  for (const row of rows.meta_ctry ?? []) {
    const country = str(row.country);
    seen.countries.add(country);
    putMetaDay(metaDayOf(metaDim.ctry, country, dateStr(row.date, 'meta_ctry')), siteKey(row.site), metaCell(row));
  }
  for (const row of rows.meta_age ?? []) {
    const age = str(row.age);
    seen.ages.add(age);
    putMetaDay(metaDayOf(metaDim.age, age, dateStr(row.date, 'meta_age')), siteKey(row.site), metaCell(row));
  }
  for (const row of rows.meta_sub ?? []) {
    const type = str(row.type);
    seen.types.add(type);
    const bySub = (metaCreative.sub[type] ??= {});
    const byDate = (bySub[str(row.sub)] ??= {});
    const date = dateStr(row.date, 'meta_sub');
    putSiteOnly((byDate[date] ??= {}), siteKey(row.site), metaCell(row));
  }
  for (const row of rows.meta_sub2 ?? []) {
    const type = str(row.type);
    const bySub = (metaCreative.sub2[type] ??= {});
    const byDate = (bySub[str(row.sub2)] ??= {});
    const date = dateStr(row.date, 'meta_sub2');
    putSiteOnly((byDate[date] ??= {}), siteKey(row.site), metaCell(row));
  }
  for (const row of rows.meta_ctype ?? []) {
    const ctype = str(row.ctype);
    putMetaDay(metaDayOf(metaCreative.ctype, ctype, dateStr(row.date, 'meta_ctype')), siteKey(row.site), metaCell(row));
  }
  for (const row of rows.meta_ad ?? []) {
    const adName = str(row.ad_name);
    seen.adList.set(adName, [adName, str(row.ad_type), str(row.ad_no)]);
    putMetaDay(metaDayOf(metaAd, adName, dateStr(row.date, 'meta_ad')), siteKey(row.site), metaCell(row));
  }

  // ---- Google 系列 ----
  // v4：channel/acc/spu/type/ctry 行集 7 元（第 7 位 = unified_interactions）；age 保持 6 元（age 表无 unified_interactions）
  for (const row of rows.google_channel ?? []) {
    const date = dateStr(row.date, 'google_channel');
    channel.google[date] = addInto(channel.google[date], googleCell7(row)) as GoogleCell;
  }
  for (const row of rows.google_acc ?? []) {
    const account = str(row.account);
    seen.gAccounts.add(account);
    const b = googleBucketOf(googleAcc, account);
    const date = dateStr(row.date, 'google_acc');
    b[date] = addInto(b[date], googleCell7(row)) as GoogleCell;
  }
  for (const row of rows.google_cmp ?? []) {
    googleType.cmpNames[str(row.campaign_id)] = str(row.campaign_name);
    seen.gCampaigns.add(str(row.campaign_name));
  }
  for (const row of rows.google_spu ?? []) {
    const spu = str(row.spu);
    seen.gSpus.add(spu);
    const b = googleBucketOf(googleSpu, spu);
    const date = dateStr(row.date, 'google_spu');
    b[date] = addInto(b[date], googleCell7(row)) as GoogleCell;
  }
  for (const row of rows.google_type ?? []) {
    const key = `${str(row.type)}|${str(row.brand)}`;
    seen.combos.add(key);
    const b = googleBucketOf(googleType.typeBrand, key);
    const date = dateStr(row.date, 'google_type');
    b[date] = addInto(b[date], googleCell7(row)) as GoogleCell;
  }
  for (const row of rows.google_ctry ?? []) {
    const country = str(row.country);
    seen.countries.add(country);
    const b = googleBucketOf(googleDim.ctry, country);
    const date = dateStr(row.date, 'google_ctry');
    b[date] = addInto(b[date], googleCell7(row)) as GoogleCell;
  }
  for (const row of rows.google_age ?? []) {
    const age = str(row.age);
    seen.ages.add(age);
    const b = googleBucketOf(googleDim.age, age);
    const date = dateStr(row.date, 'google_age');
    b[date] = addInto(b[date], googleCell(row)) as GoogleCell;
  }

  // ---- GMV / EDM ----
  for (const row of rows.gmv ?? []) {
    const date = dateStr(row.date, 'gmv');
    const d = (channel.gmv[date] ??= {});
    const site = siteKey(row.site);
    const cell = [num(row.amount), num(row.cnt)];
    d[site] = addInto(d[site], cell) as [number, number];
    d.A = addInto(d.A, cell) as [number, number];
  }
  for (const row of rows.edm ?? []) {
    const date = dateStr(row.date, 'edm');
    channel.edm[date] = addInto(channel.edm[date], [num(row.value)]) as [number];
  }

  // ---- dims 与 manifest ----
  const dims: Dims = {
    metaAccounts: [...seen.metaAccounts],
    gAccounts: [...seen.gAccounts],
    metaCampaigns: [...seen.metaCampaigns],
    gCampaigns: [...seen.gCampaigns],
    spus: [...seen.spus],
    gSpus: [...seen.gSpus],
    spuAccs: Object.fromEntries([...seen.spuAccs].map(([spu, accs]) => [spu, [...accs]])),
    types: [...seen.types],
    countries: [...seen.countries],
    ages: [...seen.ages],
    combos: [...seen.combos].map((k) => k.split('|') as [string, string]),
    adList: [...seen.adList.values()],
  };

  const dates = [...Object.keys(channel.meta), ...Object.keys(channel.google)].sort();
  const min = dates[0] ?? ctx.start;
  const max = dates[dates.length - 1] ?? ctx.end;

  return {
    manifest: {
      v: CONTRACT_VERSION,
      genAt: ctx.genAt,
      months: monthsCover(min, max),
      range: { min, max, viewStart: addDays(max, -6), viewEnd: max },
      scope: ctx.scope,
    },
    dims,
    channel,
    metaAcc,
    metaCamp,
    metaSpu,
    metaDim,
    metaCreative,
    metaAd,
    googleAcc,
    googleDim,
    googleSpu,
    googleType,
  };
}
