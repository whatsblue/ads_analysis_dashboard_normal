---
name: reorc-cli
description: 使用本仓库的 ReOrc CLI 查看项目、项目资源、高级管道、数据模型、环境、运维、变量和宏。需要运行 CLI、选择正确命令路径、解释子命令、导出或应用高级管道/数据模型 YAML、对比本地 YAML 与平台定义，或查询连接、变量和宏时使用。
metadata:
  version: 1.2.2
---

# ReOrc CLI

Use this skill to operate the published `reorc-cli` command.

> **重要：** 本工具使用本地 YAML 文件作为数据模型和管道导出、对比、应用操作的基础。推荐使用 [`yq`](https://github.com/mikefarah/yq) 编辑、查询和校验 YAML，但不是必需依赖。

## 指定本次命令使用的账号

使用 `reorc-cli config show` 查看已保存账号。用户指定账号时，将
`-p <profile_name>` 或 `--profile <profile_name>` 放在**命令名前**。
profile 是已保存的 `租户:用户名`，也可以是唯一匹配的用户名。
不存在或有歧义的名称会在请求前报错；有歧义时使用完整账号标识。
该选择仅对本次调用生效；不传时使用当前账号。`switch` 则会修改保存的默认账号。

```bash
reorc-cli -p acme:user@example.com projects list --page 2
reorc-cli --profile user@example.com projects use <project_id> data-models list
```

包括嵌套命令在内，profile 参数都应放在 `projects`、`global-connections`、
`ops` 等命令之前。`projects list` 和 `ops list` 的分页统一使用 `--page <页码>`。
不再支持分页简写 `-p`；`-p` 专用于选择账号。

## Command Tree

```
reorc-cli
├── config                            管理 CLI 配置
│   ├── set                           设置配置（交互式）
│   ├── show                          查看当前配置
│   ├── clear                         清除当前账号配置和凭证
│   └── remove                        移除指定账号
│
├── login                             浏览器登录，或用 -w 搭配 -t 直接设置 token
│
├── switch                            切换已保存的账号
│
├── projects                          项目管理
│   ├── list                          项目列表（--page --page-size --search）
│   │
│   └── use <project_id>               进入项目上下文
│       ├── data-models               数据模型和源管理
│       │   ├── list                  模型列表（--search）
│       │   ├── create                创建模型（--name --materialization --content）
│       │   ├── manage                管理目录
│       │   │   ├── new-directory     创建目录（--name --parent-id --listing-type）
│       │   │   └── move              移动模型（--model-id --directory-id）
│       │   └── use <model_id>
│       │       ├── export            导出为本地 YAML
│       │       ├── diff              对比 YAML 与平台定义
│       │       ├── apply             将 YAML 应用到平台
│       │       ├── build             占位命令；需要在平台手动构建模型
│       │       └── preview-data      预览模型运行数据（默认前10行，可用 --limit 调整；--interval/--timeout 单位为秒）
│       │
│       ├── advanced-pipelines        高级管道管理
│       │   ├── list                  管道列表（--search）
│       │   ├── create                创建管道（--name --directory-id）
│       │   ├── yaml-guide            YAML 编写指南（--operator）
│       │   ├── manage                管理目录与移动管道
│       │   │   ├── new-directory     创建目录（--name --parent-id --listing-type）
│       │   │   └── move              移动管道（--pipeline-id --directory-id）
│       │   └── use <pipeline_id>
│       │       ├── export            导出为本地 YAML
│       │       ├── diff              对比 YAML 与平台定义
│       │       ├── apply             将 YAML 应用到平台
│       │       └── get-jobs          列出管道下的调度任务
│       │
│       ├── modeling-pipelines        建模管道管理
│       │   ├── list                  管道列表（--search）
│       │   ├── create                创建管道（--name --models --directory-id）
│       │   ├── get <pipeline_id>      查看管道详情
│       │   └── use <pipeline_id>
│       │       └── get-jobs          列出管道下的调度任务
│       │
│       ├── connections               项目连接
│       │   └── list                  连接列表
│       │
│       ├── variables                 项目变量
│       │   ├── list                  变量列表
│       │   └── get <name>            变量详情
│       │
│       ├── macros                    项目宏
│       │   ├── list                  宏列表（--search --status）
│       │   └── get <id>              宏详情
│       │
│       └── export-all                删除缓存并重新导出全部模型和管道
│
├── global-connections                全局连接管理
│   ├── list                          连接列表
│   └── use <connection_id>            进入连接上下文
│       ├── query [sql]               执行只读 SQL（-d --database --env --limit）
│       ├── list-databases            列出数据库（--env --refresh）
│       ├── list-tables               列出表（--database --env --refresh）
│       └── get-table-schema <table>  获取表结构（--database --env --refresh）
│
├── ops                               运维监控
│   ├── overview                      管道健康总览（--env --range）
│   ├── list                          管道及任务状态列表
│   └── jobs <pipeline_id>             指定管道的任务详情和历史运行
│
├── environments                      环境与工作节点管理
│   ├── list                          环境列表（含工作节点）
│   └── workers                       工作节点列表详情（--env --status）
│
└── install-skill                     安装 skill 到 .claude/skills 与 .agents/skills
```

> **export-all** 会删除 `./reorc/project_<project_id>/` 目录并重新下载全部模型和管道。用于刷新本地 YAML 缓存。

## 登录

`reorc-cli login` 会打开真实的浏览器窗口进行网页登录（支持 MFA），并自动捕获 token。当 CLI 由 Agent 运行或处于无图形界面环境（CI、无 X11 的 SSH）时，浏览器流程无法完成——请让用户在自己的终端运行 `reorc-cli login`，或使用 `reorc-cli login --no-browser` 并让用户粘贴 `authorization` 请求头的值（DevTools → Network → 任意 `/api` 请求；带不带 `Bearer` 前缀均可）。

已有 access token 时，可使用 `reorc-cli login -w <website> -t '<token>'`，CLI 会验证并保存 token，且不会打开浏览器。也可以传入加引号的 `Bearer <token>`。注意：命令行中的 token 可能被 shell 历史记录保存，或对本机其他进程可见。

## yaml-guide 选项

`yaml-guide` 支持按 operator 查看特定示例：

| Operator | 额外选项 |
|---|---|
| TransferOperator | `--dump-task <name> --load-task <name>` |
| StreamOperator | `--source-type <type> --sink-type <type>` |
| NotifyOperator | `--msg-type post\|interactive` |
| PythonOperator / SQLOperator / SensorOperator | 仅 `--operator` |

## Help 与手动分发

`projects use`、`global-connections use` 下的子命令使用手动路由，`--help` 在完整路径上可能不生效。先用 `projects use <id> --help` 查看可用资源，再用 `data-models --help` 等查看子命令。

## 参数约定

- `project_id` / `connection_id` / `pipeline_id` / `model_id` — 按资源类型使用对应 ID
- `--json` — 输出结构化 JSON（适用于所有 list 命令）
- `preview-data --limit <rows>` — 默认最多展示前 10 行
- `preview-data --interval <seconds>` / `--timeout <seconds>` — 轮询时间单位为秒
- `preview-data` 仅用于预览模型数据，不会构建或发布模型；正式构建模型需要在 ReOrc 平台手动操作
- `build` 仅为占位命令，只打印提示，不会调用平台或构建模型
- `export / diff / apply` 默认 YAML 路径：`./reorc/project_<project_id>/{advanced-pipelines|data-models}/{sources|models}/<directory>/<name>.yaml`

## 预期行为

- 列表命令默认输出 Markdown 表格；空列表输出 `No ... found.`
- `diff` 输出结构化变更摘要 + SQL/Python 长字段的文本 diff
- `variables get <name>` 输出 YAML 格式详情
- `macros get <id>` 输出 YAML 格式详情；`macros list` 支持 `--search`、`--status`（默认 `active`）和 `--json`

## 推荐工作流

1. 先用 list 找到目标 ID
2. 用 `use <id>` 进入资源上下文
3. 修改 YAML 前先 `export` 确保本地文件与平台一致
4. 编辑后 `diff` 预览变更，确认后 `apply`
5. 可选执行 `preview-data` 预览模型数据；如不符合预期，在本地继续编辑并重复上述流程
6. `preview-data` 不会构建或发布模型；正式构建模型需要在 ReOrc 平台手动操作


## 项目变量

在 Python/SQL 代码中通过 `{{ var("variable_name") }}` 引用。查看所有变量用 `projects use <id> variables list`，查看单个用 `get <name>`。
