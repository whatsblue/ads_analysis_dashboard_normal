/**
 * 数据契约类型定义（唯一权威来源）。
 * 规范文档：docs/DATA_CONTRACT.md。变更需同步文档并 CONTRACT_VERSION +1。
 */

export const CONTRACT_VERSION = 2;

/** 日期字符串（YYYY-MM-DD） */
export type DateStr = string;

/** 站点键（数据文件内为小写） */
export type SiteKey = 'shopify' | 'shoplazza' | 'unknown';

/** Meta 基础桶：[spend, impressions, clicks, orders, value, atc, ckt, (inter?)] */
export type MetaCell = number[];

/** Google 基础桶：[spend, impressions, clicks, orders, vs, va]（vs=Shopify 口径 GMV, va=Ads 后台口径 GMV） */
export type GoogleCell = number[];

/** Google 国家桶（7 元，第 7 位 = unified_interactions，CVR 分母） */
export type GoogleCtyCell = number[];

/** GMV 桶：[金额, 订单数] */
export type GmvCell = number[];

/** EDM 桶：[花费] */
export type EdmCell = number[];

/** Meta 桶：日期 → { 站点..., A=全站合计 } */
export type MetaDay = Partial<Record<SiteKey | 'A', MetaCell>>;
export type MetaBucket = Record<DateStr, MetaDay>;

/** Google 桶：日期 → cell */
export type GoogleBucket = Record<DateStr, GoogleCell>;

/** Google 国家桶 */
export type GoogleCtyBucket = Record<DateStr, GoogleCtyCell>;

/** 维度 → 日期桶（Meta 带站点层） */
export type MetaDimBucket = Record<string, MetaBucket>;
export type GoogleDimBucket = Record<string, GoogleBucket>;
export type GoogleCtyDimBucket = Record<string, GoogleCtyBucket>;

export interface Manifest {
  v: number;
  genAt: string;
  range: { min: DateStr; max: DateStr; viewStart: DateStr; viewEnd: DateStr };
  scope: string;
}

/** 广告清单条目：[广告名, 素材类型, 素材编号] */
export type AdEntry = [string, string, string];

export interface Dims {
  metaAccounts: string[];
  gAccounts: string[];
  metaCampaigns: string[];
  gCampaigns: string[];
  spus: string[];
  gSpus: string[];
  spuAccs: Record<string, string[]>;
  types: string[];
  countries: string[];
  ages: string[];
  /** Google 广告类型×品牌组合 */
  combos: [string, string][];
  adList: AdEntry[];
}

export interface ChannelData {
  meta: Record<DateStr, MetaDay>;
  google: Record<DateStr, GoogleCell>;
  /** 整站 GMV（易仓已付款 status=4，按下单日期） */
  gmv: Record<DateStr, Partial<Record<SiteKey | 'A', GmvCell>>>;
  /** EDM 渠道花费 */
  edm: Record<DateStr, EdmCell>;
}

/** meta/dim.json：国家 + 年龄 */
export interface MetaDimData {
  ctry: MetaDimBucket;
  age: MetaDimBucket;
}

/** meta/creative.json：素材效率分桶 */
export interface MetaCreativeData {
  /** 素材类型 → 子分类（KOL/非KOL 等）→ 日期 → 站点桶 */
  sub: Record<string, Record<string, Record<DateStr, Partial<Record<SiteKey, MetaCell>>>>>;
  /** 素材类型 → 新旧（新素材/老素材）→ 日期 → 站点桶 */
  sub2: Record<string, Record<string, Record<DateStr, Partial<Record<SiteKey, MetaCell>>>>>;
  /** 创意大写类型（如 SEARCH）→ 日期 → 站点桶 */
  ctype: Record<string, MetaBucket>;
}

/** google/dim.json */
export interface GoogleDimData {
  ctry: GoogleCtyDimBucket;
  age: Record<string, GoogleBucket>;
}

/** google/type.json */
export interface GoogleTypeData {
  /** "type|brand" → 日期桶 */
  typeBrand: Record<string, GoogleBucket>;
  /** Google 系列数字 ID → 名称 */
  cmpNames: Record<string, string>;
}

/** google/cmp.json：Google Campaign 日桶（键=系列名或平台数字 ID；v2 新增，gm2 Campaign 明细用） */
export type GoogleCmpData = GoogleDimBucket;

/** 数据契约文件名 → 加载器（frontend/src/data 层按此懒加载） */
export const DATA_FILES = {
  manifest: 'manifest.json',
  dims: 'dims.json',
  channel: 'channel.json',
  metaAcc: 'meta/acc.json',
  metaCamp: 'meta/camp.json',
  metaSpu: 'meta/spu.json',
  metaDim: 'meta/dim.json',
  metaCreative: 'meta/creative.json',
  metaAd: 'meta/ad.json',
  googleAcc: 'google/acc.json',
  googleDim: 'google/dim.json',
  googleSpu: 'google/spu.json',
  googleType: 'google/type.json',
  googleCmp: 'google/cmp.json',
} as const;

export type DataFileKey = keyof typeof DATA_FILES;
