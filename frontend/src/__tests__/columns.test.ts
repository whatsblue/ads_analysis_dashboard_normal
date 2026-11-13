import { describe, expect, it } from 'vitest';
import {
  adCodeOf,
  COL_FMT,
  COL_NAME,
  G_ACC_COLS,
  G_AGE_COLS,
  G_COLS,
  G_CMP_COLS,
  G_DUAL_COLS,
  G_SPU_COLS,
  gTypeName,
  M2A_COLS,
  METRIC_GROUPS,
  STD_COLS,
  SUB_DEFS,
  TH_TIP,
} from '../specs/columns';

const ALL_GROUPS: [string, { k: string; name: string; fmt: (v: number | null | undefined) => string }[]][] = [
  ['STD_COLS', STD_COLS],
  ['M2A_COLS', M2A_COLS],
  ['G_COLS', G_COLS],
  ['G_SPU_COLS', G_SPU_COLS],
  ['G_ACC_COLS', G_ACC_COLS],
  ['G_CMP_COLS', G_CMP_COLS],
  ['G_AGE_COLS', G_AGE_COLS],
  ['G_DUAL_COLS', G_DUAL_COLS],
];

describe('列定义完整性（全站唯一来源）', () => {
  it('COL_NAME 与 COL_FMT 键集合一致', () => {
    expect(Object.keys(COL_FMT).sort()).toEqual(Object.keys(COL_NAME).sort());
  });

  it.each(ALL_GROUPS)('%s 每列均有名称与格式化器', (_nm, cols) => {
    for (const c of cols) {
      expect(c.k).toBeTruthy();
      expect(c.name).toBeTruthy();
      expect(typeof c.fmt).toBe('function');
      expect(c.fmt(1)).toEqual(expect.any(String));
    }
  });

  it('STD_COLS = 四组 14 指标展平', () => {
    expect(METRIC_GROUPS).toHaveLength(4);
    expect(STD_COLS.map((c) => c.k)).toEqual(METRIC_GROUPS.flatMap((g) => g[2]));
    expect(STD_COLS).toHaveLength(14);
  });

  it('M2A_COLS 占比列插入位置正确（spend/orders/value 之后）', () => {
    const ks = M2A_COLS.map((c) => c.k);
    expect(ks[ks.indexOf('spend') + 1]).toBe('spend_pct');
    expect(ks[ks.indexOf('orders') + 1]).toBe('orders_pct');
    expect(ks[ks.indexOf('value') + 1]).toBe('value_pct');
    expect(ks).toHaveLength(17);
  });

  it('Google 列名变体：Campaign ROAS、年龄不带后缀', () => {
    expect(G_CMP_COLS.find((c) => c.k === 'roas_s')!.name).toBe('ROAS');
    expect(G_AGE_COLS.find((c) => c.k === 'orders')!.name).toBe('订单');
    expect(G_AGE_COLS.find((c) => c.k === 'vs')!.name).toBe('转化价值');
    expect(G_DUAL_COLS.map((c) => c.k)).toContain('va');
    expect(G_SPU_COLS.map((c) => c.k)).not.toContain('va');
  });
});

describe('枚举映射与素材编号', () => {
  it('gTypeName：小写英文桶键 → 展示名，未知键原样回退', () => {
    expect(gTypeName('pmax')).toBe('PMax');
    expect(gTypeName('demandgen')).toBe('Demand Gen');
    expect(gTypeName('other')).toBe('other');
  });

  it('adCodeOf：XSP/XPH 编码提取（大小写不敏感、无编码为空）', () => {
    expect(adCodeOf('XSP123-爆品视频')).toBe('XSP123');
    expect(adCodeOf('xph456_Image')).toBe('XPH456');
    expect(adCodeOf('普通广告名')).toBe('');
    expect(adCodeOf('')).toBe('');
  });

  it('SUB_DEFS 三组子分类，typeName 与 name 对应', () => {
    expect(SUB_DEFS.map((s) => s.key)).toEqual(['kol', 'xsp', 'xph']);
    expect(SUB_DEFS.map((s) => s.typeName)).toEqual(['红人素材', '视频广告', '图片广告']);
    for (const s of SUB_DEFS) {
      expect(s.order.length).toBeGreaterThan(0);
      expect(s.alt.order.length).toBeGreaterThan(0);
    }
  });

  it('TH_TIP 双渠道文案互斥（std 不混入 Google 专属键）', () => {
    for (const k of ['vs', 'va', 'roas_s', 'roas_a']) {
      expect(TH_TIP[k].std).toBe('');
      expect(TH_TIP[k].g).not.toBe('');
    }
    expect(TH_TIP.spend.std).toContain('Meta');
    expect(TH_TIP.spend.g).toContain('Google');
  });
});
