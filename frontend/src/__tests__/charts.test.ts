import { describe, expect, it } from 'vitest';
import { zero } from '@ads/shared';
import { bucketAgg, bucketKey, dualHBarOption, donutOption, gTrendOpt, hBarOption, objLines, trendOption } from '../specs/charts';

function mk(spend: number, value = 0, vs = 0, va = 0) {
  const m = zero();
  m.spend = spend;
  m.value = value;
  m.vs = vs;
  m.va = va;
  return m;
}

describe('bucketKey/bucketAgg（日/月桶聚合）', () => {
  it('bucketKey 三种粒度', () => {
    expect(bucketKey('2024-05-06', 'day')).toBe('2024-05-06');
    expect(bucketKey('2024-05-06', 'month')).toBe('2024-05');
    expect(bucketKey('2024-05-06', 'year')).toBe('2024');
  });

  it('跨月聚合并保持首次出现顺序；valFn=null 跳过', () => {
    const bk = bucketAgg(['2024-05-01', '2024-05-02', '2024-06-01'], 'month', (d) => (d === '2024-05-02' ? null : mk(10, 5)));
    expect(bk.keys).toEqual(['2024-05', '2024-06']);
    expect(bk.rows[0].spend).toBe(10);
    expect(bk.rows[0].value).toBe(5);
    expect(bk.rows[1].spend).toBe(10);
  });
});

describe('trendOption / gTrendOpt（双轴图工厂）', () => {
  it('Meta：总计 ROAS=value/spend，spend=0 → null；无对象线时 legend 含 ROAS', () => {
    const bk = { keys: ['05-06', '05-07'], rows: [mk(100, 250), mk(0)] };
    const opt = trendOption(bk, [{ name: 'Meta', type: 'bar', data: [100, 0] }]) as Record<string, any>;
    const roas = (opt.series as any[]).find((s) => s.name === 'ROAS');
    expect(roas.data).toEqual([2.5, null]);
    expect((opt.legend as any[]).some((l) => l.data?.includes('ROAS'))).toBe(true);
  });

  it('Google：双口径 roas_s=vs/spend、roas_a=va/spend', () => {
    const bk = { keys: ['05-06'], rows: [mk(100, 0, 250, 300)] };
    const opt = gTrendOpt(bk, [{ name: 'Google', type: 'bar', data: [100] }]) as Record<string, any>;
    const ss = (opt.series as any[]).find((s) => s.name === 'ROAS(Shopify)');
    const aa = (opt.series as any[]).find((s) => s.name === 'ROAS(Ads后台)');
    expect(ss.data).toEqual([2.5]);
    expect(aa.data).toEqual([3]);
  });

  it('objs 传入时不加总计 ROAS 线，改挂对象虚线', () => {
    const bk = { keys: ['05-06'], rows: [mk(100, 200)] };
    const opt = trendOption(bk, [{ name: 'Meta', type: 'bar', data: [100] }], {
      names: ['Meta'],
      colors: ['#3b82f6'],
      map: { '05-06': { Meta: mk(50, 150) } },
      order: ['05-06'],
    }) as Record<string, any>;
    const names = (opt.series as any[]).map((s) => s.name);
    expect(names).not.toContain('ROAS');
    const line = (opt.series as any[]).find((s) => s.name === 'Meta' && s.type === 'line');
    expect(line.data).toEqual([3]);
    expect(line.yAxisIndex).toBe(1);
  });
});

describe('hBarOption / dualHBarOption / donutOption', () => {
  it('hBarOption colors 逐条着色（Ov 渠道色）', () => {
    const opt = hBarOption(['Meta', 'Google'], [2, 1], '#999', 'ROAS', undefined, ['#1877f2', '#ea4335']) as Record<string, any>;
    const data = opt.series[0].data as { value: number; itemStyle: { color: string } }[];
    expect(data[0].itemStyle.color).toBe('#1877f2');
    expect(data[1].itemStyle.color).toBe('#ea4335');
  });

  it('hBarOption 无 colors 时 data 为裸数值', () => {
    const opt = hBarOption(['a'], [1.5], '#10b981') as Record<string, any>;
    expect(opt.series[0].data).toEqual([1.5]);
  });

  it('dualHBarOption 双系列名称/颜色透传', () => {
    const opt = dualHBarOption(
      ['Search', 'PMax'],
      { name: 'ROAS(Shopify)', color: '#f97316', values: [2, 3] },
      { name: 'ROAS(Google)', color: '#fbbf24', values: [1, 4] },
    ) as Record<string, any>;
    expect(opt.series).toHaveLength(2);
    expect(opt.series[0].name).toBe('ROAS(Shopify)');
    expect(opt.series[1].itemStyle.color).toBe('#fbbf24');
  });

  it('donutOption data 项 itemStyle 逐项着色透传', () => {
    const opt = donutOption([
      { name: 'Meta', value: 60, itemStyle: { color: '#1877f2' } },
      { name: 'Google', value: 40 },
    ]) as Record<string, any>;
    expect(opt.series[0].data[0].itemStyle.color).toBe('#1877f2');
    expect(opt.series[0].data[1].itemStyle).toBeUndefined();
  });
});

describe('objLines（对象 ROAS 虚线）', () => {
  it('无花费的桶为 null（断点），g 模式分子取 vs', () => {
    const lines = objLines({
      names: ['Google'],
      colors: ['#ea4335'],
      map: { a: { Google: mk(100, 0, 220, 999) }, b: { Google: mk(0) } },
      order: ['a', 'b'],
      g: true,
    });
    expect(lines[0].data).toEqual([2.2, null]);
  });
});
