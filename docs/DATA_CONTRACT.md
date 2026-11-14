# 数据契约（Data Contract）

> 本文是 `pipeline`（生产方）与 `frontend`（消费方）之间的唯一契约。任何字段变更必须先改本文并同步双方评审。
> 版本：v4（v1 对齐原型 `ads_real.js` 的 `window.RD`；v2 新增 `google/cmp.json`；v3 改为月度分片 `months/<YYYY-MM>.json`；
> v4 Google 行集 7 元化（第 7 位=unified_interactions）+orders 改 unified_orders+google_type 换源 deep_dive+全 SQL 收敛 shopify 站点，2026-11-14 三方核对对齐观远）

## 1. 总则

- 所有数据文件为 UTF-8 JSON，输出目录：`frontend/public/data/`，部署后 URL 前缀 `/ads_analysis_dashboard_normal/data/`（Pages 子路径）。
- v3 月度分片：回填起点 2026-01-01，按自然月切片逐月拉取（月内字段与单窗口口径完全一致），每日 T+1 05:00 全量幂等重生成（历史月份迟到回传随同步收敛）。
- 文件级原子性：任一文件生成失败则本次更新整体失败，不提交半成品；每月分片生成时即跑校验（月窗口伪 manifest）。
- 数值精度：金额保留原始精度（不做四舍五入），比率类指标一律由前端 `shared/metrics.ts` 现算，**数据文件只存基础桶，不存派生指标**（指标一致性根因约束）。

## 2. 文件清单

| 文件 | 内容 | 估算体积 |
|---|---|---|
| `manifest.json` | 版本/生成时间/月份列表/日期范围/口径说明 | <1KB |
| `dims.json` | 全部维度枚举（全窗口并集） | ~300KB |
| `months/<YYYY-MM>.json` | 单自然月全部日粒度结构（MonthSlice：channel + 11 个维度桶） | 3~8MB/月 |

前端按需加载：首屏 `manifest + dims`，之后每次筛选区间/环比变化时加载所需月份并集（`frontend/src/data/merge.ts` 深合并重建内存桶，与 v2 单快照同构）；切日期时可能短暂显示加载遮罩。

MonthSlice 结构（权威定义 `shared/src/contract.ts`）：

```
month        YYYY-MM（冗余存文件内，加载校验用）
channel      { meta, google, gmv, edm } 渠道日汇总（含整站 GMV 与 EDM）
metaAcc      账号×日（站点桶）
metaCamp     广告系列×日
metaSpu      SPU×日
metaDim      { ctry, age }
metaCreative { sub, sub2, ctype }
metaAd       广告×日（键=adList 下标字符串）
googleAcc    账号×日
googleDim    { ctry, age }
googleSpu    SPU×日
googleType   { typeBrand, cmpNames }
googleCmp    Campaign×日
```

（各桶内部结构见 §3.4/§3.5，与 v2 逐文件字段完全一致，仅容器键名从文件名变为 MonthSlice 字段名。）

## 3. 类型定义

TypeScript 权威定义在 `shared/src/contract.ts`（前端与管道共用包），以下为规范表述。

### 3.1 基础桶（cell）

```
MetaCell   = [spend, impressions, clicks, orders, value, atc, ckt, (inter?)]
             8 元组；inter 为可选第 8 位（=全部点击，CVR 分母口径），仅部分桶携带
GoogleCell = [spend, impressions, clicks, orders, vs, va, (inter?)]
             6/7 元组；vs=Shopify 口径转化价值, va=Ads 后台口径转化价值；
             v4：channel/acc/spu/type/ctry 恒 7 元（第 7 位=unified_interactions，CVR 分母），age 恒 6 元
GoogleCtyCell = [spend, impressions, clicks, orders, vs, va, inter]
             7 元组（Google 国家桶）；与 GoogleCell 7 元同构
```

字段语义（与原型 `zero()/cell7()/g6()` 一一对应）：

