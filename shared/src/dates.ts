/**
 * 日期工具（迁移自原型 d2s/s2d/addDays/addMonths/daysBetween）。
 * 所有日期均为本地时区自然日字符串（YYYY-MM-DD）。
 */

const DAY = 86400000;

export function d2s(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function s2d(s: string): Date {
  return new Date(s + 'T00:00:00');
}

export function addDays(s: string, n: number): string {
  return d2s(new Date(s2d(s).getTime() + n * DAY));
}

/** 加 n 月（月末日期钳制到目标月最后一天；原型 addMonths） */
export function addMonths(s: string, n: number): string {
  const d = s2d(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d2s(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((s2d(b).getTime() - s2d(a).getTime()) / DAY);
}

export interface CmpRange {
  label: string;
  start: string;
  end: string;
}

/**
 * 环比对比周期（原型 cmpAuto）。
 * @param type week|month|year|custom
 * @param n 周期数（1=上一期）
 */
export function cmpAuto(
  start: string,
  end: string,
  type: 'week' | 'month' | 'year' | 'custom',
  n: number,
): CmpRange[] {
  const out: CmpRange[] = [];
  for (let k = 1; k <= n; k++) {
    if (type === 'week') {
      out.push({ label: k === 1 ? '上周同期' : k + '周前同期', start: addDays(start, -7 * k), end: addDays(end, -7 * k) });
    } else if (type === 'month') {
      out.push({
        label: k === 1 ? '上月同期' : k + '个月前同期',
        start: addMonths(start, -k),
        end: addMonths(end, -k),
      });
    } else if (type === 'year') {
      out.push({
        label: k === 1 ? '去年同期' : k + '年前同期',
        start: addMonths(start, -12 * k),
        end: addMonths(end, -12 * k),
      });
    } else {
      const len = daysBetween(start, end) + 1;
      const s = addDays(start, -len * k);
      out.push({ label: '自定义周期' + k, start: s, end: addDays(s, len - 1) });
    }
  }
  return out;
}

/** 区间内自然日列表（含端点） */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  let d = start;
  while (d <= end) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

/** [min,max] 覆盖的自然月列表（YYYY-MM 升序；窗口切片与 manifest.months 共用） */
export function monthsCover(min: string, max: string): string[] {
  const out: string[] = [];
  if (min > max) return out;
  let cur = min.slice(0, 7);
  for (let guard = 0; guard < 240; guard++) {
    out.push(cur);
    const nextM = addMonths(`${cur}-01`, 1).slice(0, 7);
    if (nextM > max.slice(0, 7)) break;
    cur = nextM;
  }
  return out;
}
