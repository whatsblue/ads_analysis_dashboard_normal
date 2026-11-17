/**
 * 文件导出工具（迁移自原型 csvCell/dl/plainPct 与 doExport 的文件生成部分）。
 * MetricsTable/视图组装 rows: ExpCell[][] 后经此处下载。
 * 2026-11-17 用户定版：指标数值以真数值导出——xls 中为数值格式单元格（可求和、无引号文本），
 * 比率/占比/环比以 pct 对象传递（xls 百分比格式显示 10.17%）；文本单元格照旧转义。
 */
export type PctCell = { pct: number };
export type ExpCell = string | number | PctCell;

export function csvCell(v: unknown): string {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function dl(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** 环比变化率纯文本（导出用，'+'/'-'号，'—' 占位） */
export function plainPct(cur: number | null | undefined, prev: number | null | undefined): string {
  if (prev == null || isNaN(prev) || !prev) return '—';
  const p = ((cur ?? NaN) - prev) / prev * 100;
  if (!isFinite(p)) return '—';
  return p.toFixed(2) + '%';
}

/** 环比变化率数值单元格（导出用）：比率 0.1017 即 +10.17%；对比期无效时 '—' 占位 */
export function deltaCell(cur: number | null | undefined, prev: number | null | undefined): ExpCell {
  if (prev == null || isNaN(prev) || !prev) return '—';
  const p = ((cur ?? NaN) - prev) / prev;
  return isFinite(p) ? { pct: p } : '—';
}

export function downloadCsv(rows: ExpCell[][], fname: string): void {
  const cell = (c: ExpCell): string => {
    if (typeof c === 'object') return String(c.pct);
    if (typeof c === 'number') return String(c);
    return csvCell(c);
  };
  dl(new Blob(['\ufeff' + rows.map((r) => r.map(cell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }), fname + '.csv');
}

export function downloadXls(rows: ExpCell[][], fname: string): void {
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const td = (c: ExpCell): string => {
    if (typeof c === 'number') return '<td style="mso-number-format:\'' + (Number.isInteger(c) ? '#,##0' : '#,##0.00') + '\'">' + c + '</td>';
    if (typeof c === 'object') return '<td style="mso-number-format:\'0.00%\'">' + c.pct + '</td>';
    return '<td>' + esc(c) + '</td>';
  };
  const html =
    '<html><head><meta charset="UTF-8"></head><body><table border="1">' +
    rows.map((r) => '<tr>' + r.map(td).join('') + '</tr>').join('') +
    '</table></body></html>';
  dl(new Blob([html], { type: 'application/vnd.ms-excel' }), fname + '.xls');
}

/** 导出文件名净化（标题去除路径非法字符） */
export function safeFname(t: string): string {
  return t.replace(/[\\/:*?"<>|]/g, '_');
}
