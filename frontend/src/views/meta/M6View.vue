<script setup lang="ts">
/**
 * Meta · 年龄维度（原型 renderM6）：ROAS 对比条形 + 占比环形（指标切换）+ 年龄段明细（固定序）。
 */
import { computed, onMounted, ref } from 'vue';
import { derive, zero, type Metrics } from '@ads/shared';
import { useDataStore } from '@/stores/data';
import { useFilterStore } from '@/stores/filter';
import { withCmps, type TableRow } from '@/composables/useRows';
import { donutOption, hBarOption } from '@/specs/charts';
import BaseChart from '@/components/BaseChart.vue';
import MetricsTable from '@/components/MetricsTable.vue';

const data = useDataStore();
const filter = useFilterStore();
const ready = ref(false);

onMounted(async () => {
  await data.init();
  await data.ensure('metaDim');
  ready.value = true;
});

const aAgg = computed<Record<string, Metrics>>(() => {
  void filter.applied.version;
  return data.metaDimRange('age', filter.applied.start, filter.applied.end);
});

const ageRows = computed<TableRow[]>(() => {
  void filter.applied.version;
  const rows = data.ages.map((k) => ({ label: k, m: aAgg.value[k] || zero() }));
  return withCmps(rows, (r, _i, rg) => data.metaDimRange('age', rg.start, rg.end)[r.label] ?? zero());
});

const roasOpt = computed(() => {
  void filter.applied.version;
  const rk = data.ages.slice().sort((x, y) => (derive(aAgg.value[y] || zero())!.roas || 0) - (derive(aAgg.value[x] || zero())!.roas || 0));
  return hBarOption(
    rk,
    rk.map((k) => +((derive(aAgg.value[k] || zero())!.roas || 0).toFixed(2))),
    '#10b981',
  );
});

const ageMet = ref<'spend' | 'orders' | 'value'>('spend');

const pieOpt = computed(() => {
  void filter.applied.version;
  const ok = data.ages.slice().sort((x, y) => (aAgg.value[y] || zero()).spend - (aAgg.value[x] || zero()).spend);
  return donutOption(
    ok.map((k) => {
      const m = aAgg.value[k] || zero();
      return { name: k, value: ageMet.value === 'orders' ? Math.round(m.orders) : +((ageMet.value === 'value' ? m.value : m.spend) as number).toFixed(2) };
    }),
  );
});
</script>

<template>
  <template v-if="ready">
    <div class="ptitle"><h2>◎ 年龄维度</h2></div>
    <div class="two">
      <div class="card"><div class="card-h">年龄段 ROAS 对比</div><div class="card-b"><BaseChart :option="roasOpt" sm /></div></div>
      <div class="card">
        <div class="card-h">
          <span>年龄段占比</span>
          <span class="seg mini">
            <button v-for="m in ([['spend', '花费'], ['orders', '订单'], ['value', '购物转化价值']] as const)" :key="m[0]" :class="{ on: ageMet === m[0] }" @click="ageMet = m[0]">{{ m[1] }}</button>
          </span>
        </div>
        <div class="card-b"><BaseChart :option="pieOpt" sm /></div>
      </div>
    </div>
    <MetricsTable
      tid="m6"
      title="年龄段明细"
      first-col="年龄段"
      :rows="ageRows"
      :sort-col="null"
      :day-fn="(r, d) => data.metaDimDate('age', d)[r.label] || zero()"
    />
  </template>
</template>
