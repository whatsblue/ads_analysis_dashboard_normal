/**
 * 环比值 hover 归因浮层的全局通信（迁移自原型 ATTR_TIDS/showAttr 机制）。
 * MetricsTable 的 Δ 行格 mouseenter → showAttr；App 级 <AttrTip> 读取状态渲染。
 */
import { reactive } from 'vue';

export interface AttrPayload {
  /** 表 id（区分渠道：m1=meta / gm1=google / ca=渠道行键判断） */
  tid: string;
  /** 指标键 */
  hk: string;
  /** 涨跌方向（up/down/flat） */
  dir: string;
  /** 行键（ca 表为渠道名；m1/gm1 为空） */
  rk: string;
  /** 对比期 */
  cs: string;
  ce: string;
}

interface AttrState {
  on: boolean;
  payload: AttrPayload | null;
  /** 触发格矩形（定位用） */
  rect: { left: number; top: number; right: number; bottom: number; width: number; height: number } | null;
}

const state = reactive<AttrState>({ on: false, payload: null, rect: null });

let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function showAttr(td: HTMLElement, p: AttrPayload): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  const r = td.getBoundingClientRect();
  state.rect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  state.payload = p;
  state.on = true;
}

/** 延迟隐藏（缓冲：鼠标移向浮层途中不闪没） */
export function hideAttrLater(ms = 150): void {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    state.on = false;
    hideTimer = null;
  }, ms);
}

export function hideAttr(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  state.on = false;
}

/** 浮层自身 hover 时取消隐藏 */
export function cancelHide(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

export function useAttrState(): AttrState {
  return state;
}
