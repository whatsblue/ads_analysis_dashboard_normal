<script setup lang="ts">
/**
 * Meta · 素材效率（原型 renderM4/renderTop/renderM4Sub/renderM4Sub2）：
 * 主态=类型 ROAS 对比+占比环形（指标切换）+类型明细（linkFirst 下钻）+子分类双表（sub/sub2 桶）；
 * 下钻态=Top 素材分析（素材编号行组展开、广告名筛选），返回恢复类型筛选。
 */
import { computed, onMounted, ref } from 'vue';
import { addMetrics, derive, zero, type Metrics } from '@ads/shared';
import { useDataStore } from '@/stores/data';
import { useFilterStore, pickKeys } from '@/stores/filter';
import { withCmps, type TableRow } from '@/composables/useRows';
import { donutOption, hBarOption } from '@/specs/charts';
import { SUB_DEFS } from '@/specs/columns';
import type { PreCell, PreCol } from '@/components/MetricsTable.vue';
import BaseChart from '@/components/BaseChart.vue';
import MultiDropdown from '@/components/MultiDropdown.vue';
import MetricsTable from '@/components/MetricsTable.vue';

const data = useDataStore();
const filter = useFilterStore();
const ready = ref(false);

onMounted(async () => {
  await data.init();
  await data.ensure('metaCreative', 'metaAd');
  ready.value = true;
});

/* ================= 类型筛选（主态即时生效；下钻保存/恢复） ================= */

const typeSel = ref<string[]>([]);
const typeExcl = ref(false);
const drill = ref<string | null>(null);
let saved: { sel: string[]; excl: boolean } | null = null;

function typeOK(t: string): boolean {
  return typeExcl.value ? typeSel.value.length > 0 && !typeSel.value.includes(t) : !typeSel.value.length || typeSel.value.includes(t);
}

function enterDrill(code: string): void {
  if (!saved) saved = { sel: typeSel.value.slice(), excl: typeExcl.value };
  typeExcl.value = false;
  typeSel.value = [code];
  drill.value = code;
}

function exitDrill(): void {
  if (saved) {
    typeExcl.value = saved.excl;
    typeSel.value = saved.sel.slice();
    saved = null;
  }
  drill.value = null;
}

/* ================= 主态：类型聚合与图表 ================= */

const typeAgg = computed<Record<string, Metrics>>(() => {
  void filter.applied.version;
  return data.metaDimRange('ctype', filter.applied.start, filter.applied.end);
});

const typeKeys = computed<string[]>(() => {
  void filter.applied.version;
  const tAgg = typeAgg.value;
  return (pickKeys(typeSel.value, typeExcl.value, data.types) || data.types)
    .slice()
    .sort((x, y) => (tAgg[y] ? tAgg[y].spend : 0) - (tAgg[x] ? tAgg[x].spend : 0));
});

const typeRows = computed<TableRow[]>(() => {
  void filter.applied.version;
  const tAgg = typeAgg.value;
  const rows = typeKeys.value.map((k) => ({ code: k, label: k, m: tAgg[k] || zero() }));
  return withCmps(rows, (r, _i, rg) => data.metaDimRange('ctype', rg.start, rg.end)[String(r.code)] ?? zero());
});

const roasOpt = computed(() => {
  void filter.applied.version;
  const tAgg = typeAgg.value;
  const byRoas = typeKeys.value.slice().sort((x, y) => (derive(tAgg[y] || zero())!.roas || 0) - (derive(tAgg[x] || zero())!.roas || 0));
  return hBarOption(
    byRoas,
    byRoas.map((k) => +((derive(tAgg[k] || zero())!.roas || 0).toFixed(2))),
    '#10b981',
  );
});

const typeMet = ref<'spend' | 'orders' | 'value'>('spend');

const pieOpt = computed(() => {
  void filter.applied.version;
  const tAgg = typeAgg.value;
  return donutOption(
    typeKeys.value.map((k) => {
      const m = tAgg[k] || zero();
      return { name: k, value: typeMet.value === 'orders' ? Math.round(m.orders) : +((typeMet.value === 'value' ? m.value : m.spend) as number).toFixed(2) };
    }),
  );
});

/* ================= 主态：子分类双表 ================= */

const subTab = ref<'kol' | 'xsp' | 'xph'>('kol');

const subDef = computed(() => SUB_DEFS.find((x) => x.key === subTab.value) as (typeof SUB_DEFS)[number]);

function subCmp(sub2: boolean): (r: TableRow, _i: number, rg: { start: string; end: string }) => Metrics {
  return (r, _i, rg) => {
    const a = data.subRows(sub2, subDef.value.typeName, sub2 ? subDef.value.alt.order : subDef.value.order, rg.start, rg.end);
    return a.find((x) => x.label === r.label)?.m ?? zero();
  };
}

const sub1Rows = computed<TableRow[]>(() => {
  void filter.applied.version;
  const d = subDef.value;
  const rows = data.subRows(false, d.typeName, d.order, filter.applied.start, filter.applied.end);
  return withCmps(rows, subCmp(false));
});

const sub2Rows = computed<TableRow[]>(() => {
  void filter.applied.version;
  const d = subDef.value;
  const rows = data.subRows(true, d.typeName, d.alt.order, filter.applied.start, filter.applied.end);
  return withCmps(rows, subCmp(true));
});

/* ================= 下钻态：Top 素材分析 ================= */

const adSel = ref<string[]>([]);
const adExcl = ref(false);

const adNames = computed(() => data.adList.map((a) => a[0]));

