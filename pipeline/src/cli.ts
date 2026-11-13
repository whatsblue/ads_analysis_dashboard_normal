/**
 * 管道入口。
 *
 * 用法：
 *   tsx pipeline/src/cli.ts --source=rdfile --in <ads_real.js> [--out <dir>] [--dry]
 *   tsx pipeline/src/cli.ts --source=reorc   [--out <dir>] [--dry]
 *   tsx pipeline/src/cli.ts --source=db      [--out <dir>] [--dry]
 *
 *   CI（pnpm --filter pipeline start）用环境变量 PIPELINE_SOURCE=reorc 传参，
 *   避免 pnpm 递归 run 场景下 `--` 传参被拆坏（实测 pnpm 12 出现孤立 "-"）
 *
 * 默认输出目录：frontend/public/data
 * --dry：只拉取+校验，不写盘（本地复现口径问题用）
 */
import { resolve } from 'node:path';
import { createDbSource } from './sources/db';
import { createReorcClient } from './sources/reorc/client';
import { discoverReorcTarget, extractDatabaseNames } from './sources/reorc/discover';
import { createReorcSource, REORC_BASE_URL_DEFAULT } from './sources/reorc';
import { createRdFileSource } from './sources/rdfile';
import type { Source, SourceKind } from './sources/types';
import { emitDataset } from './build/emit';
import { validateDataset } from './validate';

interface Args {
  source: SourceKind;
  input?: string;
  out: string;
  dry: boolean;
  probe?: boolean;
}

function parseArgs(argv: string[]): Args {
  // 通道默认值优先取环境变量（CI 传参通道），CLI flag 仍可覆盖
  const args: Args = {
    source: (process.env.PIPELINE_SOURCE as SourceKind) || 'rdfile',
    out: resolve(import.meta.dirname, '../../frontend/public/data'),
    dry: false,
  };
  for (const a of argv) {
    if (a.startsWith('--source=')) args.source = a.slice('--source='.length) as SourceKind;
    else if (a.startsWith('--in=')) args.input = a.slice('--in='.length);
    else if (a.startsWith('--out=')) args.out = a.slice('--out='.length);
    else if (a === '--dry') args.dry = true;
    else if (a === '--probe') args.probe = true;
    else throw new Error(`未知参数：${a}`);
  }
  if (args.source === 'rdfile' && !args.input) {
    throw new Error('rdfile 通道需要 --in=<ads_real.js 路径>');
  }
  if (args.source !== 'rdfile' && args.input) {
    throw new Error('--in 仅用于 rdfile 通道');
  }
  return args;
}

function createSource(kind: SourceKind, input?: string): Source {
  switch (kind) {
    case 'rdfile':
      return createRdFileSource(resolve(input!));
    case 'reorc':
      return createReorcSource();
    case 'db':
      return createDbSource();
    default:
      throw new Error(`未知通道：${kind}`);
  }
}

/**
 * 探查模式（--probe / PIPELINE_PROBE=true）：遍历全部 SQL 兼容连接，
 * 列出数据库/表清单，并对表名命中广告/订单关键词的表拉列结构——用于把
 * queries.ts 的 TODO_* 占位表名替换成真实表名与字段。
 * information_schema 查询兼容 PostgreSQL/MySQL/Doris（列名统一小写别名）。
 */
const PROBE_TABLE_PAT = /(ads|_ad_|order|report|trade|gmv|shopify|campaign)/i;

