/**
 * emitMonthly 合并基线单测（2026-11-26）：近窗日常批次（PIPELINE_MERGE=true）重生成时
 * 保留窗口外历史月份清单（manifest.months/range.min）与全局 dims 并集，旧分片文件不动；
 * 不开 merge 时行为与旧版一致（纯覆盖）。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, type Dims } from '@ads/shared';
import { emitMonthly, type MonthlyEmitPayload } from '../src/build/emit';

let dir: string | null = null;

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = null;
  }
});

function dimsOf(extra: Partial<Dims> = {}): Dims {
  return {
    metaAccounts: [], gAccounts: [], metaCampaigns: [], gCampaigns: [], metaCampNames: {},
    spus: [], gSpus: [], spuAccs: {}, types: [], countries: [], ages: [], combos: [], adList: [],
    ...extra,
  };
}

function sliceOf(month: string): MonthlyEmitPayload['slices'][number] {
  return {
    month, channel: {}, metaAcc: {}, metaCamp: {}, metaSpu: {}, metaDim: {},
    metaCreative: {}, metaAd: {}, googleAcc: {}, googleDim: {}, googleSpu: {}, googleType: {}, googleCmp: {},
  };
}

function payload(months: string[], min: string, max: string, dims: Dims): MonthlyEmitPayload {
  return {
    manifest: { v: CONTRACT_VERSION, genAt: '2026-11-26 12:00', scope: 'reorc', months, range: { min, max, viewStart: max, viewEnd: max } },
    dims,
    slices: months.map(sliceOf),
  };
}

describe('emitMonthly mergeBaseline', () => {
  it('首次运行（无基线）：merge 开与不开等价，仅写本窗口月份', () => {
    dir = mkdtempSync(join(tmpdir(), 'emit-mb-'));
    const p = payload(['2026-10', '2026-11'], '2026-10-01', '2026-11-24', dimsOf({ metaAccounts: ['A1'] }));
    const r = emitMonthly(p, dir, { mergeBaseline: true });
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    expect(m.months).toEqual(['2026-10', '2026-11']);
    expect(m.range.min).toBe('2026-10-01');
    expect(r.files.map((f) => f.path)).toContain('months/2026-10.json');
  });

  it('有基线 + merge：months 并集排序、range.min 保留旧值、dims/adList 并集去重、旧分片文件保留', () => {
    dir = mkdtempSync(join(tmpdir(), 'emit-mb-'));
    // 先落一个「历史全量」基线（2025-01~2025-02 + 2026-09）
    const base = payload(['2025-01', '2025-02', '2026-09'], '2025-01-01', '2026-09-30',
      dimsOf({ metaAccounts: ['A1', 'A2'], spus: ['S1'], adList: [['ad-1', 'image', '1'], ['ad-2', 'video', '2']] }));
    emitMonthly(base, dir);
    // 近窗批次（2026-10~2026-11）合并基线重写
    const near = payload(['2026-10', '2026-11'], '2026-10-01', '2026-11-24',
      dimsOf({ metaAccounts: ['A2', 'A3'], spus: ['S2'], adList: [['ad-2', 'video', '2'], ['ad-3', 'image', '3']] }));
    emitMonthly(near, dir, { mergeBaseline: true });

    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    expect(m.months).toEqual(['2025-01', '2025-02', '2026-09', '2026-10', '2026-11']);
    expect(m.range.min).toBe('2025-01-01');
    expect(m.range.max).toBe('2026-11-24');

    const dims = JSON.parse(readFileSync(join(dir, 'dims.json'), 'utf8'));
    expect(dims.metaAccounts).toEqual(['A1', 'A2', 'A3']); // 并集去重排序
    expect(dims.spus).toEqual(['S1', 'S2']);
    const ads = JSON.parse(readFileSync(join(dir, 'dims-ads.json'), 'utf8'));
    expect(ads.adList).toEqual([['ad-1', 'image', '1'], ['ad-2', 'video', '2'], ['ad-3', 'image', '3']]);

    // 窗口外旧分片原样保留且内容未被触碰
    expect(existsSync(join(dir, 'months/2025-01.json'))).toBe(true);
    const old = JSON.parse(readFileSync(join(dir, 'months/2025-01.json'), 'utf8'));
    expect(old.month).toBe('2025-01');
    expect(existsSync(join(dir, 'months/2026-11.json'))).toBe(true);
  });

  it('有基线 + 不开 merge：纯覆盖（months 只含新窗口，行为同旧版）', () => {
    dir = mkdtempSync(join(tmpdir(), 'emit-mb-'));
    emitMonthly(payload(['2025-01'], '2025-01-01', '2025-01-31', dimsOf({ metaAccounts: ['A1'] })), dir);
    emitMonthly(payload(['2026-11'], '2026-11-01', '2026-11-24', dimsOf({ metaAccounts: ['A9'] })), dir);
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    expect(m.months).toEqual(['2026-11']);
    expect(m.range.min).toBe('2026-11-01');
    const dims = JSON.parse(readFileSync(join(dir, 'dims.json'), 'utf8'));
    expect(dims.metaAccounts).toEqual(['A9']);
  });

  it('基线 manifest 损坏时 fail-fast 抛错（不允许静默丢历史月份）', () => {
    dir = mkdtempSync(join(tmpdir(), 'emit-mb-'));
    writeFileSync(join(dir, 'manifest.json'), 'not-json{');
    const p = payload(['2026-11'], '2026-11-01', '2026-11-24', dimsOf());
    expect(() => emitMonthly(p, dir, { mergeBaseline: true })).toThrow();
  });
});
