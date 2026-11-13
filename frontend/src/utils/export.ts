/**
 * 文件导出工具（迁移自原型 csvCell/dl/plainPct 与 doExport 的文件生成部分）。
 * MetricsTable/视图组装 rows: string[][] 后经此处下载。
 */
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

export function downloadCsv(rows: string[][], fname: string): void {
  dl(new Blob(['\ufeff' + rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }), fname + '.csv');
}

export function downloadXls(rows: string[][], fname: string): void {
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html =
    '<html><head><meta charset="UTF-8"></head><body><table border="1">' +
    rows.map((r) => '<tr>' + r.map((c) => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') +
    '</table></body></html>';
  dl(new Blob([html], { type: 'application/vnd.ms-excel' }), fname + '.xls');
}

/** 导出文件名净化（标题去除路径非法字符） */
export function safeFname(t: string): string {
  return t.replace(/[\\/:*?"<>|]/g, '_');
}
