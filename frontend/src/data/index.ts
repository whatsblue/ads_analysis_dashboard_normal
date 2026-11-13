/**
 * 数据访问层：视图/组件一律经此层取数，禁止直接 fetch。
 * - 按 DataFileKey 懒加载 + 内存缓存
 * - 数据文件统一带 ?v=<genAt> 查询串：内容变更即时生效，未变更期间长缓存
 */
import { DATA_FILES, CONTRACT_VERSION, type ChannelData, type Dims, type Manifest } from '@ads/shared';

const cache = new Map<string, Promise<unknown>>();
let genAt: string | null = null;

function dataUrl(key: keyof typeof DATA_FILES): string {
  const base = import.meta.env.BASE_URL; // 含子路径，以 / 结尾
  const v = genAt ? `?v=${encodeURIComponent(genAt)}` : '';
  return `${base}data/${DATA_FILES[key]}${v}`;
}

async function load<T>(key: keyof typeof DATA_FILES): Promise<T> {
  if (!cache.has(key)) {
    cache.set(
      key,
      fetch(dataUrl(key)).then((r) => {
        if (!r.ok) throw new Error(`加载 ${DATA_FILES[key]} 失败：HTTP ${r.status}`);
        return r.json() as Promise<T>;
      }),
    );
  }
  return cache.get(key) as Promise<T>;
}

/** 首屏：manifest（校验契约版本） */
export async function loadManifest(): Promise<Manifest> {
  const m = await load<Manifest>('manifest');
  if (m.v !== CONTRACT_VERSION) {
    throw new Error(`数据契约版本不匹配（数据 v${m.v}，前端 v${CONTRACT_VERSION}），请刷新页面或联系维护者。`);
  }
  genAt = m.genAt;
  return m;
}

export function loadDims(): Promise<Dims> {
  return load<Dims>('dims');
}

export function loadChannel(): Promise<ChannelData> {
  return load<ChannelData>('channel');
}

/** 其余维度文件按需懒加载（视图进入时才请求，见 specs/） */
export function loadData<T>(key: keyof typeof DATA_FILES): Promise<T> {
  return load<T>(key);
}

/** 测试辅助：清空缓存 */
export function resetDataCache(): void {
  cache.clear();
  genAt = null;
}
