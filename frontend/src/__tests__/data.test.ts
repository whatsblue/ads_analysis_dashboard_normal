import { describe, expect, it } from 'vitest';
import { DATA_FILES } from '@ads/shared';
import { resetDataCache } from '../data';

describe('数据访问层契约', () => {
  it('DATA_FILES 覆盖 14 个契约文件（v2：账号桶独立拆分）', () => {
    expect(Object.keys(DATA_FILES)).toHaveLength(14);
    expect(DATA_FILES.manifest).toBe('manifest.json');
    expect(DATA_FILES.metaAcc).toBe('meta/acc.json');
    expect(DATA_FILES.googleAcc).toBe('google/acc.json');
    expect(DATA_FILES.metaCreative).toBe('meta/creative.json');
    expect(DATA_FILES.googleType).toBe('google/type.json');
    expect(DATA_FILES.googleCmp).toBe('google/cmp.json');
  });

  it('resetDataCache 可重置（fetch 尚未发生不报错）', () => {
    expect(() => resetDataCache()).not.toThrow();
  });
});
