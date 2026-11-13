<script setup lang="ts">
/**
 * 大盘总览（原型 renderOv/renderOvT/renderCa/ovExport）：
 * 总览矩阵（整站 GMV=易仓）+ 花费&ROAS 趋势（Meta/Google 并排柱+ROAS 虚线）
 * + 渠道花费占比/ROAS 对比 + 渠道对比明细表（Google atc/ckt=0、hover 归因）。
 */
import { computed, onMounted, ref } from 'vue';
import { dateRange, derive, esc, fmtMoney, fmtPct, fmtRoas, type Metrics } from '@ads/shared';
import { useDataStore } from '@/stores/data';
import { useFilterStore } from '@/stores/filter';
import { withCmps, type TableRow } from '@/composables/useRows';
import { bucketAgg, donutOption, hBarOption, trendOption, type ObjLinesSpec } from '@/specs/charts';
import { downloadXls, plainPct } from '@/utils/export';
import BaseChart from '@/components/BaseChart.vue';
import MetricsTable from '@/components/MetricsTable.vue';

const data = useDataStore();
const filter = useFilterStore();
const ready = ref(false);

/** hover 归因需要全部维度桶（ca 表 Δ 格五维度） */
onMounted(async () => {
  await data.init();
  await data.ensure('metaAcc', 'metaSpu', 'metaCreative', 'metaDim', 'googleAcc', 'googleSpu', 'googleType', 'googleDim');
  ready.value = true;
});

const CH_CLS: Record<string, string> = { Meta: 'm', Google: 'g', EDM: 'e' };
const CH_COLOR: Record<string, string> = { Meta: '#5470c6', Google: '#91cc75' };

/* ================= 大盘总览矩阵（原型 ovRows） ================= */

interface OvRow {
  nm: string;
  paid: boolean;
  m: Metrics;
  pct: number;
}

const ov = computed(() => {
  void filter.applied.version;
  const cur = data.ovCalc(filter.applied.start, filter.applied.end);
  const chGmv = cur.meta.value + cur.goog.value + cur.edm.value;
  const rows: OvRow[] = [cur.meta, cur.goog, cur.edm].map((m, i) => ({
    nm: (['Meta', 'Google', 'EDM'] as const)[i],
    paid: i < 2,
    m,
    pct: chGmv ? m.value / chGmv : NaN,
  }));
  const siteRoas = cur.siteSpend ? cur.gmv / cur.siteSpend : NaN;
  return { cur, rows, siteRoas };
});

function roasOf(m: Metrics): number {
  return m.spend ? m.value / m.spend : NaN;
}

/* ================= 花费&ROAS 趋势（原型 renderOvT） ================= */

const gran = ref<'day' | 'month' | 'year'>('day');

const ovTOpt = computed(() => {
  void filter.applied.version;
  const days = dateRange(filter.applied.start, filter.applied.end);
  const mBk = bucketAgg(days, gran.value, (d) => data.chDaily('Meta', d));
  const gBk = bucketAgg(days, gran.value, (d) => data.chDaily('Google', d));
  const tot = bucketAgg(days, gran.value, (d) => {
    const a = data.chDaily('Meta', d);
    const b = data.chDaily('Google', d);
    return {
      ...a,
      spend: a.spend + b.spend,
      impressions: a.impressions + b.impressions,
      clicks: a.clicks + b.clicks,
      orders: a.orders + b.orders,
      value: a.value + b.value,
      atc: a.atc + b.atc,
      ckt: a.ckt + b.ckt,
      vs: a.vs + b.vs,
      va: a.va + b.va,
      inter: a.inter + b.inter,
    };
  });
  const map: Record<string, Record<string, Metrics>> = {};
  mBk.keys.forEach((k, i) => (map[k] = { Meta: mBk.rows[i] }));
  gBk.keys.forEach((k, i) => (map[k].Google = gBk.rows[i]));
  const series = [
    { name: 'Meta', type: 'bar' as const, barMaxWidth: 26, itemStyle: { color: CH_COLOR.Meta, borderRadius: [3, 3, 0, 0] }, data: mBk.rows.map((m) => +m.spend.toFixed(2)) },
    { name: 'Google', type: 'bar' as const, barMaxWidth: 26, itemStyle: { color: CH_COLOR.Google, borderRadius: [3, 3, 0, 0] }, data: gBk.rows.map((m) => +m.spend.toFixed(2)) },
  ];
  const objs: ObjLinesSpec = { names: ['Meta', 'Google'], colors: [CH_COLOR.Meta, CH_COLOR.Google], map, order: tot.keys };
  return trendOption(tot, series, objs);
});

