<script setup lang="ts">
/**
 * Meta · 商品投产（原型 renderM3）：SPU 排行全量进表（初始 Top10 加载更多）；
 * 有筛选=所选项合计，无筛选=全量合计；SPU 筛选即时生效。
 */
import { computed, onMounted, ref } from 'vue';
import { zero } from '@ads/shared';
import { useDataStore } from '@/stores/data';
import { useFilterStore } from '@/stores/filter';
import { pickKeys } from '@/stores/filter';
import { withCmps, type TableRow } from '@/composables/useRows';
import MultiDropdown from '@/components/MultiDropdown.vue';
import MetricsTable from '@/components/MetricsTable.vue';

const data = useDataStore();
const filter = useFilterStore();
const ready = ref(false);

onMounted(async () => {
  await data.init();
  await data.ensure('metaSpu');
  ready.value = true;
});

const spuSel = ref<string[]>([]);
const spuExcl = ref(false);

const spuRows = computed<TableRow[]>(() => {
  void filter.applied.version;
  const s = filter.applied.start;
  const e = filter.applied.end;
  const a = data.metaDimRange('spu', s, e);
  const top = Object.keys(a)
    .filter((k) => a[k].spend > 0)
    .sort((x, y) => a[y].spend - a[x].spend);
  const keys = (pickKeys(spuSel.value, spuExcl.value, data.spus) || top)
    .slice()
    .sort((x, y) => (a[y] ? a[y].spend : 0) - (a[x] ? a[x].spend : 0));
  const rows = keys.map((k) => ({ label: k, m: a[k] || zero() }));
  return withCmps(rows, (r, _i, rg) => data.metaDimRange('spu', rg.start, rg.end)[r.label] ?? zero());
});

/** 总计口径：有筛选=所选项合计，无筛选=全量（同观远） */
const totalRows = computed<TableRow[]>(() => {
  void filter.applied.version;
  const s = filter.applied.start;
  const e = filter.applied.end;
  const a = data.metaDimRange('spu', s, e);
  const top = Object.keys(a)
    .filter((k) => a[k].spend > 0)
    .sort((x, y) => a[y].spend - a[x].spend);
  const tset = pickKeys(spuSel.value, spuExcl.value, data.spus) || top;
  return tset.map((k) => ({ label: k, m: a[k] || zero() }));
});
</script>

<template>
  <template v-if="ready">
    <div class="ptitle">
      <h2>◎ 商品投产</h2>
      <span class="frow">
        <MultiDropdown all-name="SPU" :items="data.spus" :selected="spuSel" :excl="spuExcl" clearable @change="(sel, ex) => { spuSel = sel; spuExcl = ex; }" />
      </span>
    </div>

    <MetricsTable
      tid="m3"
      title="SPU 排行"
      first-col="SPU"
      :rows="spuRows"
      :total-rows="totalRows"
      :day-fn="(r, d) => data.metaDimDate('spu', d)[r.label] || zero()"
      :tips="{
        clicks: '链接点击量：Meta 广告后台 inline_link_clicks（对齐观远商品投产口径）',
        cpc: 'CPC＝花费÷链接点击量',
        ctr: 'CTR＝链接点击量÷展示量',
      }"
    />
  </template>
</template>
