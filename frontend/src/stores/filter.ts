/**
 * 全局筛选 store（迁移自原型 state/siteSel/metaSel/gAccSel/ddExcl/APPLIED_SNAP 机制）。
 * 草稿态（draft，FilterBar 直接编辑）与生效态（applied，查询函数唯一依据）分离，
 * 点【应用】才生效（观远式三态按钮）；sessionStorage 持久化跨 tab 保留。
 */
import { defineStore } from 'pinia';
import { computed, reactive } from 'vue';
import { cmpAuto, type CmpRange } from '@ads/shared';

export type CmpType = 'week' | 'month' | 'year' | 'custom';

/** 自定义周期覆盖（索引对齐 cmpAuto 输出；null=用自动预填） */
export type CmpEdits = ({ start: string; end: string } | null)[];

export interface DraftFilters {
  start: string;
  end: string;
  siteSel: string[];
  siteExcl: boolean;
  metaSel: string[];
  metaExcl: boolean;
  gSel: string[];
  gExcl: boolean;
  cmpOn: boolean;
  cmpT: CmpType;
  cmpN: number;
  cmpEd: CmpEdits | null;
}

export interface AppliedFilters {
  /** 每次 apply +1：data store 聚合缓存失效信号 */
  version: number;
  start: string;
  end: string;
  /** 已解析排除语义的站点集合（显示名，非空） */
  sites: string[];
  /** null=未筛选（全部账号） */
  metaAccounts: string[] | null;
  gAccounts: string[] | null;
  cmpOn: boolean;
  cmpT: CmpType;
  cmpN: number;
  cmpEd: CmpEdits | null;
}

/** 站点显示名全集（与数据桶键 shopify/shoplazza 对应） */
export const SITES = ['Shopify', 'Shoplazza'];

const SS_KEY = 'adsn.filters.v1';

/** pickKeys（原型）：排除模式=补集；普通模式空选择=null（全部）；视图卡级筛选共用 */
export function pickKeys(sel: string[], excl: boolean, all: string[]): string[] | null {
  if (excl) return all.filter((k) => !sel.includes(k));
  return sel.length ? all.filter((k) => sel.includes(k)) : null;
}

// 账号全集（data store init 时注入；模块级供 draftSnap 语义解析）
let allMeta: string[] = [];
let allG: string[] = [];

/** 草稿语义快照（解析排除语义：排除=补集、空选=全集；与 appliedSnap 同构） */
function draftSnap(d: DraftFilters): string {
  return JSON.stringify([
    d.start,
    d.end,
    [...(pickKeys(d.siteSel, d.siteExcl, SITES) ?? SITES.slice())].sort(),
    pickKeys(d.metaSel, d.metaExcl, allMeta),
    pickKeys(d.gSel, d.gExcl, allG),
    d.cmpOn,
    d.cmpT,
    d.cmpN,
    d.cmpEd,
  ]);
}

/** 环比对比周期（原型 cmpRanges：cmpAuto + cmpEd 覆盖） */
export function resolveCmpRanges(a: Pick<AppliedFilters, 'cmpOn' | 'cmpT' | 'cmpN' | 'cmpEd' | 'start' | 'end'>): CmpRange[] {
  if (!a.cmpOn) return [];
  const auto = cmpAuto(a.start, a.end, a.cmpT, a.cmpN);
  if (!a.cmpEd) return auto;
  return auto.map((r, i) => {
    const e = a.cmpEd![i];
    return e ? { label: r.label, start: e.start, end: e.end } : r;
  });
}

