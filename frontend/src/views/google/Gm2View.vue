<script setup lang="ts">
/**
 * Google · 账号定位（原型 renderGm2）：账号排行明细 + Campaign 明细（卡级广告系列筛选）。
 */
import { computed, onMounted, ref } from 'vue';
import { useDataStore } from '@/stores/data';
import { useFilterStore } from '@/stores/filter';
import { pickKeys } from '@/stores/filter';
import { withCmps, type TableRow } from '@/composables/useRows';
import { G_ACC_COLS, G_CMP_COLS } from '@/specs/columns';
import MultiDropdown from '@/components/MultiDropdown.vue';
import MetricsTable from '@/components/MetricsTable.vue';

const data = useDataStore();
const filter = useFilterStore();
const ready = ref(false);

onMounted(async () => {
  await data.init();
  await data.ensure('googleAcc', 'googleCmp');
  ready.value = true;
});

/* ================= 账号排行（账号筛选生效） ================= */

const accRows = computed<TableRow[]>(() => {
  void filter.applied.version;
  const s = filter.applied.start;
  const e = filter.applied.end;
  const allow = filter.applied.gAccounts;
  const accs = allow ? data.gAccounts.filter((a) => allow.includes(a)) : data.gAccounts;
  const rows = accs.map((a) => ({ label: a, m: data.gAccRange(a, s, e) }));
  rows.sort((x, y) => y.m.spend - x.m.spend);
  return withCmps(rows, (r, _i, rg) => data.gAccRange(r.label, rg.start, rg.end));
});

/* ================= Campaign 明细 ================= */

const cmpSel = ref<string[]>([]);
const cmpExcl = ref(false);

const campRows = computed<TableRow[]>(() => {
  void filter.applied.version;
  const s = filter.applied.start;
  const e = filter.applied.end;
  const pk = pickKeys(cmpSel.value, cmpExcl.value, data.gCampaigns);
  const rows = (pk || data.gCampaigns).map((cp) => ({ label: cp, m: data.gCmpRange(cp, s, e) }));
  rows.sort((x, y) => y.m.spend - x.m.spend);
  return withCmps(rows, (r, _i, rg) => data.gCmpRange(r.label, rg.start, rg.end));
});
</script>

<template>
  <template v-if="ready">
    <div class="ptitle"><h2>◎ 账号定位</h2></div>

    <MetricsTable
      tid="gm2"
      title="账号排行明细"
      first-col="账号名称"
      :rows="accRows"
      mode="g"
      :cols="G_ACC_COLS"
      :day-fn="(r, d) => data.gAccDay(r.label, d)"
    />

    <MetricsTable tid="gmc" title="Campaign 明细" first-col="Campaign" :rows="campRows" mode="g" :cols="G_CMP_COLS" no-pct>
      <template #head-extra>
        <MultiDropdown
          all-name="广告系列"
          :items="data.gCampaigns"
          :selected="cmpSel"
          :excl="cmpExcl"
          clearable
          @change="(sel, ex) => { cmpSel = sel; cmpExcl = ex; }"
        />
      </template>
    </MetricsTable>
  </template>
</template>
