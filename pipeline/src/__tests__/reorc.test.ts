/**
 * ReOrc 通道单测：client（401/业务错/分页）+ queries（模板完备性）+ rows（映射与防御）
 * + 组装闭环（mock fetch → rowsToDataset → validateDataset 全通过）。
 */
import { describe, expect, it } from 'vitest';
import { createReorcClient, ReorcApiError, ReorcConfigError, type Row } from '../sources/reorc/client';
import { discoverReorcTarget, extractDatabaseNames } from '../sources/reorc/discover';
import { REORC_QUERIES, REORC_TOPIC_IDS } from '../sources/reorc/queries';
import { rowsToDataset } from '../sources/reorc/rows';
import { createReorcSource } from '../sources/reorc';
import { validateDataset } from '../validate';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const ok = (data: unknown) => jsonResponse(200, { code: '0', data });

describe('reorc client', () => {
  it('HTTP 401 → ReorcConfigError 并提示刷新步骤', async () => {
    const client = createReorcClient({ baseUrl: 'https://x/api', token: 'expired', fetchImpl: async () => jsonResponse(401, {}) });
    await expect(client.get('/infra/environments')).rejects.toBeInstanceOf(ReorcConfigError);
    await expect(client.get('/infra/environments')).rejects.toThrow(/reorc-cli login/);
  });

  it('业务 code != 0 → ReorcApiError 携带 msg', async () => {
    const client = createReorcClient({
      baseUrl: 'https://x/api',
      token: 't',
      fetchImpl: async () => jsonResponse(200, { code: '50001', msg: 'boom' }),
    });
    await expect(client.get('/projects')).rejects.toThrow(ReorcApiError);
    await expect(client.get('/projects')).rejects.toThrow('boom');
  });

  it('sqlQueryAll 分页拉全量并按列名转对象行', async () => {
    let call = 0;
    const client = createReorcClient({
      baseUrl: 'https://x/api',
      token: 't',
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init!.body));
        expect(body.offset).toBe(call === 0 ? 0 : 2);
        call++;
        const rows = call === 1
          ? { columns: [{ name: 'date' }, { name: 'spend' }], data: [['2026-11-01', 10], ['2026-11-02', 20]] }
          : { columns: [{ name: 'date' }, { name: 'spend' }], data: [['2026-11-03', 30]] };
        return ok(rows);
      },
      queryPageSize: 2,
    });
    const rows = await client.sqlQueryAll('c1', 'SELECT 1', 'db', 'e1');
    expect(rows).toEqual([
      { date: '2026-11-01', spend: 10 },
      { date: '2026-11-02', spend: 20 },
      { date: '2026-11-03', spend: 30 },
    ]);
    expect(call).toBe(2);
  });
});

describe('reorc queries 模板', () => {
  it('19 个主题且 id 唯一', () => {
    expect(REORC_QUERIES).toHaveLength(19);
    expect(new Set(REORC_TOPIC_IDS).size).toBe(19);
    expect(REORC_TOPIC_IDS).toContain('meta_channel');
    expect(REORC_TOPIC_IDS).toContain('google_ctry');
  });

  it('日期参数渲染进 SQL', () => {
    for (const topic of REORC_QUERIES) {
      if (topic.id === 'google_cmp') continue; // 维表查询无日期窗口
      const sql = topic.sql({ start: '2026-11-01', end: '2026-11-10' });
      expect(sql).toContain("'2026-11-01'");
      expect(sql).toContain("'2026-11-10'");
    }
  });
});