| 字段 | 类型 | 含义 | 备注 |
|---|---|---|---|
| spend | number | 花费（USD） | |
| impressions | number | 展示量 | |
| clicks | number | 点击量 | Meta=inline_link_clicks（观远商品投产口径） |
| orders | number | 订单数 | Meta=platform_orders；Google=unified_orders（站点归因，v4 对齐观远）；Google 年龄桶=platform_orders（与观远年龄表一致） |
| value | number | 转化价值（GMV） | Meta；Google 侧 value=vs |
| atc | number | 加购数 | Meta 专属 |
| ckt | number | 结账数 | Meta 专属 |
| vs | number | Google·Shopify 口径 GMV | |
| va | number | Google·Ads 后台口径 GMV | |
| inter | number? | CVR 分母 | Meta 桶=全部点击；Google 桶=unified_interactions（归因访问用户数；v4 起 acc/spu/type/ctry 全携带，age 除外） |

### 3.2 manifest.json

```jsonc
{
  "v": 4,                        // 契约版本，与 shared/src/contract.ts 的 CONTRACT_VERSION 一致
  "genAt": "2026-11-14 05:10",   // 管道生成时间（展示为"数据更新"badge）
  "months": ["2026-01", "2026-02", "..."],  // 月分片月列表（升序；前端按需加载 months/<m>.json）
  "range": { "min": "2026-01-01", "max": "2026-11-11",
             "viewStart": "2026-11-05", "viewEnd": "2026-11-11" },  // view* =默认选中区间（数据末 7 天）
  "scope": "Meta×(shopify+shoplazza) + Google×shopify；TikTok/Snapchat、Google×shoplazza 未接入；口径=unified"
}
```

### 3.3 dims.json

```jsonc
{
  "metaAccounts": ["NEWBELLA-AR007", "..."],   // 含 Read-Only 监控账号（前端过滤展示）
  "gAccounts":    ["NEWBELLA-US01"],
  "metaCampaigns": ["..."],                     // 2000+，Google 系列名映射见 google/type.json 的 campaigns
  "gCampaigns":   ["..."],
  "spus":  ["8GG02BL5", "..."],                 // Meta SPU
  "gSpus": ["UNKNOWN", "AWF02776", "..."],      // Google SPU（UNKNOWN 保留）
  "spuAccs": { "AWF04228": ["cosyisland 9"], "...": ["..."] },  // SPU→有数据的账号（联动筛选用）
  "types":    ["纯人素材", "视频广告", "图片广告", "..."],        // 素材类型（m4）
  "countries": ["United States", "..."],        // 85 国，键为英文国名
  "ages": ["18-24", "25-34", "35-44", "45-54", "55-64", "65+", "Unknown"],
  "combos": [["demandgen", "no brand"], ["search", "brand"], "..."],  // Google 广告类型×品牌
  "adList": [ ["广告名", "素材类型", "素材编号code"], ... ]          // Top3000，索引即 meta/ad.json 的键
}
```

### 3.4 通用桶结构（与原型 RD 同构）

日期键 `YYYY-MM-DD`；站点键 `shopify | shoplazza | unknown`；`A` = 全站点合计（管道必须输出，站点过滤在前端基于分站点求和实现，`A` 用于交叉校验）。

```jsonc
// 形如 meta/acc.json
{
  "cosyisland 3": {
    "2026-10-03": { "shopify": [/*MetaCell*/], "A": [/*MetaCell*/] },
    "2026-10-06": { "shopify": [...], "A": [...] }
  }
}
// Google 桶无站点维：{ "NEWBELLA-US01": { "2026-10-03": [/*GoogleCell*/] } }
// Google 国家桶：{ "United Kingdom": { "2026-10-07": [/*GoogleCtyCell*/] } }
```

### 3.5 各数据文件专属结构

**channel.json**（渠道归因总览）
```jsonc
{
  "meta":   { "2026-10-03": { "shopify": [MetaCell], "shoplazza": [MetaCell], "unknown": [MetaCell], "A": [MetaCell] } },
  "google": { "2026-10-03": [GoogleCell] },
  "gmv":    { "2026-10-15": { "shopify": [金额, 订单数], "shoplazza": [金额, 订单数], "A": [金额, 订单数] } },  // 整站 GMV（易仓已付款 status=4，按下单日期）
  "edm":    { "2026-09-01": [花费] }
}
```

