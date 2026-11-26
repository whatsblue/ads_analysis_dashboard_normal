<script lang="ts">
/* 占比开关跨路由持久：须挂模块作用域（script setup 顶层为每实例作用域，路由切换组件销毁时 Map 会一并丢失） */
const PCT_STATE = new Map<string, boolean>();
</script>

<script setup lang="ts">
/**
 * 通用指标表（迁移自原型 regTable/drawTable，全站唯一表格实现）：
 * - 表头分组（gmap/g0-g3 底色）+ 点击排序 + Top10 加载更多
 * - 三行组环比（本期 / 对比期 cmp-d / Δ行 cmp-delta 涨绿跌红 + hl-cmp 波动底色）
 * - 显示占比开关（PCT_DEF 默认；渲染时计算分母，不污染行对象缓存）
 * - 总计行（Σ求和 + 比率重算）；展开行组（素材编号 expOf）；首列下钻链接（linkFirst）
 * - 环比格 hover 归因（attrOn，浮层由 App 级 AttrTip 渲染）；导出（ExportModal）
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useSlots, watch } from 'vue';
import { cmpHL, dateRange, derive, deriveG, HL_CMP, HL_TH, sumMetrics, type Metrics } from '@ads/shared';
import { deltaPct } from '@ads/shared';
import { G_COLS, G_GROUP_DEF, METRIC_GROUPS, PCT_COLS, PCT_DEF, STD_COLS, TH_TIP, type ColDef, type GroupMap } from '@/specs/columns';
import type { CmpCell, TableRow } from '@/composables/useRows';
import { useFilterStore } from '@/stores/filter';
import { deltaCell as deltaExpCell, downloadCsv, downloadXls, safeFname, type ExpCell } from '@/utils/export';
import { hideAttrLater, showAttr } from '@/composables/useAttrTip';
import '@/composables/useThTip';
import ExportModal, { type ExportCfg } from './ExportModal.vue';

/** 前置列单元格（素材编号列可展开：expandable=渲染箭头，expKey=展开态键，expCount=成员条数） */
export interface PreCell {
  text: string;
  expandable?: boolean;
  expKey?: string;
  expCount?: number;
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
    /** 卡片标题（卡头文字；导出名另见 exportName） */
    title: string;
    /** 导出文件名/导出弹窗标题（原型 regTable title 与卡头文字分离：如 g2 卡头「国家对比明细」导出「Google × 国家」）；缺省=卡头文字 */
    exportName?: string;
    /** 无 .card 外壳（素材子分类单卡双表：嵌在外层卡片内，仅渲染卡头+表体） */
    noCard?: boolean;
    /** 卡头内联样式（noCard 双表场景：表1 padding-top:4px / 表2 border-top 分隔） */
    headStyle?: string;
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
    /** 表级 tip 文案用 Google 版（原型 gTips：std derive 但 Google 口径提示，如 gm3 SPU 排行） */
    gTips?: boolean;
    /** 展开行组（素材编号）：返回成员行 */
    expOf?: ((r: TableRow) => { label: string; m: Metrics }[]) | null;
    /** 按日取数（导出按日粒度） */
    dayFn?: ((r: TableRow, d: string) => Metrics | null) | null;
    /** 环比格 hover 归因（大盘三表） */
    attrOn?: boolean;
    /** 单环比周期时压缩列距适配视口宽（总计行免横向滚动完整可见）；多周期保留滑块（2026-11-17 m4a） */
    fitCols?: boolean;
    /** 双冻结：首列+第二列（pre[0]）同时 sticky（Campaign 明细 ID+名称，2026-11-17） */
    sticky2?: boolean;
  }>(),
  {
    mode: 'std',
    exportName: '',
    noCard: false,
    headStyle: '',
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
    gTips: false,
    expOf: null,
    dayFn: null,
    attrOn: false,
    fitCols: false,
    sticky2: false,
  },
);

