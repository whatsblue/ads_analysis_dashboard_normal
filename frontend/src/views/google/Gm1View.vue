<script setup lang="ts">
/**
 * Google · 大盘健康度（原型 renderGm1）：双口径 banner + KPI 6 项（含品牌词花费占比）
 * + 双口径花费&ROAS 趋势 + 大盘明细（hover 归因）。
 */
import { computed, onMounted, ref } from 'vue';
import { addMetrics, dateRange, deriveG, fmtMoney, fmtPct, fmtRoas, zero, type Metrics } from '@ads/shared';
import { useDataStore } from '@/stores/data';
import { useFilterStore } from '@/stores/filter';
import { withCmps, type TableRow } from '@/composables/useRows';
import { bucketAgg, gTrendOpt } from '@/specs/charts';
import { G_CMP_COLS } from '@/specs/columns';
import BaseChart from '@/components/BaseChart.vue';
import KpiCard from '@/components/KpiCard.vue';
import MetricsTable from '@/components/MetricsTable.vue';

const data = useDataStore();
const filter = useFilterStore();
const ready = ref(false);

onMounted(async () => {
  await data.init();
  await data.ensure('googleAcc', 'googleType', 'googleSpu', 'googleDim');
  ready.value = true;
});

/** 品牌词聚合（原型 aggBrand）：typeBrand 桶按 brand 位合并 */
function aggBrand(b: string, s: string, e: string): Metrics {
  const src = data.gRowsRange(s, e, '');
  const m = zero();
  for (const k of Object.keys(src)) if (k.split('|')[1] === b) addMetrics(m, src[k]);
  return m;
}

const all = computed<Metrics>(() => {
  void filter.applied.version;
  return data.gTotRange(filter.applied.start, filter.applied.end);
});

const prev = computed<Metrics | null>(() => {
  void filter.applied.version;
  if (!filter.applied.cmpOn) return null;
  const rg = filter.cmpRanges[0];
  return rg ? data.gTotRange(rg.start, rg.end) : null;
});

const kpis = computed(() => {
  const dG = deriveG(all.value)!;
  const dP = prev.value ? deriveG(prev.value) : null;
  const s = filter.applied.start;
  const e = filter.applied.end;
  const bw = aggBrand('brand', s, e);
  const brandPct = all.value.spend ? (bw.spend / all.value.spend) * 100 : 0;
  let brandPctP: number | null = null;
  if (prev.value) {
    const rg = filter.cmpRanges[0];
    const bp = aggBrand('brand', rg.start, rg.end);
    brandPctP = prev.value.spend ? (bp.spend / prev.value.spend) * 100 : 0;
  }
  return [
    { title: '花费', value: fmtMoney(all.value.spend), cur: dG.spend, prev: dP ? dP.spend : null },
    { title: 'ROAS(Shopify)', value: fmtRoas(dG.roas_s), cur: dG.roas_s, prev: dP ? dP.roas_s : null },
    { title: 'ROAS(Ads后台)', value: fmtRoas(dG.roas_a), cur: dG.roas_a, prev: dP ? dP.roas_a : null },
    { title: 'CVR', value: fmtPct(dG.cvr), cur: dG.cvr, prev: dP ? dP.cvr : null },
    { title: '客单价', value: fmtMoney(dG.aov), cur: dG.aov, prev: dP ? dP.aov : null },
    { title: '品牌词花费占比', value: brandPct.toFixed(2) + '%', cur: brandPct, prev: brandPctP },
  ];
});

/* ================= 双口径趋势 ================= */

const gran = ref<'day' | 'month' | 'year'>('day');

const trendOpt = computed(() => {
  void filter.applied.version;
  const bk = bucketAgg(dateRange(filter.applied.start, filter.applied.end), gran.value, (d) => data.gTotDate(d));
  return gTrendOpt(bk, [
    { name: '花费', type: 'bar', barMaxWidth: 26, itemStyle: { color: '#10b981', borderRadius: [3, 3, 0, 0] }, data: bk.rows.map((m) => +m.spend.toFixed(2)) },
  ]);
});

/* ================= 大盘明细 ================= */

const rows = computed<TableRow[]>(() => {
  void filter.applied.version;
  const s = filter.applied.start;
  const e = filter.applied.end;
  const rs: TableRow[] = [{ label: s + ' ~ ' + e, m: data.gTotRange(s, e) }];
  return withCmps(rs, (_r, _i, rg) => data.gTotRange(rg.start, rg.end));
});
</script>

<template>
  <template v-if="ready">
    <div class="ptitle"><h2>◎ 大盘健康度</h2></div>
    <div class="banner">ⓘ Google 双口径：<b>Shopify attribution</b>（考核）vs <b>Ads 后台</b>（投放优化）</div>
    <div class="kpis">
      <KpiCard v-for="k in kpis" :key="k.title" :title="k.title" :value="k.value" :cur="k.cur" :prev="k.prev" />
    </div>
    <div class="card">
      <div class="card-h">
        <span>Google 花费 &amp; ROAS 趋势</span>
        <span class="seg mini">
          <button v-for="g in (['day', 'month', 'year'] as const)" :key="g" :class="{ on: gran === g }" @click="gran = g">
            {{ g === 'day' ? '按日' : g === 'month' ? '按月' : '按年' }}
          </button>
        </span>
      </div>
      <div class="card-b"><BaseChart :option="trendOpt" /></div>
    </div>
    <MetricsTable
      tid="gm1"
      title="大盘明细"
      first-col="日期"
      :rows="rows"
      mode="g"
      :cols="G_CMP_COLS"
      no-pct
      date-inline
      attr-on
      :day-fn="(_r, d) => data.gTotDate(d)"
    />
  </template>
</template>
