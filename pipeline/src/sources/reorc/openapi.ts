/**
 * ReOrc 开放 API（数据服务）通道：preview 端点分页拉取 → 19 主题契约行。
 *
 * 背景（2026-11-25）：sql-query 通道依赖用户登录 JWT（约 7 天过期，2026-11-21 曾致断更 4 天）；
 * 开放 API 使用个人 API 密钥（用户级，长期，与登录态无关）作为主通道，REORC_TOKEN 通道保留兜底。
 *
 * 平台侧结构（newbella_marketing_dw → 数据服务 → 9 个服务，每源表一个）：
 *   服务 SQL 由 queries.ts 口径派生——行级 CASE/COALESCE 维度列与 GROUP BY 预聚合在 SQL 端完成，
 *   输出「维度列 + 原始度量字段名」宽行；日期窗口过滤由本通道经 filters(dt time_between) 参数化，
 *   Meta/Google 平台分派与站点过滤在主题适配层按行完成（服务行携带 platform/site 列）。
 *
 * 分页正确性：preview 为 page/offset 翻页，每服务以「SQL GROUP BY 全键」作为 sorts 全序键，
 * 同键行唯一 → 页间顺序稳定，杜绝 sql-query 通道曾出现的无序翻页重复/丢行问题（无需二分补偿）。
 *
 * 环境变量：REORC_OPENAPI_KEY（数据服务页「如何调用 API?」弹窗 → 显示密钥）。
 */
import type { DateStr } from '@ads/shared';
import type { Row } from './client';

/** 数据服务实体 id（newbella_marketing_dw 项目；id 非秘密，Key 才是） */
export const OPENAPI_SERVICES = {
  channel: '569863926581157888', // ads_marketing_channel_daily（feed meta_channel/acc + google_channel/acc）
  campaign: '569866520657780736', // ads_marketing_campaign_daily（feed meta_camp + google_cmp/camp）
  spu: '569866605638311936', // ads_marketing_spu_daily（feed meta_spu + google_spu）
  country: '569866679777091584', // ads_marketing_country_daily（feed meta_ctry + google_ctry）
  age: '569866752128835584', // ads_marketing_age_daily（feed meta_age + google_age；无 unified 列，有 sales）
  creative: '569867195273830400', // ads_marketing_creative_by_ad_daily（feed meta_sub/sub2/ctype/ad）
  deepDive: '569867271987650560', // ads_google_deep_dive_daily（feed google_type；SQL 已限 shopify）
  gmv: '569867394188435456', // ods_eccang_order（status=4 + 行级 ROUND 已在 SQL 内）
  edm: '569867473171374080', // ods_edm_ads_shopify_marketing_attribution_daily（net=total−reversals 已在 SQL 内）
} as const;

export type OpenServiceKey = keyof typeof OPENAPI_SERVICES;

/** 每服务全序排序键（= 服务 SQL 的 GROUP BY 键）：全序唯一保证 offset 翻页稳定 */
const SERVICE_SORTS: Record<OpenServiceKey, string[]> = {
  channel: ['dt', 'site', 'platform', 'account'],
  campaign: ['dt', 'site', 'platform', 'campaign_id', 'campaign_name'],
  spu: ['dt', 'site', 'platform', 'spu', 'account'],
  country: ['dt', 'country', 'site', 'platform'],
  age: ['dt', 'age', 'site', 'platform'],
  creative: ['dt', 'site', 'platform', 'ad_name', 'ad_type', 'ad_no', 'type', 'sub', 'sub2', 'ctype'],
  deepDive: ['dt', 'type', 'brand'],
  gmv: ['dt', 'site'],
  edm: ['dt'],
};

export const OPENAPI_BASE_DEFAULT = 'https://api.cn.reorc.cloud';
export const OPENAPI_PAGE_SIZE = 10_000; // 平台 preview 上限
const PAGE_LIMIT = 200; // 单服务单窗口页数保险丝（creative 全历史也 <60 页）

export class OpenApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'OpenApiError';
  }
}

