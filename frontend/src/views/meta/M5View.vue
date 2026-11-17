<script setup lang="ts">
/**
 * Meta · 国家维度（原型 renderM5/renderM5T/renderM5B）：
 * 趋势对比（指标 10 项多选上限 2 + 地区 A/B 单选，默认美国 vs 非美国·花费）
 * + US/Non-US 拆分两行表 + 国家对比明细（默认花费 Top5）。
 * 趋势图 2026-11-15 用户定版：去单次加购/单次结帐；上限 2 项，先点柱状（左轴）后点折线（右轴）；颜色按国家分组（同国柱线同色）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
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
  document.addEventListener('click', closeDd);
  document.addEventListener('keydown', onEsc);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', closeDd);
  document.removeEventListener('keydown', onEsc);
});

function closeDd(): void {
  ddOpen.value = '';
}
function onEsc(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeDd();
}

/* ================= 趋势对比（原型 renderM5T；2026-11-14 用户定版：去卡头粒度切换固定按日，指标支持多选多线） ================= */

const trendMs = ref<string[]>(['spend', 'roas']);

/** 单选 Shoplazza 站点（2026-11-17 用户定版：该站点下隐藏 US & Non-US 对比明细，趋势对比默认地区改为 AE/SA） */
const isSls = computed(() => filter.applied.sites.length === 1 && filter.applied.sites[0] === 'Shoplazza');

const trendA = ref(isSls.value ? 'AE' : 'United States');
const trendB = ref(isSls.value ? 'SA' : '非美国');
/* 切换销售站点时重置为该站点默认对比地区（Shoplazza=AE/SA，其余=US/Non-US） */
watch(
  () => filter.applied.sites.join(','),
  () => {
    trendA.value = isSls.value ? 'AE' : 'United States';
    trendB.value = isSls.value ? 'SA' : '非美国';
  },
);
const ddOpen = ref<'' | 'm' | 'a' | 'b'>('');

function ctyLbl(nm: string): string {
  if (nm === data.usKey) return 'US';
  return nm === '非美国' ? 'Non-US' : nm;
}

/** 地区聚合：'非美国'=全部国家合计−美国（data.ctyAgg）；显示名→内部键归一（US/United States） */
function ctyAggDay(d: string, nm: string): Metrics {
  const key = nm === 'Non-US' || nm === '非美国' ? '非美国' : nm === 'US' || nm === 'United States' ? data.usKey : nm;
  return data.ctyAgg(data.metaDimDate('ctry', d), key);
}

const metDefs = computed(() =>
  // 按 trendMs 点击顺序取 def（2026-11-15 定版：先点=柱，不能用定义序重排）
  trendMs.value
    .map((k) => CTY_TREND_METRICS.find((m) => m.k === k))
    .filter((m): m is (typeof CTY_TREND_METRICS)[number] => m !== undefined),
);

const trendTitle = computed(() => (metDefs.value.length ? metDefs.value.map((m) => m.name).join('/') : CTY_TREND_METRICS[0].name) + '趋势对比');

const metricBtnText = computed(() => {
  const names = metDefs.value.map((m) => m.name);
  return names.length ? names.join(',') : '至多选2项';
});

/** 指标多选 toggle（点击不关面板，外点关闭）；上限 2（满 2 项再点替换最早选中，保持先点=柱），至少保留一项 */
function toggleMetric(k: string): void {
  if (trendMs.value.includes(k)) {
    if (trendMs.value.length === 1) return;
    trendMs.value = trendMs.value.filter((x) => x !== k);
  } else {
    trendMs.value = trendMs.value.length >= 2 ? [...trendMs.value.slice(1), k] : [...trendMs.value, k];
  }
}

/** 国家下拉显示名（美国用简称 US，2026-11-14 用户定版；仅影响显示，选中值仍为原始键） */
function ctySelLb(k: string): string {
  return k === data.usKey ? 'US' : k;
}

/** 下拉仅列当前筛选范围内有投放（花费>0）的国家——全历史宇宙累计 108 项，含大量已停投国家的全 0 可选项 */
const ctyItems = computed(() => {
  void filter.applied.version;
  const o = data.metaDimRange('ctry', filter.applied.start, filter.applied.end);
  return data.countries.filter((k) => (o[k]?.spend ?? 0) > 0);
});

const regionOpts = computed(() => ['非美国', data.usKey, ...ctyItems.value.filter((c) => c !== data.usKey)]);

