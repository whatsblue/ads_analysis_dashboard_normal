# 架构设计（ARCHITECTURE）

> 正式版架构定版文档。变更需评审并更新本文。
> 背景：原型 `whatsblue/ads-analysis-dashboard` 为 2317 行单 HTML + 8MB 静态 JS 数据，本地脚本更新数据、组件重复、难维护。本架构针对性解决：云端自动更新、查询速度、指标一致性、代码可维护性。

## 1. 系统总览

```
┌──────────────────────┐      ┌───────────────────────────────────────────┐
│  数据源               │      │  GitHub（唯一真相源 + 运行时）              │
│  · ReOrc 平台 API     │      │  ┌─────────────────────────────────────┐  │
│    (api.cn.reorc.cloud)│◀──────││ Actions: update-data.yml             │  │
│  · 数据库只读连接(备选)│ 拉取 │ │  每日三批次 北京 05:00/07:30/21:00     │  │
│    Meta/Google 投放   │      │ │  pipeline 拉数→校验→生成 JSON→commit │  │
└──────────────────────┘      │  └──────────────┬──────────────────────┘  │
                              │                 ▼ 触发                     │
                              │  ┌─────────────────────────────────────┐  │
                              │  │ Actions: deploy.yml                  │  │
                              │  │ pnpm build (Vite) → actions/deploy- │  │
                              │  │ pages → 线上看板更新                  │  │
                              │  └─────────────────────────────────────┘  │
                              └───────────────────────────────────────────┘
                                用户浏览器 ◀── Pages CDN（数据 JSON 懒加载）
```

**核心原则**
1. 无人值守：数据更新与部署全部在 GitHub 云端完成，不依赖任何本地电脑开机。
2. 单一真相源：指标计算只在 `shared` 包实现一次；数据文件只存基础桶，不存派生指标。
3. 契约先行：`docs/DATA_CONTRACT.md` + `shared/src/contract.ts`（含 zod schema）是 pipeline 与 frontend 的唯一接口。

## 2. 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 前端框架 | Vue 3.5 + `<script setup>` + TS | 组件化收敛原型重复代码；配置驱动渲染 |
| 构建 | Vite 6 | 快、生态成熟、GitHub Actions 构建简单 |
| 状态 | Pinia | 全局筛选（日期/站点/账号/SPU/国家/年龄/类型/系列/环比）跨 tab 持久化 |
| 图表 | ECharts 5 按需引入 | 与原型一致，迁移成本低 |
| 表格 | 自研轻量表格组件 | 原型表格交互（排序/总计/Top10加载更多/涨跌色/导出）定制深，组件化一次复用 |
| 单测 | Vitest | 锁定指标口径 |
| 管道 | Node 22 + TS + tsx | 与前端同语言栈，shared 包直接复用 |
| 包管理 | pnpm workspace | monorepo 三包（frontend / pipeline / shared） |
| CI/CD | GitHub Actions + Pages | 零成本、与仓库同域、cron 支持 |

## 3. Monorepo 结构

```
├── shared/                     # @ads/shared —— 契约与指标口径（唯一实现）
│   └── src/
│       ├── contract.ts         # CONTRACT_VERSION、cell 类型、zod schema
│       ├── metrics.ts          # Metrics 桶类型、addCell/sumMetrics、derive/deriveG（全部派生指标）
│       └── format.ts           # 金额/百分比/ROAS 格式化（全站统一）
├── frontend/                   # @ads/frontend
│   └── src/
│       ├── data/               # 数据访问层：按契约 fetch+缓存（loadDims/loadChannel/loadMeta...）
│       ├── stores/filter.ts    # 全局筛选 + 环比配置（sessionStorage 持久化）
│       ├── components/         # 通用组件（见 §5）
│       ├── specs/              # 各 tab 的列/指标/图表配置（配置驱动核心）
│       └── views/              # 13 视图：Overview + Meta(m1..m6) + Google(gm1,gm2,gm3,g1,g2,gm6)
├── pipeline/                   # @ads/pipeline
│   └── src/
│       ├── sources/reorc.ts    # ReOrc API 通道（token: REORC_BASE_URL/REORC_TOKEN）
│       ├── sources/db.ts       # DB 直连通道（适配器接口，凭据就绪后启用）
│       ├── sources/rdfile.ts   # 原型 ads_real.js 文件通道（迁移期种子数据）
│       ├── build/aggregate.ts  # 口径聚合：源行→契约桶（滚动 10 天重算）
│       ├── build/emit.ts       # 拆分写盘 frontend/public/data/*.json
│       ├── validate.ts         # 契约校验 + 交叉自洽断言
│       └── cli.ts              # 管道入口（tsx pipeline/src/cli.ts [--source=reorc|db|rdfile] [--out=...]）
├── .github/workflows/          # update-data.yml / deploy.yml / ci.yml
└── docs/
```

