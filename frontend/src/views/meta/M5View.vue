<script setup lang="ts">
/**
 * Meta · 国家维度（原型 renderM5/renderM5T/renderM5B）：
 * 趋势对比（指标 12 项 + 地区 A/B 单选，默认美国 vs 非美国·花费）
 * + US/Non-US 拆分两行表 + 国家对比明细（默认花费 Top5）。
 */
import { computed, onMounted, ref } from 'vue';
import { addMetrics, dateRange, derive, zero, type Metrics } from '@ads/shared';
import { useDataStore } from '@/stores/data';
import { useFilterStore } from '@/stores/filter';
import { pickKeys } from '@/stores/filter';
import { withCmps, type TableRow } from '@/composables/useRows';
import { bucketKey } from '@/specs/charts';
import { CTY_TREND_METRICS, M5B_COLS, M5B_GMAP } from '@/specs/columns';
import BaseChart from '@/components/BaseChart.vue';
import MultiDropdown from '@/components/MultiDropdown.vue';
import MetricsTable from '@/components/MetricsTable.vue';

const data = useDataStore();
const filter = useFilterStore();
const ready = ref(false);

onMounted(async () => {
  await data.init();
  await data.ensure('metaDim');
  trendA.value = data.usKey;
  ready.value = true;
});

/* ================= 趋势对比（原型 renderM5T） ================= */

const trendM = ref('spend');
const trendA = ref('United States');
const trendB = ref('非美国');
const gran = ref<'day' | 'month' | 'year'>('day');
const ddOpen = ref<'' | 'm' | 'a' | 'b'>('');

function ctyLbl(nm: string): string {
  if (nm === data.usKey) return 'United States';
  return nm === '非美国' ? 'Non-US' : nm;
}

/** 地区聚合：'非美国'=全部国家合计−美国（data.ctyAgg） */
function ctyAggDay(d: string, nm: string): Metrics {
  const key = nm === 'Non-US' ? '非美国' : nm === 'United States' ? data.usKey : nm;
  return data.ctyAgg(data.metaDimDate('ctry', d), key);
}

const metDef = computed(() => CTY_TREND_METRICS.find((x) => x.k === trendM.value) || CTY_TREND_METRICS[0]);

const regionOpts = computed(() => ['非美国', data.usKey, ...data.countries.filter((c) => c !== data.usKey)]);

const trendOpt = computed(() => {
  void filter.applied.version;
  const names = [trendA.value, trendB.value];
  const labels = names.map(ctyLbl);
  const order: string[] = [];
  const bk: Record<string, Record<string, Metrics>> = {};
  for (const d of dateRange(filter.applied.start, filter.applied.end)) {
    const k = bucketKey(d, gran.value);
    if (!bk[k]) {
      bk[k] = {};
      order.push(k);
    }
    for (const nm of names) {
      const t = (bk[k][nm] ??= zero());
      addMetrics(t, ctyAggDay(d, nm));
    }
  }
  const colors = ['#5470c6', '#91cc75'];
  const series = labels.map((lb, i) => ({
    name: lb,
    type: 'line' as const,
    smooth: true,
    symbol: 'circle',
    symbolSize: 5,
    itemStyle: { color: colors[i] },
    lineStyle: { width: 2 },
    data: order.map((k) => {
      const v = (derive(bk[k][names[i]]) as unknown as Record<string, number>)[metDef.value.k];
      return v == null || isNaN(v) ? null : +v.toFixed(2);
    }),
  }));
  return {
    tooltip: {
      trigger: 'axis',
      formatter: (ps: { axisValueLabel?: string; name?: string; marker: string; seriesName: string; value: number | null }[]): string => {
        if (!ps.length) return '';
        let h = '<b>' + (ps[0].axisValueLabel || ps[0].name || '') + '</b>';
        for (const p of ps) {
          h += '<div style="margin-top:2px">' + p.marker + ' ' + p.seriesName +
            '<span style="float:right;margin-left:24px;font-weight:600">' + (p.value == null ? '—' : metDef.value.fmt(p.value)) + '</span></div>';
        }
        return h;
      },
    },
    legend: { data: labels, top: 0 },
    grid: { left: 56, right: 20, top: 30, bottom: 26 },
    xAxis: { type: 'category', data: order },
    yAxis: { type: 'value', scale: true },
    series,
  };
});

function pickRegion(which: 'a' | 'b', v: string): void {
  if (which === 'a') trendA.value = v;
  else trendB.value = v;
  ddOpen.value = '';
}

/* ================= US / Non-US 拆分（原型 renderM5B） ================= */

const cAgg = computed<Record<string, Metrics>>(() => {
  void filter.applied.version;
  return data.metaDimRange('ctry', filter.applied.start, filter.applied.end);
});