export class OpenApiAuthError extends OpenApiError {
  constructor(message: string, status: number, body?: string) {
    super(message, status, body);
    this.name = 'OpenApiAuthError';
  }
}

export interface OpenApiClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** 单请求超时（默认 55s：preview 大查询服务端有毛刺，nginx 60s 网关硬限前留余量） */
  timeoutMs?: number;
  /** 429/5xx/网络错误重试次数（默认 3；401/403/4xx 不重试） */
  maxRetries?: number;
  /** 重试等待序列 ms（默认 5s/15s/30s，跳过服务端短时毛刺期） */
  retryDelaysMs?: number[];
  log?: (msg: string) => void;
}

export interface OpenApiClient {
  /** 拉取 [start,end] 窗口内某服务全部行（dt 升序全序分页） */
  previewAll(service: OpenServiceKey, start: DateStr, end: DateStr): Promise<Row[]>;
}

interface PreviewItem {
  [field: string]: { value: unknown } | undefined;
}

interface PreviewResp {
  code: string;
  msg?: string;
  data?: { total?: number; items?: PreviewItem[]; error?: { code?: string; reason?: string } | null };
}

export function createOpenApiClient(opts: OpenApiClientOptions): OpenApiClient {
  const baseUrl = (opts.baseUrl || process.env.REORC_OPENAPI_BASE || OPENAPI_BASE_DEFAULT).replace(/\/+$/, '');
  const timeoutMs = opts.timeoutMs ?? 55_000;
  const maxRetries = opts.maxRetries ?? 3;
  const retryDelays = opts.retryDelaysMs ?? [5_000, 15_000, 30_000];
  const log = opts.log ?? (() => {});

  return {
    async previewAll(service, start, end) {
      const serviceId = OPENAPI_SERVICES[service];
      const sorts = SERVICE_SORTS[service].map((field) => ({ field, order: 'asc' }));
      // time_between 上界为 datetime 语义：end 传 'YYYY-MM-DD' 会被解析为当天 00:00:00，
      // 丢失窗口尾日全天数据（2026-11-25 对账实锤：每周切片尾日全量缺行）→ 显式补 23:59:59
      const filters = [{ field: 'dt', operator: 'time_between', value: [start, `${end} 23:59:59`] }];
      const postOnce = async (page: number): Promise<PreviewResp> => {
        const url = `${baseUrl}/api/data-service/open/services/${serviceId}/preview`;
        const body = JSON.stringify({
          filters,
          filter_logic: 'all',
          sorts,
          page,
          page_size: OPENAPI_PAGE_SIZE,
        });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await (opts.fetchImpl ?? fetch)(url, {
            method: 'POST',
            signal: controller.signal,
            headers: {
              Authorization: `Bearer ${opts.apiKey}`,
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'User-Agent': 'ads-dashboard-pipeline',
            },
            body,
          });
          clearTimeout(timer);
          if (res.status === 401 || res.status === 403) {
            throw new OpenApiAuthError(
              `开放 API 鉴权失败（HTTP ${res.status}）。REORC_OPENAPI_KEY 缺失/失效——数据服务页「如何调用 API?」弹窗重新复制。`,
              res.status,
            );
          }
          if (res.status !== 200) {
            const text = await res.text();
            throw new OpenApiError(`HTTP ${res.status}：${text.slice(0, 200)}`, res.status, text);
          }
          return (await res.json()) as PreviewResp;
        } catch (e) {
          clearTimeout(timer);
          if (e instanceof OpenApiError && e.status !== 0) throw e; // 协议层错误不重试
          throw new OpenApiError(`网络错误：${e instanceof Error ? e.message : String(e)}`, 0);
        }
      };
      const post = async (page: number): Promise<PreviewResp> => {
        let lastErr: unknown;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            return await postOnce(page);
          } catch (e) {
            const err = e instanceof OpenApiError ? e : null;
            // 仅 429/5xx/网络错误重试；401/403/4xx 业务错误直接抛
            const retryable = err !== null && (err.status === 429 || err.status >= 500 || err.status === 0);
            if (!retryable || attempt >= maxRetries) throw e;
            lastErr = e;
            const delay = retryDelays[Math.min(attempt, retryDelays.length - 1)];
            log(`preview ${service} p${page} ${err?.message ?? String(e)}，${delay}ms 后重试`);
            await new Promise((r) => setTimeout(r, delay));
          }
        }
        throw lastErr;
      };

      const out: Row[] = [];
      let page = 1;
      for (;;) {
        if (page > PAGE_LIMIT) {
          throw new OpenApiError(`服务 ${service} 窗口 ${start}~${end} 超过页上限 ${PAGE_LIMIT}，疑似分页异常`, 0);
        }
        const resp = await post(page);
        const dat = resp.data ?? {};
        if (dat.error) {
          throw new OpenApiError(
            `服务 ${service} 业务错误 ${dat.error.code ?? ''}：${dat.error.reason ?? 'unknown'}`,
            200,
          );
        }
        const items = dat.items ?? [];
        for (const it of items) {
          const row: Row = {};
          for (const [field, meta] of Object.entries(it)) row[field] = meta?.value;
          out.push(row);
        }
        const total = typeof dat.total === 'number' ? dat.total : Number.POSITIVE_INFINITY;
        if (out.length >= total || items.length === 0) break;
        // total 异常缺失（不符文档契约）时退化：当前页不满页即末页，防止误判丢数据
        if (!Number.isFinite(total) && items.length < OPENAPI_PAGE_SIZE) break;
        page++;
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// 主题适配：服务宽行 → queries.ts 同名契约行（过滤 + 维度聚合 + 度量重命名）
// 度量映射严格对齐 queries.ts 各度量常量（META_MEASURE / GOOGLE_MEASURE / GOOGLE_SPU_MEASURE / google_age 内联）。
// ---------------------------------------------------------------------------

function num0(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

const META8: Record<string, string> = {
  spend: 'platform_cost',
  impressions: 'platform_impressions',
  clicks: 'platform_link_clicks',
  orders: 'platform_orders',
  value: 'platform_conversion_value',
  atc: 'platform_add_to_cart_count',
  ckt: 'platform_checkout_count',
  inter: 'platform_clicks',
};
const G7: Record<string, string> = {
  spend: 'platform_cost',
  impressions: 'platform_impressions',
  clicks: 'platform_clicks',
  orders: 'unified_orders',
  vs: 'attributed_sales',
  va: 'platform_conversion_value',
  inter: 'unified_interactions',
};
/** google_spu（GOOGLE_SPU_MEASURE）：orders=platform_orders，vs=va=platform_conversion_value */
const GSPU7: Record<string, string> = { ...G7, orders: 'platform_orders', vs: 'platform_conversion_value' };
/** google_age：无 unified 列，vs 用 sales 近似、orders=platform_orders、6 元无 inter */
const GAGE6: Record<string, string> = {
  spend: 'platform_cost',
  impressions: 'platform_impressions',
  clicks: 'platform_clicks',
  orders: 'platform_orders',
  vs: 'sales',
  va: 'platform_conversion_value',
};

const isMeta = (r: Row): boolean => String(r.platform ?? '') === 'meta';
const isGoogleShopify = (r: Row): boolean =>
  String(r.platform ?? '') === 'google' && String(r.site ?? '') === 'shopify';
const nonEmpty = (v: unknown): boolean => String(v ?? '').trim() !== '';

interface OpenTopic {
  id: string;
  service: OpenServiceKey;
  /** 行级过滤（platform/site/字段非空；与 queries.ts 各主题 WHERE 对齐） */
  keep?: (r: Row) => boolean;
  /** 输出行维度别名 ← 服务列（聚合键） */
  dims: Record<string, string>;
  /** 输出行度量别名 ← 服务列（SUM 聚合） */
  measures: Record<string, string>;
}

export const OPENAPI_TOPICS: OpenTopic[] = [
  { id: 'meta_channel', service: 'channel', keep: isMeta, dims: { date: 'dt', site: 'site' }, measures: META8 },
  { id: 'meta_acc', service: 'channel', keep: isMeta, dims: { date: 'dt', site: 'site', account: 'account' }, measures: META8 },
  {
    id: 'meta_camp',
    service: 'campaign',
    keep: isMeta,
    dims: { date: 'dt', site: 'site', campaign_id: 'campaign_id', campaign: 'campaign_name' },
    measures: META8,
  },
  { id: 'meta_spu', service: 'spu', keep: isMeta, dims: { date: 'dt', site: 'site', spu: 'spu', account: 'account' }, measures: META8 },
  { id: 'meta_ctry', service: 'country', keep: isMeta, dims: { date: 'dt', site: 'site', country: 'country' }, measures: META8 },
  { id: 'meta_age', service: 'age', keep: isMeta, dims: { date: 'dt', site: 'site', age: 'age' }, measures: META8 },
  { id: 'meta_sub', service: 'creative', keep: isMeta, dims: { date: 'dt', site: 'site', type: 'type', sub: 'sub' }, measures: META8 },
  { id: 'meta_sub2', service: 'creative', keep: isMeta, dims: { date: 'dt', site: 'site', type: 'type', sub2: 'sub2' }, measures: META8 },
  { id: 'meta_ctype', service: 'creative', keep: isMeta, dims: { date: 'dt', site: 'site', ctype: 'ctype' }, measures: META8 },
  {
    id: 'meta_ad',
    service: 'creative',
    keep: isMeta,
    dims: { date: 'dt', site: 'site', ad_name: 'ad_name', ad_type: 'ad_type', ad_no: 'ad_no' },
    measures: META8,
  },
  { id: 'google_channel', service: 'channel', keep: isGoogleShopify, dims: { date: 'dt' }, measures: G7 },
  { id: 'google_acc', service: 'channel', keep: isGoogleShopify, dims: { date: 'dt', account: 'account' }, measures: G7 },
  {
    id: 'google_cmp',
    service: 'campaign',
    keep: (r) => isGoogleShopify(r) && nonEmpty(r.campaign_id),
    dims: { campaign_id: 'campaign_id', campaign_name: 'campaign_name' },
    measures: {},
  },
  {
    id: 'google_camp',
    service: 'campaign',
    keep: (r) => isGoogleShopify(r) && nonEmpty(r.campaign_name),
    dims: { date: 'dt', campaign_id: 'campaign_id', campaign: 'campaign_name' },
    measures: G7,
  },
  { id: 'google_spu', service: 'spu', keep: isGoogleShopify, dims: { date: 'dt', spu: 'spu' }, measures: GSPU7 },
  { id: 'google_type', service: 'deepDive', dims: { date: 'dt', type: 'type', brand: 'brand' }, measures: G7 },
  { id: 'google_ctry', service: 'country', keep: isGoogleShopify, dims: { date: 'dt', country: 'country' }, measures: G7 },
  { id: 'google_age', service: 'age', keep: isGoogleShopify, dims: { date: 'dt', age: 'age' }, measures: GAGE6 },
  { id: 'gmv', service: 'gmv', dims: { date: 'dt', site: 'site' }, measures: { amount: 'amount', cnt: 'cnt' } },
  { id: 'edm', service: 'edm', dims: { date: 'dt' }, measures: { value: 'value' } },
];

export type OpenRowsByService = Record<OpenServiceKey, Row[]>;

/** 全服务窗口行 → 19 主题契约行（queries.ts 同名主题，rowsToDataset 直接可用） */
export function openRowsToTopics(svc: OpenRowsByService): Record<string, Row[] | undefined> {
  const out: Record<string, Row[] | undefined> = {};
  for (const t of OPENAPI_TOPICS) {
    const src = svc[t.service] ?? [];
    const acc = new Map<string, Row>();
    for (const r of src) {
      if (t.keep && !t.keep(r)) continue;
      const keyParts: string[] = [];
      const row: Row = {};
      for (const [alias, col] of Object.entries(t.dims)) {
        row[alias] = r[col];
        keyParts.push(String(r[col] ?? ''));
      }
      const key = keyParts.join(' ');
      const cur = acc.get(key);
      if (!cur) {
        for (const [alias, col] of Object.entries(t.measures)) row[alias] = num0(r[col]);
        acc.set(key, row);
      } else {
        for (const [alias, col] of Object.entries(t.measures)) {
          cur[alias] = num0(cur[alias]) + num0(r[col]);
        }
      }
    }
    out[t.id] = [...acc.values()];
  }
  return out;
}

/** 并行度上限（对平台友好） */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) break;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
/**
 * 窗口二分（前半 ceil，后半 rest）：7→[4,3]、4→[2,2]、2→[1,1]；单日/非法窗口返回 null（不可再分）。
 * 供慢查询自适应降级使用：周窗口遇上服务端结构性慢查询（>60s 必被 nginx 掐 504）时，
 * 二分后子窗口查询成本骤降即可恢复——实测（2026-11-25）：creative 2025-07-08~07-14 周
 * 稳定 504@60.2s，拆 4+3 天后分别 4.3s/3.1s 完成。
 */
export function splitRangeHalf(start: DateStr, end: DateStr): [DateStr, DateStr][] | null {
  const DAY = 86_400_000;
  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s || e - s < DAY) return null;
  const days = Math.round((e - s) / DAY) + 1;
  const mid = s + (Math.ceil(days / 2) - 1) * DAY;
  return [
    [start, new Date(mid).toISOString().slice(0, 10)],
    [new Date(mid + DAY).toISOString().slice(0, 10), end],
  ];
}

