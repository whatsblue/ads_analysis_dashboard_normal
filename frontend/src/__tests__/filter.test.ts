import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { zero } from '@ads/shared';
import { resolveCmpRanges, SITES, useFilterStore } from '../stores/filter';
import { withCmps, type TableRow } from '../composables/useRows';

describe('resolveCmpRanges（对比周期解析）', () => {
  it('cmpOn=false → 空数组', () => {
    expect(resolveCmpRanges({ cmpOn: false, cmpT: 'week', cmpN: 1, cmpEd: null, start: '2024-05-06', end: '2024-05-12' })).toEqual([]);
  });

  it('周环比自动平移 7 天（上周同期）', () => {
    const rs = resolveCmpRanges({ cmpOn: true, cmpT: 'week', cmpN: 1, cmpEd: null, start: '2024-05-06', end: '2024-05-12' });
    expect(rs).toEqual([{ label: '上周同期', start: '2024-04-29', end: '2024-05-05' }]);
  });

  it('多周期 n=2 标签递增', () => {
    const rs = resolveCmpRanges({ cmpOn: true, cmpT: 'week', cmpN: 2, cmpEd: null, start: '2024-05-06', end: '2024-05-12' });
    expect(rs.map((r) => r.label)).toEqual(['上周同期', '2周前同期']);
    expect(rs[1].start).toBe('2024-04-22');
  });

  it('cmpEd 按索引覆盖自动周期，null 项保留自动值', () => {
    const rs = resolveCmpRanges({
      cmpOn: true,
      cmpT: 'week',
      cmpN: 2,
      cmpEd: [{ start: '2024-01-01', end: '2024-01-07' }, null],
      start: '2024-05-06',
      end: '2024-05-12',
    });
    expect(rs[0]).toEqual({ label: '上周同期', start: '2024-01-01', end: '2024-01-07' });
    expect(rs[1].start).toBe('2024-04-22');
  });
});

describe('filter store（草稿/生效/排除语义）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  function freshStore() {
    const f = useFilterStore();
    f.setAccountUniverse(['A1', 'A2', 'A3'], ['G1', 'G2']);
    f.initDefaults('2024-05-06', '2024-05-12', ['A1', 'A2', 'A3'], ['G1', 'G2']);
    return f;
  }

  it('initDefaults 后 draft=applied，dirty=false', () => {
    const f = freshStore();
    expect(f.dirty).toBe(false);
    expect(f.applied.start).toBe('2024-05-06');
    expect(f.applied.metaAccounts).toBeNull();
    expect(f.applied.sites).toEqual(['Shopify']);
  });

  it('白名单：空选择=null（全部账号）；选中子集=子集', () => {
    const f = freshStore();
    f.apply();
    expect(f.applied.metaAccounts).toBeNull();
    f.draft.metaSel = ['A2'];
    f.apply();
    expect(f.applied.metaAccounts).toEqual(['A2']);
    expect(f.dirty).toBe(false);
  });

  it('排除：选中集取补集', () => {
    const f = freshStore();
    f.draft.metaSel = ['A1'];
    f.draft.metaExcl = true;
    f.apply();
    expect(f.applied.metaAccounts).toEqual(['A2', 'A3']);
  });

  it('站点排除语义与 version 递增（缓存失效信号）', () => {
    const f = freshStore();
    const v0 = f.applied.version;
    f.draft.siteSel = ['Shopify'];
    f.draft.siteExcl = true;
    f.apply();
    expect(f.applied.sites).toEqual(['Shoplazza']);
    expect(SITES).toEqual(['Shopify', 'Shoplazza']);
    expect(f.applied.version).toBe(v0 + 1);
  });

  it('reset 恢复数据窗口默认（语义回到已应用状态，dirty=false）', () => {
    const f = freshStore();
    f.draft.metaSel = ['A1'];
    f.draft.cmpN = 3;
    expect(f.dirty).toBe(true);
    f.reset('2024-05-06', '2024-05-12');
    expect(f.draft.metaSel).toEqual([]);
    expect(f.draft.cmpN).toBe(1);
    expect(f.draft.start).toBe('2024-05-06');
    expect(f.dirty).toBe(false);
  });
});

describe('withCmps（三行组挂载）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('按行索引对齐对比日（day=对比期起始+i），透传周期区间', () => {
    const f = useFilterStore();
    f.setAccountUniverse([], []);
    f.initDefaults('2024-05-06', '2024-05-12', [], []);
    f.apply();

    const rows: TableRow[] = [
      { label: 'r0', m: zero() },
      { label: 'r1', m: zero() },
    ];
    const out = withCmps(rows, (_r, i) => {
      const m = zero();
      m.spend = 10 + i;
      return m;
    });
    expect(out[0].cmps).toHaveLength(1);
    expect(out[0].cmps![0].start).toBe('2024-04-29');
    expect(out[0].cmps![0].day).toBe('2024-04-29');
    expect(out[1].cmps![0].day).toBe('2024-04-30');
    expect(out[1].cmps![0].m.spend).toBe(11);
    expect(out[0].cmps![0].label).toBe('上周同期');
  });
});