const drillTitle = computed(() => {
  const ex = typeExcl.value && typeSel.value.length;
  if (ex) return 'Top 素材分析 · 排除后 ' + (data.types.length - typeSel.value.length) + ' 个类型';
  if (typeSel.value.length === 1) return 'Top 素材分析 · ' + typeSel.value[0];
  return 'Top 素材分析 · ' + (typeSel.value.length ? typeSel.value.length + ' 个类型' : '全部类型');
});

interface TopRow extends TableRow {
  key: string;
  code: string;
  name: string;
  items: number[];
}

const topRows = computed<TopRow[]>(() => {
  void filter.applied.version;
  const s = filter.applied.start;
  const e = filter.applied.end;
  const pk = pickKeys(adSel.value, adExcl.value, adNames.value);
  const rows = data.collectTop(s, e, pk).filter((g) => typeOK(g.type));
  return withCmps(rows as unknown as TopRow[], (r, _i, rg) => {
    const m = zero();
    for (const i of r.items) addMetrics(m, data.adAgg(i, rg.start, rg.end));
    return m;
  });
});

const topPre = computed<PreCol[]>(() => [
  {
    name: '素材编号',
    w: '130px',
    get: (r): PreCell | string => {
      const g = r as unknown as TopRow;
      if (!g.code) return '—';
      if (g.items.length < 2) return { text: g.code, tip: '单条广告，无可展开明细' };
      return { text: g.code, expandable: true, expKey: g.key, expCount: g.items.length };
    },
  },
  {
    name: '广告名称',
    get: (r): string => (r as unknown as TopRow).name,
  },
]);

function topExpOf(r: TableRow): { label: string; m: Metrics }[] {
  void filter.applied.version;
  const g = r as unknown as TopRow;
  return g.items
    .map((i) => ({ label: data.adList[i][0], m: data.adAgg(i, filter.applied.start, filter.applied.end) }))
    .sort((x, y) => y.m.orders - x.m.orders);
}

function topDayFn(r: TableRow, d: string): Metrics {
  const m = zero();
  for (const i of (r as unknown as TopRow).items) {
    const c = data.adMetrics(i, d);
    if (c) addMetrics(m, c);
  }
  return m;
}
</script>

<template>
  <template v-if="ready">
    <div class="ptitle">
      <h2>◎ 素材效率</h2>
      <span class="frow">
        <MultiDropdown all-name="素材类型" :items="data.types" :selected="typeSel" :excl="typeExcl" clearable @change="(sel, ex) => { typeSel = sel; typeExcl = ex; }" />
      </span>
    </div>

    <!-- 主态 -->
    <template v-if="drill === null">
      <div class="two">
        <div class="card"><div class="card-h">素材类型 ROAS 对比</div><div class="card-b"><BaseChart :option="roasOpt" sm /></div></div>
        <div class="card">
          <div class="card-h">
            <span>素材类型占比</span>
            <span class="seg mini">
              <button v-for="m in ([['spend', '花费'], ['orders', '订单'], ['value', '购物转化价值']] as const)" :key="m[0]" :class="{ on: typeMet === m[0] }" @click="typeMet = m[0]">{{ m[1] }}</button>
            </span>
          </div>
          <div class="card-b"><BaseChart :option="pieOpt" sm /></div>
        </div>
      </div>

      <MetricsTable
        tid="m4a"
        title="素材类型明细"
        first-col="素材类型"
        :rows="typeRows"
        link-first
        first-tip="点击下钻查看该类型 Top 素材"
        :day-fn="(r, d) => data.metaDimDate('ctype', d)[String(r.code)] || zero()"
        @link="enterDrill"
      >
        <template #head-note>
          <span style="font-weight: 400; color: var(--sub); font-size: 11px; margin-left: 8px">点击「素材类型」名称下钻查看该类型 Top 素材</span>
        </template>
      </MetricsTable>

      <div class="card">
        <div class="card-h">
          <span>素材子分类明细</span>
          <span class="seg mini" style="margin-left: 12px">
            <button v-for="d in SUB_DEFS" :key="d.key" :class="{ on: subTab === d.key }" @click="subTab = d.key">{{ d.name }}</button>
          </span>
        </div>
      </div>
      <MetricsTable
        tid="m4sub"
        :title="subDef.t1"
        no-card
        head-style="padding-top: 4px"
        first-col="子分类"
        :rows="sub1Rows"
        :sort-col="null"
        :day-fn="(r, d) => data.subDay(false, subDef.typeName, r.label, d)"
      />
      <MetricsTable
        tid="m4sub2"
        :title="subDef.alt.title"
        no-card
        head-style="border-top: 1px solid var(--line)"
        first-col="子分类"
        :rows="sub2Rows"
        :sort-col="null"
        :day-fn="(r, d) => data.subDay(true, subDef.typeName, r.label, d)"
      />
    </template>

    <!-- 下钻态：Top 素材分析 -->
    <template v-else>
      <MetricsTable
        tid="m4c"
        :title="drillTitle"
        export-name="Top 素材分析"
        first-col="素材类型"
        :rows="topRows"
        no-pct
        :pre="topPre"
        sort-col="orders"
        :exp-of="topExpOf"
        :day-fn="topDayFn"
      >
        <template #head-pre>
          <button class="btn xs" @click="exitDrill">← 返回素材类型明细</button>
        </template>
        <template #below-head>
          <div class="frow" style="padding: 10px 16px 0">
            <MultiDropdown label="广告名称" all-name="广告" :items="adNames" :selected="adSel" :excl="adExcl" clearable @change="(sel, ex) => { adSel = sel; adExcl = ex; }" />
          </div>
        </template>
      </MetricsTable>
    </template>
  </template>
</template>