## 4. 指标一致性设计（痛点 1）

```
数据源 ──pipeline 聚合(基础桶)──▶ data/*.json ──▶ frontend data 层
                                                    │
                                                    ▼
                                   shared/metrics.ts（唯一实现）
                                   · Metrics：{spend,impressions,clicks,orders,value,atc,ckt,vs,va,inter}
                                   · derive(m)：CPM/CPC/CTR/CVR/CPA_ATC/CPA_CKT/CPA_ORD/ROAS/AOV/花费占比...
                                   · deriveG(m)：Google 双口径 ROAS_S(=vs/spend)/ROAS_A(=va/spend)
                                   · 总计规则：Σ求和 + 比率=Σ分子/Σ分母（对齐观远）
                                                    ▲
                                   pipeline/validate.ts（同一 shared 包做自洽断言）
```

- 任何视图/图表/KPI/导出**禁止**内联计算公式，只能调用 `shared/metrics.ts`。
- Vitest 快照锁定关键口径：ROAS、CVR（inter 分母）、Google 双口径、总计重算规则、涨跌色阈值（钱效率组>5%、流量效率组>10%）。
- 派生指标定义迁移自原型 `derive/deriveG/cell7/g6`，行为逐一对照。

## 5. 组件化设计（痛点：重复代码）

原型 12 个 render 函数（renderM1..M6/renderGm1..Gm6/renderOv/renderG1/renderG2）收敛为**配置驱动**：

```
视图 = DashboardTabShell + spec（columns/metrics/charts/filters）
```

| 组件 | 职责 | 收敛的原型代码 |
|---|---|---|
| `DashboardTabShell.vue` | tab 标题/描述/筛选插槽/卡片栅格 | 各 render* 头部样板 |
| `MetricsTable.vue` | 排序、总计行（Σ重算）、Top10+加载更多、涨跌色、零花费有订单行保留、导出 CSV | drawTable/regTable/buildCols 三处复制 |
| `KpiCard.vue` | 指标值+环比小字+波动高亮 | calHtml/deltaHtml |
| `BaseChart.vue` | ECharts 生命周期/resize/懒渲染/tooltip 主题 | chart()/trendOption/gTrendOpt |
| `MultiDropdown.vue` | 多选+搜索+分页+批量粘贴+排除+全选 | buildDD/ddInit 大段重复 |
| `RangeCompareBar.vue` | 环比开关+周期类型+周期数+自定义区间 | cmpRanges/cmpAuto/readCmpEd |
| `ExportModal.vue` | 自定义列与顺序导出 | openExpModal/doExport |

`specs/` 内每个 tab 一份纯配置（列 key、指标集、图表 option 工厂、筛选依赖），Meta 与 Google 同构 tab 共用视图组件仅换 spec——新增/修改维度只改配置不改组件。

## 6. 查询速度设计（痛点 2）

1. **拆分懒加载**：13 文件按视图加载，首屏 `manifest+dims+channel`（gzip 后约 80KB）；m4 下钻的 `meta/ad.json`（最大 ~3MB/gzip ~600KB）仅在进入素材下钻时加载。
2. **内存聚合**：数据已是日粒度桶（22 账号×67 天×8 字段量级），前端按筛选求和开销可忽略（原型已验证），无需后端查询服务。
3. **缓存**：数据文件内容不变期间 304/ETag；`manifest.json` 短缓存，其余文件按 genAt 日期做版本化查询串（`?v=<genAt>`）实现变更即时生效 + 长缓存。
4. **构建优化**：ECharts 按需注册、路由级代码分割、vendor 稳定分包。

## 7. 数据管道设计（痛点 3：自动更新）

```
cli.ts（PIPELINE_MODE=monthly）
  → sources/reorc/：ReOrc 双通道拉数（按凭证自动选择）
      主通道 openapi.ts：数据服务 preview（Bearer REORC_OPENAPI_KEY 个人密钥，长期）
      兜底 monthly.ts：sql-query（Bearer REORC_TOKEN 登录 JWT）+ queries.ts 19 主题 SQL + 二分翻页
  → build/aggregate.ts：源数据 → 契约桶（对齐原型 extract_real.py 口径：
      滚动重算最近 10 个自然日；历史区间快照不动）
  → validate.ts：契约 schema + 交叉自洽（Σ账号=渠道、Σ组合=Google 渠道、A=Σ站点）
  → build/emit.ts：原子写盘 frontend/public/data/（先写 tmp 再 rename）
  → 退出码非 0 = 失败 → workflow 停止 + 自动开 Issue 告警（附错误摘要）
```

