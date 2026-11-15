<script setup lang="ts">
/**
 * ECharts 封装（按需引入）：option 变化即 setOption(notMerge)，容器尺寸变化自动 resize。
 * 视图只负责组装 option（specs/charts 工厂），渲染细节全部收敛于此。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

const props = withDefaults(defineProps<{ option: Record<string, unknown> | null; height?: string; sm?: boolean }>(), {
  height: '',
  sm: false,
});

const el = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;
let ro: ResizeObserver | null = null;

/** tooltip 统一 confine（2026-11-15 用户定版）：悬浮说明限制在画布内完整展示，不随超出容器边缘被裁剪 */
function withConfine(o: Record<string, unknown>): Record<string, unknown> {
  const tip = o.tooltip as Record<string, unknown> | undefined;
  if (!tip) return o;
  return { ...o, tooltip: { ...tip, confine: true } };
}

onMounted(() => {
  if (!el.value) return;
  chart = echarts.init(el.value);
  if (props.option) chart.setOption(withConfine(props.option), true);
  ro = new ResizeObserver(() => chart?.resize());
  ro.observe(el.value);
});

watch(
  () => props.option,
  (o) => {
    if (chart && o) chart.setOption(withConfine(o), true);
  },
);

onBeforeUnmount(() => {
  ro?.disconnect();
  ro = null;
  chart?.dispose();
  chart = null;
});
</script>

<template>
  <div ref="el" class="chart" :class="{ sm: props.sm }" :style="props.height ? { height: props.height } : undefined"></div>
</template>
