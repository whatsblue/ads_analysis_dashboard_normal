/**
 * 图表 option 工厂（迁移自原型 trendOption/gTrendOpt/objLines/dualTip 及各条形/环形图配置）。
 * 全部为纯函数：视图组装数据后调用，BaseChart 只负责渲染。
 */
import { addMetrics, derive, deriveG, fmtMoney, fmtRoas, zero, type Metrics } from '@ads/shared';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface BucketData {
  keys: string[];
  rows: Metrics[];
}

/** 日/月/年桶键（原型 bucketKey） */
export function bucketKey(d: string, g: 'day' | 'month' | 'year'): string {
  return g === 'day' ? d : g === 'month' ? d.slice(0, 7) : d.slice(0, 4);
}

/** 桶聚合（原型 bucketAgg）：valFn 返回某日的指标，null 跳过 */
export function bucketAgg(days: string[], g: 'day' | 'month' | 'year', valFn: (d: string) => Metrics | null): BucketData {
  const seen: string[] = [];
  const o: Record<string, Metrics> = {};
  for (const d of days) {
    const k = bucketKey(d, g);
    if (!o[k]) {
      o[k] = zero();
      seen.push(k);
    }
    const v = valFn(d);
    if (v) addMetrics(o[k], v);
  }
  return { keys: seen, rows: seen.map((k) => o[k]) };
}

/** 悬浮提示分区：花费（柱）与 ROAS（线）分组展示（原型 dualTip） */
export function dualTip(ps: any[]): string {
  if (!ps || !ps.length) return '';
  const bars: any[] = [];
  const lines: any[] = [];
  ps.forEach((p) => (p.seriesType === 'bar' ? bars : lines).push(p));
  const esc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  let h = '<b>' + esc(ps[0].axisValueLabel || ps[0].name || '') + '</b>';
  const grp = (arr: any[], fmt: (v: number) => string, label: string): void => {
    const rows: string[] = [];
    arr.forEach((p) => {
      const v = p.value;
      if (v == null || isNaN(v)) return;
      rows.push(
        '<div style="margin-top:2px">' + p.marker + ' ' + esc(p.seriesName) +
          '<span style="float:right;margin-left:24px;font-weight:600">' + fmt(v) + '</span></div>',
      );
    });
    if (!rows.length) return;
    h += '<div style="margin-top:6px;padding-top:4px;border-top:1px solid #eef1f6;font-weight:700;color:#41506a">' + label + '</div>' + rows.join('');
  };
  grp(bars, fmtMoney, '花费($)');
  grp(lines, fmtRoas, 'ROAS');
  return h;
}

export interface ObjLinesSpec {
  names: string[];
  colors: string[];
  /** bucketKey → name → Metrics */
  map: Record<string, Record<string, Metrics>>;
  order: string[];
  /** true：ROAS 分子取 vs（Google），否则 value */
  g?: boolean;
}

/** 多对象 ROAS 虚线（颜色与对应柱一致；原型 objLines） */
export function objLines(o: ObjLinesSpec): any[] {
  return o.names.map((nm, i) => ({
    name: nm,
    type: 'line',
    yAxisIndex: 1,
    smooth: true,
    symbol: 'circle',
    symbolSize: 5,
    itemStyle: { color: o.colors[i % o.colors.length] },
    lineStyle: { width: 1.5, type: 'dashed' },
    data: o.order.map((k) => {
      const m = (o.map[k] || {})[nm];
      if (!m || !m.spend) return null;
      const v = o.g ? m.vs : m.value;
      return +((v / m.spend) as number).toFixed(2);
    }),
  }));
}

/** 花费&ROAS 双轴图（Meta 口径；原型 trendOption） */
export function trendOption(bk: BucketData, barSeries: any[], objs?: ObjLinesSpec): Record<string, unknown> {
  const roas = bk.rows.map((m) => (m.spend ? +((m.value / m.spend) as number).toFixed(2) : null));
  const lines = objs ? objLines(objs) : [];
  const showTotal = !objs;
  const legendData = barSeries.map((s) => s.name);
  const lg: any[] = [{ top: 2, type: 'scroll', data: legendData }];
  if (showTotal) lg.push({ top: 28, data: ['ROAS'] });
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: dualTip },
    legend: lg,
    grid: { left: 56, right: 56, top: showTotal ? 62 : 36, bottom: 28 },
    xAxis: { type: 'category', data: bk.keys },
    yAxis: [
      { type: 'value', name: '花费($)', splitLine: { lineStyle: { color: '#eef1f6' } } },
      { type: 'value', name: 'ROAS', position: 'right', splitLine: { show: false } },
    ],
    series: barSeries.concat(lines, showTotal
      ? [{ name: 'ROAS', type: 'line', yAxisIndex: 1, data: roas, smooth: true, itemStyle: { color: '#f59e0b' }, lineStyle: { width: 2.5 } }]
      : []),
  };
}

