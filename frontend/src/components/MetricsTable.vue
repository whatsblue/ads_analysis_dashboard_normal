<script setup lang="ts">
/**
 * 通用指标表（迁移自原型 regTable/drawTable，全站唯一表格实现）：
 * - 表头分组（gmap/g0-g3 底色）+ 点击排序 + Top10 加载更多
 * - 三行组环比（本期 / 对比期 cmp-d / Δ行 cmp-delta 涨绿跌红 + hl-cmp 波动底色）
 * - 显示占比开关（PCT_DEF 默认；渲染时计算分母，不污染行对象缓存）
 * - 总计行（Σ求和 + 比率重算）；展开行组（素材编号 expOf）；首列下钻链接（linkFirst）
 * - 环比格 hover 归因（attrOn，浮层由 App 级 AttrTip 渲染）；导出（ExportModal）
 */
import { computed, ref, watch } from 'vue';
import { cmpHL, dateRange, derive, deriveG, HL_CMP, HL_TH, sumMetrics, type Metrics } from '@ads/shared';
import { deltaPct } from '@ads/shared';
import { G_COLS, G_GROUP_DEF, METRIC_GROUPS, PCT_COLS, PCT_DEF, STD_COLS, TH_TIP, type ColDef, type GroupMap } from '@/specs/columns';
import type { CmpCell, TableRow } from '@/composables/useRows';
import { useFilterStore } from '@/stores/filter';
import { csvCell, downloadCsv, downloadXls, plainPct, safeFname } from '@/utils/export';
import { hideAttrLater, showAttr } from '@/composables/useAttrTip';
import ExportModal, { type ExportCfg } from './ExportModal.vue';

/** 前置列单元格（素材编号列可展开：expandable=渲染箭头，expKey=展开态键） */
export interface PreCell {
  text: string;
  expandable?: boolean;
  expKey?: string;
  tip?: string;
}
export interface PreCol {
  name: string;
  w?: string;
  get: (r: never) => string | PreCell;
}

const props = withDefaults(
  defineProps<{
    /** 表 id（PCT_DEF 默认占比 / hover 归因键） */
    tid: string;
    /** 卡片标题（导出文件名） */
    title: string;
    firstCol: string;
    rows: TableRow[];
    mode?: 'std' | 'g';
    dateInline?: boolean;
    linkFirst?: boolean;
    firstTip?: string;
    pre?: PreCol[] | null;
    cols?: ColDef[] | null;
    gmap?: GroupMap | null;
    /** 初始排序列；null=保持传入顺序（点击表头仍可排序） */
    sortCol?: string | null;
    sortDir?: 'desc' | 'asc';
    tips?: Record<string, string> | null;
    /** 总计行口径（缺省=rows 全量） */
    totalRows?: TableRow[] | null;
    noTotal?: boolean;
    noHl?: boolean;
    noPct?: boolean;
    /** 展开行组（素材编号）：返回成员行 */
    expOf?: ((r: TableRow) => { label: string; m: Metrics }[]) | null;
    /** 按日取数（导出按日粒度） */
    dayFn?: ((r: TableRow, d: string) => Metrics | null) | null;
    /** 环比格 hover 归因（大盘三表） */
    attrOn?: boolean;
  }>(),
  {
    mode: 'std',
    dateInline: false,
    linkFirst: false,
    firstTip: '',
    pre: null,
    cols: null,
    gmap: null,
    sortCol: 'spend',
    sortDir: 'desc',
    tips: null,
    totalRows: null,
    noTotal: false,
    noHl: false,
    noPct: false,
    expOf: null,
    dayFn: null,
    attrOn: false,
  },
);

const emit = defineEmits<{ link: [label: string] }>();

/** 占比开关跨页保留（原型 tables[id].pctOn 全局持久：页签切换/筛选重渲染不丢勾选，路由重建也不重置） */
const PCT_STATE = new Map<string, boolean>();

const filter = useFilterStore();

