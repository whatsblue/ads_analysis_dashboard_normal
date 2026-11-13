<script setup lang="ts">
/**
 * Google · 商品投产（原型 renderGm3）：SPU 排行默认 Top6；
 * 订单/转化价值取平台口径（G_SPU_COLS，std derive，桶位 value=vs）。
 */
import { computed, onMounted, ref } from 'vue';
import { useDataStore } from '@/stores/data';
import { useFilterStore } from '@/stores/filter';
import { pickKeys } from '@/stores/filter';
import { withCmps, type TableRow } from '@/composables/useRows';
import { G_SPU_COLS } from '@/specs/columns';
import MultiDropdown from '@/components/MultiDropdown.vue';
import MetricsTable from '@/components/MetricsTable.vue';

const data = useDataStore();
const filter = useFilterStore();
const ready = ref(false);

onMounted(async () => {
  await data.init();
  await data.ensure('googleSpu');
  ready.value = true;
});

const spuSel = ref<string[]>([]);
const spuExcl = ref(false);

const spuTop = computed(() =>
  data.gSpus
    .slice()
    .sort((x, y) => data.gSpuRange(y, filter.applied.start, filter.applied.end).spend - data.gSpuRange(x, filter.applied.start, filter.applied.end).spend),
);

const spuRows = computed<TableRow[]>(() => {
  void filter.applied.version;
  const s = filter.applied.start;
  const e = filter.applied.end;
  const keys = pickKeys(spuSel.value, spuExcl.value, data.gSpus) || spuTop.value.slice(0, 6);
  const rows = keys.map((k) => ({ label: k, m: data.gSpuRange(k, s, e) }));
  return withCmps(rows, (r, _i, rg) => data.gSpuRange(r.label, rg.start, rg.end));
});
</script>

<template>
  <template v-if="ready">
    <div class="ptitle">
      <h2>◎ 商品投产</h2>
      <span class="frow">
        <MultiDropdown all-name="SPU" :items="data.gSpus" :selected="spuSel" :excl="spuExcl" clearable @change="(sel, ex) => { spuSel = sel; spuExcl = ex; }" />
      </span>
    </div>

    <MetricsTable
      tid="gm3"
      title="SPU 排行"
      first-col="SPU"
      :rows="spuRows"
      :cols="G_SPU_COLS"
      no-total
      no-hl
      :day-fn="(r, d) => data.gSpuRange(r.label, d, d)"
      :tips="{
        orders: '订单：Google Ads 平台转化（platform_orders）',
        value: '转化价值：Google Ads 平台回传（platform_conversion_value）',
        cpa_ord: '单次购买＝花费÷平台订单',
        roas: 'ROAS＝平台转化价值÷花费',
        aov: '客单价＝平台转化价值÷平台订单',
        cvr: 'CVR＝平台订单÷点击',
      }"
    />
  </template>
</template>
