/**
 * 展示格式化（全站统一；迁移自原型 fmtInt/fmtMoney/fmtPct/fmtRoas/deltaHtml/plainPct）。
 * 约定：null/undefined/NaN → '—'（数据缺失占位）。
 */

export function fmtInt(v: number | null | undefined): string {
  return v == null || isNaN(v) ? '—' : Math.round(v).toLocaleString('en-US');
}

export function fmtMoney(v: number | null | undefined): string {
  return v == null || isNaN(v)
    ? '—'
    : '$' +
        Number(v).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
}

export function fmtPct(v: number | null | undefined): string {
  return v == null || isNaN(v) ? '—' : (v * 100).toFixed(2) + '%';
}

export function fmtRoas(v: number | null | undefined): string {
  return v == null || isNaN(v) ? '—' : v.toFixed(2);
}

/** 环比变化率（%）。prev 缺失/为 0 → null（展示 '—'）；cur 相对 prev 变化无穷大 → null（原型：不渲染） */
export function deltaPct(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (prev == null || isNaN(prev) || !prev) return null;
  const p = ((cur! - prev) / prev) * 100;
  return isFinite(p) ? p : null;
}

/** 环比变化率展示文本（带符号，如 '+3.25%' / '-1.10%' / '—'） */
export function deltaText(cur: number | null | undefined, prev: number | null | undefined): string {
  const p = deltaPct(cur, prev);
  if (p == null) return '—';
  return (p >= 0 ? '+' : '') + p.toFixed(2) + '%';
}

export function esc(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
}