/* ================= 内部状态（行数据变化时重置，对齐原型重渲染语义） ================= */
const sortCol = ref<string | null>(props.sortCol);
const sortDir = ref<'desc' | 'asc'>(props.sortDir);
const limit = ref(10);
const expanded = ref<Record<string, 1>>({});
const pctOn = ref(props.noPct ? false : (PCT_STATE.get(props.tid) ?? !!PCT_DEF[props.tid]));
watch(pctOn, (v) => PCT_STATE.set(props.tid, v));

watch(
  () => props.rows,
  () => {
    sortCol.value = props.sortCol;
    sortDir.value = props.sortDir;
    limit.value = 10;
    expanded.value = {};
  },
);

/* ================= 列构造（占比注入，原型 buildCols） ================= */
const PCT_K = ['spend_pct', 'orders_pct', 'value_pct'] as const;

const colsBase = computed<ColDef[]>(() => props.cols ?? (props.mode === 'g' ? G_COLS : STD_COLS));

const cols = computed<ColDef[]>(() => {
  let cs = colsBase.value.filter((c) => !PCT_K.includes(c.k as (typeof PCT_K)[number]));
  if (!pctOn.value) return cs;
  const out: ColDef[] = [];
  for (const c of cs) {
    out.push(c);
    if (c.k === 'spend') out.push(PCT_COLS.spend_pct);
    if (c.k === 'orders') out.push(PCT_COLS.orders_pct);
    if (c.k === 'value' || c.k === 'vs') out.push(PCT_COLS.value_pct);
  }
  cs = out;
  return cs;
});

const groups = computed<GroupMap>(() => {
  const gsrc = props.gmap ?? (props.mode === 'std' && !props.cols ? METRIC_GROUPS : null);
  if (!gsrc) return G_GROUP_DEF;
  return gsrc.map((g) => [g[0], g[1], g[2].filter((k) => (pctOn.value ? true : !PCT_K.includes(k as (typeof PCT_K)[number])))]) as GroupMap;
});

const TIP = computed<Record<string, string>>(() => {
  const ch = props.mode === 'g' ? 'g' : 'std';
  const out: Record<string, string> = {};
  for (const k of Object.keys(TH_TIP)) out[k] = TH_TIP[k][ch];
  if (props.tips) Object.assign(out, props.tips);
  return out;
});

/* ================= 行派生与排序 ================= */
function deriveRow(m: Metrics): Record<string, number> {
  const d = props.mode === 'g' ? deriveG(m) : derive(m);
  return (d ?? {}) as unknown as Record<string, number>;
}

const rowsD = computed<{ r: TableRow; d: Record<string, number> }[]>(() => {
  const arr = props.rows.map((r) => ({ r, d: deriveRow(r.m) }));
  if (!sortCol.value) return arr;
  const k = sortCol.value;
  arr.sort((a, b) => {
    let x = a.d[k] as number | undefined;
    let y = b.d[k] as number | undefined;
    if (x == null || isNaN(x)) x = -Infinity;
    if (y == null || isNaN(y)) y = -Infinity;
    return sortDir.value === 'desc' ? y - x : x - y;
  });
  return arr;
});

const show = computed(() => rowsD.value.slice(0, limit.value));
const more = computed(() => rowsD.value.length > limit.value);

/* ================= 占比分母（渲染时计算，不挂载行对象） ================= */
const dens = computed(() => {
  const tAll = props.totalRows?.length ? props.totalRows : props.rows;
  let s = 0;
  let o = 0;
  let v = 0;
  for (const r of tAll) {
    s += r.m.spend || 0;
    o += r.m.orders || 0;
    v += r.m.value || 0;
  }
  return { s, o, v };
});
const cmpDens = computed(() => {
  let s = 0;
  let o = 0;
  let v = 0;
  for (const r of props.rows) {
    for (const cm of r.cmps ?? []) {
      s += cm.m.spend || 0;
      o += cm.m.orders || 0;
      v += cm.m.value || 0;
    }
  }
  return { s, o, v };
});