export const useFilterStore = defineStore('filter', () => {
  const draft = reactive<DraftFilters>({
    start: '1970-01-01',
    end: '1970-01-01',
    siteSel: ['Shopify'],
    siteExcl: false,
    metaSel: [],
    metaExcl: false,
    gSel: [],
    gExcl: false,
    cmpOn: true,
    cmpT: 'week',
    cmpN: 1,
    cmpEd: null,
  });

  const applied = reactive<AppliedFilters>({
    version: 0,
    start: '1970-01-01',
    end: '1970-01-01',
    sites: ['Shopify'],
    metaAccounts: null,
    gAccounts: null,
    cmpOn: true,
    cmpT: 'week',
    cmpN: 1,
    cmpEd: null,
  });

  let initialized = false;

  /** 首屏以 manifest 默认区间初始化（sessionStorage 已有则恢复） */
  function initDefaults(viewStart: string, viewEnd: string, metaAccounts: string[], gAccounts: string[]): void {
    if (initialized) return;
    initialized = true;
    const saved = readSaved();
    if (saved) {
      Object.assign(draft, saved.draft);
      Object.assign(applied, saved.applied);
      applied.version = 0;
      return;
    }
    draft.start = applied.start = viewStart;
    draft.end = applied.end = viewEnd;
    // 账号全选语义=null；草稿空数组
    void metaAccounts;
    void gAccounts;
  }

  function readSaved(): { draft: DraftFilters; applied: AppliedFilters } | null {
    try {
      const raw = sessionStorage.getItem(SS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { draft: DraftFilters; applied: AppliedFilters };
      if (!parsed?.draft?.start || !parsed?.applied?.start) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function persist(): void {
    try {
      const { version: _v, ...rest } = applied;
      void _v;
      sessionStorage.setItem(SS_KEY, JSON.stringify({ draft, applied: rest }));
    } catch {
      /* 隐私模式等场景忽略 */
    }
  }

  /** 有待应用更改（应用按钮高亮依据；草稿/生效语义快照比对） */
  const dirty = computed(() => !initialized || draftSnap(draft) !== appliedSnap());

  function appliedSnap(): string {
    return JSON.stringify([
      applied.start,
      applied.end,
      [...applied.sites].sort(),
      applied.metaAccounts ? [...applied.metaAccounts].sort() : null,
      applied.gAccounts ? [...applied.gAccounts].sort() : null,
      applied.cmpOn,
      applied.cmpT,
      applied.cmpN,
      applied.cmpEd,
    ]);
  }

  function setAccountUniverse(meta: string[], g: string[]): void {
    allMeta = meta;
    allG = g;
  }

  /** 应用草稿 → 生效（并触发 data store 缓存失效） */
  function apply(onApplied?: () => void): void {
    applied.start = draft.start;
    applied.end = draft.end;
    applied.sites = pickKeys(draft.siteSel, draft.siteExcl, SITES) ?? SITES.slice();
    applied.metaAccounts = pickKeys(draft.metaSel, draft.metaExcl, allMeta);
    applied.gAccounts = pickKeys(draft.gSel, draft.gExcl, allG);
    applied.cmpOn = draft.cmpOn;
    applied.cmpT = draft.cmpT;
    applied.cmpN = draft.cmpN;
    applied.cmpEd = draft.cmpEd;
    applied.version++;
    persist();
    onApplied?.();
  }

  /** 重置为数据窗口默认（对齐原型：上个自然周数据窗口 → manifest view*） */
  function reset(viewStart: string, viewEnd: string): void {
    draft.start = viewStart;
    draft.end = viewEnd;
    draft.siteSel = ['Shopify'];
    draft.siteExcl = false;
    draft.metaSel = [];
    draft.metaExcl = false;
    draft.gSel = [];
    draft.gExcl = false;
    draft.cmpOn = true;
    draft.cmpT = 'week';
    draft.cmpN = 1;
    draft.cmpEd = null;
  }

  /** 生效的对比周期列表（cmpOn=false → 空） */
  const cmpRanges = computed<CmpRange[]>(() => resolveCmpRanges(applied));

  /** 站点桶键（小写；供 metaDayToMetrics / gmvAt） */
  const siteKeys = computed<string[]>(() => applied.sites.map((s) => s.toLowerCase()));

  return {
    draft,
    applied,
    dirty,
    cmpRanges,
    siteKeys,
    initDefaults,
    setAccountUniverse,
    apply,
    reset,
  };
});
