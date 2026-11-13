# 广告流量分析看板（正式版）

Newbella / cosyisland 品牌 Meta + Google 广告数据看板。本仓库为正式版：组件化前端 + 云端自动数据管道 + GitHub Pages 自动部署，全程不依赖任何本地电脑开机。

- 在线看板：https://whatsblue.github.io/ads_analysis_dashboard_normal/
- 原型参考：`whatsblue/ads-analysis-dashboard`（单文件原型，已冻结）

## 快速开始

```bash
# 前置：Node.js >= 20、pnpm >= 9（npm i -g pnpm）
pnpm install
pnpm -r build        # 构建前端 + 数据管道类型检查
pnpm --filter frontend dev   # 本地开发（使用 frontend/public/data 下的数据）
pnpm -r test         # 指标口径单测等
```

## 仓库结构

| 目录 | 说明 |
|---|---|
| `docs/` | 架构设计、数据契约、开发规范 |
| `frontend/` | Vite + Vue 3 + TS + Pinia + ECharts 看板应用 |
| `shared/` | 指标口径包（前后端/管道唯一实现，含 cell 定义与 derive） |
| `pipeline/` | 数据管道：ReOrc / 数据库拉数 → 预聚合 → 拆分 JSON |
| `.github/workflows/` | `update-data.yml`（T+1 定时拉数）与 `deploy.yml`（构建部署 Pages） |
| `frontend/public/data/` | 管道产出的数据文件（由 Actions 自动提交） |

## 数据更新机制

GitHub Actions 每日北京时间 05:00（UTC 21:00，cron `0 21 * * *`）自动执行：拉取 ReOrc / 数据库数据 → 按数据契约生成 `frontend/public/data/*.json` → 提交并触发现场部署。失败会自动开 Issue 告警。

## 详细文档

- [架构设计](docs/ARCHITECTURE.md)
- [数据契约](docs/DATA_CONTRACT.md)
- [开发规范与 Worktree 工作流](docs/DEVELOPMENT.md)