const usRows = computed<TableRow[]>(() => {
  void filter.applied.version;
  const rows = [
    { label: 'United States', m: cAgg.value[data.usKey] || zero() },
    { label: 'Non-US', m: data.ctyAgg(cAgg.value, '非美国') },
  ];
  return withCmps(rows, (r, _i, rg) => {
    const o = data.metaDimRange('ctry', rg.start, rg.end);
    return r.label === 'United States' ? o[data.usKey] || zero() : data.ctyAgg(o, '非美国');
  });
});

/* ================= 国家对比明细（默认花费 Top5） ================= */

const ctySel = ref<string[]>([]);
const ctyExcl = ref(false);

const ctyTop5 = computed(() => {
  void filter.applied.version;
  const a = cAgg.value;
  return Object.keys(a)
    .filter((k) => a[k].spend > 0)
    .sort((x, y) => a[y].spend - a[x].spend)
    .slice(0, 5);
});

const ctyRows = computed<TableRow[]>(() => {
  void filter.applied.version;
  const a = cAgg.value;
  const top = Object.keys(a)
    .filter((k) => a[k].spend > 0)
    .sort((x, y) => a[y].spend - a[x].spend);
  const keys = pickKeys(ctySel.value, ctyExcl.value, data.countries) || top.slice(0, 5);
  const rows = keys.map((k) => ({ label: k, m: a[k] || zero() }));
  return withCmps(rows, (r, _i, rg) => data.metaDimRange('ctry', rg.start, rg.end)[r.label] ?? zero());
});
</script>

<template>
  <template v-if="ready">
    <div class="ptitle"><h2>◎ 国家维度</h2></div>

    <div class="card">
      <div class="card-h">
        <span>{{ metDef.name }}趋势对比</span>
        <span style="display: flex; gap: 6px; align-items: center; font-weight: 400">
          <span class="seg mini">
            <button v-for="g in (['day', 'month', 'year'] as const)" :key="g" :class="{ on: gran === g }" @click="gran = g">
              {{ g === 'day' ? '按日' : g === 'month' ? '按月' : '按年' }}
            </button>
          </span>
          <span class="dd"><button @click.stop="ddOpen = ddOpen === 'm' ? '' : 'm'">{{ metDef.name }}</button>
            <div v-if="ddOpen === 'm'" class="dd-panel cty-panel" @click.stop>
              <div v-for="m in CTY_TREND_METRICS" :key="m.k" class="cty-opt" :class="{ on: trendM === m.k }" @click="trendM = m.k; ddOpen = ''">{{ m.name }}</div>
            </div></span>
          <span class="dd"><button @click.stop="ddOpen = ddOpen === 'a' ? '' : 'a'">{{ ctyLbl(trendA) }}</button>
            <div v-if="ddOpen === 'a'" class="dd-panel cty-panel" @click.stop>
              <div v-for="o in regionOpts" :key="o" class="cty-opt" :class="{ on: trendA === o }" @click="pickRegion('a', o)">{{ ctyLbl(o) }}</div>
            </div></span>
          <span style="color: var(--sub)">vs</span>
          <span class="dd"><button @click.stop="ddOpen = ddOpen === 'b' ? '' : 'b'">{{ ctyLbl(trendB) }}</button>
            <div v-if="ddOpen === 'b'" class="dd-panel cty-panel" @click.stop>
              <div v-for="o in regionOpts" :key="o" class="cty-opt" :class="{ on: trendB === o }" @click="pickRegion('b', o)">{{ ctyLbl(o) }}</div>
            </div></span>
        </span>
      </div>
      <div class="card-b"><BaseChart :option="trendOpt" /></div>
    </div>

    <MetricsTable
      tid="m5b"
      title="United States / Non-US 拆分明细"
      first-col="分类"
      :rows="usRows"
      :sort-col="null"
      :cols="M5B_COLS"
      :gmap="M5B_GMAP"
      :day-fn="(r, d) => ctyAggDay(d, r.label)"
    />

    <MetricsTable
      tid="m5"
      title="国家对比明细"
      first-col="国家"
      :rows="ctyRows"
      :total-rows="ctyRows"
      :cols="M5B_COLS"
      :gmap="M5B_GMAP"
      :day-fn="(r, d) => data.metaDimDate('ctry', d)[r.label] || zero()"
    >
      <template #head-extra>
        <MultiDropdown
          all-name="国家"
          :items="data.countries"
          :selected="ctySel"
          :excl="ctyExcl"
          clearable
          :empty-text="() => (ctyTop5.length ? ctyTop5.slice(0, 2).join(',') + (ctyTop5.length > 2 ? ' 等' + ctyTop5.length + '项' : '') : '全部国家')"
          @change="(sel, ex) => { ctySel = sel; ctyExcl = ex; }"
        />
      </template>
    </MetricsTable>
  </template>
</template>
