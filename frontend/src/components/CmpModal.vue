<script setup lang="ts">
/**
 * 环比设置弹窗（迁移自原型 cmpModal）：类型（上/上月/去年/自定义）+ 周期数 1-4 + 各周期范围日历编辑。
 * 直接编辑 filter.draft（未应用不生效）；保存=开启环比并关闭。仅自定义类型保留手动编辑。
 */
import { computed, ref, watch } from 'vue';
import { cmpAuto, type CmpRange } from '@ads/shared';
import { useFilterStore, type CmpType } from '@/stores/filter';
import CalendarPicker from './CalendarPicker.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const filter = useFilterStore();
const d = filter.draft;

const openIx = ref(-1); // 展开日历的周期下标

watch(
  () => props.open,
  (o) => {
    if (o) openIx.value = -1;
  },
);

const TYPES: { v: CmpType; label: string }[] = [
  { v: 'week', label: '上周同期' },
  { v: 'month', label: '上月同期' },
  { v: 'year', label: '去年同期' },
  { v: 'custom', label: '自定义周期' },
];

/** 各周期显示值：自动预填 + 手动编辑覆盖 */
const cpR = computed<CmpRange[]>(() => {
  const auto = cmpAuto(d.start, d.end, d.cmpT, d.cmpN);
  return auto.map((r, i) => {
    const e = d.cmpEd?.[i];
    return e ? { label: r.label, start: e.start, end: e.end } : r;
  });
});

function setType(t: CmpType): void {
  d.cmpT = t;
  d.cmpEd = null;
}

function setN(n: number): void {
  d.cmpN = Math.min(4, Math.max(1, n));
  d.cmpEd = null;
}

function onPicked(i: number, s: string, e: string): void {
  const ed = d.cmpEd ? d.cmpEd.slice() : [];
  ed[i] = { start: s, end: e };
  d.cmpEd = ed;
  openIx.value = -1;
}

function save(): void {
  // 仅自定义类型保留手动编辑（对齐原型 readCmpEd）
  if (d.cmpT !== 'custom') d.cmpEd = null;
  d.cmpOn = true;
  emit('close');
}
</script>

<template>
  <Teleport to="body">
    <div v-if="props.open" class="modal-mask on" @click.self="emit('close')">
      <div class="modal cmp-modal">
        <button class="x" @click="emit('close')">✕</button>
        <h3>环比设置</h3>
        <div class="cmp-hint">选择环比类型与周期数；自定义周期的时间范围可修改（不强制等长）</div>
        <div class="cmpo-row">
          <span class="cmpo-lb">环比类型</span>
          <span class="cmpo-opts">
            <label v-for="t in TYPES" :key="t.v" class="cmpo-opt">
              <input type="radio" :value="t.v" v-model="d.cmpT" @change="setType(t.v)" />
              <span>{{ t.label }}</span>
            </label>
          </span>
        </div>
        <div class="cmpo-row">
          <span class="cmpo-lb">环比周期数</span>
          <span class="stepper">
            <button @click="setN(d.cmpN - 1)">−</button>
            <span>{{ d.cmpN }}</span>
            <button @click="setN(d.cmpN + 1)">＋</button>
          </span>
          <span class="cmpo-tip">每个对比期往前推 N 个周期，明细中同时显示 N 组对比行</span>
        </div>
        <div class="cmpo-row">
          <span class="cmpo-lb">各周期时间范围</span>
          <span class="cmpo-tip">按所选类型自动预填，可修改（不强制等长）</span>
        </div>
        <div class="prange">
          <div v-for="(r, i) in cpR" :key="i" class="pr-wrap">
            <span class="pl">{{ r.label }}</span>
            <span class="dd pr-dd" :class="{ open: openIx === i }">
              <button type="button" style="min-width: 210px" @click.stop="openIx = openIx === i ? -1 : i">{{ r.start }} ~ {{ r.end }}</button>
              <div v-if="openIx === i" class="dd-panel" @click.stop>
                <CalendarPicker :start="r.start" :end="r.end" @picked="(s, e) => onPicked(i, s, e)" />
              </div>
            </span>
          </div>
        </div>
        <button class="btn pri" style="margin-top: 14px" @click="save()">保 存</button>
      </div>
    </div>
  </Teleport>
</template>