/** Google 双口径花费&ROAS 双轴图（roas_s 实线 + roas_a 虚线；原型 gTrendOpt） */
export function gTrendOpt(bk: BucketData, barSeries: any[], objs?: ObjLinesSpec): Record<string, unknown> {
  const roasS = bk.rows.map((m) => {
    const g = deriveG(m);
    return g && g.roas_s ? +g.roas_s.toFixed(2) : null;
  });
  const roasA = bk.rows.map((m) => {
    const g = deriveG(m);
    return g && g.roas_a ? +g.roas_a.toFixed(2) : null;
  });
  const lines = objs ? objLines(objs) : [];
  const showTotal = !objs;
  const lg: any[] = [{ top: 2, type: 'scroll', data: barSeries.map((s) => s.name) }];
  if (showTotal) lg.push({ top: 28, data: ['ROAS(Shopify)', 'ROAS(Ads后台)'] });
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: dualTip },
    legend: lg,
    grid: { left: 56, right: 56, top: showTotal ? 62 : 36, bottom: 28 },
    xAxis: { type: 'category', data: bk.keys },
    yAxis: [
      { type: 'value', name: '花费($)', splitLine: { lineStyle: { color: '#eef1f6' } } },
      { type: 'value', name: 'ROAS', position: 'right', splitLine: { show: false } },
    ],
    series: barSeries.concat(lines, showTotal
      ? [
          { name: 'ROAS(Shopify)', type: 'line', yAxisIndex: 1, smooth: true, itemStyle: { color: '#f97316' }, lineStyle: { width: 2.5 }, data: roasS },
          { name: 'ROAS(Ads后台)', type: 'line', yAxisIndex: 1, smooth: true, itemStyle: { color: '#fbbf24' }, lineStyle: { width: 2.5, type: 'dashed' }, data: roasA },
        ]
      : []),
  };
}

/** 横向条形图（大值在顶；原型各 ROAS 对比图）；colors 非空时逐条着色；layout 覆盖大盘专属版式（原型 chartCad2） */
export function hBarOption(
  labels: string[],
  values: number[],
  color: string,
  axisName = 'ROAS',
  seriesName?: string,
  colors?: string[],
  layout?: { grid?: { left: number; right: number; top: number; bottom: number }; barMaxWidth?: number; axisNameLocation?: 'middle'; axisNameGap?: number },
): Record<string, unknown> {
  return {
    tooltip: { trigger: 'axis' },
    grid: layout?.grid ?? { left: 96, right: 44, top: 10, bottom: 26 },
    xAxis: {
      type: 'value',
      name: axisName,
      ...(layout?.axisNameLocation ? { nameLocation: layout.axisNameLocation, nameGap: layout.axisNameGap } : {}),
    },
    yAxis: { type: 'category', data: labels, inverse: true },
    series: [
      {
        name: seriesName,
        type: 'bar',
        barMaxWidth: layout?.barMaxWidth ?? 20,
        itemStyle: { color, borderRadius: [0, 3, 3, 0] },
        data: colors ? values.map((v, i) => ({ value: v, itemStyle: { color: colors[i % colors.length], borderRadius: [0, 3, 3, 0] } })) : values,
        label: { show: true, position: 'right', fontSize: 11 },
      },
    ],
  };
}

/** 双系列横向条形图（Google 广告类型双口径 ROAS 对比；原型 renderG1 chartG2c） */
export function dualHBarOption(
  labels: string[],
  s1: { name: string; color: string; values: number[] },
  s2: { name: string; color: string; values: number[] },
  axisName = 'ROAS',
): Record<string, unknown> {
  const mk = (s: { name: string; color: string; values: number[] }): any => ({
    name: s.name,
    type: 'bar',
    barMaxWidth: 14,
    itemStyle: { color: s.color, borderRadius: [0, 3, 3, 0] },
    data: s.values,
  });
  return {
    tooltip: { trigger: 'axis' },
    legend: { top: 2 },
    grid: { left: 100, right: 40, top: 30, bottom: 26 },
    xAxis: { type: 'value', name: axisName },
    yAxis: { type: 'category', data: labels, inverse: true },
    series: [mk(s1), mk(s2)],
  };
}

/** 环形占比图（原型 pie 系列：花费/订单/转化价值切换；data 项可带 itemStyle 逐项着色）；大盘与 g1 花费分布用 42%/68%@50%,45%（原型 chartCad1/chartG1） */
export function donutOption(
  data: { name: string; value: number; itemStyle?: Record<string, unknown> }[],
  radius: [string, string] = ['45%', '70%'],
  center: [string, string] = ['50%', '46%'],
): Record<string, unknown> {
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0 },
    series: [
      {
        type: 'pie',
        radius,
        center,
        itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
        label: { formatter: '{b}\n{d}%' },
        data,
      },
    ],
  };
}

/** 派生指标取值（图表数据准备：null 安全） */
export function derived(mode: 'std' | 'g', m: Metrics): Record<string, number> {
  const d = mode === 'g' ? deriveG(m) : derive(m);
  return (d ?? {}) as unknown as Record<string, number>;
}
