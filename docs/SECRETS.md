# Secrets 与站点配置清单

本仓库的自动更新与部署依赖以下一次性配置。全部完成后，数据每日自动更新，无需任何人保持电脑开机。

## 一、GitHub Actions Secrets

仓库页面 → **Settings → Secrets and variables → Actions → New repository secret**：

| Secret | 必填 | 说明 |
|---|---|---|
| `REORC_TOKEN` | ✅ | ReOrc 平台访问令牌，数据管道（`update-data.yml`）拉数用 |
| `REORC_BASE_URL` | ❌ | 平台 API 地址，默认 `https://api.cn.reorc.cloud/api`，仅私有化部署时需要 |

### REORC_TOKEN 获取与刷新

方式 A（推荐）：本地终端执行

```bash
npm i -g reorc-cli
reorc-cli login
```

浏览器完成登录（支持 MFA）后，token 保存在 CLI 配置中，从 `reorc-cli config show` 或配置文件复制 token 值填入 Secrets。

方式 B：浏览器登录 ReOrc 平台 → DevTools → Network → 任一 `/api` 请求 → 复制 `authorization` 请求头（带不带 `Bearer` 前缀均可）。

> ⚠️ token 有有效期。过期后 `update-data.yml` 会失败并**自动开告警 issue**（label `data-update-failure`）。按上述方式重新获取并更新 Secret，手动 Run 一次 workflow 确认成功后关闭 issue。

## 二、开启 GitHub Pages（一次性）

仓库页面 → **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**（不要选分支目录方式）。

之后 `deploy.yml` 与 `update-data.yml` 的部署步骤即可发布到：

```
https://whatsblue.github.io/ads_analysis_dashboard_normal/
```

> 前端 `base` 已固定为 `/ads_analysis_dashboard_normal/`，与该地址匹配。

## 三、Workflow 一览

| Workflow | 触发 | 作用 |
|---|---|---|
| `ci.yml` | push 任意分支 / PR 到 main | typecheck + test + build 质量门禁 |
| `deploy.yml` | push main（前端/共享/管道代码变更）、手动 | 构建 frontend → 部署 Pages |
| `update-data.yml` | cron `0 21 * * *`（北京 05:00）、手动 | ReOrc 拉数 → 校验 → 13 个 JSON 落盘 → commit → 数据有变化则重新部署 |

### 首次手动触发（验证链路）

1. 确认上文 Secrets 与 Pages 已配置；
2. 仓库 **Actions** 页 → 左侧 **Update Data** → **Run workflow** → 选择 `main` 分支运行；
3. 观察 `update` job：拉数、校验、commit 是否成功；
4. 成功后站点数据即更新（genAt 时间戳可在 `manifest.json` 核对）。

> 注意：`schedule` 触发只在 workflow 文件合入**默认分支**后生效；GitHub 对整点 cron 有几分钟级别的调度延迟，属正常现象。

## 四、数据失败告警机制

- 管道任一步骤失败（token 过期、平台异常、校验不过）→ `Alert on failure` 步骤自动创建/追加评论带 `data-update-failure` 标签的 issue；
- 站点保留上一次成功数据，不会因失败而空白；
- 修复后请手动 Run workflow 验证并关闭 issue。
