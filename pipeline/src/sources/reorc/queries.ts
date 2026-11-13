/**
 * ReOrc 拉数 SQL 模板（按主题）。每个主题输出列名固定，行映射（rows.ts）严格依赖这些别名。
 *
 * 数据源（2026-11-13 定向探查确认，selectdb 连接 / Doris）：
 *   - data_warehouse_prod.ads_marketing_channel/campaign/country/age_daily  统一营销日表（platform=meta/google/tiktok/snapchat）
 *   - data_warehouse_prod.ads_marketing_spu_daily          商品×日（spu 字段直接可用）
 *   - data_warehouse_prod.ads_marketing_creative_by_ad_daily  广告×日（ad_name/creative_type/creative_code）
 *   - belle_oversea.dim_facebook_ad_info_mapping_current   Meta 广告维表（material_type/kol_name/created_time）
 *   - belle_oversea.ads_ec_mul_platform_sales_daily        易仓已付款订单日汇总（整站 GMV 口径）
 *   - data_warehouse_prod.dim_edm_ad_fee                   EDM 月度账单（月摊日）
 *
 * 口径映射：clicks=platform_link_clicks（链接点击，CVR 分子）、inter=platform_clicks（全部点击）；
 *          Google：vs=attributed_sales（站点归因 GMV）、va=platform_conversion_value（平台后台 GMV）。
 * 列别名与聚合口径是契约的一部分，调整时**不得改动别名**。
 *
 * 统一约定：
 *   - 维度列：date(YYYY-MM-DD) / site(shopify|shoplazza|unknown) / account / campaign / spu / country / age / type / sub / sub2 / ctype / ad_name / ad_type / ad_no / brand / campaign_id / campaign_name
 *   - Meta 度量：spend impressions clicks orders value atc ckt inter（inter=全部点击/CVR 分母，可为 NULL → 7 元 cell）
 *   - Google 度量：spend impressions clicks orders vs va（vs=站点归因 GMV，va=Ads 后台口径 GMV）；国家桶另有 inter
 *   - GMV：amount cnt；EDM：spend
 *   - {{START}}/{{END}} 由渲染时替换（滚动重算窗口）
 */

export interface QueryParams {
  start: string;
  end: string;
}

export interface QueryTopic {
  id: string;
  desc: string;
  sql: (p: QueryParams) => string;
}

/** Meta 广告表与过滤条件（platform 取值：meta/google/tiktok/snapchat） */
const META_BY_AD = 'data_warehouse_prod.ads_marketing_creative_by_ad_daily';
const META_FILTER = `platform = 'meta' AND dt BETWEEN '{{START}}' AND '{{END}}'`;

/** Meta 8 度量（marketing 系列表 platform_* 字段 → 契约别名） */
const META_MEASURE = `SUM(platform_cost) AS spend, SUM(platform_impressions) AS impressions, SUM(platform_link_clicks) AS clicks,
       SUM(platform_orders) AS orders, SUM(platform_conversion_value) AS value, SUM(platform_add_to_cart_count) AS atc,
       SUM(platform_checkout_count) AS ckt, SUM(platform_clicks) AS inter`;

/** Google 6 度量（vs=站点归因销售 attributed_sales，va=平台后台口径 platform_conversion_value） */
const GOOGLE_MEASURE = `SUM(platform_cost) AS spend, SUM(platform_impressions) AS impressions, SUM(platform_link_clicks) AS clicks,
       SUM(platform_orders) AS orders, SUM(attributed_sales) AS vs, SUM(platform_conversion_value) AS va`;

/** KOL/非KOL 判定与新老素材判定（dim 维表字段） */
const SUB_KOL = `CASE WHEN d.kol_name IS NOT NULL AND TRIM(d.kol_name) != '' THEN 'KOL' ELSE '非KOL' END`;
const SUB_AGE = `CASE WHEN SUBSTRING(d.created_time, 1, 10) >= DATE_SUB('{{END}}', INTERVAL 30 DAY) THEN '新素材' ELSE '老素材' END`;
/** 创意格式中文 → IMAGE/VIDEO（原型 ctype 口径） */
const CTYPE = `CASE WHEN f.creative_type LIKE '%视频%' THEN 'VIDEO' WHEN f.creative_type LIKE '%图片%' THEN 'IMAGE'
       ELSE COALESCE(NULLIF(TRIM(f.creative_type), ''), 'OTHER') END`;
/** 品牌解析（campaign_name 无统一 brand 字段，按命名约定识别） */
const BRAND = `CASE WHEN LOWER(f.campaign_name) LIKE '%cosy%' THEN 'Cosy' WHEN LOWER(f.campaign_name) LIKE '%bella%' THEN 'Bella' ELSE '其他' END`;

