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
pnpm --filter pipeline start -- --source=rdfile --in <ads_real.js>   # 管道（rdfile 通道）
pnpm --filter pipeline start -- --source=reorc                      # 管道（ReOrc 通道，需环境变量）
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

1. 看板数据异常 → 查 `manifest.json` genAt → 对应 Actions run 日志
2. Actions 失败会自动开 Issue；ReOrc token 过期类错误按 Issue 内指引刷新 Secrets
3. 本地复现：`pnpm --filter pipeline start -- --source=rdfile --in <本地ads_real.js> --out <临时目录>`

## 7. 实施前提与协作事项（Phase 1 进行中滚动更新）

- [ ] ReOrc token 刷新：用户在本地终端 `reorc-cli login` 后提供可用 token（配 Secrets `REORC_TOKEN`、`REORC_BASE_URL`）
- [ ] GitHub 仓库 Settings → Pages → Source: GitHub Actions（一次性）
- [ ] （可选）DB 直连信息：只读账号 + 公网地址（启用 `--source=db` 时需要）