const trendOpt = computed(() => {
  void filter.applied.version;
  const names = [trendA.value, trendB.value];
  const labels = names.map(ctyLbl);
  const defs = metDefs.value.length ? metDefs.value : [CTY_TREND_METRICS[0]];
  const order: string[] = [];
  const bk: Record<string, Record<string, Metrics>> = {};
  for (const d of dateRange(filter.applied.start, filter.applied.end)) {
    const k = bucketKey(d, 'day');
    if (!bk[k]) {
      bk[k] = {};
      order.push(k);
    }
    for (const nm of names) {
      const t = (bk[k][nm] ??= zero());
      addMetrics(t, ctyAggDay(d, nm));
    }
  }
  /* 2026-11-15 定版：颜色按国家分组（A/B 各一色，同国柱线同色）；系列序=先国家后指标；
     两指标时首指标（先点）柱状挂左轴、次指标折线挂右轴（金额与比率量级分离），单指标维持折线单轴 */
  const dual = defs.length >= 2;
  const ctyColors = ['#5470c6', '#91cc75'];
  const fmtMap: Record<string, (v: number) => string> = {};
  const series = labels.flatMap((lb, ri) =>
    defs.map((md, mi) => {
      const name = defs.length > 1 ? md.name + '·' + lb : lb;
      fmtMap[name] = md.fmt;
      const isBar = dual && mi === 0;
      const base = {
        name,
        type: isBar ? ('bar' as const) : ('line' as const),
        itemStyle: { color: ctyColors[ri] },
        data: order.map((k) => {
          const v = (derive(bk[k][names[ri]]) as unknown as Record<string, number>)[md.k];
          return v == null || isNaN(v) ? null : +v.toFixed(2);
        }),
      };
      return isBar
        ? base
        : { ...base, smooth: true, symbol: 'circle', symbolSize: 5, lineStyle: { width: 2 }, yAxisIndex: dual ? 1 : 0 };
    }),
  );
  return {
    tooltip: {
      trigger: 'axis',
      formatter: (ps: { axisValueLabel?: string; name?: string; marker: string; seriesName: string; value: number | null }[]): string => {
        if (!ps.length) return '';
        let h = '<b>' + (ps[0].axisValueLabel || ps[0].name || '') + '</b>';
        for (const p of ps) {
          const fmt = fmtMap[p.seriesName];
          h += '<div style="margin-top:2px">' + p.marker + ' ' + p.seriesName +
            '<span style="float:right;margin-left:24px;font-weight:600">' + (p.value == null || !fmt ? '—' : fmt(p.value)) + '</span></div>';
        }
        return h;
      },
    },
    legend: { data: series.map((s) => s.name), top: 0 },
    grid: { left: 56, right: dual ? 56 : 20, top: 30, bottom: 26 },
    xAxis: { type: 'category', data: order },
    yAxis: dual
      ? [
          { type: 'value', scale: true },
          { type: 'value', scale: true, splitLine: { show: false } },
        ]
      : { type: 'value', scale: true },
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
  const us = ctyLbl(data.usKey);
  const rows = [
    { label: us, m: cAgg.value[data.usKey] || zero() },
    { label: 'Non-US', m: data.ctyAgg(cAgg.value, '非美国') },
  ];
  return withCmps(rows, (r, _i, rg) => {
    const o = data.metaDimRange('ctry', rg.start, rg.end);
    return r.label === us ? o[data.usKey] || zero() : data.ctyAgg(o, '非美国');
  });
});

/* ================= 国家对比明细（全量进表，初始 Top10 加载更多；2026-11-16 业务更新，原默认 Top5） ================= */

const ctySel = ref<string[]>([]);
const ctyExcl = ref(false);

const ctyRows = computed<TableRow[]>(() => {
  void filter.applied.version;
  const a = cAgg.value;
  const top = Object.keys(a)
    .filter((k) => a[k].spend > 0)
    .sort((x, y) => a[y].spend - a[x].spend);
  const keys = pickKeys(ctySel.value, ctyExcl.value, data.countries) || top;
  const rows = keys.map((k) => ({ label: k, m: a[k] || zero() }));
  return withCmps(rows, (r, _i, rg) => data.metaDimRange('ctry', rg.start, rg.end)[r.label] ?? zero());
});
</script>

<template>
  <template v-if="ready">
    <div class="ptitle"><h2>◎ 国家维度</h2></div>

    <div class="card">
      <div class="card-h">
        <span>{{ trendTitle }}</span>
        <span style="display: flex; gap: 6px; align-items: center; font-weight: 400">
          <span class="dd"><button @click.stop="ddOpen = ddOpen === 'm' ? '' : 'm'">{{ metricBtnText }}<span style="color: var(--sub); font-weight: 400; margin-left: 5px; font-size: 12px">至多选2项</span></button>
            <div v-if="ddOpen === 'm'" class="dd-panel cty-panel" @click.stop>
              <div v-for="m in CTY_TREND_METRICS" :key="m.k" class="cty-opt" :class="{ on: trendMs.includes(m.k) }" @click="toggleMetric(m.k)">{{ m.name }}</div>
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

    <!-- Shoplazza 站点下隐藏（2026-11-17 用户定版）：US/Non-US 拆分对该站点无意义 -->
    <MetricsTable
      v-if="!isSls"
      tid="m5b"
      title="US & Non-US 对比明细"
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
          :items="ctyItems"
          :selected="ctySel"
          :excl="ctyExcl"
          clearable
          allow-all
          :label-fn="ctySelLb"
          @change="(sel, ex) => { ctySel = sel; ctyExcl = ex; }"
        />
      </template>
    </MetricsTable>
  </template>
</template>
