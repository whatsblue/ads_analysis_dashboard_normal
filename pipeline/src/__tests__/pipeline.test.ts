import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRdFile, rdToDataset } from '../sources/rdfile';
import { validateDataset } from '../validate';
import { emitDataset } from '../build/emit';

/** 最小可用 RD fixture：2 账号 × 2 日 × 2 站点，含 A 合计 */
function rdFixture(): string {
  const day1 = {
    shopify: [100, 2000, 300, 10, 1500, 20, 8],
    shoplazza: [50, 1000, 150, 5, 700, 10, 4],
    A: [150, 3000, 450, 15, 2200, 30, 12],
  };
  const day2 = {
    shopify: [120, 2400, 360, 12, 1800, 24, 9],
    shoplazza: [60, 1200, 180, 6, 840, 12, 5],
    A: [180, 3600, 540, 18, 2640, 36, 14],
  };
  const rd = {
    v: 1,
    genAt: '2026-11-07 16:43',
    range: { min: '2026-11-01', max: '2026-11-02', viewStart: '2026-11-01', viewEnd: '2026-11-02' },
    scope: 'fixture',
    metaAccounts: ['acc-a', 'acc-b'],
    gAccounts: ['gacc-a'],
    metaCampaigns: ['camp-1'],
    gCampaigns: ['gcamp-1'],
    spus: ['SPU1'],
    gSpus: ['GSPU1'],
    spuAccs: { SPU1: ['acc-a'] },
    types: ['视频广告'],
    countries: ['United States'],
    ages: ['25-34'],
    combos: [['search', 'brand']],
    adList: [['ad-1', '视频广告', 'KOL']],
    ch: {
      meta: { '2026-11-01': day1, '2026-11-02': day2 },
      google: { '2026-11-01': [30, 5000, 100, 3, 500, 400], '2026-11-02': [36, 6000, 120, 4, 600, 480] },
    },
    acc: { 'acc-a': { '2026-11-01': day1, '2026-11-02': day2 }, 'acc-b': {} },
    gacc: { 'gacc-a': { '2026-11-01': [30, 5000, 100, 3, 500, 400], '2026-11-02': [36, 6000, 120, 4, 600, 480] } },
    camp: { 'camp-1': { '2026-11-01': day1, '2026-11-02': day2 } },
    gcmp: { '999': { '2026-11-01': [30, 5000, 100, 3, 500, 400] } },
    spu: { SPU1: { '2026-11-01': { ...day1, A: [...day1.A, 450] } } },
    gspu: { GSPU1: { '2026-11-01': [30, 5000, 100, 3, 500, 400] } },
    sub: { 视频广告: { KOL: { '2026-11-01': { shopify: day1.shopify } } } },
    sub2: { 视频广告: { 新素材: { '2026-11-01': { shopify: day1.shopify } } } },
    ctype: { SEARCH: { '2026-11-01': { ...day1 } } },
    ad: { '0': { '2026-11-01': day1 } },
    ctry: { 'United States': { '2026-11-01': day1 } },
    age: { '25-34': { '2026-11-01': day1 } },
    gcty: { 'United States': { '2026-11-01': [30, 5000, 100, 3, 500, 400, 110] } },
    gage: { '25-34': { '2026-11-01': [30, 5000, 100, 3, 500, 400] } },
    gc: { 'search|brand': { '2026-11-01': [30, 5000, 100, 3, 500, 400], '2026-11-02': [36, 6000, 120, 4, 600, 480] } },
    gmv: { '2026-11-01': { shopify: [3000, 20], A: [3000, 20] } },
    edm: { '2026-11-01': [100] },
  };
  return 'window.RD=' + JSON.stringify(rd);
}

describe('rdfile 通道', () => {
  it('解析 ads_real.js → RawDataset 并通过校验', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adn-rd-'));
    const file = join(dir, 'ads_real.js');
    writeFileSync(file, rdFixture(), 'utf8');
    try {
      const rd = parseRdFile(file);
      const ds = rdToDataset(rd);
      expect(ds.manifest.genAt).toBe('2026-11-07 16:43');
      expect(ds.dims.metaAccounts).toEqual(['acc-a', 'acc-b']);
      expect(ds.channel.meta['2026-11-01'].A).toHaveLength(7);
      expect(ds.metaCreative.sub['视频广告'].KOL).toBeTruthy();
      expect(ds.googleCmp?.['999']?.['2026-11-01']).toHaveLength(6);
      validateDataset(ds); // 不抛错
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('emit 写盘产物可被 JSON 解析且文件清单完整', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adn-emit-'));
    const file = join(dir, 'ads_real.js');
    writeFileSync(file, rdFixture(), 'utf8');
    const out = join(dir, 'data');
    try {
      const ds = rdToDataset(parseRdFile(file));
      const result = emitDataset(ds, out);
      expect(result.files.map((f) => f.path)).toContain('meta/creative.json');
      expect(result.files.map((f) => f.path)).toContain('google/cmp.json');
      const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
      expect(manifest.v).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('validate 交叉自洽', () => {
  it('Σ账号 ≠ 渠道时抛错', () => {
    const ds = rdToDataset(JSON.parse(rdFixture().replace('window.RD=', '')) as never);
    // 破坏：channel.meta 某日 spend 改大
    ds.channel.meta['2026-11-01'].A![0] = 999;
    expect(() => validateDataset(ds)).toThrow(/交叉自洽失败/);
  });

  it('A ≠ Σ站点时抛错', () => {
    const ds = rdToDataset(JSON.parse(rdFixture().replace('window.RD=', '')) as never);
    // 破坏分站点值：A(180) ≠ Σ站点(61)，但 Σ账号仍=channel.A → 只触发 A 键校验
    ds.channel.meta['2026-11-02'].shopify![0] = 1;
    expect(() => validateDataset(ds)).toThrow(/A 键校验失败/);
  });

  it('负值抛错', () => {
    const ds = rdToDataset(JSON.parse(rdFixture().replace('window.RD=', '')) as never);
    ds.channel.google['2026-11-01'][0] = -5;
    expect(() => validateDataset(ds)).toThrow(/非负断言失败/);
  });
});
