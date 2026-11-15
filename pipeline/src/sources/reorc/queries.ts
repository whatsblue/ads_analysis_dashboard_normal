/**
 * ReOrc 拉数 SQL 模板（按主题）。每个主题输出列名固定，行映射（rows.ts）严格依赖这些别名。
 *
 * 数据源（2026-11-13 定向探查确认，selectdb 连接 / Doris）：
 *   - data_warehouse_prod.ads_marketing_channel/campaign/country/age_daily  统一营销日表（platform=meta/google/tiktok/snapchat）
 *   - data_warehouse_prod.ads_marketing_spu_daily          商品×日（spu 字段直接可用）
 *   - data_warehouse_prod.ads_marketing_creative_by_ad_daily  广告×日（ad_name/creative_type/creative_code）
 *   - belle_oversea.dim_facebook_ad_info_mapping_current   Meta 广告维表（material_type/kol_name/created_time）
 *   - belle_oversea.ads_ec_mul_platform_sales_daily        易仓已付款订单日汇总（整站 GMV 口径）
 *   - data_warehouse_prod.ods_edm_ads_shopify_marketing_attribution_daily  Shopify EDM 营销归因日销售（utm=Klaviyo+CartSee，2025-01 起全历史；2026-11-15 切换：原 edmreport_d 仅 2026-09 起有数致 1-8 月 EDM 缺失）
 *
 * 口径映射：clicks=platform_link_clicks（链接点击，CVR 分子）、inter=platform_clicks（全部点击）；
 *          Google：clicks=platform_clicks（Google Ads interactions，观远后台口径；数仓 link_clicks 恒 0）、
 *                  orders=unified_orders（站点归因订单，2026-11-14 三方核对对齐观远）、
 *                  vs=attributed_sales（站点归因 GMV）、va=platform_conversion_value（平台后台 GMV）、
 *                  inter=unified_interactions（归因访问用户数，CVR 分母）；全站仅 shopify（shoplazza 站 AR01 账号不纳入）。
 * 列别名与聚合口径是契约的一部分，调整时**不得改动别名**。
 *
 * 统一约定：
 *   - 维度列：date(YYYY-MM-DD) / site(shopify|shoplazza|unknown) / account / campaign / spu / country / age / type / sub / sub2 / ctype / ad_name / ad_type / ad_no / brand / campaign_id / campaign_name
 *   - Meta 度量：spend impressions clicks orders value atc ckt inter（inter=全部点击/CVR 分母，可为 NULL → 7 元 cell）
 *   - Google 度量：spend impressions clicks orders vs va inter（orders=unified_orders，vs=站点归因 GMV，
 *     va=Ads 后台口径 GMV，inter=unified_interactions 全桶携带；age 桶除外，恒 6 度量）
 *   - GMV：amount cnt；EDM：value（归因销售额，前端计入转化价值，无广告花费）
 *   - {{START}}/{{END}} 由渲染时替换（滚动重算窗口）
 *   - 禁止末尾 ORDER BY/LIMIT 修饰：平台 sql-query API 会包装 SQL（追加页 limit/offset），
 *     末尾裸 ORDER BY 语法非法（mismatched input 'ORDER'）；翻页丢行问题由 monthly.ts 的
 *     queryWindow 自适应二分解决（页满即二分日期窗口递归拉取，2026-11-14 定位：无序 GROUP BY
 *     在两次翻页间行序不稳定 → 页重复/尾部丢行，google_spu 10 月 5162 行只入桶 5000、10-29 全天丢失）
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

/** Google 过滤：观远口径仅 shopify 站点（shoplazza 站 NEWBELLA-AR01 账号不纳入，2026-11-14 三方核对确认） */
const GOOGLE_FILTER = `platform = 'google' AND sales_platform = 'shopify' AND dt BETWEEN '{{START}}' AND '{{END}}'`;

/** Google 7 度量（orders=unified_orders 站点归因订单；inter=unified_interactions 归因访问用户数，CVR 分母；
 *  clicks=platform_clicks 即 Google Ads interactions，观远后台口径；vs=站点归因 attributed_sales，va=平台后台 platform_conversion_value） */
