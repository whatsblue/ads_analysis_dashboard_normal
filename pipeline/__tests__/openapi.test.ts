/**
 * 开放 API 通道单测：主题适配（过滤/聚合/重命名）+ previewAll 分页与错误处理。
 * 口径对齐断言：META8/G7/GSPU7/GAGE6 映射必须与 queries.ts 度量常量一致。
 */
import { describe, expect, it } from 'vitest';
import {
  createOpenApiClient,
  fetchOpenRowsByWindow,
  mergeTopicRows,
  OpenApiAuthError,
  OpenApiError,
  openRowsToTopics,
  splitRangeHalf,
  splitWeeks,
  type OpenRowsByService,
} from '../src/sources/reorc/openapi';

function svc(partial: Partial<OpenRowsByService>): OpenRowsByService {
  return {
    channel: [], campaign: [], spu: [], country: [], age: [],
    creative: [], deepDive: [], gmv: [], edm: [], ...partial,
  };
}

describe('openRowsToTopics', () => {
  it('meta_channel：按平台过滤并聚合 META8 度量（link_clicks=clicks、platform_clicks=inter）', () => {
    const rows = openRowsToTopics(svc({
      channel: [
        { dt: '2026-11-01', site: 'shopify', platform: 'meta', account: 'A1', platform_cost: '100', platform_impressions: '10', platform_link_clicks: '5', platform_clicks: '9', platform_orders: '2', platform_conversion_value: '50', platform_add_to_cart_count: '3', platform_checkout_count: '4' },
        { dt: '2026-11-01', site: 'shopify', platform: 'meta', account: 'A2', platform_cost: '1.5', platform_impressions: '2', platform_link_clicks: '1', platform_clicks: '1', platform_orders: '0', platform_conversion_value: '0', platform_add_to_cart_count: '0', platform_checkout_count: '0' },
        { dt: '2026-11-01', site: 'shopify', platform: 'google', account: 'G1' }, // 应被过滤
      ],
    }));
    const mc = rows.meta_channel!;
    expect(mc).toHaveLength(1);
    expect(mc[0]).toMatchObject({
      date: '2026-11-01', site: 'shopify',
      spend: 101.5, impressions: 12, clicks: 6, orders: 2, value: 50, atc: 3, ckt: 4, inter: 10,
    });
  });

  it('google_channel：shopify+google 过滤 + G7 映射（unified_orders=orders、attributed_sales=vs）', () => {
    const rows = openRowsToTopics(svc({
      channel: [
        { dt: '2026-11-02', site: 'shopify', platform: 'google', platform_cost: '8', platform_impressions: '80', platform_clicks: '7', unified_orders: '3', attributed_sales: '30', platform_conversion_value: '33', unified_interactions: '40' },
        { dt: '2026-11-02', site: 'shoplazza', platform: 'google', platform_cost: '999', unified_orders: '99' }, // 站点外过滤
        { dt: '2026-11-02', site: 'shopify', platform: 'meta', unified_orders: '1' }, // 平台外过滤
      ],
    }));
    const gc = rows.google_channel!;
    expect(gc).toHaveLength(1);
    expect(gc[0]).toMatchObject({ date: '2026-11-02', spend: 8, impressions: 80, clicks: 7, orders: 3, vs: 30, va: 33, inter: 40 });
  });

  it('google_spu：GSPU7（orders=platform_orders、vs=va=platform_conversion_value）', () => {
    const rows = openRowsToTopics(svc({
      spu: [{ dt: '2026-11-03', site: 'shopify', platform: 'google', spu: 'S1', platform_cost: '5', platform_impressions: '50', platform_clicks: '5', platform_orders: '4', platform_conversion_value: '44', unified_orders: '0', attributed_sales: '0', unified_interactions: '6' }],
    }));
    const gs = rows.google_spu!;
    expect(gs[0]).toMatchObject({ date: '2026-11-03', spu: 'S1', spend: 5, clicks: 5, orders: 4, vs: 44, va: 44, inter: 6 });
  });

  it('google_age：GAGE6（vs=sales、6 元无 inter）', () => {
    const rows = openRowsToTopics(svc({
      age: [{ dt: '2026-11-04', site: 'shopify', platform: 'google', age: '25-34', platform_cost: '2', platform_impressions: '20', platform_clicks: '2', platform_orders: '1', sales: '11', platform_conversion_value: '12' }],
    }));
    const ga = rows.google_age!;
    expect(ga[0]).toMatchObject({ date: '2026-11-04', age: '25-34', spend: 2, orders: 1, vs: 11, va: 12 });
    expect(ga[0].inter).toBeUndefined();
    expect(ga[0].ckt).toBeUndefined();
  });

  it('google_cmp：campaign_id 非空过滤 + 去重；google_camp：campaign_name 非空过滤', () => {
    const rows = openRowsToTopics(svc({
      campaign: [
        { dt: '2026-11-05', site: 'shopify', platform: 'google', campaign_id: '111', campaign_name: 'Camp A', platform_cost: '1' },
        { dt: '2026-11-06', site: 'shopify', platform: 'google', campaign_id: '111', campaign_name: 'Camp A', platform_cost: '2' },
        { dt: '2026-11-05', site: 'shopify', platform: 'google', campaign_id: '', campaign_name: 'NoID', platform_cost: '1' },
        { dt: '2026-11-05', site: 'shopify', platform: 'google', campaign_id: '222', campaign_name: '', platform_cost: '1' },
      ],
    }));
    const cmp = rows.google_cmp!;
    // cmp 只按 campaign_id 非空过滤（原 SQL 口径）：111 与 222 均保留，去重后 2 行
    expect(cmp).toHaveLength(2);
    expect(cmp.map((r) => r.campaign_id)).toEqual(['111', '222']);
    const camp = rows.google_camp!;
    // camp 按 campaign_name 非空过滤：222 被剔除；dims 含 date，111 两天为两行 + NoID 一行 = 3 行
    expect(camp).toHaveLength(3);
    expect(camp.filter((r) => r.campaign_id === '111')).toHaveLength(2);
    expect(camp.filter((r) => r.campaign_id === '')).toHaveLength(1);
  });

  it('gmv/edm：直映射；meta_camp：campaign_name→campaign 别名', () => {
    const rows = openRowsToTopics(svc({
      gmv: [
        { dt: '2026-11-06', site: 'shopify', amount: '10.5', cnt: '2' },
        { dt: '2026-11-06', site: 'shoplazza', amount: '1', cnt: '1' },
      ],
      edm: [{ dt: '2026-11-06', value: '7' }],
      campaign: [{ dt: '2026-11-06', site: 'shopify', platform: 'meta', campaign_id: 'C1', campaign_name: '系列一', platform_cost: '9' }],
    }));
    expect(rows.gmv!).toHaveLength(2);
    expect(rows.gmv![0]).toMatchObject({ date: '2026-11-06', site: 'shopify', amount: 10.5, cnt: 2 });
    expect(rows.edm![0]).toMatchObject({ date: '2026-11-06', value: 7 });
    expect(rows.meta_camp![0]).toMatchObject({ campaign_id: 'C1', campaign: '系列一', spend: 9 });
  });
});

