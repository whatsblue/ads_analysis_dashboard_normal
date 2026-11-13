/**
 * ReOrc 拉数 SQL 模板（按主题）。每个主题输出列名固定，行映射（rows.ts）严格依赖这些别名。
 *
 * ⚠️ 表名/字段名占位：当前写为 TODO_* 形式（token 恢复后按数仓实际 schema 替换，
 *    并按方言微调日期函数）。列别名与聚合口径是契约的一部分，替换时**不得改动别名**。
 *
 * 统一约定：
 *   - 维度列：date(YYYY-MM-DD) / site(shopify|shoplazza|unknown) / account / campaign / spu / country / age / type / sub / sub2 / ctype / ad_name / ad_type / ad_no / brand / campaign_id / campaign_name
 *   - Meta 度量：spend impressions clicks orders value atc ckt inter（inter=全部点击/CVR 分母，可为 NULL → 7 元 cell）
 *   - Google 度量：spend impressions clicks orders vs va（vs=Shopify 口径 GMV，va=Ads 后台口径 GMV）；国家桶另有 inter
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

/** 度量列 SQL 片段（Meta 8 项 / Google 6+1 项），别名即契约 */
const M = {
  meta: `SUM(spend) AS spend, SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(orders) AS orders,
         SUM(value) AS value, SUM(atc) AS atc, SUM(ckt) AS ckt, SUM(inter) AS inter`,
  google: `SUM(spend) AS spend, SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(orders) AS orders,
           SUM(vs) AS vs, SUM(va) AS va`,
};

const metaFrom = (groupByCols: string): string => `
FROM TODO_meta_ads_daily            -- TODO: Meta 广告日表（账号×系列×SPU×国家×年龄×素材×站点粒度）
WHERE stat_date BETWEEN '{{START}}' AND '{{END}}'
GROUP BY ${groupByCols}`;

const googleFrom = (groupByCols: string): string => `
FROM TODO_google_ads_daily          -- TODO: Google 广告日表
WHERE stat_date BETWEEN '{{START}}' AND '{{END}}'
GROUP BY ${groupByCols}`;

