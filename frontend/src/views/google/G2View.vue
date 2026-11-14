<script setup lang="ts">
/**
 * Google · 国家维度（原型 renderG2）：默认花费 Top5；国家名纯文本（2026-11-04 定版）。
 */
import { computed, onMounted, ref } from 'vue';
import { useDataStore } from '@/stores/data';
import { useFilterStore } from '@/stores/filter';
import { pickKeys } from '@/stores/filter';
import { withCmps, type TableRow } from '@/composables/useRows';
import { G_CMP_COLS } from '@/specs/columns';
import MultiDropdown from '@/components/MultiDropdown.vue';
import MetricsTable from '@/components/MetricsTable.vue';

const data = useDataStore();
const filter = useFilterStore();
const ready = ref(false);

onMounted(async () => {
  await data.init();
  await data.ensure('googleDim');
  ready.value = true;
});

const ctySel = ref<string[]>([]);
const ctyExcl = ref(false);

const ctyTop5 = computed(() => {
  void filter.applied.version;
  const s = filter.applied.start;
  const e = filter.applied.end;
  return data.countries
    .map((ct) => ({ ct, m: data.gCtyRange(ct, s, e) }))
    .filter((r) => r.m.spend > 0)
    .sort((x, y) => y.m.spend - x.m.spend)
    .slice(0, 5)
    .map((r) => r.ct);
});

const ctyRows = computed<TableRow[]>(() => {
  void filter.applied.version;
  const s = filter.applied.start;
  const e = filter.applied.end;
  const keys = pickKeys(ctySel.value, ctyExcl.value, data.countries) || ctyTop5.value;
  const rows = keys.map((ct) => ({ label: ct, m: data.gCtyRange(ct, s, e) }));
  rows.sort((x, y) => y.m.spend - x.m.spend);
  return withCmps(rows, (r, _i, rg) => data.gCtyRange(r.label, rg.start, rg.end));
});
</script>

<template>
  <template v-if="ready">
    <div class="ptitle">
      <h2>◎ 国家维度</h2>
      <span class="frow">
        <MultiDropdown
          all-name="国家"
          :items="data.countries"
          :selected="ctySel"
          :excl="ctyExcl"
          clearable
          :empty-text="() => (ctyTop5.length ? ctyTop5.slice(0, 2).join(',') + (ctyTop5.length > 2 ? ' 等' + ctyTop5.length + '项' : '') : '全部国家')"
          @change="(sel, ex) => { ctySel = sel; ctyExcl = ex; }"
        />
      </span>
    </div>

    <MetricsTable
      tid="g2"
      title="国家对比明细"
      export-name="Google × 国家"
      first-col="国家"
      :rows="ctyRows"
      mode="g"
      :cols="G_CMP_COLS"
      :day-fn="(r, d) => data.gCtyRange(r.label, d, d)"
    />
  </template>
</template>
