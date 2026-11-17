<script setup lang="ts">
/**
 * 环比设置弹窗（迁移自原型 cmpModal）：类型（上/上月/去年/自定义）+ 周期数 1-4 + 各周期范围日历编辑。
 * 直接编辑 filter.draft（未应用不生效）；保存=开启环比并关闭。仅自定义类型保留手动编辑。
 * 2026-11-17 交互定版：左右两栏——左侧配置+周期列表（点击选中），右侧常驻日历实时编辑所选周期，
 * 弹窗无滚动条（原单列展开日历超视口出现纵/横滚动条）。
 */
import { computed, ref, watch } from 'vue';
import { cmpAuto, type CmpRange } from '@ads/shared';
import { useFilterStore, type CmpEdits, type CmpType } from '@/stores/filter';
import CalendarPicker from './CalendarPicker.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const filter = useFilterStore();
const d = filter.draft;

const openIx = ref(-1); // 展开日历的周期下标

/* 打开时快照已生效环比配置；✕/遮罩关闭回滚未保存编辑（原型 closeCmpModal 语义：编辑不写回，重开从生效值重置）2026-11-15 走查定版 */
let snap: { cmpT: CmpType; cmpN: number; cmpEd: CmpEdits | null } | null = null;

watch(
  () => props.open,
  (o) => {
    if (o) {
      snap = { cmpT: d.cmpT, cmpN: d.cmpN, cmpEd: d.cmpEd ? d.cmpEd.map((r) => (r ? { start: r.start, end: r.end } : null)) : null };
      openIx.value = 0; // 打开即选中首个周期，右侧日历常驻展开（2026-11-17 用户定版）
    }
  },
);

function close(): void {
  if (snap) {
    d.cmpT = snap.cmpT;
    d.cmpN = snap.cmpN;
    d.cmpEd = snap.cmpEd ? snap.cmpEd.map((r) => (r ? { start: r.start, end: r.end } : null)) : null;
    snap = null;
  }
  emit('close');
}

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
  openIx.value = 0; // 重置回首个周期，右侧日历跟随刷新
}

function setN(n: number): void {
  d.cmpN = Math.min(4, Math.max(1, n));
  d.cmpEd = null;
  if (openIx.value >= d.cmpN) openIx.value = d.cmpN - 1; // 选中项越界时回落到最后一个周期
}

function onPicked(i: number, s: string, e: string): void {
  const ed = d.cmpEd ? d.cmpEd.slice() : [];
  ed[i] = { start: s, end: e };
  d.cmpEd = ed; // 右栏日历常驻，选完不收起，区间即时回显
}

function save(): void {
  // 仅自定义类型保留手动编辑（对齐原型 readCmpEd）
  if (d.cmpT !== 'custom') d.cmpEd = null;
  d.cmpOn = true;
  snap = null;
  emit('close');
}
</script>

<template>
  <Teleport to="body">
    <div v-if="props.open" class="modal-mask on" @click.self="close()">
      <div class="modal cmp-modal">
        <button class="x" @click="close()">✕</button>
        <h3>环比设置</h3>
        <div class="cmp-hint">选择环比类型与周期数；自定义周期的时间范围可修改（不强制等长）</div>
        <div class="cmp-cols">
          <div class="cmp-left">
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
            </div>
            <div class="cmpo-sec">各周期时间范围</div>
            <div class="prange">
              <button
                v-for="(r, i) in cpR"
                :key="i"
                type="button"
                class="pr-btn"
                :class="{ act: openIx === i }"
                @click="openIx = i"
              >
                <span class="pl">{{ r.label }}</span>
                <span class="pv">{{ r.start }} ~ {{ r.end }}</span>
              </button>
            </div>
            <button class="btn pri cmp-save" @click="save()">保 存</button>
          </div>
          <div class="cmp-right">
            <CalendarPicker
              v-if="openIx >= 0"
              :key="openIx"
              :start="cpR[openIx].start"
              :end="cpR[openIx].end"
              footer-tip="选择起止日期后自动更新区间，点【保 存】生效"
              @picked="(s, e) => onPicked(openIx, s, e)"
            />
            <div v-else class="cmp-empty">点击左侧周期可编辑时间范围</div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
