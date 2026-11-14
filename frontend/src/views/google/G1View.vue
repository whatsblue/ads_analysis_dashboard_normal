<script setup lang="ts">
/**
 * Google · 广告类型分析（原型 renderG1）：类型花费分布 + 双口径 ROAS 对比（双系列条形）
 * + 广告类型明细 + 是否品牌词明细（aggBrand）。
 */
import { computed, onMounted, ref } from 'vue';
import { addMetrics, deriveG, zero, type Metrics } from '@ads/shared';
import { useDataStore } from '@/stores/data';
import { useFilterStore } from '@/stores/filter';
import { withCmps, type TableRow } from '@/composables/useRows';
import { donutOption, dualHBarOption } from '@/specs/charts';
import { gTypeName, G_DUAL_COLS } from '@/specs/columns';
import BaseChart from '@/components/BaseChart.vue';
import MetricsTable from '@/components/MetricsTable.vue';

const data = useDataStore();
const filter = useFilterStore();
const ready = ref(false);

onMounted(async () => {
  await data.init();
  await data.ensure('googleType');
  ready.value = true;
});

/** 品牌词聚合（原型 aggBrand） */
function aggBrand(src: Record<string, Metrics>, b: string): Metrics {
  const m = zero();
  for (const k of Object.keys(src)) if (k.split('|')[1] === b) addMetrics(m, src[k]);
  return m;
}

/* ================= 类型聚合 ================= */

const typeAgg = computed<Record<string, Metrics>>(() => {
  void filter.applied.version;
  return data.gTypeAgg(filter.applied.start, filter.applied.end);
});

const typeKeys = computed(() => {
  void filter.applied.version;
  const ta = typeAgg.value;
  return Object.keys(ta).sort((x, y) => ta[y].spend - ta[x].spend);
});

const typeRows = computed<TableRow[]>(() => {
  void filter.applied.version;
  const rows = typeKeys.value.map((ty) => ({ label: gTypeName(ty), _ty: ty, m: typeAgg.value[ty] }));
  return withCmps(rows, (r, _i, rg) => data.gTypeAgg(rg.start, rg.end)[String(r._ty)] ?? zero());
});

/* ================= 品牌词聚合 ================= */

const brandRows = computed<TableRow[]>(() => {
  void filter.applied.version;
  const s = filter.applied.start;
  const e = filter.applied.end;
  const src = data.gRowsRange(s, e, '');
  const rows = [
    { key: 'brand', label: 'brand', m: aggBrand(src, 'brand') },
    { key: 'no brand', label: 'no brand', m: aggBrand(src, 'no brand') },
    { key: 'unknown', label: 'unknown', m: aggBrand(src, 'unknown') },
  ];
  return withCmps(rows, (r, _i, rg) => aggBrand(data.gRowsRange(rg.start, rg.end, ''), String(r.key)));
});

/* ================= 图表 ================= */

const pieOpt = computed(() => {
  void filter.applied.version;
  /* 大盘同款版式（原型 chartG1：radius 42%/68% center 50%,45%） */
  return donutOption(
    typeKeys.value.map((ty) => ({ name: gTypeName(ty), value: +typeAgg.value[ty].spend.toFixed(2) })),
    ['42%', '68%'],
    ['50%', '45%'],
  );
});

const roasOpt = computed(() => {
  void filter.applied.version;
  const rk = typeKeys.value
    .slice()
    .sort((x, y) => (deriveG(typeAgg.value[y])!.roas_s || 0) - (deriveG(typeAgg.value[x])!.roas_s || 0));
  return dualHBarOption(
    rk.map(gTypeName),
    { name: 'ROAS(Shopify)', color: '#f97316', values: rk.map((ty) => +((deriveG(typeAgg.value[ty])!.roas_s || 0).toFixed(2))) },
    { name: 'ROAS(Ads后台)', color: '#fbbf24', values: rk.map((ty) => +((deriveG(typeAgg.value[ty])!.roas_a || 0).toFixed(2))) },
  );
});
</script>

<template>
  <template v-if="ready">
    <div class="ptitle"><h2>◎ 广告类型分析</h2></div>
    <div class="banner">ⓘ Google 有两套数据口径：<b>Ads 后台</b>（平台回传，用于投放优化）vs <b>Shopify attribution</b>（实际订单）。考核以 Shopify 为准。</div>
    <div class="two">
      <div class="card"><div class="card-h">Google 广告类型花费分布</div><div class="card-b"><BaseChart :option="pieOpt" sm /></div></div>
      <div class="card"><div class="card-h">Google 广告类型 ROAS 对比</div><div class="card-b"><BaseChart :option="roasOpt" sm /></div></div>
    </div>
    <MetricsTable
      tid="g1"
      title="广告类型明细"
      first-col="广告类型"
      :rows="typeRows"
      mode="g"
      :cols="G_DUAL_COLS"
      :day-fn="(r, d) => data.gTypeAgg(d, d)[String(r._ty)] || zero()"
    />
    <MetricsTable
      tid="g1b"
      title="广告类型明细 · 是否品牌词"
      export-name="是否品牌词明细"
      first-col="是否品牌词"
      :rows="brandRows"
      mode="g"
      :cols="G_DUAL_COLS"
      :day-fn="(r, d) => aggBrand(data.gRowsRange(d, d, ''), String(r.key))"
    />
  </template>
</template>