async function probeReorc(): Promise<void> {
  const baseUrl = process.env.REORC_BASE_URL || REORC_BASE_URL_DEFAULT;
  const token = process.env.REORC_TOKEN;
  if (!token) throw new Error('probe 需要 REORC_TOKEN 环境变量');
  const client = createReorcClient({ baseUrl, token });
  const target = await discoverReorcTarget(client, (m) => console.log(`[probe] ${m}`));

  const conns = await client.get<{ items: { id: string; name: string; type?: string }[] }>('/conn/connections', {
    connection_type: 'destination',
  });
  const SQL_TYPES = new Set(['MySQL', 'PostgreSQL', 'ClickHouse', 'StarRocks', 'SelectDB(Doris)', 'TiDB', 'Microsoft SQL Server', 'Redshift', 'Apache Impala', 'Google BigQuery']);
  const sqlConns = (conns.items ?? []).filter((c) => SQL_TYPES.has(c.type ?? ''));
  console.log(`[probe] SQL 兼容连接：${sqlConns.map((c) => `${c.name}(${c.type})`).join(', ')}`);

  const EXCLUDED_SCHEMAS = "('pg_catalog', 'information_schema', 'mysql', 'performance_schema', 'sys', '__internal_schema')";
  for (const conn of sqlConns) {
    let dbs: string[];
    try {
      dbs = extractDatabaseNames(
        await client.get(`/conn/connections/${conn.id}/databases`, { env_id: target.envId }),
      );
    } catch (e) {
      console.log(`[probe] ${conn.name} 数据库列表失败：${e instanceof Error ? e.message : e}`);
      continue;
    }
    for (const db of dbs.slice(0, 5)) {
      let tables: Record<string, unknown>[];
      try {
        tables = await client.sqlQueryAll(
          conn.id,
          'SELECT table_schema AS table_schema, table_name AS table_name FROM information_schema.tables ' +
            `WHERE table_schema NOT IN ${EXCLUDED_SCHEMAS} ORDER BY table_schema, table_name`,
          db,
          target.envId,
        );
      } catch (e) {
        console.log(`[probe] ${conn.name}.${db} 表清单失败：${e instanceof Error ? e.message : e}`);
        continue;
      }
      const names = tables.map((t) => `${String(t.table_schema)}.${String(t.table_name)}`);
      console.log(`[probe] ${conn.name}.${db} 表（${names.length}）：${names.join(', ')}`);

      const hits = tables.filter((t) => PROBE_TABLE_PAT.test(String(t.table_name)));
      if (hits.length === 0) continue;
      const inList = hits.map((h) => `'${String(h.table_name).replace(/'/g, "")}'`).join(', ');
      const cols = await client.sqlQueryAll(
        conn.id,
        'SELECT table_name AS table_name, column_name AS column_name, data_type AS data_type ' +
          'FROM information_schema.columns ' +
          `WHERE table_schema NOT IN ${EXCLUDED_SCHEMAS} AND table_name IN (${inList}) ` +
          'ORDER BY table_name, ordinal_position',
        db,
        target.envId,
      );
      let cur = '';
      for (const c of cols) {
        const t = String(c.table_name);
        if (t !== cur) {
          cur = t;
          console.log(`[probe]   .${t} 字段：`);
        }
        console.log(`[probe]     ${String(c.column_name)} ${String(c.data_type)}`);
      }
    }
  }
}

async function main() {
  // 探查模式优先：env（CI 通道）或 CLI flag
  if (process.env.PIPELINE_PROBE === 'true' || process.argv.includes('--probe')) {
    await probeReorc();
    return;
  }
  const args = parseArgs(process.argv.slice(2));
  console.log(`[pipeline] 通道=${args.source}${args.input ? ` in=${args.input}` : ''} out=${args.out}${args.dry ? ' (dry)' : ''}`);

  const source = createSource(args.source, args.input);
  const ds = await source.fetch();
  console.log(`[pipeline] 拉取完成：genAt=${ds.manifest.genAt} range=${ds.manifest.range.min}~${ds.manifest.range.max}`);

  validateDataset(ds);
  console.log('[pipeline] 校验通过（zod 契约 + 交叉自洽）');

  if (args.dry) {
    console.log('[pipeline] --dry：跳过写盘');
    return;
  }

  const result = emitDataset(ds, args.out);
  const totalKB = (result.files.reduce((s, f) => s + f.bytes, 0) / 1024).toFixed(1);
  console.log(`[pipeline] 写盘完成：${result.files.length} 个文件，共 ${totalKB} KB → ${result.outDir}`);
  for (const f of result.files) console.log(`  - ${f.path} (${(f.bytes / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error(`[pipeline] 失败：${err instanceof Error ? err.stack || err.message : String(err)}`);
  process.exit(1);
});