- **通道抽象**：`Source` 接口（拉取原始行）→ reorc / db / rdfile 三实现。切换通道只改 `--source` 参数，聚合口径层复用。
- **迁移期策略**：`--source=rdfile` 把原型 `ads_real.js` 转为契约 JSON（Phase 0 fixture 即此产物），前端开发不被数据源阻塞；ReOrc 凭据就绪后切 `reorc`。
- **凭据**：`REORC_OPENAPI_KEY`（主通道，数据服务个人 API 密钥，长期有效、与登录态无关）与 `REORC_TOKEN`（兜底，登录 JWT 约 7 天过期）存 GitHub Secrets；主通道鉴权失败时管道以明确错误码失败并开 Issue 指导换钥；token 通道另有剩余有效期预警（<48h 自动开 issue 提醒续期，2026-11-25 断更 4 天事故防复发）。

### 7.1 取数链路与来源（2026-11-25 补记定版）

```
GitHub Actions（update-data.yml，北京 05:00 / 07:30 / 21:00 三批次）
  → pipeline 包启动（Node 22 + tsx）
  → 拉数双通道（cli.ts monthly 分支按凭证自动选择）：
      ① 主通道（REORC_OPENAPI_KEY 存在时）：ReOrc 开放 API 数据服务
         POST /api/data-service/open/services/{id}/preview
         body = { filters:[dt time_between], sorts, page, page_size:10000 }
         9 个数据服务（SQL 由 queries.ts 口径派生，平台侧 GROUP BY 预聚合）；
         月窗口按周切片拉取（大服务单月超 nginx 60s 网关硬限，实测 2026-11-25：
         campaign 单月 504、单周 2.5s）；慢窗口重试耗尽自动二分降级
         （splitRangeHalf：结构性慢查询单周也 504 时拆 4+3 天即可恢复，
         实测 creative 2025-07 中间三周均靠二分拉回；二分子窗口用零重试
         客户端直达——结构性慢查询重试必然再次超时，省时 ~200s/毛刺周）
         → openapi.ts 主题适配 → 契约行
      ② 兜底通道（仅 REORC_TOKEN）：平台 REST API（Bearer JWT）
         discover：按连接名 selectdb 解析 connection_id（GET 连接列表）
         POST /conn/connections/sql-query
         body = { connection_id, sql, env_id, database: data_warehouse_prod, limit, offset }
         平台以自身登记的 selectdb 连接（Doris 协议）代为执行仓库内 SQL，分页返回（5000 行/页）
  → pipeline：zod 契约校验 → shared 派生计算 → 月度分片 JSON + manifest
  → commit main → Pages 部署 → 前端按需懒加载
```

机制要点：**口径 SQL 维护在仓库**（queries.ts 模板与 openapi.ts 服务/度量映射常量，两通道同一契约），主通道服务 SQL 由 queries.ts 派生并部署在平台数据服务（个人 API 密钥鉴权，与登录态解耦）；兜底通道平台仅代为执行仓库内 SQL；数据库凭据登记在平台的「连接」内，两通道均不持有数仓账密。本地核对走同一入口（reorc-cli）。

数仓数据来源（`data_warehouse_prod`，ReOrc 上游建模管道产出）：

| 表 | 用途 |
|---|---|
| `ads_marketing_channel/campaign/country/age_daily` | 统一营销日表（platform=meta/google/tiktok/snapchat，四维拆分） |
| `ads_marketing_spu_daily` | 商品×日（SPU 字段直接可用） |
| `ads_marketing_creative_by_ad_daily` | 广告×日（ad_name/creative_type/creative_code） |
| `belle_oversea.dim_facebook_ad_info_mapping_current` | Meta 广告维表（material_type/kol_name/created_time） |
| `ods_eccang_order` | 易仓订单明细（status=4 已付款，整站 GMV 口径，对齐观远） |
| `ods_edm_ads_shopify_marketing_attribution_daily` | Shopify EDM 营销归因日销售（utm=Klaviyo+CartSee） |

### 7.2 数据与逻辑分层

