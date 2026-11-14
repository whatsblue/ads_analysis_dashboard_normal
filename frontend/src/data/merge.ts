/**
 * 月分片合并纯函数：把多个 MonthSlice 深合并为与 v2 单快照同构的内存形态。
 * 月分片间日期不相交，合并语义 = 按键树归并、叶子（日桶 cell）覆盖。
 * 纯函数无 store 依赖，__tests__ 直接覆盖。
 */
import type { ChannelData, MonthSlice } from '@ads/shared';

type Rec = Record<string, unknown>;

/** 嵌套对象归并：两侧均为普通对象（非数组）时递归，否则覆盖（日不相交 → 覆盖=合并） */
export function mergeDeep(dst: Rec, src: Rec): void {
  for (const k of Object.keys(src)) {
    const dv = dst[k];
    const sv = src[k];
    if (
      dv &&
      sv &&
      typeof dv === 'object' &&
      typeof sv === 'object' &&
      !Array.isArray(dv) &&
      !Array.isArray(sv)
    ) {
      mergeDeep(dv as Rec, sv as Rec);
    } else {
      dst[k] = sv;
    }
  }
}

export interface SliceBuckets {
  channel: ChannelData;
  metaAcc: Rec;
  metaCamp: Rec;
  metaSpu: Rec;
  metaDim: Rec;
  metaCreative: Rec;
  metaAd: Rec;
  googleAcc: Rec;
  googleDim: Rec;
  googleSpu: Rec;
  googleType: Rec;
  googleCmp: Rec;
}

/** 全部内存桶置空（与契约结构同构） */
export function emptyBuckets(): SliceBuckets {
  return {
    channel: { meta: {}, google: {}, gmv: {}, edm: {} },
    metaAcc: {},
    metaCamp: {},
    metaSpu: {},
    metaDim: { ctry: {}, age: {} },
    metaCreative: { sub: {}, sub2: {}, ctype: {} },
    metaAd: {},
    googleAcc: {},
    googleDim: { ctry: {}, age: {} },
    googleSpu: {},
    googleType: { typeBrand: {}, cmpNames: {} },
    googleCmp: {},
  };
}

/** 按给定顺序把月分片合并进内存桶（slices 顺序=月升序，结果与窗口全量拉取同构） */
export function mergeSlices(b: SliceBuckets, slices: MonthSlice[]): void {
  for (const s of slices) {
    mergeDeep(b.channel as unknown as Rec, s.channel as unknown as Rec);
    mergeDeep(b.metaAcc, s.metaAcc as unknown as Rec);
    mergeDeep(b.metaCamp, s.metaCamp as unknown as Rec);
    mergeDeep(b.metaSpu, s.metaSpu as unknown as Rec);
    mergeDeep(b.metaDim, s.metaDim as unknown as Rec);
    mergeDeep(b.metaCreative, s.metaCreative as unknown as Rec);
    mergeDeep(b.metaAd, s.metaAd as unknown as Rec);
    mergeDeep(b.googleAcc, s.googleAcc as unknown as Rec);
    mergeDeep(b.googleDim, s.googleDim as unknown as Rec);
    mergeDeep(b.googleSpu, s.googleSpu as unknown as Rec);
    mergeDeep(b.googleType, s.googleType as unknown as Rec);
    mergeDeep(b.googleCmp, s.googleCmp as unknown as Rec);
  }
}

/** 选中区间 ∪ 环比区间 → 应加载的月列表（YYYY-MM 升序；仅保留 manifest.months 中存在的） */
export function neededMonths(
  ranges: { start: string; end: string }[],
  available: string[],
): string[] {
  const set = new Set<string>();
  for (const r of ranges) {
    // 月粒度推导（不依赖 shared 日期循环：字符串比较足够）
    let m = r.start.slice(0, 7);
    const endM = r.end.slice(0, 7);
    if (!(m <= endM)) continue;
    for (let guard = 0; guard < 240 && m <= endM; guard++) {
      set.add(m);
      const [y, mo] = m.split('-').map(Number);
      const ny = mo === 12 ? y + 1 : y;
      const nm = mo === 12 ? 1 : mo + 1;
      m = `${ny}-${String(nm).padStart(2, '0')}`;
    }
  }
  return [...set].filter((m) => available.includes(m)).sort();
}