export const REORC_QUERIES: QueryTopic[] = [
  {
    id: 'meta_channel',
    desc: 'Meta 渠道日汇总（站点级，渠道总览）',
    sql: (p) => `SELECT stat_date AS date, LOWER(site) AS site, ${M.meta}${metaFrom('stat_date, LOWER(site)')}`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'meta_acc',
    desc: 'Meta 账号×日（m2 账号定位）',
    sql: (p) => `SELECT stat_date AS date, account_name AS account, LOWER(site) AS site, ${M.meta}${metaFrom('stat_date, account_name, LOWER(site)')}`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'meta_camp',
    desc: 'Meta 系列×日（m1 大盘健康度系列列表）',
    sql: (p) => `SELECT stat_date AS date, campaign_name AS campaign, LOWER(site) AS site, ${M.meta}${metaFrom('stat_date, campaign_name, LOWER(site)')}`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'meta_spu',
    desc: 'Meta SPU×账号×日（m3 商品投产；推导 spuAccs）',
    sql: (p) => `SELECT stat_date AS date, spu_name AS spu, account_name AS account, LOWER(site) AS site, ${M.meta}${metaFrom('stat_date, spu_name, account_name, LOWER(site)')}`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'meta_ctry',
    desc: 'Meta 国家×日（m5）',
    sql: (p) => `SELECT stat_date AS date, country_code AS country, LOWER(site) AS site, ${M.meta}${metaFrom('stat_date, country_code, LOWER(site)')}`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'meta_age',
    desc: 'Meta 年龄×日（m6）',
    sql: (p) => `SELECT stat_date AS date, age_range AS age, LOWER(site) AS site, ${M.meta}${metaFrom('stat_date, age_range, LOWER(site)')}`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'meta_sub',
    desc: 'Meta 素材类型×子分类×日（m4 KOL/非KOL）',
    sql: (p) => `SELECT stat_date AS date, creative_type AS type, sub_category AS sub, LOWER(site) AS site, ${M.meta}${metaFrom('stat_date, creative_type, sub_category, LOWER(site)')}`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'meta_sub2',
    desc: 'Meta 素材类型×新旧素材×日（m4 新老素材）',
    sql: (p) => `SELECT stat_date AS date, creative_type AS type, sub_category AS sub2, LOWER(site) AS site, ${M.meta}${metaFrom('stat_date, creative_type, sub_category, LOWER(site)')}`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'meta_ctype',
    desc: 'Meta 创意大写类型×日（如 IMAGE/VIDEO）',
    sql: (p) => `SELECT stat_date AS date, UPPER(creative_format) AS ctype, LOWER(site) AS site, ${M.meta}${metaFrom('stat_date, UPPER(creative_format), LOWER(site)')}`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'meta_ad',
    desc: 'Meta 广告×日（m4 素材下钻；推导 adList=[ad_name, ad_type, ad_no]）',
    sql: (p) => `SELECT stat_date AS date, ad_name AS ad_name, creative_type AS ad_type, creative_no AS ad_no, LOWER(site) AS site, ${M.meta}${metaFrom('stat_date, ad_name, creative_type, creative_no, LOWER(site)')}`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'google_channel',
    desc: 'Google 渠道日汇总',
    sql: (p) => `SELECT stat_date AS date, ${M.google}${googleFrom('stat_date')}`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'google_acc',
    desc: 'Google 账号×日（gm2）',
    sql: (p) => `SELECT stat_date AS date, account_name AS account, ${M.google}${googleFrom('stat_date, account_name')}`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'google_cmp',
    desc: 'Google 系列 ID→名称（cmpNames；非聚合查询）',
    sql: () => `SELECT campaign_id AS campaign_id, campaign_name AS campaign_name
FROM TODO_google_campaigns   -- TODO: Google 系列维表（平台数字 ID → 名称）
LIMIT 100000`,
  },
  {
    id: 'google_spu',
    desc: 'Google SPU×日（gm3）',
    sql: (p) => `SELECT stat_date AS date, spu_name AS spu, ${M.google}${googleFrom('stat_date, spu_name')}`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'google_type',
    desc: 'Google 广告类型×品牌×日（g1；推导 combos）',
    sql: (p) => `SELECT stat_date AS date, campaign_type AS type, brand AS brand, ${M.google}${googleFrom('stat_date, campaign_type, brand')}`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'google_ctry',
    desc: 'Google 国家×日（g2；7 元含 unified_interactions）',
    sql: (p) => `SELECT stat_date AS date, country_code AS country, ${M.google}, SUM(interactions) AS inter${googleFrom('stat_date, country_code')}`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'google_age',
    desc: 'Google 年龄×日（gm6）',
    sql: (p) => `SELECT stat_date AS date, age_range AS age, ${M.google}${googleFrom('stat_date, age_range')}`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'gmv',
    desc: '整站 GMV（易仓已付款 status=4，按下单日期，站点级）',
    sql: (p) => `SELECT order_date AS date, LOWER(site) AS site, SUM(amount) AS amount, COUNT(*) AS cnt
FROM TODO_ec_orders          -- TODO: 易仓订单表（已付款）
WHERE order_date BETWEEN '{{START}}' AND '{{END}}' AND status = 4
GROUP BY order_date, LOWER(site)`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
  {
    id: 'edm',
    desc: 'EDM 渠道日花费',
    sql: (p) => `SELECT stat_date AS date, SUM(spend) AS spend
FROM TODO_edm_spend          -- TODO: EDM 花费表
WHERE stat_date BETWEEN '{{START}}' AND '{{END}}'
GROUP BY stat_date`
      .replace(/{{START}}/g, p.start).replace(/{{END}}/g, p.end),
  },
];

export const REORC_TOPIC_IDS = REORC_QUERIES.map((q) => q.id);
