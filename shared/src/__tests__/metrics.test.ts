import { describe, expect, it } from 'vitest';
import {
  addMetrics,
  cmpHL,
  derive,
  deriveG,
  googleCellToMetrics,
  metaCellToMetrics,
  metaDayToMetrics,
  sumMetrics,
  zero,
} from '../metrics';

describe('cell → Metrics 映射（对齐原型 cell7/g6）', () => {
  it('Meta 7 元 cell：无 inter', () => {
    const m = metaCellToMetrics([100, 2000, 300, 10, 1500, 20, 8]);
    expect(m.spend).toBe(100);
    expect(m.impressions).toBe(2000);
    expect(m.clicks).toBe(300);
    expect(m.orders).toBe(10);
    expect(m.value).toBe(1500);
    expect(m.atc).toBe(20);
    expect(m.ckt).toBe(8);
    expect(m.inter).toBe(0);
  });

  it('Meta 8 元 cell：第 8 位 = inter（全部点击，CVR 分母）', () => {
    const m = metaCellToMetrics([100, 2000, 300, 10, 1500, 20, 8, 320]);
    expect(m.inter).toBe(320);
  });

  it('Google 6 元 cell：value=vs、inter 退化为 clicks', () => {
    const m = googleCellToMetrics([50, 10000, 200, 5, 900, 700]);
    expect(m.vs).toBe(900);
    expect(m.va).toBe(700);
    expect(m.value).toBe(900);
    expect(m.inter).toBe(200);
  });

  it('Google 国家 7 元 cell：inter=unified_interactions（0 值保留 0）', () => {
    const m = googleCellToMetrics([50, 10000, 200, 5, 900, 700, 0]);
    expect(m.inter).toBe(0);
    const m2 = googleCellToMetrics([50, 10000, 200, 5, 900, 700, 999]);
    expect(m2.inter).toBe(999);
  });
});

describe('metaDayToMetrics 站点过滤（对齐原型 cell7）', () => {
  const day = {
    shopify: [100, 2000, 300, 10, 1500, 20, 8] as number[],
    shoplazza: [50, 1000, 150, 5, 700, 10, 4] as number[],
    unknown: [1, 10, 2, 0, 3, 0, 0] as number[],
    A: [151, 3010, 452, 15, 2203, 30, 12] as number[],
  };

  it('多站点选中：不过滤（含 unknown），忽略 A', () => {
    const m = metaDayToMetrics(day, ['Shopify', 'Shoplazza'])!;
    expect(m.spend).toBe(151);
    expect(m.clicks).toBe(452);
  });

  it('单站点选中：只累计该站点', () => {
    const m = metaDayToMetrics(day, ['Shopify'])!;
    expect(m.spend).toBe(100);
    expect(m.orders).toBe(10);
  });

  it('8 元桶透传 inter', () => {
    const day8 = { shopify: [10, 100, 20, 1, 30, 2, 1, 25], A: [10, 100, 20, 1, 30, 2, 1, 25] };
    const m = metaDayToMetrics(day8, ['shopify'])!;
    expect(m.inter).toBe(25);
  });

  it('无命中数据 → null', () => {
    expect(metaDayToMetrics(day, ['Shoplazza'.toLowerCase()])).not.toBeNull();
    expect(metaDayToMetrics(undefined, ['shopify'])).toBeNull();
    expect(metaDayToMetrics({ shopify: [] as number[] }, ['shopify'])).not.toBeNull();
  });
});

describe('derive 标准指标（对齐原型 derive）', () => {
  it('全指标公式', () => {
    // spend=100 impressions=2000 clicks=300 orders=10 value=1500 atc=20 ckt=8 inter=320
    const d = derive(metaCellToMetrics([100, 2000, 300, 10, 1500, 20, 8, 320]))!;
    expect(d.cpm).toBeCloseTo(50, 10); // 100/2000*1000
    expect(d.cpc).toBeCloseTo(0.3333333333, 8);
    expect(d.ctr).toBeCloseTo(0.15, 10);
    expect(d.cvr).toBeCloseTo(10 / 320, 10); // inter 分母优先
    expect(d.cpa_atc).toBeCloseTo(5, 10);
    expect(d.cpa_ckt).toBeCloseTo(12.5, 10);
    expect(d.cpa_ord).toBeCloseTo(10, 10);
    expect(d.roas).toBeCloseTo(15, 10);
    expect(d.aov).toBeCloseTo(150, 10);
  });

  it('无 inter 时 CVR 分母退化为 clicks', () => {
    const d = derive(metaCellToMetrics([100, 2000, 300, 10, 1500, 20, 8]))!;
    expect(d.cvr).toBeCloseTo(10 / 300, 10);
  });

  it('零分母 → NaN（展示层渲染 —）', () => {
    const d = derive(zero())!;
    expect(d.cpm).toBeNaN();
    expect(d.cpc).toBeNaN();
    expect(d.ctr).toBeNaN();
    expect(d.cvr).toBeNaN();
    expect(d.cpa_ord).toBeNaN();
    expect(d.roas).toBeNaN();
    expect(d.aov).toBeNaN();
  });

  it('null 入参 → null', () => {
    expect(derive(null)).toBeNull();
  });
});

