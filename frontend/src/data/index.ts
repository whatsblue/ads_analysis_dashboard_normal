/**
 * 数据访问层：视图/组件一律经此层取数，禁止直接 fetch。
 * v3：manifest/dims 全局文件 + months/<YYYY-MM>.json 月分片按需加载（内存缓存 per month）。
 * 数据文件统一带 ?v=<genAt> 查询串：内容变更即时生效，未变更期间长缓存。
 */
import { DATA_FILES, CONTRACT_VERSION, type Dims, type Manifest, type MonthSlice } from '@ads/shared';

const cache = new Map<string, Promise<unknown>>();
let genAt: string | null = null;

function dataUrl(rel: string): string {
  const base = import.meta.env.BASE_URL; // 含子路径，以 / 结尾
  const v = genAt ? `?v=${encodeURIComponent(genAt)}` : '';
  return `${base}data/${rel}${v}`;
}

async function load<T>(rel: string, label: string): Promise<T> {
  if (!cache.has(rel)) {
    cache.set(
      rel,
      fetch(dataUrl(rel)).then((r) => {
        if (!r.ok) throw new Error(`加载 ${label} 失败：HTTP ${r.status}`);
        return r.json() as Promise<T>;
      }),
    );
  }
  return cache.get(rel) as Promise<T>;
}

/** 首屏：manifest（校验契约版本，提供 months 列表） */
export async function loadManifest(): Promise<Manifest> {
  const m = await load<Manifest>(DATA_FILES.manifest, 'manifest.json');
  if (m.v !== CONTRACT_VERSION) {
    throw new Error(`数据契约版本不匹配（数据 v${m.v}，前端 v${CONTRACT_VERSION}），请刷新页面或联系维护者。`);
  }
  genAt = m.genAt;
  return m;
}

export function loadDims(): Promise<Dims> {
  return load<Dims>(DATA_FILES.dims, 'dims.json');
}

/** 月分片按需加载（月名来自 manifest.months；缓存键含月份） */
export function loadSlice(month: string): Promise<MonthSlice> {
  return load<MonthSlice>(`months/${month}.json`, `months/${month}.json`);
}

/** 测试辅助：清空缓存 */
export function resetDataCache(): void {
  cache.clear();
  genAt = null;
}
