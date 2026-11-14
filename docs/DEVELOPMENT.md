# 开发规范与 Worktree 工作流（DEVELOPMENT）

## 1. 环境要求

- Node.js >= 20（CI 用 22），pnpm >= 9（`npm i -g pnpm`）
- Windows 开发注意：PowerShell 执行策略限制 `.ps1`，请使用 `pnpm.cmd` / `npm.cmd` / `reorc-cli.cmd` 入口

## 2. 常用命令

```bash
pnpm install                # 安装全部 workspace 依赖
pnpm --filter frontend dev      # 本地开发 http://localhost:5173（base 已配子路径）
pnpm -r typecheck           # 全部包 tsc --noEmit
pnpm -r test                # Vitest（shared 指标口径 + frontend 关键组件）
pnpm --filter frontend build    # 产出 frontend/dist
pnpm --filter pipeline start -- --source=rdfile --in <ads_real.js>   # 管道（rdfile 原型种子通道，迁移期）

# 管道主通道（ReOrc，需 Secrets/环境变量）
REORC_BASE_URL=... REORC_TOKEN=... pnpm --filter pipeline start -- --source=reorc
# 可选 REORC_WINDOW_DAYS=90：拉取 90 天窗口（回填演练；默认 10 天）
# 可选 REORC_PROBE_SQL（分号分隔）+ REORC_PROBE_CONN：只读探查，每条 SQL 打印前 20 行，不改代码即可验证数仓
```

## 3. Git 规范

### 3.1 分支与 Worktree（并行开发工作流）

按**功能层**划分 worktree（不按 tab 划分——tab 并行会同时改 shared/组件库/specs 造成大面积冲突）：

| worktree 目录 | 分支 | 职责 |
|---|---|---|
| `d:\ai\ads_analysis_dashboard_normal` | `main` | 契约/骨架/文档/集成合并 |
| `d:\ai\adn_wt_dashboard` | `feat/dashboard` | frontend 全部视图与组件 |
| `d:\ai\adn_wt_pipeline` | `feat/data-pipeline` | pipeline 三通道+聚合+校验 |
| `d:\ai\adn_wt_cicd` | `feat/cicd-deploy` | workflows + Pages + Secrets 文档 |

创建方式（在 main 检出目录执行）：

```bash
git worktree add d:/ai/adn_wt_dashboard -b feat/dashboard
git worktree add d:/ai/adn_wt_pipeline  -b feat/data-pipeline
git worktree add d:/ai/adn_wt_cicd      -b feat/cicd-deploy
```

合并顺序：`feat/cicd-deploy` → `feat/data-pipeline` → `feat/dashboard`，每步要求 CI 绿。worktree 使用完毕 `git worktree remove <dir>` 清理。

> **当前状态（2026-11-14）**：三个 feat 分支已全部合并入 main 且线上验证通过；worktree 目录（`adn_wt_dashboard/pipeline/cicd`）与远端三分支待收尾清理（等用户确认后执行）。后续日常开发直接在 main 或按需新建 feature 分支。

### 3.2 提交信息

Conventional Commits：`feat|fix|refactor|docs|chore|data: 摘要`。数据自动提交统一 `data: T+1 update <YYYY-MM-DD>`（由管道生成，跳过 CI 的重型 job）。

### 3.3 禁止事项