/** 值得二分降级的错误：网络超时/429/5xx（含 nginx 504 网关超时）；401/403/4xx 协议错误直接抛 */
function isSlowQueryError(e: unknown): e is OpenApiError {
  return e instanceof OpenApiError && (e.status === 0 || e.status === 429 || e.status >= 500);
}

/**
 * 服务窗口拉取（慢查询自适应降级）：previewAll 内部重试耗尽仍失败且窗口跨多天时，
 * 窗口二分递归拉取后拼接。行序说明：主题适配层（openRowsToTopics/mergeTopicRows）
 * 均为 Map 聚合，与行序无关，拼接安全。
 *
 * childClient：二分后子窗口使用的客户端，建议零重试——结构性慢查询（服务端执行必超
 * nginx 60s）重试必然再次超时，重试纯属浪费时间；缺省回退 client（重试策略不变）。
 * 实测（2026-11-25）零重试二分把每毛刺周惩罚从 ~278s（4 次超时 + 3 段等待）降到 ~120s。
 */
async function previewAllWithSplit(
  client: OpenApiClient,
  childClient: OpenApiClient,
  rootClient: OpenApiClient,
  service: OpenServiceKey,
  start: DateStr,
  end: DateStr,
  log?: (msg: string) => void,
): Promise<Row[]> {
  try {
    return await client.previewAll(service, start, end);
  } catch (e) {
    if (!isSlowQueryError(e)) throw e;
    if (start === end) {
      // 单日不可再分：大促日（如 2025-11-11 双 11）creative 单日在服务端全量聚合下也超
      // nginx 60s 硬限，且负载随时段波动（深夜高峰单日 504、下午同窗口可过）→
      // 换带重试的 rootClient 再拉一轮（自带 5/15/30s 等待序列，横跨 ~4min 等负载回落），仍失败才报错
      log?.(`服务 ${service} 单日 ${start} 拉取失败，等待重试序列后重拉`);
      return await rootClient.previewAll(service, start, end);
    }
    const halves = splitRangeHalf(start, end);
    if (!halves) throw e;
    log?.(`服务 ${service} 窗口 ${start}~${end} 重试耗尽（${e.message.slice(0, 60)}），二分降级拉取`);
    const [ra, rb] = await Promise.all([
      previewAllWithSplit(childClient, childClient, rootClient, service, halves[0][0], halves[0][1], log),
      previewAllWithSplit(childClient, childClient, rootClient, service, halves[1][0], halves[1][1], log),
    ]);
    return [...ra, ...rb];
  }
}