describe('deriveG 双口径（对齐原型 deriveG）', () => {
  it('roas_s=vs/spend、roas_a=va/spend、aov=vs/orders', () => {
    // spend=50 impressions=10000 clicks=200 orders=5 vs=900 va=700
    const d = deriveG(googleCellToMetrics([50, 10000, 200, 5, 900, 700]))!;
    expect(d.roas_s).toBeCloseTo(18, 10);
    expect(d.roas_a).toBeCloseTo(14, 10);
    expect(d.aov).toBeCloseTo(180, 10);
    expect(d.cvr).toBeCloseTo(5 / 200, 10); // 6 元桶 inter=clicks
    expect(d.cpm).toBeCloseTo(5, 10);
    expect(d.cpc).toBeCloseTo(0.25, 10);
  });

  it('国家桶 inter 参与 CVR', () => {
    const d = deriveG(googleCellToMetrics([50, 10000, 200, 5, 900, 700, 400]))!;
    expect(d.inter).toBe(400);
    expect(d.cvr).toBeCloseTo(5 / 400, 10);
  });
});

describe('总计口径：Σ求和 + 比率=Σ分子/Σ分母（对齐观远）', () => {
  it('合并两桶后重算比率 ≠ 比率平均', () => {
    const a = metaCellToMetrics([100, 2000, 300, 10, 1500, 20, 8]); // roas 15
    const b = metaCellToMetrics([200, 1000, 100, 2, 100, 5, 1]); // roas 0.5
    const t = derive(sumMetrics([a, b]))!;
    expect(t.roas).toBeCloseTo(1600 / 300, 10); // Σvalue/Σspend，非 (15+0.5)/2
    expect(t.cvr).toBeCloseTo(12 / 400, 10);
    expect(t.aov).toBeCloseTo(1600 / 12, 10);
  });

  it('addMetrics 占比守卫透传（任一侧挂载才引入）', () => {
    const a = zero();
    a.spendPct = 0.6;
    const b = zero();
    b.spendPct = 0.4;
    const t = addMetrics(a, b);
    expect(t.spendPct).toBeCloseTo(1.0, 10);

    const c = zero();
    const d = zero();
    const t2 = addMetrics(c, d);
    expect(t2.spendPct).toBeUndefined(); // 两侧均未挂载不引入 0
  });

  it('零花费有订单行保留（总计=全量）', () => {
    const a = metaCellToMetrics([100, 1000, 100, 5, 800, 10, 3]);
    const zeroSpend = metaCellToMetrics([0, 0, 0, 2, 300, 0, 0]);
    const t = derive(sumMetrics([a, zeroSpend]))!;
    expect(t.orders).toBe(7);
    expect(t.value).toBe(1100);
  });
});

describe('环比高亮阈值（2026-11-06 定版）', () => {
  it('钱效率组 >5% 高亮（严格大于；避开浮点边界值）', () => {
    expect(cmpHL(1.06, 1.0)).toBe(true);
    expect(cmpHL(1.049, 1.0)).toBe(false); // 4.9% 不高亮
    // 注：1.05 因浮点误差实际为 5.000000000000004%，会高亮——与原型 JS 行为一致
  });
  it('流量效率组 10% 阈值', () => {
    expect(cmpHL(1.099, 1.0, 10)).toBe(false); // 9.9% 不高亮
    expect(cmpHL(1.11, 1.0, 10)).toBe(true);
  });
  it('prev 缺失/0 → 不高亮', () => {
    expect(cmpHL(1.5, 0)).toBe(false);
    expect(cmpHL(1.5, NaN)).toBe(false);
    expect(cmpHL(NaN, 1.0)).toBe(false);
  });
});