const GOOGLE_MEASURE = `SUM(platform_cost) AS spend, SUM(platform_impressions) AS impressions, SUM(platform_clicks) AS clicks,
       SUM(unified_orders) AS orders, SUM(attributed_sales) AS vs, SUM(platform_conversion_value) AS va, SUM(unified_interactions) AS inter`;

/** 素材子分类桶键规则（对齐原型 RD.sub 抽取侧：按广告名关键词拆分，与 adCodeOf 同款编码正则）：
 *  type 层：XSP 编码→视频广告、XPH 编码→图片广告、其余→红人素材（红人桶=全员，含不含 KOL 归「其他」行，合计=素材类型明细） */
const SUB_TYPE = `CASE WHEN f.ad_name REGEXP '[Xx][Ss][Pp][0-9]{3,}' THEN '视频广告'
       WHEN f.ad_name REGEXP '[Xx][Pp][Hh][0-9]{3,}' THEN '图片广告' ELSE '红人素材' END`;
/** 子分类层：编码素材按 AI 关键词；红人素材桶按 KOL×图片/视频（原型 SUB_DEFS.kol.split） */
const SUB_SUB = `CASE WHEN f.ad_name REGEXP '[Xx][Ss][Pp][0-9]{3,}' OR f.ad_name REGEXP '[Xx][Pp][Hh][0-9]{3,}'
       THEN CASE WHEN f.ad_name LIKE '%AI%' THEN 'AI' ELSE '非AI' END
       WHEN f.ad_name NOT LIKE '%KOL%' THEN '其他' WHEN f.ad_name LIKE '%图片%' THEN '图片'
       WHEN f.ad_name LIKE '%视频%' THEN '视频' ELSE '其他' END`;
/** 新旧/付费分类层（原型 alt.split 定版）：视频含 NEW=新/否则复刻；图片含 XMB=新/FK=复刻/其余其他；红人含「付费」=付费红人 */
const SUB_SUB2 = `CASE WHEN f.ad_name REGEXP '[Xx][Ss][Pp][0-9]{3,}' THEN CASE WHEN f.ad_name LIKE '%NEW%' THEN '新素材' ELSE '复刻素材' END
       WHEN f.ad_name REGEXP '[Xx][Pp][Hh][0-9]{3,}' THEN CASE WHEN f.ad_name LIKE '%XMB%' THEN '新素材'
       WHEN f.ad_name LIKE '%FK%' THEN '复刻素材' ELSE '其他' END
       WHEN f.ad_name LIKE '%付费%' THEN '付费红人' ELSE '非付费红人' END`;
/** 创意格式中文 → IMAGE/VIDEO（原型 ctype 口径） */
const CTYPE = `CASE WHEN f.creative_type LIKE '%视频%' THEN 'VIDEO' WHEN f.creative_type LIKE '%图片%' THEN 'IMAGE'
       ELSE COALESCE(NULLIF(TRIM(f.creative_type), ''), 'OTHER') END`;