/** 占比原始值（0-1；分母为 0 → NaN → 显示 '—'） */
function pctVal(k: string, m: Metrics, den: { s: number; o: number; v: number }): number {
  if (k === 'spend_pct') return den.s ? m.spend / den.s : NaN;
  if (k === 'orders_pct') return den.o ? m.orders / den.o : NaN;
  return den.v ? m.value / den.v : NaN;
}

function cellText(c: ColDef, d: Record<string, number>, m: Metrics, den: { s: number; o: number; v: number }): string {
  if (PCT_K.includes(c.k as (typeof PCT_K)[number])) return c.fmt(pctVal(c.k, m, den));
  return c.fmt(d[c.k]);
}

/** Δ格（涨绿跌红；占比列对比集合分母） */
function deltaCell(c: ColDef, o: { d: Record<string, number>; r: TableRow }, cm: { m: Metrics }): { up: boolean; txt: string } {
  const cd = deriveRow(cm.m);
  let cur: number | null;
  let prev: number | null;
  if (PCT_K.includes(c.k as (typeof PCT_K)[number])) {
    cur = pctVal(c.k, o.r.m, dens.value);
    prev = pctVal(c.k, cm.m, cmpDens.value);
  } else {
    cur = o.d[c.k] ?? null;
    prev = cd[c.k] ?? null;
  }
  const p = deltaPct(cur, prev);
  if (p == null) return { up: false, txt: '—' };
  return { up: p >= 0, txt: (p >= 0 ? '↑ ' : '↓ ') + Math.abs(p).toFixed(2) + '%' };
}

function isHl(k: string, cur: number | undefined, prev: number | undefined): boolean {
  if (props.noHl || props.mode === 'g') return false;
  const th = HL_CMP[k];
  if (!th) return false;
  return cmpHL(cur ?? null, prev ?? null, HL_TH[k]);
}

/* ================= 交互 ================= */
function toggleSort(k: string): void {
  if (sortCol.value === k) sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc';
  else {
    sortCol.value = k;
    sortDir.value = 'desc';
  }
}

function toggleExpand(ek: string): void {
  if (expanded.value[ek]) delete expanded.value[ek];
  else expanded.value[ek] = 1;
}

function expKeyOf(r: TableRow): string {
  return String(r.key ?? r.label);
}

/** hover 归因（Δ 格）：flat / 占比列不触发（对齐原型） */
function onDeltaEnter(ev: MouseEvent, c: ColDef, o: { d: Record<string, number>; r: TableRow }, cm: CmpCell): void {
  if (!props.attrOn || c.k.includes('_pct') || deltaDir(c, o, cm) === 'flat') {
    hideAttrLater(0);
    return;
  }
  showAttr(ev.currentTarget as HTMLElement, {
    tid: props.tid,
    hk: c.k,
    dir: deltaDir(c, o, cm),
    rk: String(o.r.ch ?? o.r.label ?? ''),
    cs: cm.start,
    ce: cm.end,
  });
}

function deltaDir(c: ColDef, o: { d: Record<string, number>; r: TableRow }, cm: { m: Metrics }): 'up' | 'down' | 'flat' {
  if (PCT_K.includes(c.k as (typeof PCT_K)[number])) {
    const a = pctVal(c.k, o.r.m, dens.value);
    const b = pctVal(c.k, cm.m, cmpDens.value);
    if (a == null || b == null || isNaN(a) || isNaN(b) || !b || a === b) return 'flat';
    return a > b ? 'up' : 'down';
  }
  const cd = deriveRow(cm.m);
  const acur = o.d[c.k];
  const apv = cd[c.k];
  if (acur == null || apv == null || isNaN(acur) || isNaN(apv) || !apv || acur === apv) return 'flat';
  return acur > apv ? 'up' : 'down';
}