const emit = defineEmits<{ link: [label: string] }>();

/* 表头页面级吸顶：挂载后测量分组行实际高度注入本表根节点 --gtrH（列名行 sticky top=--topbarH+--gtrH） */
const tblRoot = ref<HTMLElement | null>(null);
const scrollWrap = ref<HTMLElement | null>(null);
/* 卡内横滚（2026-11-25 用户反馈 Top 素材分析等宽表溢出卡片）：表格实际宽超出容器时挂 scroll-on
   转卡片内底部滑块；未超宽不加 overflow——容器无 overflow 才不劫持 sticky 包含块，表头页面级
   吸顶保持有效（两态样式见 dashboard.css .scroll-on）。ResizeObserver 覆盖触发源：行数/列数
   （占比开关、加载更多）、字体加载、视口缩放 */
const xOverflow = ref(false);
let sizeRo: ResizeObserver | null = null;

/* stk2 双冻结：第二列 left=首列实际宽（测量注入 --col1w，防字体晚载偏移）；横滚两态切换改
   变容器 padding（16→0），需重测对齐 */
const setCol1 = (): void => {
  const c2 = tblRoot.value?.querySelector('.matrix thead tr:not(.gtr) th:nth-child(2)');
  if (tblRoot.value && c2) tblRoot.value.style.setProperty('--col1w', String((c2 as HTMLElement).offsetLeft) + 'px');
};

watch(xOverflow, () => {
  if (props.sticky2) nextTick(setCol1);
});

onMounted(() => {
  if (props.sticky2) {
    setCol1();
    document.fonts?.ready.then(setCol1).catch(() => undefined);
  }
  const tbl = scrollWrap.value?.querySelector('table.matrix');
  if (scrollWrap.value && tbl) {
    /* +1px 容差：临界宽附近两态间 padding 差会引起往返抖动 */
    const check = (): void => {
      xOverflow.value = tbl.getBoundingClientRect().width > scrollWrap.value!.getBoundingClientRect().width + 1;
    };
    check();
    sizeRo = new ResizeObserver(check);
    sizeRo.observe(tbl);
    sizeRo.observe(scrollWrap.value);
  }
  const gtr = tblRoot.value?.querySelector('.matrix thead tr.gtr');
  if (!tblRoot.value || !gtr) return;
  const setH = (): void => tblRoot.value!.style.setProperty('--gtrH', gtr.getBoundingClientRect().height + 'px');
  setH();
  new ResizeObserver(setH).observe(gtr);
});
onBeforeUnmount(() => sizeRo?.disconnect());

const slots = useSlots();

/* PCT_STATE 定义见上方模块级 <script> 块（原型 tables[id].pctOn 全局持久：页签切换/路由重建不重置） */

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
/* 比率列：值本身是小数，前端 fmtPct 显示百分比——导出同样走 {pct}（2026-11-17 用户定版导出与前端显示完全一致） */
const RATIO_K = ['ctr', 'cvr'] as const;

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
  const gm = (gsrc ?? G_GROUP_DEF).map(
    (g) => [g[0], g[1], g[2].filter((k) => !PCT_K.includes(k as (typeof PCT_K)[number]))] as unknown as GroupMap[number],
  ) as GroupMap;
  if (pctOn.value) {
    // 对齐原型 buildCols pctOn 分支：占比键跟随锚点主键插回所在组，分组行 colspan 恒等于列数（开占比时表头右侧空白列的根因）
    for (const g of gm) {
      const cs: string[] = [];
      for (const k of g[2]) {
        cs.push(k);
        if (k === 'spend') cs.push('spend_pct');
        if (k === 'orders') cs.push('orders_pct');
        if (k === 'value' || k === 'vs') cs.push('value_pct');
      }
      g[2] = cs;
    }
  }
  return gm;
});

