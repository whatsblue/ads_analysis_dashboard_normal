/**
 * 契约文件写盘：全部文件先写 .tmp 再原子 rename，失败不残留半成品。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { MonthSlice } from '@ads/shared';
import type { RawDataset } from '../sources/types';
import { mergeDims } from '../sources/reorc/monthly';

export interface EmitResult {
  outDir: string;
  files: { path: string; bytes: number }[];
}

export function emitDataset(ds: RawDataset, outDir: string): EmitResult {
  const entries: [string, unknown][] = [
    ['manifest.json', ds.manifest],
    ['dims.json', ds.dims],
    ['channel.json', ds.channel],
    ['meta/acc.json', ds.metaAcc],
    ['meta/camp.json', ds.metaCamp],
    ['meta/spu.json', ds.metaSpu],
    ['meta/dim.json', ds.metaDim],
    ['meta/creative.json', ds.metaCreative],
    ['meta/ad.json', ds.metaAd],
    ['google/acc.json', ds.googleAcc],
    ['google/dim.json', ds.googleDim],
    ['google/spu.json', ds.googleSpu],
    ['google/type.json', ds.googleType],
    ['google/cmp.json', ds.googleCmp ?? {}],
  ];

  const files: { path: string; bytes: number }[] = [];
  for (const [rel, data] of entries) {
    const target = join(outDir, rel);
    mkdirSync(dirname(target), { recursive: true });
    const tmp = target + '.tmp';
    const buf = Buffer.from(JSON.stringify(data), 'utf8');
    writeFileSync(tmp, buf);
    renameSync(tmp, target);
    files.push({ path: rel, bytes: buf.byteLength });
  }
  // 清理可能残留的 .tmp（历史失败）
  cleanupTmp(outDir);
  return { outDir, files };
}

function cleanupTmp(dir: string) {
  // 仅清理本目录两层的 .tmp 残留
  for (const sub of ['', 'meta', 'google']) {
    const d = join(dir, sub);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (f.endsWith('.tmp') && statSync(p).isFile()) {
        try {
          unlinkSync(p);
        } catch {
          /* 忽略清理失败 */
        }
      }
    }
  }
}

export function removeDataDir(outDir: string): void {
  rmSync(outDir, { recursive: true, force: true });
}

/** v3：manifest + dims（core，无 adList）+ dims-ads.json（adList 懒加载拆分）+ months/<YYYY-MM>.json；
 *  先全局文件后 manifest（加载器以 manifest 为准） */
export interface MonthlyEmitPayload {
  manifest: RawDataset['manifest'];
  dims: RawDataset['dims'];
  slices: MonthSlice[];
}

export function emitMonthly(payload: MonthlyEmitPayload, outDir: string, opts?: {
  /** 合并基线（2026-11-26）：true 时读取 outDir 现有 manifest/dims，months/range.min/dims 取并集——
   *  近窗日常批次（只拉最近月份）不丢历史月份分片清单与全局枚举；窗口外旧分片文件原样保留 */
  mergeBaseline?: boolean;
}): EmitResult {
  removeV2Files(outDir);
  const files: { path: string; bytes: number }[] = [];
  const write = (rel: string, data: unknown) => {
    const target = join(outDir, rel);
    mkdirSync(dirname(target), { recursive: true });
    const tmp = target + '.tmp';
    const buf = Buffer.from(JSON.stringify(data), 'utf8');
    writeFileSync(tmp, buf);
    renameSync(tmp, target);
    files.push({ path: rel, bytes: buf.byteLength });
  };
  let { dims, manifest } = payload;
  if (opts?.mergeBaseline) {
    const base = readBaseline(outDir);
    if (base) {
      dims = mergeDims(base.dims, dims);
      manifest = {
        ...manifest,
        months: [...new Set([...base.manifest.months, ...manifest.months])].sort(),
        range: {
          ...manifest.range,
          min: base.manifest.range.min < manifest.range.min ? base.manifest.range.min : manifest.range.min,
        },
      };
    }
  }
  // dims 拆分：core（无 adList）+ dims-ads.json（adList 专文件，前端仅 m4 下钻懒加载）
  const { adList, ...coreDims } = dims;
  void adList;
  write('dims.json', coreDims);
  write('dims-ads.json', { adList: dims.adList });
  for (const s of payload.slices) write(`months/${s.month}.json`, s);
  write('manifest.json', manifest); // 最后写：前端以 manifest.v/months 为准
  cleanupTmpMonths(outDir);
  return { outDir, files };
}

/** 读取现有落盘的 manifest 与 dims（core+adList 重组）作合并基线；首次运行无旧数据返回 null */
function readBaseline(outDir: string): { manifest: RawDataset['manifest']; dims: RawDataset['dims'] } | null {
  const mPath = join(outDir, 'manifest.json');
  if (!existsSync(mPath)) return null;
  const manifest = JSON.parse(readFileSync(mPath, 'utf8')) as RawDataset['manifest'];
  const core = JSON.parse(readFileSync(join(outDir, 'dims.json'), 'utf8')) as Omit<RawDataset['dims'], 'adList'>;
  const adsPath = join(outDir, 'dims-ads.json');
  const ads = existsSync(adsPath) ? (JSON.parse(readFileSync(adsPath, 'utf8')) as { adList: string[][] }) : { adList: [] };
  return { manifest, dims: { ...core, adList: ads.adList } as RawDataset['dims'] };
}

/** v2 遗留文件清理（channel.json/meta/google 目录；前端 v3 不再请求） */
function removeV2Files(outDir: string): void {
  for (const rel of ['channel.json', 'meta', 'google']) {
    rmSync(join(outDir, rel), { recursive: true, force: true });
  }
}

function cleanupTmpMonths(outDir: string): void {
  const d = join(outDir, 'months');
  if (!existsSync(d)) return;
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (f.endsWith('.tmp') && statSync(p).isFile()) {
      try {
        unlinkSync(p);
      } catch {
        /* 忽略清理失败 */
      }
    }
  }
}
