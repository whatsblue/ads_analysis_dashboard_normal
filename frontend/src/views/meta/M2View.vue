<script setup lang="ts">
/**
 * Meta · 账号定位（原型 renderM2）：
 * 账号排行明细（占比列分母=Meta 全部账号合计，不受账号筛选缩放）
 * + Campaign 明细（零花费但有订单/销售行保留；卡级广告系列筛选即时生效）。
 */
import { computed, onMounted, ref } from 'vue';
import { zero } from '@ads/shared';
import { useDataStore } from '@/stores/data';
import { useFilterStore } from '@/stores/filter';
import { pickKeys } from '@/stores/filter';
import { withCmps, type TableRow } from '@/composables/useRows';
import { M2A_COLS, M2A_GMAP } from '@/specs/columns';
import MultiDropdown from '@/components/MultiDropdown.vue';
import MetricsTable from '@/components/MetricsTable.vue';

const data = useDataStore();
const filter = useFilterStore();
const ready = ref(false);

onMounted(async () => {
  await data.init();
  await data.ensure('metaAcc', 'metaCamp');
  ready.value = true;
});

/* ================= 账号排行（占比分母=全部账号合计） ================= */

const accRows = computed<TableRow[]>(() => {
  void filter.applied.version;
  const s = filter.applied.start;
  const e = filter.applied.end;
  const allow = filter.applied.metaAccounts;
  const accs = allow ? data.metaAccounts.filter((a) => allow.includes(a)) : data.metaAccounts;
  const rows = accs.map((a) => ({ label: a, m: data.metaAccRange(a, s, e) }));
  rows.sort((x, y) => y.m.spend - x.m.spend);
  return withCmps(rows, (r, _i, rg) => data.metaAccRange(r.label, rg.start, rg.end));
});

/* ================= Campaign 明细（卡级筛选即时生效） ================= */

const cmpSel = ref<string[]>([]);
const cmpExcl = ref(false);

const campRows = computed<TableRow[]>(() => {
  void filter.applied.version;
  const s = filter.applied.start;
  const e = filter.applied.end;
  const agg = data.metaDimRange('camp', s, e);
  const pk = pickKeys(cmpSel.value, cmpExcl.value, data.metaCampaigns);
  const keys = Object.keys(agg)
    .filter((k) => {
      const m0 = agg[k];
      // 零花费但有订单/销售的行保留，保证总计=全量（同观远）
      if (m0.spend <= 0 && m0.orders <= 0 && m0.value <= 0) return false;
      if (pk && !pk.includes(k)) return false;
      return true;
    })
    .sort((x, y) => agg[y].spend - agg[x].spend);
  const rows = keys.map((k) => ({ label: k, m: agg[k] }));
  return withCmps(rows, (r, _i, rg) => data.metaDimRange('camp', rg.start, rg.end)[r.label] ?? zero());
});
</script>

<template>
  <template v-if="ready">
    <div class="ptitle"><h2>◎ 账号定位</h2></div>

    <MetricsTable
      tid="m2a"
      title="账号排行明细"
      first-col="账号名称"
      :rows="accRows"
      :cols="M2A_COLS"
      :gmap="M2A_GMAP"
      :day-fn="(r, d) => data.metaAccDay(r.label, d)"
    />

    <MetricsTable tid="m2b" title="Campaign 明细" first-col="Campaign 名称" :rows="campRows" no-pct>
      <template #head-extra>
        <MultiDropdown
          all-name="广告系列"
          :items="data.metaCampaigns"
          :selected="cmpSel"
          :excl="cmpExcl"
          clearable
          @change="(sel, ex) => { cmpSel = sel; cmpExcl = ex; }"
        />
      </template>
    </MetricsTable>
  </template>
</template>
