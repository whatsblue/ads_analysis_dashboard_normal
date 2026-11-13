/**
 * 数据校验：契约 zod 结构校验 + 交叉自洽断言。
 * 任一失败 → 抛错（管道整体失败，不写盘/不提交半成品）。
 */
import {
  ChannelSchema,
  DimsSchema,
  GoogleDimBucketSchema,
  GoogleDimSchema,
  GoogleTypeSchema,
  ManifestSchema,
  MetaCreativeSchema,
  MetaDimBucketSchema,
  MetaDimSchema,
} from '@ads/shared/schema';
import type { RawDataset } from './sources/types';

export interface ValidateOptions {
  /** 相对/绝对容差（默认 0.01） */
  tolerance?: number;
}

export function validateDataset(ds: RawDataset, opts: ValidateOptions = {}): void {
  const tol = opts.tolerance ?? 0.01;

  // 1) 结构校验（zod）
  ManifestSchema.parse(ds.manifest);
  DimsSchema.parse(ds.dims);
  ChannelSchema.parse(ds.channel);
  MetaDimBucketSchema.parse(ds.metaAcc);
  MetaDimBucketSchema.parse(ds.metaCamp);
  MetaDimBucketSchema.parse(ds.metaSpu);
  MetaDimSchema.parse(ds.metaDim);
  MetaCreativeSchema.parse(ds.metaCreative);
  MetaDimBucketSchema.parse(ds.metaAd);
  GoogleDimBucketSchema.parse(ds.googleAcc);
  GoogleDimSchema.parse(ds.googleDim);
  GoogleDimBucketSchema.parse(ds.googleSpu);
  GoogleTypeSchema.parse(ds.googleType);

  // 2) 非负断言
  assertNonNegative('channel.meta', ds.channel.meta);
  assertNonNegative('channel.google', ds.channel.google);

  // 3) 交叉自洽（对抽样日期断言，避免全量逐日开销；抽样=首日/末日/中间日）
  const metaDates = Object.keys(ds.channel.meta).sort();
  const sampleDates = pickSamples(metaDates);
  for (const d of sampleDates) {
    // Σ(meta/acc 各账号某日 A.spend) == channel.meta[某日].A.spend
    let accSpend = 0;
    for (const acc of Object.keys(ds.metaAcc)) {
      const day = ds.metaAcc[acc]?.[d];
      const a = day?.A;
      if (a) accSpend += a[0];
    }
    const chSpend = ds.channel.meta[d]?.A?.[0] ?? 0;
    if (Math.abs(accSpend - chSpend) > tol) {
      throw new Error(
        `交叉自洽失败：${d} ΣmetaAcc.A.spend=${accSpend.toFixed(2)} ≠ channel.meta.A.spend=${chSpend.toFixed(2)}`,
      );
    }

    // A 键 = Σ分站点（抽 meta 渠道桶）
    const day = ds.channel.meta[d];
    if (day && day.A) {
      let siteSpend = 0;
      for (const k of Object.keys(day)) {
        if (k === 'A') continue;
        const v = day[k as 'shopify' | 'shoplazza' | 'unknown'];
        if (v) siteSpend += v[0];
      }
      if (Math.abs(siteSpend - day.A[0]) > tol) {
        throw new Error(`A 键校验失败：channel.meta[${d}] Σ站点=${siteSpend.toFixed(2)} ≠ A=${day.A[0].toFixed(2)}`);
      }
    }
  }

  const gDates = Object.keys(ds.channel.google).sort();
  for (const d of pickSamples(gDates)) {
    // Σ(google/type 组合 spend) == channel.google.spend
    let tbSpend = 0;
    for (const key of Object.keys(ds.googleType.typeBrand)) {
      const cell = ds.googleType.typeBrand[key]?.[d];
      if (cell) tbSpend += cell[0];
    }
    const chSpend = ds.channel.google[d]?.[0] ?? 0;
    if (Math.abs(tbSpend - chSpend) > tol) {
      throw new Error(
        `交叉自洽失败：${d} ΣgoogleType.spend=${tbSpend.toFixed(2)} ≠ channel.google.spend=${chSpend.toFixed(2)}`,
      );
    }
  }

  // 4) 日期范围覆盖
  const allDates = [...metaDates, ...gDates].sort();
  if (allDates.length) {
    const { min, max } = ds.manifest.range;
    if (allDates[0] < min || allDates[allDates.length - 1] > max) {
      throw new Error(
        `日期越界：数据日期 ${allDates[0]}~${allDates[allDates.length - 1]} 超出 manifest.range ${min}~${max}`,
      );
    }
  }
}

function pickSamples(sorted: string[]): string[] {
  if (sorted.length <= 3) return sorted;
  return [sorted[0], sorted[Math.floor(sorted.length / 2)], sorted[sorted.length - 1]];
}

function assertNonNegative(path: string, obj: unknown, depth = 0): void {
  if (depth > 6) return;
  if (typeof obj === 'number') {
    if (obj < 0) throw new Error(`非负断言失败：${path} = ${obj}`);
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => assertNonNegative(`${path}[${i}]`, v, depth + 1));
    return;
  }
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) assertNonNegative(`${path}.${k}`, (obj as Record<string, unknown>)[k], depth + 1);
  }
}
