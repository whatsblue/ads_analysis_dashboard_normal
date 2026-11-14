<script setup lang="ts">
/**
 * 通用多选下拉（迁移自原型 buildDD）：搜索（`-词` 排除）/全选+排除/已选查看/分页/批量粘贴/取消确定。
 * 面板内为临时选择，点【确定】才 emit('change', sel, excl)；可清除（hover ×）。
 */
import { computed, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    items: string[];
    selected: string[];
    excl: boolean;
    /** 全称后缀（如「站点」→ 全部站点） */
    allName?: string;
    /** 按钮上方小标签（.fd dd 纵向结构，原型 m2b/gmc「广告系列」、下钻「广告名称」） */
    label?: string;
    /** 未选态按钮文案（动态，如国家 Top5） */
    emptyText?: () => string;
    clearable?: boolean;
    labelFn?: (it: string) => string;
    /** 面板最小宽（跟随按钮场景） */
    panelMinWidth?: number;
  }>(),
  { allName: '', label: '', clearable: false, panelMinWidth: 300 },
);

const emit = defineEmits<{ change: [sel: string[], excl: boolean] }>();

const open = ref(false);
const q = ref('');
const page = ref(1);
const size = ref(10);
const view = ref<'check' | 'paste'>('check');
const showSel = ref(false);
const sel = ref<string[]>([]);
const exclTmp = ref(false);
const pasteSep = ref('\n');
const pasteTxt = ref('');

/** 关键词匹配（原型 kwMatch）：多词与关系；`-词` 排除 */
function kwMatch(query: string, lb: string): boolean {
  if (!query) return true;
  let ok = true;
  const s = lb.toLowerCase();
  for (const t of query.toLowerCase().split(/\s+/)) {
    if (!t) continue;
    if (t.charAt(0) === '-') {
      if (t.length > 1 && s.includes(t.slice(1))) ok = false;
    } else if (!s.includes(t)) ok = false;
  }
  return ok;
}

function lb(it: string): string {
  return props.labelFn ? props.labelFn(it) : it;
}

const matches = computed(() => props.items.filter((it) => kwMatch(q.value, lb(it))));
const pages = computed(() => Math.max(1, Math.ceil(matches.value.length / size.value)));
const slice = computed(() => {
  const p = Math.min(page.value, pages.value);
  return matches.value.slice((p - 1) * size.value, p * size.value);
});
const allChecked = computed(() => matches.value.length > 0 && matches.value.every((it) => sel.value.includes(it)));

watch(open, (o) => {
  if (o) reset();
});

function reset(): void {
  q.value = '';
  page.value = 1;
  view.value = 'check';
  showSel.value = false;
  sel.value = props.selected.slice();
  exclTmp.value = props.excl;
  pasteTxt.value = '';
}

const btnText = computed(() => {
  const n = props.selected.length;
  if (!n) return props.emptyText ? props.emptyText() : '全部' + props.allName;
  const show = props.selected.slice(0, 2).map(lb);
  return (props.excl ? '排除: ' : '') + show.join(',') + (n > 2 ? ' 等' + n + '项' : '');
});

function commit(): void {
  emit('change', sel.value.slice(), exclTmp.value);
  open.value = false;
}

function clear(): void {
  emit('change', [], false);
  open.value = false;
}

function pageNav(d: number): void {
  page.value = Math.min(pages.value, Math.max(1, page.value + d));
}

function onSearch(): void {
  page.value = 1;
}

function toggleAll(on: boolean): void {
  sel.value = on ? matches.value.slice() : [];
}

const SEP_OPTS: [string, string][] = [
  ['\n', '换行(\\n)'],
  ['\t', '制表符(\\t)'],
  [';', '分号(;)'],
  ['|', '管道符(|)'],
  [' ', '空格( )'],
  ['custom', '自定义'],
];

