/**
 * 行组装与环比构造（迁移自原型 withCmps：本期行 + N×（对比行+Δ行）三行组）。
 * 对比期按行索引对齐日（day=对比期起始+行序），区间表仅用 start/end。
 */
import type { CmpRange } from '@ads/shared';
import { addDays } from '@ads/shared';
import type { Metrics } from '@ads/shared';
import { useFilterStore } from '@/stores/filter';

export interface CmpCell {
  label: string;
  day: string;
  start: string;
  end: string;
  m: Metrics;
}

/** 表行（m=本期指标桶；cmps=对比期列表；其余字段由视图自定义） */
export interface TableRow {
  label: string;
  /** 渠道标识（ca 表 hover 归因用，如 'Meta'） */
  ch?: string;
  m: Metrics;
  cmps?: CmpCell[];
  [k: string]: unknown;
}

export interface RowWithCmps extends TableRow {
  cmps: CmpCell[];
}

/**
 * 为行挂载环比对比期（原型 withCmps）。
 * @param mkCmp 计算对比期指标（行+行索引+周期）
 */
export function withCmps<T extends TableRow>(rows: T[], mkCmp: (r: T, i: number, rg: CmpRange) => Metrics): T[] {
  const filter = useFilterStore();
  const rgs: CmpRange[] = filter.cmpRanges;
  rows.forEach((r, i) => {
    r.cmps = rgs.map((rg) => ({ label: rg.label, day: addDays(rg.start, i), start: rg.start, end: rg.end, m: mkCmp(r, i, rg) }));
  });
  return rows;
}

/** 行集合区间排序辅助：按指标值降序取键（原型 top 逻辑） */
export function topKeys(agg: Record<string, Metrics>, metric: keyof Metrics = 'spend'): string[] {
  return Object.keys(agg)
    .filter((k) => (agg[k][metric] as number) > 0)
    .sort((x, y) => (agg[y][metric] as number) - (agg[x][metric] as number));
}