export const REORC_QUERIES: QueryTopic[] = [
  {
    id: 'meta_channel',
    desc: 'Meta 渠道日汇总（站点级，渠道总览）',
    sql: (p) => `SELECT dt AS date, LOWER(sales_platform) AS site, ${META_MEASURE}
FROM data_warehouse_prod.ads_marketing_channel_daily
WHERE ${META_FILTER}
GROUP BY dt, LOWER(sales_platform)`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'meta_acc',
    desc: 'Meta 账号×日（m2 账号定位）',
    sql: (p) => `SELECT dt AS date, account AS account, LOWER(sales_platform) AS site, ${META_MEASURE}
FROM data_warehouse_prod.ads_marketing_channel_daily
WHERE ${META_FILTER}
GROUP BY dt, account, LOWER(sales_platform)`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'meta_camp',
    desc: 'Meta 系列×日（m1 大盘健康度系列列表）',
    sql: (p) => `SELECT dt AS date, campaign_name AS campaign, LOWER(sales_platform) AS site, ${META_MEASURE}
FROM data_warehouse_prod.ads_marketing_campaign_daily
WHERE ${META_FILTER}
GROUP BY dt, campaign_name, LOWER(sales_platform)`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'meta_spu',
    desc: 'Meta SPU×账号×日（m3 商品投产；推导 spuAccs）',
    sql: (p) => `SELECT dt AS date, spu AS spu, account AS account, LOWER(sales_platform) AS site, ${META_MEASURE}
FROM data_warehouse_prod.ads_marketing_spu_daily
WHERE platform = 'meta' AND spu IS NOT NULL AND spu != '' AND dt BETWEEN '{{START}}' AND '{{END}}'
GROUP BY dt, spu, account, LOWER(sales_platform)`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'meta_ctry',
    desc: 'Meta 国家×日（m5）',
    sql: (p) => `SELECT dt AS date, COALESCE(country_code, 'UNKNOWN') AS country, LOWER(sales_platform) AS site, ${META_MEASURE}
FROM data_warehouse_prod.ads_marketing_country_daily
WHERE ${META_FILTER}
GROUP BY dt, COALESCE(country_code, 'UNKNOWN'), LOWER(sales_platform)`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'meta_age',
    desc: 'Meta 年龄×日（m6）',
    sql: (p) => `SELECT dt AS date, age_group AS age, LOWER(sales_platform) AS site, ${META_MEASURE}
FROM data_warehouse_prod.ads_marketing_age_daily
WHERE ${META_FILTER}
GROUP BY dt, age_group, LOWER(sales_platform)`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'meta_sub',
    desc: 'Meta 素材类型×KOL子分类×日（m4 KOL/非KOL；dim 维表 JOIN）',
    sql: (p) => `SELECT f.dt AS date, d.material_type AS type, ${SUB_KOL} AS sub, LOWER(f.sales_platform) AS site, ${META_MEASURE}
FROM ${META_BY_AD} f
LEFT JOIN belle_oversea.dim_facebook_ad_info_mapping_current d ON f.ad_id = d.ad_id
WHERE f.${META_FILTER}
GROUP BY f.dt, d.material_type, ${SUB_KOL}, LOWER(f.sales_platform)`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'meta_sub2',
    desc: 'Meta 素材类型×新老素材×日（m4；创建时间 30 天内=新素材）',
    sql: (p) => `SELECT f.dt AS date, d.material_type AS type, ${SUB_AGE} AS sub2, LOWER(f.sales_platform) AS site, ${META_MEASURE}
FROM ${META_BY_AD} f
LEFT JOIN belle_oversea.dim_facebook_ad_info_mapping_current d ON f.ad_id = d.ad_id
WHERE f.${META_FILTER}
GROUP BY f.dt, d.material_type, ${SUB_AGE}, LOWER(f.sales_platform)`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'meta_ctype',
    desc: 'Meta 创意格式 IMAGE/VIDEO×日',
    sql: (p) => `SELECT f.dt AS date, ${CTYPE} AS ctype, LOWER(f.sales_platform) AS site, ${META_MEASURE}
FROM ${META_BY_AD} f
WHERE f.${META_FILTER}
GROUP BY f.dt, ${CTYPE}, LOWER(f.sales_platform)`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'meta_ad',
    desc: 'Meta 广告×日（m4 素材下钻；推导 adList=[ad_name, ad_type, ad_no]）',
    sql: (p) => `SELECT f.dt AS date, f.ad_name AS ad_name, f.creative_type AS ad_type,
       COALESCE(NULLIF(TRIM(f.creative_code), ''), f.ad_id) AS ad_no, LOWER(f.sales_platform) AS site, ${META_MEASURE}
FROM ${META_BY_AD} f
WHERE f.${META_FILTER}
GROUP BY f.dt, f.ad_name, f.creative_type, COALESCE(NULLIF(TRIM(f.creative_code), ''), f.ad_id), LOWER(f.sales_platform)`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'google_channel',
    desc: 'Google 渠道日汇总',
    sql: (p) => `SELECT dt AS date, ${GOOGLE_MEASURE}
FROM data_warehouse_prod.ads_marketing_channel_daily
WHERE platform = 'google' AND dt BETWEEN '{{START}}' AND '{{END}}'
GROUP BY dt`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'google_acc',
    desc: 'Google 账号×日（gm2）',
    sql: (p) => `SELECT dt AS date, account AS account, ${GOOGLE_MEASURE}
FROM data_warehouse_prod.ads_marketing_channel_daily
WHERE platform = 'google' AND dt BETWEEN '{{START}}' AND '{{END}}'
GROUP BY dt, account`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'google_cmp',
    desc: 'Google 系列 ID→名称（cmpNames；非聚合查询）',
    sql: () => `SELECT DISTINCT campaign_id AS campaign_id, campaign_name AS campaign_name
FROM data_warehouse_prod.ads_marketing_campaign_daily
WHERE platform = 'google' AND campaign_id IS NOT NULL AND TRIM(campaign_id) != ''
LIMIT 100000`,
  },
  {
    id: 'google_spu',
    desc: 'Google SPU×日（gm3）',
    sql: (p) => `SELECT dt AS date, spu AS spu, ${GOOGLE_MEASURE}
FROM data_warehouse_prod.ads_marketing_spu_daily
WHERE platform = 'google' AND spu IS NOT NULL AND spu != '' AND dt BETWEEN '{{START}}' AND '{{END}}'
GROUP BY dt, spu`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'google_type',
    desc: 'Google 广告类型×品牌×日（g1；推导 combos；品牌按 campaign_name 约定识别）',
    sql: (p) => `SELECT f.dt AS date, f.creative_type AS type, ${BRAND} AS brand, ${GOOGLE_MEASURE}
FROM ${META_BY_AD} f
WHERE f.platform = 'google' AND f.dt BETWEEN '{{START}}' AND '{{END}}'
GROUP BY f.dt, f.creative_type, ${BRAND}`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'google_ctry',
    desc: 'Google 国家×日（g2；7 元含 unified_interactions）',
    sql: (p) => `SELECT dt AS date, COALESCE(country_code, 'UNKNOWN') AS country, ${GOOGLE_MEASURE}, SUM(unified_interactions) AS inter
FROM data_warehouse_prod.ads_marketing_country_daily
WHERE platform = 'google' AND dt BETWEEN '{{START}}' AND '{{END}}'
GROUP BY dt, COALESCE(country_code, 'UNKNOWN')`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'google_age',
    desc: 'Google 年龄×日（gm6；age 表无归因销售，vs 用 sales 近似）',
    sql: (p) => `SELECT dt AS date, age_group AS age, SUM(platform_cost) AS spend, SUM(platform_impressions) AS impressions,
       SUM(platform_link_clicks) AS clicks, SUM(platform_orders) AS orders, SUM(sales) AS vs, SUM(platform_conversion_value) AS va
FROM data_warehouse_prod.ads_marketing_age_daily
WHERE platform = 'google' AND dt BETWEEN '{{START}}' AND '{{END}}'
GROUP BY dt, age_group`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'gmv',
    desc: '整站 GMV（易仓已付款订单日汇总表，按付款日期；cnt=qty 件数近似）',
    sql: (p) => `SELECT platform_paid_date AS date, LOWER(platform) AS site, SUM(sale_usd) AS amount, SUM(qty) AS cnt
FROM belle_oversea.ads_ec_mul_platform_sales_daily
WHERE platform_paid_date BETWEEN '{{START}}' AND '{{END}}'
GROUP BY platform_paid_date, LOWER(platform)`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'edm',
    desc: 'EDM 渠道日花费（dim_edm_ad_fee 为月度账单，按月天数摊到日）',
    sql: (p) => `SELECT DATE_ADD(DATE_FORMAT(SUBSTRING(f.bill_month, 1, 10), '%Y-%m-01'), INTERVAL s.n - 1 DAY) AS date,
       SUM(f.ad_fee) / DAY(LAST_DAY(f.bill_month)) AS spend
FROM data_warehouse_prod.dim_edm_ad_fee f
CROSS JOIN (SELECT 1 AS n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6
            UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12
            UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL SELECT 15 UNION ALL SELECT 16 UNION ALL SELECT 17 UNION ALL SELECT 18
            UNION ALL SELECT 19 UNION ALL SELECT 20 UNION ALL SELECT 21 UNION ALL SELECT 22 UNION ALL SELECT 23 UNION ALL SELECT 24
            UNION ALL SELECT 25 UNION ALL SELECT 26 UNION ALL SELECT 27 UNION ALL SELECT 28 UNION ALL SELECT 29 UNION ALL SELECT 30
            UNION ALL SELECT 31) s
WHERE s.n <= DAY(LAST_DAY(f.bill_month))
  AND DATE_ADD(DATE_FORMAT(SUBSTRING(f.bill_month, 1, 10), '%Y-%m-01'), INTERVAL s.n - 1 DAY) BETWEEN '{{START}}' AND '{{END}}'
GROUP BY date`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
];

export const REORC_TOPIC_IDS = REORC_QUERIES.map((q) => q.id);