/* ================= 导出（原型 doExport） ================= */
const expOpen = ref(false);
const expCols = computed(() => {
  const a = [props.firstCol];
  props.pre?.forEach((p) => a.push(p.name));
  if (!props.dateInline) a.push('日期');
  cols.value.forEach((c) => a.push(c.name));
  return a;
});

function expCell(pc: PreCell | string): string {
  return typeof pc === 'string' ? pc : pc.text;
}

function doExport(cfg: ExportCfg): void {
  const t = { pre: props.pre, firstCol: props.firstCol, dateInline: props.dateInline };
  const names = cfg.names;
  const dateTxt = filter.applied.start + ' ~ ' + filter.applied.end;
  const arr: string[][] = [names.slice()];

  function rowObj(o: { r: TableRow; d: Record<string, number> }): Record<string, string> {
    const o2: Record<string, string> = {};
    o2[t.firstCol] = String(o.r.label ?? '');
    props.pre?.forEach((p) => (o2[p.name] = expCell(p.get(o.r as never))));
    if (!t.dateInline) o2['日期'] = dateTxt;
    cols.value.forEach((c) => (o2[c.name] = cellText(c, o.d, o.r.m, dens.value)));
    return o2;
  }

  if (cfg.gran === 'day' && props.dayFn) {
    const days = dateRange(filter.applied.start, filter.applied.end);
    for (const o of rowsD.value) {
      for (const d of days) {
        const dv = props.dayFn(o.r, d);
        if (!dv) continue;
        const dd = deriveRow(dv);
        const o2: Record<string, string> = {};
        o2[t.firstCol] = t.firstCol === '日期' ? d : String(o.r.label ?? '');
        props.pre?.forEach((p) => (o2[p.name] = expCell(p.get(o.r as never))));
        if (!t.dateInline) o2['日期'] = d;
        colsBase.value.forEach((c) => (o2[c.name] = c.fmt(dd[c.k])));
        arr.push(names.map((n) => csvCell(o2[n] ?? '')));
      }
    }
  } else {
    for (const o of rowsD.value) {
      arr.push(names.map((n) => csvCell(rowObj(o)[n] ?? '')));
      if (cfg.showCmp && filter.applied.cmpOn && o.r.cmps) {
        for (const cm of o.r.cmps) {
          const cd = deriveRow(cm.m);
          // 对比期行
          const oc: Record<string, string> = {};
          oc[t.firstCol] = '';
          props.pre?.forEach((p) => (oc[p.name] = expCell(p.get(o.r as never))));
          if (!t.dateInline) oc['日期'] = cm.start + ' ~ ' + cm.end;
          else oc[t.firstCol] = cm.start + ' ~ ' + cm.end;
          cols.value.forEach((c) => (oc[c.name] = cellText(c, cd, cm.m, cmpDens.value)));
          arr.push(names.map((n) => csvCell(oc[n] ?? '')));
          // Δ行（占比列=占比值变化率；其余=指标变化率）
          const od: Record<string, string> = {};
          od[t.firstCol] = t.dateInline ? '环比' : '';
          props.pre?.forEach((p) => (od[p.name] = ''));
          if (!t.dateInline) od['日期'] = '环比';
          cols.value.forEach((c) => {
            let cur: number | null;
            let prev: number | null;
            if (PCT_K.includes(c.k as (typeof PCT_K)[number])) {
              cur = pctVal(c.k, o.r.m, dens.value);
              prev = pctVal(c.k, cm.m, cmpDens.value);
            } else {
              cur = o.d[c.k] ?? null;
              prev = cd[c.k] ?? null;
            }
            od[c.name] = plainPct(cur, prev);
          });
          arr.push(names.map((n) => csvCell(od[n] ?? '')));
        }
      }
    }
  }

  // 总计行（全量口径；占比=100%）
  if (!props.noTotal && !props.dateInline) {
    const tAll = props.totalRows?.length ? props.totalRows : rowsD.value.map((o) => o.r);
    if (tAll.length) {
      const tm = sumMetrics(tAll.map((r) => r.m));
      const dt2 = deriveRow(tm);
      const ot: Record<string, string> = {};
      ot[t.firstCol] = '总计';
      props.pre?.forEach((p) => (ot[p.name] = ''));
      if (!t.dateInline) ot['日期'] = dateTxt;
      cols.value.forEach((c) => {
        ot[c.name] = PCT_K.includes(c.k as (typeof PCT_K)[number]) ? c.fmt(1) : c.fmt(dt2[c.k]);
      });
      arr.push(names.map((n) => csvCell(ot[n] ?? '')));
    }
  }

  const fname = safeFname(props.title);
  if (cfg.fmt === 'csv') downloadCsv(arr, fname);
  else downloadXls(arr, fname);
  expOpen.value = false;
}