function applyPaste(): void {
  const sep = pasteSep.value === 'custom' ? (pasteCustom.value || ',') : pasteSep.value;
  const parts =
    sep === '\n'
      ? pasteTxt.value.split(/\r?\n/)
      : sep === '\t'
        ? pasteTxt.value.split('\t')
        : sep === ' '
          ? pasteTxt.value.split(/\s+/)
          : pasteTxt.value.split(new RegExp('[' + sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ']'));
  const toks = parts.map((s) => s.trim().toLowerCase()).filter(Boolean);
  sel.value = props.items.filter((it) => toks.includes(lb(it).toLowerCase()));
  view.value = 'check';
  page.value = 1;
}

const pasteCustom = ref('');
</script>

<template>
  <span class="dd" :class="{ open, fd: !!props.label }">
    <b v-if="props.label">{{ props.label }}</b>
    <button type="button" :class="{ 'has-sel': props.clearable && props.selected.length }" @click.stop="open = !open">
      <span class="dd-lbl">{{ btnText }}</span>
      <i v-if="props.clearable && props.selected.length" class="dd-x" title="清除筛选" @click.stop="clear">×</i>
    </button>
    <div v-if="open" class="dd-panel" :style="{ minWidth: props.panelMinWidth + 'px' }" @click.stop>
      <template v-if="view === 'check'">
        <input class="dd-search" v-model="q" placeholder="搜索…" @input="onSearch" />
        <div class="dd-tools">
          <label><input type="checkbox" :checked="allChecked" @change="toggleAll(($event.target as HTMLInputElement).checked)" />全选</label>
          <label><input type="checkbox" v-model="exclTmp" />排除</label>
          <span class="dd-cnt">
            已选: {{ sel.length }}
            <a v-if="sel.length" @click="showSel = !showSel">查看</a>
          </span>
        </div>
        <div v-if="showSel && sel.length" class="dd-selview">{{ sel.map(lb).join('、') }}</div>
        <div class="dd-list">
          <div v-if="!slice.length" class="empty" style="padding: 14px">无匹配项</div>
          <label v-for="it in slice" :key="it">
            <input type="checkbox" :value="it" :checked="sel.includes(it)" @change="(($event.target as HTMLInputElement).checked ? sel.push(it) : sel.splice(sel.indexOf(it), 1))" />
            {{ lb(it) }}
          </label>
        </div>
        <div class="dd-pager">
          <span class="pg-nav">
            <button :disabled="page <= 1" @click="pageNav(-1)">‹</button>
            <b>{{ Math.min(page, pages) }}</b>
            <button :disabled="page >= pages" @click="pageNav(1)">›</button>
          </span>
          <select class="pg-size" v-model.number="size" @change="page = 1">
            <option :value="10">10 条/页</option>
            <option :value="20">20 条/页</option>
            <option :value="50">50 条/页</option>
          </select>
          <span class="pg-total">共 {{ matches.length }} 项</span>
        </div>
        <div class="dd-foot">
          <a @click="view = 'paste'">⌨ 批量粘贴</a>
          <span class="spacer"></span>
          <button class="btn xs" @click="open = false">取消</button>
          <button class="btn xs pri" @click="commit()">确定</button>
        </div>
      </template>
      <template v-else>
        <textarea class="dd-paste-ta" v-model="pasteTxt" placeholder="选项文本粘贴处"></textarea>
        <div class="paste-sep">
          分隔符：
          <select class="paste-sel" v-model="pasteSep">
            <option v-for="o in SEP_OPTS" :key="o[0]" :value="o[0]">{{ o[1] }}</option>
          </select>
          <input v-if="pasteSep === 'custom'" class="paste-cus" v-model="pasteCustom" placeholder="分隔符" style="width: 56px" />
        </div>
        <div class="dd-foot">
          <a @click="view = 'check'">≡ 勾选框选择</a>
          <span class="spacer"></span>
          <button class="btn xs" @click="view = 'check'">取消</button>
          <button class="btn xs pri" @click="applyPaste()">确定</button>
        </div>
      </template>
    </div>
  </span>
</template>