describe('splitWeeks / mergeTopicRows（周切片拉取，应对 nginx 60s 限制）', () => {
  it('splitWeeks：整月 5 片、闭区间无缝隙无重叠、尾片自然收短', () => {
    expect(splitWeeks('2025-01-01', '2025-01-31')).toEqual([
      ['2025-01-01', '2025-01-07'],
      ['2025-01-08', '2025-01-14'],
      ['2025-01-15', '2025-01-21'],
      ['2025-01-22', '2025-01-28'],
      ['2025-01-29', '2025-01-31'],
    ]);
    expect(splitWeeks('2026-11-24', '2026-11-24')).toEqual([['2026-11-24', '2026-11-24']]);
    expect(splitWeeks('2026-11-18', '2026-11-24')).toEqual([['2026-11-18', '2026-11-24']]);
  });

  it('mergeTopicRows：同维度键跨片 SUM、异键保留、无度量主题去重', () => {
    const merged = mergeTopicRows([
      {
        meta_channel: [
          { date: '2025-01-01', site: 'shopify', spend: 1, clicks: 2 },
          { date: '2025-01-02', site: 'shopify', spend: 3, clicks: 4 },
        ],
        google_cmp: [{ campaign_id: 'C1' }],
      },
      {
        meta_channel: [{ date: '2025-01-01', site: 'shopify', spend: 10, clicks: 20 }],
        google_cmp: [{ campaign_id: 'C1' }], // 跨片同键无度量 → 去重保留 1 行
      },
    ]);
    expect(merged.meta_channel).toHaveLength(2);
    expect(merged.meta_channel![0]).toMatchObject({ spend: 11, clicks: 22 });
    expect(merged.meta_channel![1]).toMatchObject({ spend: 3 });
    expect(merged.google_cmp).toHaveLength(1);
  });

  it('makeMonthlyRowsProvider：月窗口内部切周拉取并合并（mock 按窗口分发行）', async () => {
    const windows: string[] = [];
    const impl = async (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { filters: { value: string[] }[] };
      const [ws, weRaw] = body.filters[0].value;
      const we = String(weRaw).slice(0, 10); // time_between 上界实传 'YYYY-MM-DD 23:59:59'，取日期部分匹配
      const svcId = String(url).match(/services\/(\d+)\//)?.[1];
      if (svcId === '569863926581157888') windows.push(`${ws}~${we}`); // 仅记录 channel 服务的窗口序列
      const items =
        svcId === '569863926581157888' && ws === '2025-01-01'
          ? [{ dt: { value: '2025-01-01' }, site: { value: 'shopify' }, platform: { value: 'meta' }, account: { value: 'A' }, platform_cost: { value: '5' }, platform_impressions: { value: '50' }, platform_link_clicks: { value: '5' }, platform_clicks: { value: '5' }, platform_orders: { value: '1' }, platform_conversion_value: { value: '10' }, platform_add_to_cart_count: { value: '2' }, platform_checkout_count: { value: '1' } }]
        : svcId === '569863926581157888'
          ? [{ dt: { value: '2025-01-08' }, site: { value: 'shopify' }, platform: { value: 'meta' }, account: { value: 'A' }, platform_cost: { value: '7' }, platform_impressions: { value: '70' }, platform_link_clicks: { value: '7' }, platform_clicks: { value: '7' }, platform_orders: { value: '2' }, platform_conversion_value: { value: '20' }, platform_add_to_cart_count: { value: '3' }, platform_checkout_count: { value: '2' } }]
          : []; // 其余服务返回空行
      return new Response(JSON.stringify({ code: '0', data: { total: items.length, items, error: null } }), { status: 200 });
    };
    const { makeMonthlyRowsProvider } = await import('../src/sources/reorc/openapi');
    const provider = makeMonthlyRowsProvider({ apiKey: 'k', fetchImpl: impl as typeof fetch });
    const topics = await provider({ start: '2025-01-01', end: '2025-01-14' });
    expect(windows).toEqual(['2025-01-01~2025-01-07', '2025-01-08~2025-01-14']);
    // 契约粒度为日×站点×账户：两周 date 不同 → 各自独立成行，度量不跨日 SUM
    expect(topics.meta_channel).toHaveLength(2);
    expect(topics.meta_channel![0]).toMatchObject({ date: '2025-01-01', spend: 5, clicks: 5, orders: 1, value: 10 });
    expect(topics.meta_channel![1]).toMatchObject({ date: '2025-01-08', spend: 7, clicks: 7, orders: 2, value: 20 });
  });
});

describe('splitRangeHalf / 窗口二分降级（慢查询 504 自适应）', () => {
  it('splitRangeHalf：7 天→4+3、4 天→2+2、2 天→1+1、单日不可再分', () => {
    expect(splitRangeHalf('2025-07-08', '2025-07-14')).toEqual([
      ['2025-07-08', '2025-07-11'],
      ['2025-07-12', '2025-07-14'],
    ]);
    expect(splitRangeHalf('2025-07-08', '2025-07-11')).toEqual([
      ['2025-07-08', '2025-07-09'],
      ['2025-07-10', '2025-07-11'],
    ]);
    expect(splitRangeHalf('2025-07-08', '2025-07-09')).toEqual([
      ['2025-07-08', '2025-07-08'],
      ['2025-07-09', '2025-07-09'],
    ]);
    expect(splitRangeHalf('2025-07-08', '2025-07-08')).toBeNull();
  });

  it('fetchOpenRowsByWindow：周窗口 504 → 自动二分拉子窗口并合并（creative 2025-07-08~07-14 实测场景）', async () => {
    const CREATIVE = '569867195273830400';
    const seen: string[] = [];
    const row = (dt: string, spend: string) => ({
      dt: { value: dt }, site: { value: 'shopify' }, platform: { value: 'meta' },
      ad_name: { value: 'AD1' }, ad_type: { value: 'image' }, ad_no: { value: 'N1' },
      type: { value: 'T' }, sub: { value: 'S' }, sub2: { value: 'S2' }, ctype: { value: 'CT' },
      platform_cost: { value: spend },
    });
    const impl = async (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { filters: { value: string[] }[] };
      const [ws, weRaw] = body.filters[0].value;
      const we = String(weRaw).slice(0, 10); // time_between 上界实传 'YYYY-MM-DD 23:59:59'，取日期部分匹配
      const svcId = String(url).match(/services\/(\d+)\//)?.[1];
      if (svcId !== CREATIVE) {
        return new Response(JSON.stringify({ code: '0', data: { total: 0, items: [], error: null } }), { status: 200 });
      }
      seen.push(`${ws}~${we}`);
      if (ws === '2025-07-08' && we === '2025-07-14') {
        return new Response('504 Gateway Time-out', { status: 504 }); // 结构性慢查询：nginx 网关硬限
      }
      const items = ws === '2025-07-08' ? [row('2025-07-08', '1'), row('2025-07-11', '2')] : [row('2025-07-12', '4')];
      return new Response(JSON.stringify({ code: '0', data: { total: items.length, items, error: null } }), { status: 200 });
    };
    const client = createOpenApiClient({ apiKey: 'k', fetchImpl: impl as typeof fetch, maxRetries: 1, retryDelaysMs: [10] });
    const svc = await fetchOpenRowsByWindow(client, '2025-07-08', '2025-07-14');
    // 周窗口尝试 2 次（初始 + 1 重试）后二分；两个子窗口并发拉取，顺序不定 → 排序后断言
    expect(seen.slice().sort()).toEqual([
      '2025-07-08~2025-07-11',
      '2025-07-08~2025-07-14',
      '2025-07-08~2025-07-14',
      '2025-07-12~2025-07-14',
    ]);
    expect(svc.creative.map((r) => [r.dt, r.platform_cost])).toEqual([['2025-07-08', '1'], ['2025-07-11', '2'], ['2025-07-12', '4']]);
  });

  it('fetchOpenRowsByWindow：childClient 零重试——子窗口 504 不再重试直接继续二分（结构性慢查询省时）', async () => {
    const CREATIVE = '569867195273830400';
    const seen: string[] = [];
    const row = (dt: string, spend: string) => ({
      dt: { value: dt }, site: { value: 'shopify' }, platform: { value: 'meta' },
      ad_name: { value: 'AD1' }, ad_type: { value: 'image' }, ad_no: { value: 'N1' },
      type: { value: 'T' }, sub: { value: 'S' }, sub2: { value: 'S2' }, ctype: { value: 'CT' },
      platform_cost: { value: spend },
    });
    const impl = async (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { filters: { value: string[] }[] };
      const [ws, weRaw] = body.filters[0].value;
      const we = String(weRaw).slice(0, 10); // time_between 上界实传 'YYYY-MM-DD 23:59:59'，取日期部分匹配
      const svcId = String(url).match(/services\/(\d+)\//)?.[1];
      if (svcId !== CREATIVE) {
        return new Response(JSON.stringify({ code: '0', data: { total: 0, items: [], error: null } }), { status: 200 });
      }
      seen.push(`${ws}~${we}`);
      // 周窗口与 4 天前半子窗口均为结构性慢查询；2 天/3 天子窗口正常
      if (ws === '2025-07-08' && (we === '2025-07-14' || we === '2025-07-11')) {
        return new Response('504 Gateway Time-out', { status: 504 });
      }
      const items = we === '2025-07-09' ? [row('2025-07-08', '1')] : we === '2025-07-11' ? [row('2025-07-10', '2')] : [row('2025-07-12', '4')];
      return new Response(JSON.stringify({ code: '0', data: { total: items.length, items, error: null } }), { status: 200 });
    };
    const client = createOpenApiClient({ apiKey: 'k', fetchImpl: impl as typeof fetch, maxRetries: 1, retryDelaysMs: [10] });
    const child = createOpenApiClient({ apiKey: 'k', fetchImpl: impl as typeof fetch, maxRetries: 0 });
    const svc = await fetchOpenRowsByWindow(client, '2025-07-08', '2025-07-14', undefined, child);
    // 周窗口 2 次（主 client 重试）；4 天子窗口仅 1 次（child 零重试 → 失败直接再二分），子窗口并发顺序不定 → 排序后断言
    expect(seen.slice().sort()).toEqual([
      '2025-07-08~2025-07-09',
      '2025-07-08~2025-07-11',
      '2025-07-08~2025-07-14',
      '2025-07-08~2025-07-14',
      '2025-07-10~2025-07-11',
      '2025-07-12~2025-07-14',
    ]);
    expect(svc.creative.map((r) => [r.dt, r.platform_cost])).toEqual([['2025-07-08', '1'], ['2025-07-10', '2'], ['2025-07-12', '4']]);
  });

  it('fetchOpenRowsByWindow：单日窗口 504 不可再分 → 直接抛出', async () => {
    const impl = async () => new Response('504 Gateway Time-out', { status: 504 });
    const client = createOpenApiClient({ apiKey: 'k', fetchImpl: impl as typeof fetch, maxRetries: 1, retryDelaysMs: [10] });
    await expect(fetchOpenRowsByWindow(client, '2026-11-24', '2026-11-24')).rejects.toThrowError(/504/);
  });

  it('fetchOpenRowsByWindow：单日 504 → rootClient 重试序列重拉成功（大促日负载波动防线）', async () => {
    let n = 0;
    const row = (dt: string) => ({
      dt: { value: dt }, site: { value: 'shopify' }, platform: { value: 'meta' },
      ad_name: { value: 'AD1' }, ad_type: { value: 'image' }, ad_no: { value: 'N1' },
      type: { value: 'T' }, sub: { value: 'S' }, sub2: { value: 'S2' }, ctype: { value: 'CT' },
      platform_cost: { value: '1' },
    });
    const impl = async (url: string | URL, init?: RequestInit) => {
      const svcId = String(url).match(/services\/(\d+)\//)?.[1];
      if (svcId !== '569867195273830400') {
        return new Response(JSON.stringify({ code: '0', data: { total: 0, items: [], error: null } }), { status: 200 });
      }
      n++;
      if (n <= 2) return new Response('504 Gateway Time-out', { status: 504 }); // 首次链路 child 首试 + rootClient 初试均 504
      return new Response(JSON.stringify({ code: '0', data: { total: 1, items: [row('2025-11-11')], error: null } }), { status: 200 });
    };
    const client = createOpenApiClient({ apiKey: 'k', fetchImpl: impl as typeof fetch, maxRetries: 1, retryDelaysMs: [10] });
    const svc = await fetchOpenRowsByWindow(client, '2025-11-11', '2025-11-11');
    expect(n).toBe(3); // child 零重试首试失败 + rootClient 初试 504 + 1 次重试成功
    expect(svc.creative.map((r) => r.dt)).toEqual(['2025-11-11']);
  });
});

describe('createOpenApiClient.previewAll', () => {
  const okResp = (items: Record<string, { value: unknown }>[], total: number) => ({
    code: '0',
    msg: 'success',
    data: { total, items, error: null },
  });

  it('多页合并（total 3 行，page_size 内分 2 页）', async () => {
    const calls: string[] = [];
    const impl = async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { page: number };
      calls.push(`p${body.page}`);
      const page = body.page;
      if (page === 1) {
        return new Response(JSON.stringify(okResp([{ dt: { value: '2026-11-01' } }, { dt: { value: '2026-11-02' } }], 3)), { status: 200 });
      }
      return new Response(JSON.stringify(okResp([{ dt: { value: '2026-11-03' } }], 3)), { status: 200 });
    };
    const client = createOpenApiClient({ apiKey: 'k', fetchImpl: impl as typeof fetch });
    const rows = await client.previewAll('channel', '2026-11-01', '2026-11-30');
    expect(rows.map((r) => r.dt)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(calls[0]).toBe('p1');
  });

  it('业务错误（data.error）抛 OpenApiError', async () => {
    const impl = async () =>
      new Response(JSON.stringify({ code: '0', data: { total: 0, items: [], error: { code: 'A1402', reason: 'boom' } } }), { status: 200 });
    const client = createOpenApiClient({ apiKey: 'k', fetchImpl: impl as typeof fetch });
    await expect(client.previewAll('edm', '2026-11-01', '2026-11-02')).rejects.toThrowError(OpenApiError);
  });

  it('401/403 抛 OpenApiAuthError（不重试）', async () => {
    let n = 0;
    const impl = async () => {
      n++;
      return new Response('Not authenticated', { status: 403 });
    };
    const client = createOpenApiClient({ apiKey: 'k', fetchImpl: impl as typeof fetch });
    await expect(client.previewAll('edm', '2026-11-01', '2026-11-02')).rejects.toThrowError(OpenApiAuthError);
    expect(n).toBe(1);
  });

  it('5xx 按重试策略重试后成功', async () => {
    let n = 0;
    const impl = async () => {
      n++;
      if (n === 1) return new Response('bad gateway', { status: 502 });
      return new Response(JSON.stringify(okResp([{ dt: { value: '2026-11-01' } }], 1)), { status: 200 });
    };
    const client = createOpenApiClient({ apiKey: 'k', fetchImpl: impl as typeof fetch, maxRetries: 2, retryDelaysMs: [10, 20] });
    const rows = await client.previewAll('gmv', '2026-11-01', '2026-11-02');
    expect(rows).toHaveLength(1);
    expect(n).toBe(2);
  });

  it('网络超时按重试序列多次重试后成功（毛刺场景）', async () => {
    let n = 0;
    const impl = async () => {
      n++;
      if (n <= 3) throw new Error('The operation was aborted'); // AbortError → 网络错误包装 status 0
      return new Response(JSON.stringify(okResp([{ dt: { value: '2026-11-01' } }], 1)), { status: 200 });
    };
    const client = createOpenApiClient({ apiKey: 'k', fetchImpl: impl as typeof fetch, maxRetries: 3, retryDelaysMs: [10, 10, 10] });
    const rows = await client.previewAll('gmv', '2026-11-01', '2026-11-02');
    expect(rows).toHaveLength(1);
    expect(n).toBe(4);
  });
});