describe('reorc rows 映射', () => {
  it('站点行入桶 + A 累加 + inter NULL→7 元 + 非白名单站点归 unknown', () => {
    const ds = rowsToDataset(
      {
        meta_channel: [
          { date: '2026-11-10', site: 'Shopify', spend: '100', impressions: 1000, clicks: 50, orders: 5, value: 250, atc: 10, ckt: 8, inter: 60 },
          { date: '2026-11-10', site: 'SHOPLAZZA', spend: 50, impressions: 500, clicks: 25, orders: 2, value: 100, atc: 4, ckt: 3, inter: null },
        ],
      },
      { genAt: '2026-11-11 05:00', start: '2026-11-01', end: '2026-11-10', scope: 'test' },
    );
    const day = ds.channel.meta['2026-11-10']!;
    expect(day.shopify).toEqual([100, 1000, 50, 5, 250, 10, 8, 60]);
    // shoplazza 行 inter 为 NULL → 7 元 cell
    expect(day.shoplazza).toEqual([50, 500, 25, 2, 100, 4, 3]);
    // A = Σ站点，8 元（长度取 max）
    expect(day.A).toEqual([150, 1500, 75, 7, 350, 14, 11, 60]);
    expect(ds.manifest.range).toMatchObject({ min: '2026-11-10', max: '2026-11-10', viewEnd: '2026-11-10' });
  });

  it('维度推导（spuAccs/combos/adList/cmpNames）', () => {
    const ds = rowsToDataset(
      {
        meta_spu: [{ date: '2026-11-10', spu: 'SKU-A', account: 'acc1', site: 'shopify', spend: 1, impressions: 1, clicks: 1, orders: 1, value: 1, atc: 1, ckt: 1, inter: 1 }],
        meta_ad: [{ date: '2026-11-10', ad_name: 'ad-1', ad_type: 'image', ad_no: 'N01', site: 'shopify', spend: 1, impressions: 1, clicks: 1, orders: 1, value: 1, atc: 1, ckt: 1, inter: 1 }],
        google_type: [{ date: '2026-11-10', type: 'PMAX', brand: 'Bella', spend: 2, impressions: 2, clicks: 2, orders: 2, vs: 2, va: 2 }],
        google_cmp: [{ campaign_id: 123, campaign_name: 'PMAX Bella' }],
      },
      { genAt: '2026-11-11 05:00', start: '2026-11-01', end: '2026-11-10', scope: 'test' },
    );
    expect(ds.dims.spuAccs).toEqual({ 'SKU-A': ['acc1'] });
    expect(ds.dims.adList).toEqual([['ad-1', 'image', 'N01']]);
    expect(ds.dims.combos).toEqual([['PMAX', 'Bella']]);
    expect(ds.googleType.typeBrand['PMAX|Bella']!['2026-11-10']).toEqual([2, 2, 2, 2, 2, 2]);
    expect(ds.googleType.cmpNames['123']).toBe('PMAX Bella');
  });

  it('非法日期抛错', () => {
    expect(() =>
      rowsToDataset({ edm: [{ date: 'not-a-date', spend: 1 }] }, { genAt: 'x', start: '2026-11-01', end: '2026-11-10', scope: 's' }),
    ).toThrow(/非法日期/);
  });
});

describe('reorc discover', () => {
  it('默认取第一个环境/SQL 兼容连接/数据库', async () => {
    const client = createReorcClient({
      baseUrl: 'https://x/api',
      token: 't',
      fetchImpl: async (url) => {
        const u = String(url);
        // 判断顺序由具体到一般：/databases 在 /conn/connections 之前，避免误命中
        if (u.includes('/databases')) return ok({ databases: ['db_a', 'db_b'] });
        if (u.includes('/conn/connections')) {
          return ok({ items: [{ id: 'c9', name: 's3', type: 'S3' }, { id: 'c1', name: 'doris', type: 'SelectDB(Doris)' }] });
        }
        if (u.includes('/infra/environments')) {
          return ok({ items: [{ id: 'e1', name: 'Dev' }, { id: 'e2', name: 'Prod' }] });
        }
        throw new Error('unexpected ' + u);
      },
    });
    const logs: string[] = [];
    const t = await discoverReorcTarget(client, (m) => logs.push(m));
    expect(t).toMatchObject({ envId: 'e1', connectionId: 'c1', database: 'db_a' });
    expect(logs.some((m) => m.includes('doris'))).toBe(true);
  });

  it('extractDatabaseNames 兼容数组与对象形态', () => {
    expect(extractDatabaseNames(['a', 'b'])).toEqual(['a', 'b']);
    expect(extractDatabaseNames({ databases: [{ name: 'x' }] })).toEqual(['x']);
    expect(extractDatabaseNames({ items: 'not-array' })).toEqual([]);
  });
});

