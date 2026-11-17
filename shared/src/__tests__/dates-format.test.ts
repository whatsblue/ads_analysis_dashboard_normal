import { describe, expect, it } from 'vitest';
import { addDays, addMonths, cmpAuto, dateRange, daysBetween, lastFullWeek } from '../dates';
import { deltaPct, deltaText, fmtInt, fmtMoney, fmtPct, fmtRoas } from '../format';

describe('日期工具（对齐原型 addDays/addMonths/cmpAuto）', () => {
  it('addDays 跨月', () => {
    expect(addDays('2026-10-28', 5)).toBe('2026-11-02');
    expect(addDays('2026-11-02', -5)).toBe('2026-10-28');
  });

  it('lastFullWeek：上一个完整自然周（周一～周日，2026-11-17 定版默认窗口）', () => {
    /* 周二 2026-11-17 → 上周一～上周日（用户示例） */
    expect(lastFullWeek(new Date(2026, 10, 17))).toEqual({ start: '2026-11-09', end: '2026-11-15' });
    /* 周一 → 前一天结尾的那一周 */
    expect(lastFullWeek(new Date(2024, 4, 6))).toEqual({ start: '2024-04-29', end: '2024-05-05' });
    /* 周日 → 本周未结束，仍返回再前一周 */
    expect(lastFullWeek(new Date(2026, 10, 15))).toEqual({ start: '2026-11-02', end: '2026-11-08' });
  });

  it('addMonths 月末钳制', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-10-26', -1)).toBe('2026-09-26');
  });

  it('daysBetween', () => {
    expect(daysBetween('2026-10-01', '2026-10-08')).toBe(7);
  });

  it('cmpAuto 周/月环比', () => {
    const [w] = cmpAuto('2026-10-26', '2026-11-01', 'week', 1);
    expect(w.label).toBe('上周同期');
    expect(w.start).toBe('2026-10-19');
    expect(w.end).toBe('2026-10-25');

    const [m] = cmpAuto('2026-10-26', '2026-11-01', 'month', 1);
    expect(m.start).toBe('2026-09-26');
    expect(m.end).toBe('2026-10-01');
  });

  it('dateRange 含端点', () => {
    expect(dateRange('2026-11-01', '2026-11-03')).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
  });
});

describe('格式化（对齐原型 fmt*）', () => {
  it('缺失值渲染 —', () => {
    expect(fmtInt(NaN)).toBe('—');
    expect(fmtMoney(null)).toBe('—');
    expect(fmtPct(undefined)).toBe('—');
    expect(fmtRoas(NaN)).toBe('—');
  });

  it('常规格式', () => {
    expect(fmtInt(1234567.4)).toBe('1,234,567');
    expect(fmtMoney(1234.5)).toBe('$1,234.50');
    expect(fmtPct(0.123456)).toBe('12.35%');
    expect(fmtRoas(3.456)).toBe('3.46');
  });

  it('deltaPct：prev 缺失/0/Infinity → null', () => {
    expect(deltaPct(2, 1)).toBe(100);
    expect(deltaPct(1, 0)).toBeNull();
    expect(deltaPct(1, null)).toBeNull();
    expect(deltaPct(0, 0)).toBeNull();
  });

  it('deltaText 带符号', () => {
    expect(deltaText(1.0325, 1.0)).toBe('+3.25%');
    expect(deltaText(0.9, 1.0)).toBe('-10.00%');
    expect(deltaText(1, null)).toBe('—');
  });
});
