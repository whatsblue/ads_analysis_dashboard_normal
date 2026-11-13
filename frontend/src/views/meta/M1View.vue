<script setup lang="ts">
/**
 * Meta · 大盘健康度（原型 renderM1）：KPI 6 项（环比取首个对比期）
 * + 花费&ROAS 趋势 + 大盘明细单行表（dateInline，hover 归因）。
 */
import { computed, onMounted, ref } from 'vue';
import { dateRange, derive, fmtInt, fmtMoney, fmtPct, fmtRoas, type Metrics } from '@ads/shared';
import { useDataStore } from '@/stores/data';
import { useFilterStore } from '@/stores/filter';
import { withCmps, type TableRow } from '@/composables/useRows';
import { bucketAgg, trendOption } from '@/specs/charts';
import BaseChart from '@/components/BaseChart.vue';
import KpiCard from '@/components/KpiCard.vue';
import MetricsTable from '@/components/MetricsTable.vue';

const data = useDataStore();
const filter = useFilterStore();
const ready = ref(false);

onMounted(async () => {
  await data.init();
  await data.ensure('metaAcc', 'metaSpu', 'metaCreative', 'metaDim');
  ready.value = true;
});

const all = computed<Metrics>(() => {
  void filter.applied.version;
  return data.metaTotRange(filter.applied.start, filter.applied.end);
});

const prev = computed<Metrics | null>(() => {
  void filter.applied.version;
  if (!filter.applied.cmpOn) return null;
  const rg = filter.cmpRanges[0];
  return rg ? data.metaTotRange(rg.start, rg.end) : null;
});

const kpis = computed(() => {
  const dA = derive(all.value)!;
  const dP = prev.value ? derive(prev.value) : null;
  return [
    { title: '花费', value: fmtMoney(all.value.spend), cur: dA.spend, prev: dP ? dP.spend : null },
    { title: '订单', value: fmtInt(all.value.orders), cur: dA.orders, prev: dP ? dP.orders : null },
    { title: '转化价值', value: fmtMoney(all.value.value), cur: dA.value, prev: dP ? dP.value : null },
    { title: 'ROAS', value: fmtRoas(dA.roas), cur: dA.roas, prev: dP ? dP.roas : null },
    { title: '客单价', value: fmtMoney(dA.aov), cur: dA.aov, prev: dP ? dP.aov : null },
    { title: 'CVR', value: fmtPct(dA.cvr), cur: dA.cvr, prev: dP ? dP.cvr : null },
  ];
});

/* ================= 趋势图 ================= */

const gran = ref<'day' | 'month' | 'year'>('day');

const trendOpt = computed(() => {
  void filter.applied.version;
  const bk = bucketAgg(dateRange(filter.applied.start, filter.applied.end), gran.value, (d) => data.metaTotDate(d));
  return trendOption(bk, [
    { name: 'Meta 花费', type: 'bar', barMaxWidth: 26, itemStyle: { color: '#3b82f6', borderRadius: [3, 3, 0, 0] }, data: bk.rows.map((m) => +m.spend.toFixed(2)) },
  ]);
});

/* ================= 大盘明细（单行，dateInline） ================= */

const rows = computed<TableRow[]>(() => {
  void filter.applied.version;
  const s = filter.applied.start;
  const e = filter.applied.end;
  const rs: TableRow[] = [{ label: s + ' ~ ' + e, m: data.metaTotRange(s, e) }];
  return withCmps(rs, (_r, _i, rg) => data.metaTotRange(rg.start, rg.end));
});
</script>

<template>
  <template v-if="ready">
    <div class="ptitle"><h2>◎ 大盘健康度</h2></div>
    <div class="kpis">
      <KpiCard v-for="k in kpis" :key="k.title" :title="k.title" :value="k.value" :cur="k.cur" :prev="k.prev" />
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
      <div class="card-b"><BaseChart :option="trendOpt" /></div>
    </div>
    <MetricsTable
      tid="m1"
      title="大盘明细"
      first-col="日期"
      :rows="rows"
      no-pct
      date-inline
      attr-on
      :day-fn="(_r, d) => data.metaTotDate(d)"
    />
  </template>
</template>
