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
 * 探查模式（--probe / PIPELINE_PROBE=true）：遍历全部 SQL 兼容连接，列出库/表清单，
 * 并对广告/订单关键词命中的表 SELECT * LIMIT 2 取样本（列名+首行值）。
 * 实测：guanyuan(PostgreSQL) 的 information_schema.columns 被平台 sql-query 代理拒绝，
 * 但真实表 SELECT 与 information_schema.tables 可用；每表逐查耗时高，设 20 分钟预算。
 */
const PROBE_TABLE_PAT = /(ads|_ad_|order|report|trade|gmv|shopify|campaign)/i;

async function probeReorc(): Promise<void> {
  const baseUrl = process.env.REORC_BASE_URL || REORC_BASE_URL_DEFAULT;
  const token = process.env.REORC_TOKEN;
  if (!token) throw new Error('probe 需要 REORC_TOKEN 环境变量');
  // 快速失败：15s 超时 + 不重试，避免单表失败拖垮整轮（上轮 30min 超时的教训）
  const client = createReorcClient({ baseUrl, token, timeoutMs: 15_000, maxRetries: 0 });
  const target = await discoverReorcTarget(client, (m) => console.log(`[probe] ${m}`));
  const deadline = Date.now() + 20 * 60_000;

  const conns = await client.get<{ items: { id: string; name: string; type?: string }[] }>('/conn/connections', {
    connection_type: 'destination',
  });

  // 定向 SQL 模式：REORC_PROBE_SQL 为分号分隔的语句列表（REORC_PROBE_CONN 指定连接，默认 selectdb），
  // 逐条执行并打印前 20 行——改写取数 SQL 前确认列名/取值范围用，不遍历库表
  const customSql = process.env.REORC_PROBE_SQL?.trim();
  if (customSql) {
    const connName = process.env.REORC_PROBE_CONN || 'selectdb';
    const conn = (conns.items ?? []).find((c) => c.name === connName);
    if (!conn) {
      throw new Error(`定向 probe 找不到连接 ${connName}（可用：${(conns.items ?? []).map((c) => c.name).join(', ')}）`);
    }
    const dbs = extractDatabaseNames(await client.get(`/conn/connections/${conn.id}/databases`, { env_id: target.envId }));
    const db = process.env.REORC_DATABASE || dbs[0];
    const stmts = customSql.split(';').map((s) => s.trim()).filter(Boolean);
    console.log(`[probe] 定向模式：conn=${conn.name}(${conn.type}) db=${db} 语句数=${stmts.length}`);
    for (const [i, sql] of stmts.entries()) {
      console.log(`[probe] --- SQL#${i + 1} ${sql.slice(0, 160)} ---`);
      try {
        const rows = await client.sqlQueryAll(conn.id, sql, db, target.envId);
        console.log(`[probe] ${rows.length} 行`);
        for (const r of rows.slice(0, 20)) console.log(`[probe]   ${JSON.stringify(r).slice(0, 800)}`);
      } catch (e) {
        console.log(`[probe] 执行失败：${e instanceof Error ? e.message : e}`);
      }
    }
    return;
  }
  const SQL_TYPES = new Set(['MySQL', 'PostgreSQL', 'ClickHouse', 'StarRocks', 'SelectDB(Doris)', 'TiDB', 'Microsoft SQL Server', 'Redshift', 'Apache Impala', 'Google BigQuery']);
  // Doris/MySQL 数仓层优先（最可能存放加工后的报表表），legacy ODS 最后
  const sqlConns = (conns.items ?? []).filter((c) => SQL_TYPES.has(c.type ?? ''));
  sqlConns.sort((a, b) => (a.type === 'PostgreSQL' ? 1 : 0) - (b.type === 'PostgreSQL' ? 1 : 0));
  console.log(`[probe] SQL 兼容连接（探查顺序）：${sqlConns.map((c) => `${c.name}(${c.type})`).join(', ')}`);

  const EXCLUDED_SCHEMAS = "('pg_catalog', 'information_schema', 'mysql', 'performance_schema', 'sys', '__internal_schema')";
  outer: for (const conn of sqlConns) {
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

      const hits = tables
        .filter((t) => {
          const n = String(t.table_name);
          return PROBE_TABLE_PAT.test(n) && !/(bak|test|bushu|new1|_refa)/i.test(n);
        })
        .slice(0, 40);
      for (const h of hits) {
        if (Date.now() > deadline) {
          console.log('[probe] 20 分钟预算用尽，提前结束（已收集部分见上）');
          break outer;
        }
        const sch = String(h.table_schema);
        const name = String(h.table_name);
        try {
          const rows = await client.sqlQueryAll(
            conn.id,
            `SELECT * FROM ${sch}.${name} LIMIT 2`,
            db,
            target.envId,
          );
          if (rows.length > 0) {
            const cols = Object.keys(rows[0]);
            console.log(`[probe] ${sch}.${name} 列(${cols.length})：${cols.join(',')}`);
            console.log(`[probe]   样本：${JSON.stringify(rows[0]).slice(0, 500)}`);
          } else {
            console.log(`[probe] ${sch}.${name}：空表`);
          }
        } catch (e) {
          console.log(`[probe] ${sch}.${name} 采样失败：${e instanceof Error ? e.message : e}`);
        }
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
