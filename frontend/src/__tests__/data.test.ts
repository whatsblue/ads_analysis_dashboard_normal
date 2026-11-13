import { describe, expect, it } from 'vitest';
import { DATA_FILES } from '@ads/shared';
import { resetDataCache } from '../data';

describe('数据访问层 URL 构造', () => {
  it('DATA_FILES 覆盖 13 个契约文件', () => {
    expect(Object.keys(DATA_FILES)).toHaveLength(13);
    expect(DATA_FILES.manifest).toBe('manifest.json');
    expect(DATA_FILES.metaCreative).toBe('meta/creative.json');
    expect(DATA_FILES.googleType).toBe('google/type.json');
  });

  it('resetDataCache 可重置（fetch 尚未发生不报错）', () => {
    expect(() => resetDataCache()).not.toThrow();
  });
});
