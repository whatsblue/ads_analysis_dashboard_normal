<script setup lang="ts">
/**
 * 导出弹窗（迁移自原型 expModal）：列勾选 + 拖拽排序 + 粒度（区间/按日）+ 显示环比 + 格式（xls/csv）。
 * 纯 UI 组件：下载逻辑由父（MetricsTable/视图）在 @download 中执行。
 */
import { ref, watch } from 'vue';

export interface ExportCfg {
  names: string[];
  gran: 'range' | 'day';
  showCmp: boolean;
  fmt: 'xls' | 'csv';
}

const props = defineProps<{
  open: boolean;
  title: string;
  cols: string[];
  /** 是否提供按日粒度（dayFn 存在时） */
  hasDay: boolean;
}>();

const emit = defineEmits<{ close: []; download: [cfg: ExportCfg] }>();

const order = ref<string[]>([]);
const sel = ref<string[]>([]);
const gran = ref<'range' | 'day'>('range');
const showCmp = ref(true);
const fmt = ref<'xls' | 'csv'>('xls');
const dragIx = ref(-1);
const overIx = ref(-1);

/* 打开时仅重置列勾选；粒度/环比/格式为静态 DOM 跨打开保留（原型 radio/checkbox 不随弹窗重置） */
watch(
  () => props.open,
  (o) => {
    if (o) {
      order.value = props.cols.slice();
      sel.value = props.cols.slice();
    }
  },
);

function toggle(nm: string): void {
  const i = sel.value.indexOf(nm);
  if (i >= 0) sel.value.splice(i, 1);
  else sel.value.push(nm);
}

function onDrop(ix: number): void {
  if (dragIx.value >= 0 && ix !== dragIx.value) {
    const item = order.value.splice(dragIx.value, 1)[0];
    order.value.splice(ix, 0, item);
  }
  dragIx.value = -1;
  overIx.value = -1;
}

function ok(): void {
  if (!sel.value.length) {
    alert('请至少勾选一列');
    return;
  }
  emit('download', { names: order.value.filter((n) => sel.value.includes(n)), gran: gran.value, showCmp: showCmp.value, fmt: fmt.value });
}
</script>

<template>
  <Teleport to="body">
    <div v-if="props.open" class="modal-mask on" @click.self="emit('close')">
      <div class="modal">
        <button class="x" @click="emit('close')">✕</button>
        <h3>导出 · {{ props.title }}</h3>
        <div class="exp-hint">勾选所需列；拖动行可直接调整列顺序；选择导出粒度后下载（含环比数值）</div>
        <div class="frow exp-tools">
          <button class="btn xs" @click="sel = order.slice()">全选</button>
          <button class="btn xs" @click="sel = []">清空</button>
          <span class="exp-opts">
            粒度：
            <label><input type="radio" value="range" v-model="gran" />按日期范围</label>
            <label><input type="radio" value="day" v-model="gran" />按日</label>
            ｜
            <label><input type="checkbox" v-model="showCmp" />显示环比</label>
            ｜
            <label><input type="radio" value="xls" v-model="fmt" />Excel(.xls)</label>
            <label><input type="radio" value="csv" v-model="fmt" />CSV</label>
          </span>
        </div>
        <div class="exp-list">
          <div
            v-for="(nm, i) in order"
            :key="nm"
            class="er"
            :class="{ on: sel.includes(nm), dragging: dragIx === i, over: overIx === i }"
            draggable="true"
            @dragstart="dragIx = i"
            @dragover.prevent="overIx = i"
            @drop.prevent="onDrop(i)"
            @dragend="dragIx = -1; overIx = -1"
          >
            <input type="checkbox" :checked="sel.includes(nm)" @change="toggle(nm)" />
            <span class="nm">{{ nm }}</span>
            <span class="drag-hint">⠿</span>
          </div>
        </div>
        <button class="btn pri" @click="ok">⇩ 下载</button>
      </div>
    </div>
  </Teleport>
</template>