/* ================= 渠道花费占比 / ROAS 对比 ================= */

const spendOpt = computed(() => {
  void filter.applied.version;
  return donutOption(
    (['Meta', 'Google'] as const).map((ch) => ({
      name: ch,
      value: +data.chRange(ch, filter.applied.start, filter.applied.end).spend.toFixed(2),
      itemStyle: { color: CH_COLOR[ch] },
    })),
  );
});

const roasOpt = computed(() => {
  void filter.applied.version;
  const prs = (['Meta', 'Google'] as const)
    .map((ch) => ({ ch, v: +(derive(data.chRange(ch, filter.applied.start, filter.applied.end))!.roas || 0).toFixed(2) }))
    .sort((a, b) => b.v - a.v);
  return hBarOption(
    prs.map((p) => p.ch),
    prs.map((p) => p.v),
    '#5470c6',
    'ROAS',
    undefined,
    prs.map((p) => CH_COLOR[p.ch]),
  );
});

/* ================= 渠道对比明细（原型 renderCa） ================= */

function chM(ch: string, s: string, e: string): Metrics {
  const m = data.chRange(ch as 'Meta' | 'Google' | 'EDM', s, e);
  if (ch === 'Google') {
    m.atc = 0;
    m.ckt = 0;
  }
  return m;
}

const caRows = computed<TableRow[]>(() => {
  void filter.applied.version;
  const s = filter.applied.start;
  const e = filter.applied.end;
  const rows: (TableRow & { ch: string })[] = (['Meta', 'Google', 'EDM'] as const).map((ch) => ({
    ch,
    label: ch,
    m: chM(ch, s, e),
  }));
  rows.sort((a, b) => b.m.spend - a.m.spend);
  return withCmps(rows, (r, _i, rg) => chM(r.ch, rg.start, rg.end));
});

/* ================= 导出（原型 ovExport） ================= */

const cmpPrev = computed(() => (filter.applied.cmpOn ? filter.cmpRanges[0] ?? null : null));

function ovExport(): void {
  const prev = cmpPrev.value;
  const cur = data.ovCalc(filter.applied.start, filter.applied.end);
  const pv = prev ? data.ovCalc(prev.start, prev.end) : null;
  const cmp = !!pv;
  const head = cmp ? ['渠道', '花费', '花费环比', 'GMV', 'GMV环比', 'GMV占比', 'ROAS', 'ROAS环比'] : ['渠道', '花费', 'GMV', 'GMV占比', 'ROAS'];
  const chGmv = cur.meta.value + cur.goog.value + cur.edm.value;
  const arr: string[][] = [head];
  const row = (nm: string, sp: number | null, spP: number | null, gm: number, gmP: number | null, pct: string, ro: number | null, roP: number | null): void => {
    const r2 = [nm, sp == null ? '—' : fmtMoney(sp)];
    if (cmp) r2.push(pv && spP != null ? plainPct(sp, spP) : '');
    r2.push(fmtMoney(gm));
    if (cmp) r2.push(pv && gmP != null ? plainPct(gm, gmP) : '');
    r2.push(pct, ro == null || isNaN(ro) ? '—' : fmtRoas(ro));
    if (cmp) r2.push(pv && roP != null && !isNaN(roP) ? plainPct(ro, roP) : '');
    arr.push(r2);
  };
  row('整站', cur.siteSpend, pv ? pv.siteSpend : null, cur.gmv, pv ? pv.gmv : null, '—', cur.siteSpend ? cur.gmv / cur.siteSpend : NaN, pv && pv.siteSpend ? pv.gmv / pv.siteSpend : NaN);
  row('Meta', cur.meta.spend, pv ? pv.meta.spend : null, cur.meta.value, pv ? pv.meta.value : null, fmtPct(chGmv ? cur.meta.value / chGmv : NaN), roasOf(cur.meta), pv ? roasOf(pv.meta) : NaN);
  row('Google', cur.goog.spend, pv ? pv.goog.spend : null, cur.goog.value, pv ? pv.goog.value : null, fmtPct(chGmv ? cur.goog.value / chGmv : NaN), roasOf(cur.goog), pv ? roasOf(pv.goog) : NaN);
  row('EDM', null, null, cur.edm.value, pv ? pv.edm.value : null, fmtPct(chGmv ? cur.edm.value / chGmv : NaN), null, null);
  downloadXls(arr.map((r) => r.map((c) => esc(c))), '大盘总览');
}
</script>

