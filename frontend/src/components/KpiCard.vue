<script setup lang="ts">
/**
 * KPI 指标卡（迁移自原型 .kpi 结构）：标题 + 主值 + 环比小字（涨绿↓红）。
 */
import { computed } from 'vue';
import { deltaPct } from '@ads/shared';

const props = defineProps<{
  title: string;
  value: string;
  /** 环比：cur=本期值，prev=上期值（null=不显示环比） */
  cur?: number | null;
  prev?: number | null;
}>();

const delta = computed<{ up: boolean; txt: string } | null>(() => {
  if (props.prev == null) return null;
  const p = deltaPct(props.cur ?? null, props.prev);
  if (p == null) return { up: false, txt: '—' };
  return { up: p >= 0, txt: (p >= 0 ? '↑ ' : '↓ ') + Math.abs(p).toFixed(2) + '%' };
});
</script>

<template>
  <div class="kpi">
    <div class="t">{{ props.title }}</div>
    <div class="v">{{ props.value }}</div>
    <div class="s"><span v-if="delta" class="delta" :class="delta.up ? 'd' : 'u'">{{ delta.txt }}</span></div>
  </div>
</template>