export const REORC_QUERIES: QueryTopic[] = [
  {
    id: 'meta_channel',
    desc: 'Meta 渠道日汇总（站点级，渠道总览）',
    sql: (p) => `SELECT dt AS date, LOWER(sales_platform) AS site, ${META_MEASURE}
FROM data_warehouse_prod.ads_marketing_channel_daily
WHERE ${META_FILTER}
GROUP BY dt, LOWER(sales_platform)`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'meta_acc',
    desc: 'Meta 账号×日（m2 账号定位）',
    sql: (p) => `SELECT dt AS date, account AS account, LOWER(sales_platform) AS site, ${META_MEASURE}
FROM data_warehouse_prod.ads_marketing_channel_daily
WHERE ${META_FILTER}
GROUP BY dt, account, LOWER(sales_platform)`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'meta_camp',
    desc: 'Meta 系列×日（m1 大盘健康度系列列表）',
    sql: (p) => `SELECT dt AS date, campaign_name AS campaign, LOWER(sales_platform) AS site, ${META_MEASURE}
FROM data_warehouse_prod.ads_marketing_campaign_daily
WHERE ${META_FILTER}
GROUP BY dt, campaign_name, LOWER(sales_platform)`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'meta_spu',
    desc: 'Meta SPU×账号×日（m3 商品投产；推导 spuAccs）',
    sql: (p) => `SELECT dt AS date, spu AS spu, account AS account, LOWER(sales_platform) AS site, ${META_MEASURE}
FROM data_warehouse_prod.ads_marketing_spu_daily
WHERE platform = 'meta' AND spu IS NOT NULL AND spu != '' AND dt BETWEEN '{{START}}' AND '{{END}}'
GROUP BY dt, spu, account, LOWER(sales_platform)`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'meta_ctry',
    desc: 'Meta 国家×日（m5）',
    sql: (p) => `SELECT dt AS date, COALESCE(country_code, 'UNKNOWN') AS country, LOWER(sales_platform) AS site, ${META_MEASURE}
FROM data_warehouse_prod.ads_marketing_country_daily
WHERE ${META_FILTER}
GROUP BY dt, COALESCE(country_code, 'UNKNOWN'), LOWER(sales_platform)`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'meta_age',
    desc: 'Meta 年龄×日（m6）',
    sql: (p) => `SELECT dt AS date, age_group AS age, LOWER(sales_platform) AS site, ${META_MEASURE}
FROM data_warehouse_prod.ads_marketing_age_daily
WHERE ${META_FILTER}
GROUP BY dt, age_group, LOWER(sales_platform)`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'meta_sub',
    desc: 'Meta 素材子分类×日（m4 双表；广告名关键词规则对齐原型 RD.sub：红人素材 KOL×图片/视频、视频/图片广告×AI/非AI）',
    sql: (p) => `SELECT f.dt AS date, ${SUB_TYPE} AS type, ${SUB_SUB} AS sub, LOWER(f.sales_platform) AS site, ${META_MEASURE}
FROM ${META_BY_AD} f
WHERE f.${META_FILTER}
GROUP BY f.dt, type, sub, LOWER(f.sales_platform)`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'meta_sub2',
    desc: 'Meta 素材新旧/付费分类×日（m4 alt 表；原型 alt.split：NEW/XMB=新、FK=复刻、付费=付费红人）',
    sql: (p) => `SELECT f.dt AS date, ${SUB_TYPE} AS type, ${SUB_SUB2} AS sub2, LOWER(f.sales_platform) AS site, ${META_MEASURE}
FROM ${META_BY_AD} f
WHERE f.${META_FILTER}
GROUP BY f.dt, type, sub2, LOWER(f.sales_platform)`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'meta_ctype',
    desc: 'Meta 创意格式 IMAGE/VIDEO×日',
    sql: (p) => `SELECT f.dt AS date, ${CTYPE} AS ctype, LOWER(f.sales_platform) AS site, ${META_MEASURE}
FROM ${META_BY_AD} f
WHERE f.${META_FILTER}
GROUP BY f.dt, ${CTYPE}, LOWER(f.sales_platform)`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'meta_ad',
    desc: 'Meta 广告×日（m4 素材下钻；推导 adList=[ad_name, ad_type, ad_no]）',
    sql: (p) => `SELECT f.dt AS date, f.ad_name AS ad_name, f.creative_type AS ad_type,
       COALESCE(NULLIF(TRIM(f.creative_code), ''), f.ad_id) AS ad_no, LOWER(f.sales_platform) AS site, ${META_MEASURE}
FROM ${META_BY_AD} f
WHERE f.${META_FILTER}
GROUP BY f.dt, f.ad_name, f.creative_type, COALESCE(NULLIF(TRIM(f.creative_code), ''), f.ad_id), LOWER(f.sales_platform)`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'google_channel',
    desc: 'Google 渠道日汇总（shopify 站点口径，7 度量含 inter）',
    sql: (p) => `SELECT dt AS date, ${GOOGLE_MEASURE}
FROM data_warehouse_prod.ads_marketing_channel_daily
WHERE ${GOOGLE_FILTER}
GROUP BY dt`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'google_acc',
    desc: 'Google 账号×日（gm2；shopify 站点口径）',
    sql: (p) => `SELECT dt AS date, account AS account, ${GOOGLE_MEASURE}
FROM data_warehouse_prod.ads_marketing_channel_daily
WHERE ${GOOGLE_FILTER}
GROUP BY dt, account`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'google_cmp',
    desc: 'Google 系列 ID→名称（cmpNames；非聚合查询；shopify 站点口径）',
    sql: () => `SELECT DISTINCT campaign_id AS campaign_id, campaign_name AS campaign_name
FROM data_warehouse_prod.ads_marketing_campaign_daily
WHERE platform = 'google' AND sales_platform = 'shopify' AND campaign_id IS NOT NULL AND TRIM(campaign_id) != ''LIMIT 100000`,
  },
  {
    id: 'google_spu',
    desc: 'Google SPU×日（gm3；shopify 站点口径）',
    sql: (p) => `SELECT dt AS date, spu AS spu, ${GOOGLE_MEASURE}
FROM data_warehouse_prod.ads_marketing_spu_daily
WHERE ${GOOGLE_FILTER} AND spu IS NOT NULL AND spu != ''
GROUP BY dt, spu`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'google_type',
    desc: 'Google 广告类型×是否品牌词×日（g1；推导 combos；v4 换源 deep_dive 表：小写类型键 + brand_keyword_type，2026-11-14 与观远逐位核对）',
    sql: (p) => `SELECT dt AS date, google_ad_type_group AS type, brand_keyword_type AS brand, ${GOOGLE_MEASURE}
FROM data_warehouse_prod.ads_google_deep_dive_daily
WHERE sales_platform = 'shopify' AND dt BETWEEN '{{START}}' AND '{{END}}'
GROUP BY dt, google_ad_type_group, brand_keyword_type`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'google_ctry',
    desc: 'Google 国家×日（g2；shopify 站点口径，7 元含 inter）',
    sql: (p) => `SELECT dt AS date, COALESCE(country_code, 'UNKNOWN') AS country, ${GOOGLE_MEASURE}
FROM data_warehouse_prod.ads_marketing_country_daily
WHERE ${GOOGLE_FILTER}
GROUP BY dt, COALESCE(country_code, 'UNKNOWN')`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'google_age',
    desc: 'Google 年龄×日（gm6；shopify 站点口径；age 表无归因销售，vs 用 sales 近似，orders 保持 platform_orders 与观远年龄表一致）',
    sql: (p) => `SELECT dt AS date, age_group AS age, SUM(platform_cost) AS spend, SUM(platform_impressions) AS impressions,
       SUM(platform_clicks) AS clicks, SUM(platform_orders) AS orders, SUM(sales) AS vs, SUM(platform_conversion_value) AS va
FROM data_warehouse_prod.ads_marketing_age_daily
WHERE ${GOOGLE_FILTER}
GROUP BY dt, age_group`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'gmv',
    desc: '整站 GMV（易仓已付款订单日汇总表，按付款日期；cnt=qty 件数近似）',
    sql: (p) => `SELECT platform_paid_date AS date, LOWER(platform) AS site, SUM(sale_usd) AS amount, SUM(qty) AS cnt
FROM belle_oversea.ads_ec_mul_platform_sales_daily
WHERE platform_paid_date BETWEEN '{{START}}' AND '{{END}}'
GROUP BY platform_paid_date, LOWER(platform)`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'edm',
    desc: 'EDM 渠道日归因销售额（Shopify 营销归因 utm=Klaviyo+CartSee，net=total_sales−reversals 退货后口径，与观远 BI 逐位一致；无广告花费，前端计入转化价值）',
    sql: (p) => `SELECT dt AS date, SUM(total_sales) - SUM(sales_reversals) AS value
FROM data_warehouse_prod.ods_edm_ads_shopify_marketing_attribution_daily
WHERE dt BETWEEN '{{START}}' AND '{{END}}'
GROUP BY dt
`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
];

export const REORC_TOPIC_IDS = REORC_QUERIES.map((q) => q.id);