<template>
  <template v-if="ready">
    <div class="ptitle"><h2>◎ 大盘</h2></div>

    <div class="card">
      <div class="card-h">
        <span>大盘总览</span>
        <button class="btn xs exp-btn" @click="ovExport">⇩ 导出</button>
      </div>
      <div class="card-b tbl-scroll">
        <table class="matrix">
          <thead>
            <tr><th>渠道</th><th>花费</th><th>GMV</th><th>GMV占比</th><th>ROAS</th></tr>
          </thead>
          <tbody>
            <tr class="ov-total">
              <td>整站</td>
              <td><div class="dv"><span>{{ fmtMoney(ov.cur.siteSpend) }}</span></div></td>
              <td><div class="dv"><span>{{ fmtMoney(ov.cur.gmv) }}</span></div></td>
              <td>—</td>
              <td><div class="dv"><span>{{ fmtRoas(ov.siteRoas) }}</span></div></td>
            </tr>
            <tr v-for="r in ov.rows" :key="r.nm">
              <td>
                <span class="chip" :class="CH_CLS[r.nm]">{{ r.nm }}</span>
                <span v-if="r.nm === 'EDM'" class="chip e">无广告花费</span>
              </td>
              <td><div class="dv"><span>{{ r.paid ? fmtMoney(r.m.spend) : '—' }}</span></div></td>
              <td><div class="dv"><span>{{ fmtMoney(r.m.value) }}</span></div></td>
              <td>{{ fmtPct(r.pct) }}</td>
              <td><div class="dv"><span>{{ r.paid ? fmtRoas(roasOf(r.m)) : '—' }}</span></div></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-h">
        <span>花费 &amp; ROAS 趋势</span>
        <span class="seg mini">
          <button v-for="g in (['day', 'month', 'year'] as const)" :key="g" :class="{ on: gran === g }" @click="gran = g">
            {{ g === 'day' ? '按日' : g === 'month' ? '按月' : '按年' }}
          </button>
        </span>
      </div>
      <div class="card-b"><BaseChart :option="ovTOpt" /></div>
    </div>

    <div class="two">
      <div class="card"><div class="card-h">渠道花费占比</div><div class="card-b"><BaseChart :option="spendOpt" sm /></div></div>
      <div class="card"><div class="card-h">渠道 ROAS 对比</div><div class="card-b"><BaseChart :option="roasOpt" sm /></div></div>
    </div>

    <MetricsTable
      tid="ca"
      title="渠道对比明细"
      first-col="渠道"
      :rows="caRows"
      :day-fn="(r, d) => chM(String(r.ch), d, d)"
      attr-on
    >
      <template #first="{ row }">
        <span class="chip" :class="CH_CLS[String(row.ch)]">{{ row.label }}</span>
        <span v-if="row.ch === 'EDM'" class="chip e">无广告花费</span>
      </template>
    </MetricsTable>
  </template>
</template>
