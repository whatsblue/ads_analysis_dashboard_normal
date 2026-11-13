<script setup lang="ts">
/**
 * 双月日历（迁移自原型 calHtml/drawCal/buildDatePicker）：
 * 周一起始，上月/下月补位灰显，选满起止即 emit('picked')（父负责收起面板）。
 */
import { computed, ref, watch } from 'vue';
import { d2s } from '@ads/shared';

const props = defineProps<{
  /** 外部当前生效区间（打开面板时同步） */
  start: string;
  end: string;
}>();

const emit = defineEmits<{ picked: [s: string, e: string] }>();

const y = ref(2026);
const m = ref(0);
const selStart = ref<string | null>(null);
const selEnd = ref<string | null>(null);

function syncFromProps(): void {
  y.value = +props.start.slice(0, 4);
  m.value = +props.start.slice(5, 7) - 1;
  selStart.value = props.start;
  selEnd.value = props.end;
}

syncFromProps();
watch(() => props.start + '|' + props.end, syncFromProps);

const today = d2s(new Date());

interface Cell {
  ds: string;
  d: number;
  muted: boolean;
}

/** 单月 42 格（含前后月补位） */
function monthCells(yy: number, mm: number): Cell[] {
  const first = new Date(yy, mm, 1);
  const dow = (first.getDay() + 6) % 7;
  const dim = new Date(yy, mm + 1, 0).getDate();
  const prevDim = new Date(yy, mm, 0).getDate();
  const out: Cell[] = [];
  for (let i = 0; i < 42; i++) {
    const dnum = i - dow + 1;
    let d = dnum;
    let m2 = mm;
    let y2 = yy;
    if (dnum < 1) {
      d = prevDim + dnum;
      m2--;
    } else if (dnum > dim) {
      d = dnum - dim;
      m2++;
    }
    if (m2 < 0) {
      m2 = 11;
      y2--;
    }
    if (m2 > 11) {
      m2 = 0;
      y2++;
    }
    out.push({
      ds: y2 + '-' + String(m2 + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0'),
      d,
      muted: dnum < 1 || dnum > dim,
    });
  }
  return out;
}

const months = computed(() => {
  const y2 = m.value === 11 ? y.value + 1 : y.value;
  const m2 = m.value === 11 ? 0 : m.value + 1;
  return [
    { y: y.value, m: m.value, cells: monthCells(y.value, m.value) },
    { y: y2, m: m2, cells: monthCells(y2, m2) },
  ];
});

function cellCls(c: Cell): string[] {
  const cls = ['cal-cell'];
  if (c.muted) cls.push('muted');
  if (selStart.value && selEnd.value && c.ds > selStart.value && c.ds < selEnd.value) cls.push('inr');
  if (c.ds === selStart.value || c.ds === selEnd.value) cls.push('sel');
  if (c.ds === today) cls.push('today');
  return cls;
}

function nav(d: number): void {
  m.value += d;
  while (m.value < 0) {
    m.value += 12;
    y.value--;
  }
  while (m.value > 11) {
    m.value -= 12;
    y.value++;
  }
}

function pick(ds: string): void {
  if (!selStart.value || selEnd.value) {
    selStart.value = ds;
    selEnd.value = null;
    return;
  }
  if (ds < selStart.value) {
    const tmp = selStart.value;
    selStart.value = ds;
    selEnd.value = tmp;
  } else {
    selEnd.value = ds;
  }
  if (selStart.value && selEnd.value) {
    emit('picked', selStart.value, selEnd.value);
  }
}
</script>

<template>
  <div class="dr-panel">
    <div class="cal-wrap">
      <div v-for="mo in months" :key="mo.y + '-' + mo.m" class="cal">
        <div class="cal-h">
          <span class="nav">
            <button @click="nav(-12)">«</button>
            <button @click="nav(-1)">‹</button>
          </span>
          <span>{{ mo.y }}年 {{ mo.m + 1 }}月</span>
          <span class="nav">
            <button @click="nav(1)">›</button>
            <button @click="nav(12)">»</button>
          </span>
        </div>
        <div class="cal-grid">
          <span v-for="w in ['一', '二', '三', '四', '五', '六', '日']" :key="w" class="wd">{{ w }}</span>
          <span v-for="c in mo.cells" :key="c.ds" :class="cellCls(c)" @click="pick(c.ds)">{{ c.d }}</span>
        </div>
      </div>
    </div>
    <div class="cal-f">
      <span>{{ selStart || '…' }} ~ {{ selEnd || '…' }}</span>
      <span class="cal-f-tip">选择起止日期后自动收起，点筛选栏【应用】生效</span>
    </div>
  </div>
</template>
