/**
 * v3 月度分片拉取：拉取窗口按自然月切片，逐月执行全部主题 SQL → 月度 RawDataset。
 *
 * 月内结构与单窗口口径完全一致（rowsToDataset 复用），分片仅是存储切分；
 * dims 枚举跨月并集合并为全局 dims.json。
 * 每月分片在生成时即跑 validateDataset（月窗口伪 manifest），坏数据不落盘。
 */
import { CONTRACT_VERSION, addDays, addMonths } from '@ads/shared';
import type { DateStr, Dims, MonthSlice } from '@ads/shared';
import { DimsSchema } from '@ads/shared/schema';
import type { RawDataset } from '../types';
import type { ReorcClient, Row } from './client';
import { REORC_SCOPE } from './index';
import { REORC_QUERIES } from './queries';
import { rowsToDataset, type RowsByTopic } from './rows';
import { validateDataset } from '../../validate';

export interface MonthWindow {
  month: string;
  start: DateStr;
  end: DateStr;
}

/** [start,end] 按自然月切片（闭区间）；首月从 max(start, 月首) 起、末月到 min(end, 月尾) 止 */
export function planMonths(start: DateStr, end: DateStr): MonthWindow[] {
  const wins: MonthWindow[] = [];
  if (start > end) return wins;
  let cur = start.slice(0, 7);
  for (let guard = 0; guard < 240; guard++) {
    const monthStart = `${cur}-01`;
    const monthEnd = addDays(addMonths(monthStart, 1), -1);
    const s = start > monthStart ? start : monthStart;
    const e = end < monthEnd ? end : monthEnd;
    if (s <= e) wins.push({ month: cur, start: s, end: e });
    if (monthEnd >= end) break;
    cur = addMonths(monthStart, 1).slice(0, 7);
  }
  return wins;
}

/** dims 枚举并集：数组 unique 排序；spuAccs 按键合并；combos/adList 键去重 */
export function mergeDims(a: Dims, b: Dims): Dims {
  const uniq = (arr: string[]): string[] => [...new Set(arr)].sort((x, y) => (x < y ? -1 : 1));
  const uniqTuple = <T extends string[]>(arr: T[]): T[] => {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const it of arr) {
      const k = JSON.stringify(it);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(it);
      }
    }
    return out;
  };
  const spuAccs: Record<string, string[]> = { ...a.spuAccs };
  for (const [spu, accs] of Object.entries(b.spuAccs)) {
    spuAccs[spu] = uniq([...(spuAccs[spu] ?? []), ...accs]);
  }
  return {
    metaAccounts: uniq([...a.metaAccounts, ...b.metaAccounts]),
    gAccounts: uniq([...a.gAccounts, ...b.gAccounts]),
    metaCampaigns: uniq([...a.metaCampaigns, ...b.metaCampaigns]),
    gCampaigns: uniq([...a.gCampaigns, ...b.gCampaigns]),
    spus: uniq([...a.spus, ...b.spus]),
    gSpus: uniq([...a.gSpus, ...b.gSpus]),
    spuAccs,
    types: uniq([...a.types, ...b.types]),
    countries: uniq([...a.countries, ...b.countries]),
    ages: uniq([...a.ages, ...b.ages]),
    combos: uniqTuple([...a.combos, ...b.combos]),
    adList: uniqTuple([...a.adList, ...b.adList]),
  };
}

function sliceOf(ds: RawDataset, month: string): MonthSlice {
  return {
    month,
    channel: ds.channel,
    metaAcc: ds.metaAcc,
    metaCamp: ds.metaCamp,
    metaSpu: ds.metaSpu,
    metaDim: ds.metaDim,
    metaCreative: ds.metaCreative,
    metaAd: ds.metaAd,
    googleAcc: ds.googleAcc,
    googleDim: ds.googleDim,
    googleSpu: ds.googleSpu,
    googleType: ds.googleType,
    googleCmp: ds.googleCmp ?? {},
  };
}

export interface FetchMonthlyOptions {
  client: ReorcClient;
  connectionId: string;
  database: string;
  envId: string;
  /** 回填起点（含；默认 2026-01-01 由 cli 注入） */
  start: DateStr;
  /** 回填终点（含；默认北京昨日） */
  end: DateStr;
  log?: (msg: string) => void;
}

export interface MonthlyPayload {
  /** v3 完整 manifest（全窗口 range + months 列表；默认视图=数据末 7 天） */
  manifest: RawDataset['manifest'];
  dims: Dims;
  slices: MonthSlice[];
}

export async function fetchMonthly(opts: FetchMonthlyOptions): Promise<MonthlyPayload> {
  const log = opts.log ?? ((m: string) => console.log(`[pipeline][monthly] ${m}`));
  const genAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const wins = planMonths(opts.start, opts.end);
  if (!wins.length) throw new Error(`非法回填窗口：${opts.start} ~ ${opts.end}`);
  log(`回填窗口 ${opts.start}~${opts.end} → ${wins.length} 个月分片`);

  const slices: MonthSlice[] = [];
  const months: string[] = [];
  let dims: Dims | null = null;

  for (const win of wins) {
    const rows: RowsByTopic = {};
    for (const topic of REORC_QUERIES) {
      const sql = topic.sql({ start: win.start, end: win.end });
      const result: Row[] = await opts.client.sqlQueryAll(opts.connectionId, sql, opts.database, opts.envId);
      rows[topic.id] = result;
      log(`${win.month} ${topic.id}：${result.length} 行`);
    }
    const ds = rowsToDataset(rows, { genAt, start: win.start, end: win.end, scope: REORC_SCOPE });
    // 月内校验：伪 manifest 补 months 字段满足 v3 Schema；range=该月窗口（数据日期天然月内）
    validateDataset({
      ...ds,
      manifest: {
        v: CONTRACT_VERSION,
        genAt,
        scope: REORC_SCOPE,
        months: [win.month],
        range: { min: win.start, max: win.end, viewStart: win.start, viewEnd: win.end },
      },
    });
    slices.push(sliceOf(ds, win.month));
    dims = dims ? mergeDims(dims, ds.dims) : ds.dims;
    months.push(win.month);
    log(`${win.month} 分片完成（校验通过）`);
  }

  DimsSchema.parse(dims);
  const min = wins[0].start;
  const max = wins[wins.length - 1].end;
  return {
    manifest: {
      v: CONTRACT_VERSION,
      genAt,
      scope: REORC_SCOPE,
      months,
      range: { min, max, viewStart: addDays(max, -6), viewEnd: max },
    },
    dims: dims as Dims,
    slices,
  };
}