- 禁止 push --force 到 main/feat/*（数据 commit 由 Actions 产生，冲突时先 pull --rebase）
- 禁止在仓库内提交任何凭据/明文 token（Secrets 只存 GitHub）

## 4. 代码规范

### 4.1 指标口径（最重要）

- 所有派生指标（ROAS/CVR/CPM/CPC/CTR/CPA/AOV/占比）**只能**从 `@ads/shared` 的 `derive/deriveG` 获取。code review 硬标准：视图代码出现任何 `/`、`*1000` 等比率计算公式一律打回。
- 总计行用 `sumMetrics` 后 `derive`（Σ分子/Σ分母），禁止对派生指标求平均。
- 涨跌色阈值（原型定版）：钱效率组（cvr/roas/aov 含 roas_s/roas_a）>5% 高亮；Meta 流量效率组（cpm/cpc/ctr）>10% 高亮；涨绿跌红。
- **源口径映射（queries.ts 头注释为准，2026-11 观远口径对齐定版）**：Meta 桶 8 元组 clicks=链接点击（platform_link_clicks，CVR 分子）、inter=全部点击（platform_clicks，CVR 分母）；Google 全主题 clicks=platform_clicks（Ads 后台口径；数仓 link_clicks 对 google 恒 0，禁用）、vs=attributed_sales（Shopify 考核）、va=platform_conversion_value（Ads 参考）；EDM=Shopify 订单 Klaviyo 归因销售额（`ads_shopify_operationdata_edmreport_d` 的 SUM(sales_afterreturn)，2026-09 起有数，非订阅账单费用）。列别名是 rows.ts 契约，不可改动。

### 4.2 前端

- Vue 3 `<script setup lang="ts">`，组合式函数放 `src/composables/`
- 组件命名 PascalCase 单文件组件；`specs/` 配置对象用 camelCase
- 数据访问只经 `src/data/`（fetch+缓存），视图不直接 fetch
- ECharts 按需引入（只从 `echarts/core` 注册用到的图表/组件）
- CSS：原型设计变量迁移至 `src/styles/variables.css`（--pri/--c-meta/--c-google 等），全局用 BEM-lite（.card/.kpi/.tbl 等沿用原型类名体系）

### 4.3 管道

- 源数据行结构变化只改 `sources/`；口径调整只改 `build/aggregate.ts`；两者不得交叉修改
- 所有写盘走 `emit.ts`（原子写：tmp + rename）
- 管道必须可在本地 dry-run：`--dry` 只校验不写盘

## 5. 测试策略

| 层 | 工具 | 覆盖 |
|---|---|---|
| shared | Vitest | derive/deriveG 全指标、Σ规则、格式化、zod 契约 |
| frontend | Vitest | filter store 联动、MetricsTable 排序/总计/加载更多、spec 加载完整性 |
| pipeline | Vitest | rdfile 转换快照、aggregate 口径、validate 断言（含故意构造的坏数据） |
| E2E（Phase 2） | 手动清单 | 13 视图对照原型同日期数值一致 |

## 6. 数据问题排查

1. 看板数据异常 → 查线上 `data/manifest.json` genAt → 对应 Actions run 日志
2. Actions 失败会自动开 Issue；ReOrc token 过期类错误按 Issue 内指引刷新 Secrets
3. 本地复现：`pnpm --filter pipeline start -- --source=rdfile --in <本地ads_real.js> --out <临时目录>`
4. 手动演练拉数：Actions 页 `update-data.yml` → Run workflow（可填 `window_days` 拉大窗口）
5. 部署后线上 5-20 分钟内 CDN（Fastly）才完成传播，genAt 未变先等待再排查；部署 job checkout 的是 origin/main 最新，与触发 push 的 SHA 可能相差一个数据 commit
6. 数仓锚点直查（不动代码）：设置 `REORC_PROBE_SQL` + `REORC_PROBE_CONN` 派发探查 run（见 §2）

## 7. 当前实施状态（2026-11-14 滚动更新）

- [x] ReOrc 通道上线：每日 cron（北京 05:00）拉数→校验→commit→自动部署 Pages，失败自动开 Issue
- [x] 线上看板验证闭环：genAt 演进、19/19 主题有数、数据锚点与数仓 SUM 逐位一致（11/11 PASS）
- [x] 指标口径观远对齐：Google clicks=platform_clicks、EDM=Klaviyo 归因销售额（详见 §4.1 与 docs/PRODUCT.md §6）
- [x] 全历史数据验证：2025-01-01 起覆盖完整、质量零缺陷（报告：`_wt_staging/data-verify-report.md`）
- [ ] 月度分片全历史方案（方案已定：23+ 月分片按需加载 + 滚动重写最近 3 个月 + 一次性按月回填，待实施）
- [ ] worktree 与三个已合并 feat 分支清理（等用户确认）
