# 数据目录（v3 月度分片）

管道产物输出于此（pipeline/src/build/emit.ts）。文件由 GitHub Actions update-data 工作流自动提交，也可本地生成。

## 文件结构

```
manifest.json   v3 契约清单（v/genAt/months/range/scope）
dims.json       全窗口维度枚举（账号/系列/SPU/spuAccs/国家/年龄/类型/combos/adList）
months/         月分片：months/<YYYY-MM>.json（单自然月全部日粒度结构）
```

## 生成方式

```
# 月度分片模式（v3 默认）：回填 2026-01-01 ~ 北京昨日
pnpm --filter pipeline start            # PIPELINE_MODE=monthly
# 或显式窗口
PIPELINE_MODE=monthly REORC_START=2026-01-01 REORC_END=2026-11-11 pnpm --filter pipeline start

# 旧单窗口模式（v2，仅 db/rdfile 调试用）
pnpm --filter pipeline start -- --source=rdfile --in <原型 ads_real.js>
```

月分片由前端按需加载（选中区间 ∪ 环比区间的月份并集），详见 docs/DATA_CONTRACT.md。