**meta/camp.json**：`{ 系列名: { 日期: {站点|A: MetaCell} } }`（键= dims.metaCampaigns 成员）

**meta/spu.json**：`{ SPU: { 日期: {站点|A: MetaCell} } }`（8 元含 inter）

**meta/dim.json**：`{ "ctry": {国家: {日期: {站点|A: MetaCell}}}, "age": {年龄段: {...}} }`

**meta/creative.json**（m4 素材效率）
```jsonc
{
  "sub":  { 素材类型: { 子分类(如 KOL/非KOL): { 日期: {站点: MetaCell} } } },
  "sub2": { 素材类型: { 新旧(新素材/老素材):   { 日期: {站点: MetaCell} } } },
  "ctype": { 大写类型(如 SEARCH): { 日期: {站点|A: MetaCell} } }
}
```

**meta/ad.json**：`{ 序号字符串: { 日期: {站点|A: MetaCell} } }`（序号 = dims.adList 数组下标）

**google/acc.json**：`{ 账号: { 日期: GoogleCell } }`（7 元含 inter）；**google/spu.json**、channel.google、google/type.json 同构（7 元）
**google/dim.json**：`{ "ctry": {国家: {日期: GoogleCtyCell}}, "age": {年龄段: {日期: GoogleCell}} }`（age 恒 6 元）
**google/type.json**：`{ "typeBrand": { "search|no brand": { 日期: GoogleCell } }, "cmpNames": { "10579": "系列名", "...": "..." } }`（v4 换源 deep_dive：type 键小写 search/shopping/pmax/demandgen/display/unknown，brand 键=brand/no brand/unknown）
**google/cmp.json**（v2 新增）：`{ 系列名或数字ID: { 日期: GoogleCell } }`；枚举= dims.gCampaigns，未携带名称映射的数字 ID 原样展示

## 4. 校验规则（pipeline/src/validate.ts 强制执行；v3 逐月分片运行）

1. **结构**：所有文件符合上述 schema（zod schema 定义于 `shared/src/contract.ts`）。
2. **交叉自洽**（容差 0.01）：
   - Σ(meta/acc 各账号某日 A.spend) == channel.meta[某日].A.spend
   - Σ(meta/spu 各 SPU 某日 A.value) ≈ channel.meta[某日].A.value（SPU 维有 unknown 归集，允许 ±2% 漂移，超限告警不阻断）
   - Σ(google/type 各组合某日 spend) == channel.google[某日].spend
3. **非负**：计数/花费位严格 ≥0；GMV 金额位允许为负（v4：Meta 位 4=value、Google 位 4=vs/5=va——站点退款/取消回溯修正，2026-11-03 google vs=-21.26 实测）；orders>0 而 spend==0 的行保留（口径：零花费有订单行保留以保证总计=全量）。
4. **日期连续性**：range 内允许缺天（无投放），但 manifest.range.min/max 必须覆盖所有键。
5. **A 键校验**：任一分站点之和与 A 差异 > 0.01 视为管道 bug。

## 5. 变更流程

1. 修改 `shared/src/contract.ts` + 本文档，`CONTRACT_VERSION` +1；
2. manifest.v 与前端运行时校验不匹配时，前端顶栏提示“数据契约已升级，请刷新”；
3. 管道与前端同 PR 合并（或先合管道保持向后兼容新增字段，再合前端消费）。

## 6. v3 加载语义（frontend/src/data + stores/data）

- 首屏：manifest（版本校验）→ dims → `ensureForRange()`（默认区间∪环比所需月份并行拉取，`mergeSlices` 深合并重建全部内存桶）。
- 筛选应用（version++）→ watch 触发 `ensureForRange()` 增量补载缺失月份；加载期间 `rangeReady=false`，App 层显示遮罩。
- 已加载月份缓存于内存 Map；重复切换区间不再重复请求。`?v=<genAt>` 查询串保证内容变更后长缓存失效。