const rangeTxt = computed(() => filter.applied.start + ' ~ ' + filter.applied.end);
const ncol = computed(() => 1 + (props.pre?.length ?? 0) + (props.dateInline ? 0 : 1) + cols.value.length);
const cmpOn = computed(() => filter.applied.cmpOn);
</script>

<template>
  <div class="card">
    <div class="card-h">
      <span>{{ props.title }}</span>
      <label v-if="!props.noPct" class="pct-tgl" title="勾选后展示花费占比、订单占比、转化价值占比（分母=本表总计，总计=100%）">
        <input type="checkbox" v-model="pctOn" />显示占比
      </label>
      <span class="card-h-extra"><slot name="head-extra"></slot></span>
      <button class="btn xs exp-btn" @click="expOpen = true">⇩ 导出</button>
    </div>
    <div class="card-b tbl-scroll" :class="{ tall: limit > 10 }">
      <table class="matrix">
        <thead>
          <tr class="gtr">
            <th></th>
            <th v-for="p in props.pre" :key="p.name"></th>
            <th v-if="!props.dateInline"></th>
            <th v-for="g in groups" :key="g[0]" v-show="cols.some((c) => g[2].includes(c.k))" :class="g[1]" :colspan="cols.filter((c) => g[2].includes(c.k)).length">
              {{ g[0] }}
            </th>
          </tr>
          <tr>
            <th>{{ props.firstCol }}</th>
            <th v-for="p in props.pre" :key="p.name" :style="p.w ? { minWidth: p.w } : undefined">{{ p.name }}</th>
            <th v-if="!props.dateInline">日期</th>
            <th
              v-for="c in cols"
              :key="c.k"
              class="sortable"
              :class="{ 'sorted-desc': sortCol === c.k && sortDir === 'desc', 'sorted-asc': sortCol === c.k && sortDir === 'asc' }"
              :title="TIP[c.k] || undefined"
              @click="toggleSort(c.k)"
            >
              {{ c.name }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!rowsD.length">
            <td :colspan="ncol" class="empty">当前筛选无数据</td>
          </tr>
          <template v-for="o in show" :key="String(o.r.label) + '|' + (o.r.key ?? '')">
            <!-- 本期行 -->
            <tr>
              <td>
                <slot name="first" :row="o.r" :range="rangeTxt">
                  <span v-if="props.linkFirst" class="flink" :title="props.firstTip || '点击下钻查看该类型 Top 素材'" @click="emit('link', String(o.r.label))">
                    {{ props.dateInline ? rangeTxt : o.r.label }}
                  </span>
                  <template v-else>{{ props.dateInline ? rangeTxt : o.r.label }}</template>
                </slot>
              </td>
              <td v-for="(p, pi) in props.pre" :key="p.name" :style="p.w ? { maxWidth: p.w, overflow: 'hidden', textOverflow: 'ellipsis' } : undefined">
                <template v-if="pi === 0 && typeof p.get(o.r as never) !== 'string'">
                  <span v-if="(p.get(o.r as never) as PreCell).expandable" class="exp-tgl" :title="`点击${expanded[(p.get(o.r as never) as PreCell).expKey!] ? '收起' : '展开'}该编号下细分指标`" @click="toggleExpand((p.get(o.r as never) as PreCell).expKey!)">
                    {{ expanded[(p.get(o.r as never) as PreCell).expKey!] ? '▾' : '▸' }} {{ (p.get(o.r as never) as PreCell).text }}
                  </span>
                  <span v-else :title="(p.get(o.r as never) as PreCell).tip">{{ (p.get(o.r as never) as PreCell).text }}</span>
                </template>
                <template v-else>{{ typeof p.get(o.r as never) === 'string' ? p.get(o.r as never) : (p.get(o.r as never) as PreCell).text }}</template>
              </td>
              <td v-if="!props.dateInline">{{ rangeTxt }}</td>
              <td v-for="c in cols" :key="c.k">{{ cellText(c, o.d, o.r.m, dens) }}</td>
            </tr>
            <!-- 展开成员行（素材编号行组） -->
            <template v-if="props.expOf && expanded[expKeyOf(o.r)]">
              <tr v-for="x in props.expOf(o.r)" :key="'exp-' + expKeyOf(o.r) + '-' + x.label" class="exp-row">
                <td></td>
                <td v-for="(p, pi) in props.pre" :key="p.name">
                  <span v-if="pi === props.pre!.length - 1" class="exp-name">└ {{ x.label }}</span>
                </td>
                <td v-if="!props.dateInline"></td>
                <td v-for="c in cols" :key="c.k">{{ cellText(c, deriveRow(x.m), x.m, dens) }}</td>
              </tr>
            </template>
            <!-- 环比三行组 -->
            <template v-if="cmpOn && o.r.cmps">
              <template v-for="(cm, ci) in o.r.cmps" :key="'cmp-' + ci + '-' + String(o.r.label)">
                <tr class="cmp-d">
                  <td>{{ props.dateInline ? cm.start + ' ~ ' + cm.end : '' }}</td>
                  <td v-for="p in props.pre" :key="p.name"></td>
                  <td v-if="!props.dateInline">{{ cm.start }} ~ {{ cm.end }}</td>
                  <td v-for="c in cols" :key="c.k">{{ cellText(c, deriveRow(cm.m), cm.m, cmpDens) }}</td>
                </tr>
                <tr class="cmp-delta">
                  <td>{{ props.dateInline ? '环比' : '' }}</td>
                  <td v-for="p in props.pre" :key="p.name"></td>
                  <td v-if="!props.dateInline">环比</td>
                  <td
                    v-for="c in cols"
                    :key="c.k"
                    :class="{ 'hl-cmp': isHl(c.k, o.d[c.k], deriveRow(cm.m)[c.k]) }"
                    @mouseenter="onDeltaEnter($event, c, o, cm)"
                    @mouseleave="hideAttrLater()"
                  >
                    <span class="delta" :class="deltaCell(c, o, cm)!.up ? 'd' : 'u'">{{ deltaCell(c, o, cm)!.txt }}</span>
                  </td>
                </tr>
              </template>
            </template>
          </template>
          <tr v-if="more">
            <td :colspan="ncol" class="more-wrap">
              <button @click="limit = 9999">加载更多（共 {{ rowsD.length }} 行，已显示 {{ limit }}）</button>
            </td>
          </tr>
          <!-- 总计行 -->
          <tr v-if="!props.dateInline && !props.noTotal && (props.totalRows?.length || rowsD.length)" class="tbl-total">
            <td>总计</td>
            <td v-for="p in props.pre" :key="p.name"></td>
            <td v-if="!props.dateInline"></td>
            <td v-for="c in cols" :key="c.k">{{
              ['spend_pct', 'orders_pct', 'value_pct'].includes(c.k)
                ? c.fmt(1)
                : c.fmt(deriveRow(sumMetrics((props.totalRows?.length ? props.totalRows : rowsD.map((o) => o.r)).map((r) => r.m)))[c.k])
            }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
  <ExportModal :open="expOpen" :title="props.title" :cols="expCols" :hasDay="!!props.dayFn" @close="expOpen = false" @download="doExport" />
</template>