describe('reorc 组装闭环（mock fetch → validate）', () => {
  it('全链路产出通过校验的数据集', async () => {
    const metaRows = (site: string, acc: string): Row[] => [
      { date: '2026-11-09', site, account: acc, spend: 90, impressions: 900, clicks: 45, orders: 4, value: 220, atc: 9, ckt: 7, inter: 55 },
      { date: '2026-11-10', site, account: acc, spend: 100, impressions: 1000, clicks: 50, orders: 5, value: 250, atc: 10, ckt: 8, inter: 60 },
    ];
    const gRows = (): Row[] => [
      { date: '2026-11-09', spend: 70, impressions: 1800, clicks: 35, orders: 3, vs: 280, va: 260 },
      { date: '2026-11-10', spend: 80, impressions: 2000, clicks: 40, orders: 4, vs: 320, va: 300 },
    ];

    const source = createReorcSource({
      token: 't',
      fetchImpl: async (url, init) => {
        const u = String(url);
        // 判断顺序由具体到一般：sql-query 与 /databases 先于 /conn/connections
        if (u.includes('sql-query')) {
          const sql = JSON.parse(String(init!.body)).sql as string;
          const rows = topicRows(sql, metaRows, gRows);
          return ok({ columns: rows.length ? Object.keys(rows[0]).map((name) => ({ name })) : [{ name: 'date' }], data: rows.map((r) => Object.values(r)) });
        }
        if (u.includes('/databases')) return ok(['ads_dw']);
        if (u.includes('/conn/connections')) return ok({ items: [{ id: 'c1', name: 'doris', type: 'SelectDB(Doris)' }] });
        if (u.includes('/infra/environments')) return ok({ items: [{ id: 'e1', name: 'Dev' }] });
        throw new Error('unexpected ' + u);
      },
      windowDays: 10,
    });

    const ds = await source.fetch();
    expect(ds.channel.meta['2026-11-10']!.A).toEqual([100, 1000, 50, 5, 250, 10, 8, 60]);
    expect(ds.googleType.cmpNames['123']).toBe('PMAX Bella');
    expect(() => validateDataset(ds)).not.toThrow();
  });
});

/** 按 SQL 特征返回对应主题的行（模拟数仓；特征判断由具体到一般） */
function topicRows(sql: string, metaRows: (site: string, acc: string) => Row[], gRows: () => Row[]): Row[] {
  const withDim = (rows: Row[], extra: Record<string, unknown>) => rows.map((r) => ({ ...r, ...extra }));
  const channelMeta: Row[] = [
    { date: '2026-11-09', site: 'shopify', spend: 90, impressions: 900, clicks: 45, orders: 4, value: 220, atc: 9, ckt: 7, inter: 55 },
    { date: '2026-11-10', site: 'shopify', spend: 100, impressions: 1000, clicks: 50, orders: 5, value: 250, atc: 10, ckt: 8, inter: 60 },
  ];
  if (sql.includes('TODO_google_campaigns')) return [{ campaign_id: 123, campaign_name: 'PMAX Bella' }];
  if (sql.includes('TODO_meta_ads_daily')) {
    if (sql.includes('AS spu')) return withDim(metaRows('shopify', 'acc1'), { spu: 'SKU-A', account: 'acc1' });
    if (sql.includes('AS campaign')) return withDim(metaRows('shopify', 'acc1'), { campaign: 'C1' });
    if (sql.includes('AS ad_name')) return withDim(metaRows('shopify', 'acc1'), { ad_name: 'ad-1', ad_type: 'image', ad_no: 'N01' });
    if (sql.includes('AS account')) return withDim(metaRows('shopify', 'acc1'), { account: 'acc1' });
    return channelMeta;
  }
  if (sql.includes('campaign_type')) return withDim(gRows(), { type: 'PMAX', brand: 'Bella' });
  if (sql.includes('TODO_google_ads_daily')) {
    if (sql.includes('AS spu')) return withDim(gRows(), { spu: 'GSKU' });
    if (sql.includes('AS account')) return withDim(gRows(), { account: 'g1' });
    return gRows();
  }
  return [];
}