/** 拉取全部 9 服务 [start,end] 行（并行度 3；服务级慢查询自动二分降级，子窗口可用零重试客户端提速） */
export async function fetchOpenRowsByWindow(
  client: OpenApiClient,
  start: DateStr,
  end: DateStr,
  log?: (msg: string) => void,
  childClient: OpenApiClient = client,
): Promise<OpenRowsByService> {
  const keys = Object.keys(OPENAPI_SERVICES) as OpenServiceKey[];
  const rows = await mapPool(keys, 3, async (k) => {
    const t0 = Date.now();
    const r = await previewAllWithSplit(client, childClient, client, k, start, end, log);
    log?.(`服务 ${k}：${r.length} 行（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
    return r;
  });
  return Object.fromEntries(keys.map((k, i) => [k, rows[i]])) as OpenRowsByService;
}

/**
 * 月窗口 → ≤7 天子窗口序列（闭区间，无缝隙无重叠）。
 * 实测依据（2026-11-25）：preview 服务端执行为「全量聚套外层过滤」，
 * campaign/creative 大服务单月窗口超 nginx 60s 网关硬限（HTTP 504），
 * 周窗口 2.5s 完成——查询成本随窗口规模缩放，故大窗口必须切片。
 */
export function splitWeeks(start: DateStr, end: DateStr): [DateStr, DateStr][] {
  const DAY = 86_400_000;
  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  const out: [DateStr, DateStr][] = [];
  for (let a = s; a <= e; a += 7 * DAY) {
    const b = Math.min(a + 7 * DAY - 1, e);
    out.push([new Date(a).toISOString().slice(0, 10), new Date(b).toISOString().slice(0, 10)]);
  }
  return out;
}

/** 跨片主题行合并：同维度键行度量 SUM（契约行：维度别名见 OPENAPI_TOPICS，度量全 number） */
export function mergeTopicRows(parts: Record<string, Row[] | undefined>[]): Record<string, Row[] | undefined> {
  const out: Record<string, Row[] | undefined> = {};
  for (const t of OPENAPI_TOPICS) {
    const dimKeys = Object.keys(t.dims);
    const measureKeys = Object.keys(t.measures);
    const acc = new Map<string, Row>();
    for (const part of parts) {
      for (const r of part[t.id] ?? []) {
        const key = dimKeys.map((k) => String(r[k] ?? '')).join(' ');
        const cur = acc.get(key);
        if (!cur) {
          acc.set(key, { ...r });
          continue;
        }
        for (const m of measureKeys) cur[m] = num0(cur[m]) + num0(r[m]);
      }
    }
    out[t.id] = [...acc.values()];
  }
  return out;
}

/**
 * 构造 fetchMonthly 的 rowsByTopic 提供者（开放 API 主通道）。
 * 内部按周切片拉取（nginx 60s 限制，见 splitWeeks），逐周聚合到主题行后合并，
 * 避免全历史服务宽行同时驻留内存。
 */
export function makeMonthlyRowsProvider(opts: {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
}): (win: { start: DateStr; end: DateStr }) => Promise<Record<string, Row[] | undefined>> {
  const client = createOpenApiClient(opts);
  // 二分子窗口用零重试客户端：结构性慢查询重试必然再次超时（实测每毛刺周浪费 ~200s），直达二分更省时
  const childClient = createOpenApiClient({ ...opts, maxRetries: 0 });
  return async (win) => {
    const weeks = splitWeeks(win.start, win.end);
    const parts: Record<string, Row[] | undefined>[] = [];
    for (const [ws, we] of weeks) {
      const svc = await fetchOpenRowsByWindow(client, ws, we, opts.log, childClient);
      parts.push(openRowsToTopics(svc));
    }
    return mergeTopicRows(parts);
  };
}
