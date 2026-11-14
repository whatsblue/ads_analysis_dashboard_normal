import { describe, expect, it } from 'vitest';
import { DATA_FILES } from '@ads/shared';
import type { MonthSlice } from '@ads/shared';
import { resetDataCache } from '../data';
import { emptyBuckets, mergeDeep, mergeSlices, neededMonths } from '../data/merge';

describe('数据访问层契约（v3 月分片）', () => {
  it('DATA_FILES 仅含全局文件（月分片由 loader 按 months 拼路径）', () => {
    expect(Object.keys(DATA_FILES)).toHaveLength(2);
    expect(DATA_FILES.manifest).toBe('manifest.json');
    expect(DATA_FILES.dims).toBe('dims.json');
  });

  it('resetDataCache 可重置（fetch 尚未发生不报错）', () => {
    expect(() => resetDataCache()).not.toThrow();
  });
});

describe('neededMonths（选中∪环比 → 月列表）', () => {
  const avail = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-11'];

  it('单区间跨月展开', () => {
    expect(neededMonths([{ start: '2026-01-05', end: '2026-03-02' }], avail)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
    ]);
  });

  it('多区间去重并按月升序', () => {
    expect(
      neededMonths(
        [
          { start: '2026-03-01', end: '2026-03-31' },
          { start: '2026-01-01', end: '2026-01-31' },
        ],
        avail,
      ),
    ).toEqual(['2026-01', '2026-03']);
  });

  it('过滤掉 manifest.months 不存在的月份', () => {
    expect(neededMonths([{ start: '2025-12-01', end: '2026-05-02' }], avail)).toEqual(avail.filter((m) => m !== '2026-11').sort());
  });
});

describe('mergeDeep / mergeSlices', () => {
  it('mergeDeep：对象递归归并，数组叶子覆盖', () => {
    const dst = { a: { b: { v: 1 }, keep: true } as Record<string, unknown>, list: [1, 2] } as Record<string, unknown>;
    mergeDeep(dst, {
      a: { b: { w: 2 }, other: false },
      list: [9],
      extra: 'x',
    } as Record<string, unknown>);
    const a = dst.a as Record<string, unknown>;
    expect(a.b).toEqual({ v: 1, w: 2 });
    expect(a.keep).toBe(true);
    expect(a.other).toBe(false);
    expect(dst.list).toEqual([9]);
    expect(dst.extra).toBe('x');
  });

  it('mergeSlices：两月分片合并=与全窗口拉取同构（账号日桶不相交合并）', () => {
    const slice = (month: string, day: string, spend: number): MonthSlice =>
      ({
        month,
        channel: { meta: { [day]: { A: [spend, 0, 0, 0, 0, 0, 0] } }, google: {}, gmv: {}, edm: {} },
        metaAcc: { AccA: { [day]: { A: [spend, 0, 0, 0, 0, 0, 0] } } },
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
      }) as unknown as MonthSlice;

    const b = emptyBuckets();
    mergeSlices(b, [slice('2026-01', '2026-01-31', 100), slice('2026-02', '2026-02-01', 200)]);
    expect(Object.keys(b.channel.meta).sort()).toEqual(['2026-01-31', '2026-02-01']);
    const acc = b.metaAcc as Record<string, Record<string, { A?: number[] }>>;
    expect(acc.AccA['2026-01-31'].A?.[0]).toBe(100);
    expect(acc.AccA['2026-02-01'].A?.[0]).toBe(200);
  });
});
