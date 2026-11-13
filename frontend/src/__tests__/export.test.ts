import { describe, expect, it } from 'vitest';
import { csvCell, plainPct, safeFname } from '../utils/export';

describe('导出工具', () => {
  it('csvCell：逗号/引号/换行转义，null/undefined 为空', () => {
    expect(csvCell('abc')).toBe('abc');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('plainPct：带符号百分比；基数为 0/缺失/NaN → —', () => {
    expect(plainPct(110, 100)).toBe('10.00%');
    expect(plainPct(90, 100)).toBe('-10.00%');
    expect(plainPct(1, 0)).toBe('—');
    expect(plainPct(null, 100)).toBe('—');
    expect(plainPct(5, null)).toBe('—');
  });

  it('safeFname：文件名非法字符替换为下划线', () => {
    expect(safeFname('a/b:c*d?e"f<g>h|i')).toBe('a_b_c_d_e_f_g_h_i');
    expect(safeFname('正常标题')).toBe('正常标题');
  });
});