const TIP = computed<Record<string, string>>(() => {
  const ch = props.mode === 'g' || props.gTips ? 'g' : 'std';
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
  /* 占比列（*_pct）不在 derive 结果中，排序键走 pctVal（与显示同一集合分母，2026-11-17 用户定版支持点击占比列排序） */
  const isPct = PCT_K.includes(k as (typeof PCT_K)[number]);
  const keyOf = (o: { r: TableRow; d: Record<string, number> }): number => {
    if (isPct) {
      const v = pctVal(k, o.r.m, dens.value);
      return v == null || isNaN(v) ? -Infinity : v;
    }
    const v = o.d[k] as number | undefined;
    return v == null || isNaN(v) ? -Infinity : v;
  };
  arr.sort((a, b) => {
    const x = keyOf(a);
    const y = keyOf(b);
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
  const arr: ExpCell[][] = [names.slice()];

  /* 数值单元格（2026-11-17 用户定版）：指标真数值、占比/比率为 pct（xls 百分比格式）；无效值 '—' 占位 */
  function expVal(c: { k: string }, d: Record<string, number>, m: Metrics, dens: { s: number; o: number; v: number }): ExpCell {
    if (PCT_K.includes(c.k as (typeof PCT_K)[number])) {
      const v = pctVal(c.k, m, dens);
      return v == null || isNaN(v) ? '—' : { pct: v };
    }
    const v = d[c.k];
    if (v == null || isNaN(v)) return '—';
    return RATIO_K.includes(c.k as (typeof RATIO_K)[number]) ? { pct: v } : v;
  }

  function rowObj(o: { r: TableRow; d: Record<string, number> }): Record<string, ExpCell> {
    const o2: Record<string, ExpCell> = {};
    o2[t.firstCol] = String(o.r.label ?? '');
    props.pre?.forEach((p) => (o2[p.name] = expCell(p.get(o.r as never))));
    if (!t.dateInline) o2['日期'] = dateTxt;
    cols.value.forEach((c) => (o2[c.name] = expVal(c, o.d, o.r.m, dens.value)));
    return o2;
  }

  if (cfg.gran === 'day' && props.dayFn) {
    const days = dateRange(filter.applied.start, filter.applied.end);
    for (const o of rowsD.value) {
      for (const d of days) {
        const dv = props.dayFn(o.r, d);
        if (!dv) continue;
        const dd = deriveRow(dv);
        const o2: Record<string, ExpCell> = {};
        o2[t.firstCol] = t.firstCol === '日期' ? d : String(o.r.label ?? '');
        props.pre?.forEach((p) => (o2[p.name] = expCell(p.get(o.r as never))));
        if (!t.dateInline) o2['日期'] = d;
        colsBase.value.forEach((c) => {
          const v = dd[c.k];
          const asPct = PCT_K.includes(c.k as (typeof PCT_K)[number]) || RATIO_K.includes(c.k as (typeof RATIO_K)[number]);
          o2[c.name] = v == null || isNaN(v) ? '—' : asPct ? { pct: v } : v;
        });
        arr.push(names.map((n) => o2[n] ?? ''));
      }
    }
  } else {
    for (const o of rowsD.value) {
      arr.push(names.map((n) => rowObj(o)[n] ?? ''));
      /* 环比行跟随前端当前表的环比状态（2026-11-17 定版：弹窗不再单独提供开关） */
      if (cmpOn.value && o.r.cmps) {
        for (const cm of o.r.cmps) {
          const cd = deriveRow(cm.m);
          // 对比期行
          const oc: Record<string, ExpCell> = {};
          oc[t.firstCol] = '';
          props.pre?.forEach((p) => (oc[p.name] = expCell(p.get(o.r as never))));
          if (!t.dateInline) oc['日期'] = cm.start + ' ~ ' + cm.end;
          else oc[t.firstCol] = cm.start + ' ~ ' + cm.end;
          cols.value.forEach((c) => (oc[c.name] = expVal(c, cd, cm.m, cmpDens.value)));
          arr.push(names.map((n) => oc[n] ?? ''));
          // Δ行（占比列=占比值变化率；其余=指标变化率）
          const od: Record<string, ExpCell> = {};
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
            od[c.name] = deltaExpCell(cur, prev);
          });
          arr.push(names.map((n) => od[n] ?? ''));
        }
      }
    }
  }

  // 总计行（全量口径，含 dateInline 表；占比=100%）
  if (!props.noTotal) {
    const tAll = props.totalRows?.length ? props.totalRows : rowsD.value.map((o) => o.r);
    if (tAll.length) {
      const tm = sumMetrics(tAll.map((r) => r.m));
      const dt2 = deriveRow(tm);
      const ot: Record<string, ExpCell> = {};
      ot[t.firstCol] = '总计';
      props.pre?.forEach((p) => (ot[p.name] = ''));
      if (!t.dateInline) ot['日期'] = dateTxt;
      cols.value.forEach((c) => {
        const v = dt2[c.k];
        const asPct = PCT_K.includes(c.k as (typeof PCT_K)[number]) || RATIO_K.includes(c.k as (typeof RATIO_K)[number]);
        /* PCT 列总计恒 100%；比率列总计=全量重算比率；其余数值 */
        ot[c.name] = PCT_K.includes(c.k as (typeof PCT_K)[number])
          ? { pct: 1 }
          : asPct
            ? v == null || isNaN(v) ? '—' : { pct: v }
            : v == null || isNaN(v) ? '—' : v;
      });
      arr.push(names.map((n) => ot[n] ?? ''));
    }
  }

  const fname = safeFname(props.exportName || props.title);
  if (cfg.fmt === 'csv') downloadCsv(arr, fname);
  else downloadXls(arr, fname);
  expOpen.value = false;
}

const rangeTxt = computed(() => filter.applied.start + ' ~ ' + filter.applied.end);
/** 表内日期短格式（2026-11-17 用户反馈：完整区间把 16 列表撑到 ~1320px，1280 有效视口（Windows 150% 缩放）下
 *  页面被撑出横向滚动，滚到最右后日期列左端被 sticky 首列遮挡呈"-09 ~ …"；去年份省 ~75px，
 *  悬停 title 仍见完整区间，导出保持完整日期不受影响 */
const shortRange = (s: string, e: string) => s.slice(5) + ' ~ ' + e.slice(5);
const rangeShort = computed(() => shortRange(filter.applied.start, filter.applied.end));
const ncol = computed(() => 1 + (props.pre?.length ?? 0) + (props.dateInline ? 0 : 1) + cols.value.length);
const cmpOn = computed(() => filter.applied.cmpOn);
/* fitCols：仅单环比周期（或未开环比）压缩列距；多周期时移除压缩类恢复自然列宽出现滑块 */
const cmpCount = computed(() => (filter.applied.cmpOn ? filter.cmpRanges.length : 0));
</script>

<template>
  <!-- noCard：素材子分类单卡双表场景，嵌在外层 .card 内仅去掉卡片外壳（原型 m4sub 结构） -->
  <div ref="tblRoot" :class="[props.noCard ? undefined : 'card', props.fitCols && cmpCount <= 1 ? 'tbl-fit' : '', props.sticky2 ? 'stk2' : '']">
    <div class="card-h" :style="props.headStyle || undefined">
      <!-- head-pre：卡头最左（下钻返回按钮）；head-note：紧贴标题的说明（原型 m4a 注释） -->
      <slot name="head-pre"></slot>
      <!-- 原型 m4c：卡头标题跟在返回按钮后，margin-left:10px（叠加 .card-h gap:10px） -->
      <span :style="slots['head-pre'] ? { marginLeft: '10px' } : undefined">{{ props.title }}</span>
      <slot name="head-note"></slot>
      <span class="card-h-extra"><slot name="head-extra"></slot></span>
      <label v-if="!props.noPct" class="pct-tgl" title="勾选后展示花费占比、订单占比、转化价值占比（分母=本表总计，总计=100%）">
        <input type="checkbox" v-model="pctOn" />显示占比
      </label>
      <button class="btn xs exp-btn" @click="expOpen = true">⇩ 导出</button>
    </div>
    <slot name="below-head"></slot>
    <div ref="scrollWrap" class="card-b tbl-scroll" :class="{ tall: limit > 10, 'scroll-on': xOverflow }">
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
            <!-- p.w 三值锁宽（width/min/max 同值）：防止宽视口下表格 width:100% 拉伸把长文本列分到额外宽度、而 td 内容盒仍被 maxWidth 截断，右侧留出空白带（2026-11-17 用户反馈） -->
            <th v-for="p in props.pre" :key="p.name" :style="p.w ? { width: p.w, minWidth: p.w, maxWidth: p.w } : undefined">{{ p.name }}</th>
            <th v-if="!props.dateInline">日期</th>
            <th
              v-for="c in cols"
              :key="c.k"
              class="sortable"
              :class="{ 'sorted-desc': sortCol === c.k && sortDir === 'desc', 'sorted-asc': sortCol === c.k && sortDir === 'asc' }"
              :data-tip="TIP[c.k] || undefined"
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
              <td :title="props.dateInline ? rangeTxt : undefined">
                <slot name="first" :row="o.r" :range="rangeTxt">
                  <span v-if="props.linkFirst" class="flink" :title="props.firstTip || '点击下钻查看该类型 Top 素材'" @click="emit('link', String(o.r.label))">
                    {{ props.dateInline ? rangeShort : o.r.label }}
                  </span>
                  <template v-else>{{ props.dateInline ? rangeShort : o.r.label }}</template>
                </slot>
              </td>
              <td v-for="(p, pi) in props.pre" :key="p.name" :style="p.w ? { width: p.w, maxWidth: p.w, overflow: 'hidden', textOverflow: 'ellipsis' } : undefined">
                <template v-if="pi === 0 && typeof p.get(o.r as never) !== 'string'">
                  <span v-if="(p.get(o.r as never) as PreCell).expandable" class="exp-tgl" :title="`点击${expanded[(p.get(o.r as never) as PreCell).expKey!] ? '收起' : '展开'}该编号下${(p.get(o.r as never) as PreCell).expCount ? ' ' + (p.get(o.r as never) as PreCell).expCount + ' 条广告' : ''}的细分指标`" @click="toggleExpand((p.get(o.r as never) as PreCell).expKey!)">
                    {{ expanded[(p.get(o.r as never) as PreCell).expKey!] ? '▾' : '▸' }} {{ (p.get(o.r as never) as PreCell).text }}
                  </span>
                  <span v-else :title="(p.get(o.r as never) as PreCell).tip">{{ (p.get(o.r as never) as PreCell).text }}</span>
                </template>
                <template v-else>{{ typeof p.get(o.r as never) === 'string' ? p.get(o.r as never) : (p.get(o.r as never) as PreCell).text }}</template>
              </td>
              <td v-if="!props.dateInline" :title="rangeTxt">{{ rangeShort }}</td>
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
                  <td :title="props.dateInline ? cm.start + ' ~ ' + cm.end : undefined">{{ props.dateInline ? shortRange(cm.start, cm.end) : '' }}</td>
                  <td v-for="p in props.pre" :key="p.name"></td>
                  <td v-if="!props.dateInline" :title="cm.start + ' ~ ' + cm.end">{{ shortRange(cm.start, cm.end) }}</td>
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
  <ExportModal :open="expOpen" :title="props.exportName || props.title" :cols="expCols" :hasDay="!!props.dayFn" @close="expOpen = false" @download="doExport" />
</template>