| 层 | 位置 | 内容 |
|---|---|---|
| 数据存储 | SelectDB 数仓 `data_warehouse_prod` | 上表各主题基础表；本仓库只读，不存任何派生指标 |
| 数据快照 | 仓库 `frontend/public/data/` | 管道产出的月度分片 JSON（19 主题×月）+ manifest/dims，前端唯一数据源 |
| 拉取逻辑 | `pipeline/src/sources/reorc/queries.ts` | 每主题 SQL 模板 + 列别名（别名=契约的一部分）+ 口径映射（clicks=link_clicks、orders=unified_orders 等） |
| 管道逻辑 | `pipeline/src/sources/reorc/{openapi,monthly,rows}.ts`、`validate.ts`、`build/emit.ts` | 行映射、开放 API 周切片与主题适配、月度分片与二分翻页、契约校验、原子写盘 |
| 口径逻辑 | `shared/src/metrics.ts` | 派生指标（ROAS/CVR/CPA/AOV 等）唯一实现，前端与管道共用 |
| 展示逻辑 | `frontend/src/{specs,views,components}` | 仅展示层聚合与配置驱动渲染，不算口径 |

### 7.3 为何经由平台 API 而非直连 SelectDB

1. **凭据安全收口**：直连需把数仓账密放进 GitHub Secrets，权限大且泄露影响面大；平台 token 短效、可吊销、权限经平台管控。
2. **公网可达**：Actions runner 在公网，数仓通常仅内网/白名单可达；ReOrc API 为公网 HTTPS——「无人值守、不依赖任何人的电脑」核心原则的前提。
3. **统一入口与审计**：连接、账号、审计由平台统一管理（平台网页 / reorc-cli / CI 同一入口同一权限体系），旁路直连无审计。
4. **只读网关**：sql-query 为平台只读查询通道（限流/超时/分页协议由平台封装）；直连则是全权限数据库连接。

代价与兜底：sql-query 通道登录 JWT 周期过期曾致断更（2026-11-25 事故）→ 已由开放 API 主通道根治（个人密钥长期有效，与登录态解耦）；token <48h 预警 + 失败自动告警 + 部署前新鲜度校验三重防线保留兜底。开放 API 通道的已知约束：preview 服务端为全量聚合外层过滤执行，大服务必须周切片（nginx 60s 网关限）；time_between 上界为 datetime 语义，裸日期（'YYYY-MM-DD'）被解析为当天 00:00:00 会丢窗口尾日全天数据（对账实锤后拉取层已显式补 ' 23:59:59'）；个别周窗口是结构性慢查询（重试无用），拉取层对网络超时/429/5xx 重试耗尽后自动二分窗口递归拉取（子窗口零重试直达），单日窗口仍失败才报错。

## 8. CI/CD 设计

| workflow | 触发 | 步骤 |
|---|---|---|
| `ci.yml` | PR / push（非 main 的任意分支） | install → typecheck → vitest → build |
| `update-data.yml` | cron 三批次（北京 05:00 / 07:30 / 21:00）+ workflow_dispatch | token 预警 → 拉数校验（开放 API 主 + sql-query 兜底）→ 有变化则 commit `chore(data)` → 构建 frontend → 新鲜度校验 → 部署 Pages |
| `deploy.yml` | push main（前端共享/管道代码变更）、手动 | pnpm build → actions/upload-pages-artifact → actions/deploy-pages |

Pages URL：`https://whatsblue.github.io/ads_analysis_dashboard_normal/`（Vite `base` 配置子路径）。

## 9. 安全

- Secrets 只存 GitHub Actions Secrets，代码与文档零明文凭据。
- 管道对数据源只读（ReOrc 只读查询接口 / DB 只读账号）。
- Pages 为公开静态站（与原型一致）；若未来需鉴权，再评估 Cloudflare Access，当前不引入。

## 10. 已知约束与边界

- Google×shoplazza、TikTok、Snapchat 未接入（与原型一致，dims/契约预留扩展位）。
- 整站 GMV 为每日 T+1 快照口径（易仓 status=4 已付款，按下单日期），历史月份延迟回填导致历史区间略低于实时数仓——沿用原型口径，页脚保留说明文案。
- gcmp（Google 系列桶）键为平台数字 ID，名字映射由管道输出至 `google/type.json.cmpNames`。
- ReOrc 平台 sql-query API 三重限制：①单页钳制 5000 行（body.limit 上限）②拒绝 SQL 末尾裸 ORDER BY（包装器追加页 limit/offset，语法非法）③SQL 内自带 LIMIT 与 body.limit 冲突。offset 翻页在无序 GROUP BY 上行序不稳定 → 页间重复/尾部丢行。解法：monthly.ts `queryWindow` 自适应二分（页满即二分日期窗口递归拉取，窗口不重叠合并不损），queries.ts 禁止末尾 ORDER BY/LIMIT。
- ReOrc 平台默认库可能漂移（belle_oversea → guanyuan_legacy）：回填/定时任务需显式指定 REORC_DATABASE。
