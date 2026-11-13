/**
 * ReOrc 目标发现：环境 → SQL 连接 → 数据库。
 *
 * 环境变量（均可选，缺省自动探测并打印所选值）：
 *   REORC_ENV             环境名（CLI 默认 Dev；生产数据常在 Prod）
 *   REORC_CONNECTION_ID   指定连接 ID
 *   REORC_CONNECTION_NAME 指定连接名
 *   REORC_DATABASE        指定数据库
 */
import type { ReorcClient } from './client';

/** reorc-cli isSqlCompatible 同款清单（连接 type 字段值） */
const SQL_COMPATIBLE_TYPES = new Set([
  'MySQL',
  'PostgreSQL',
  'ClickHouse',
  'StarRocks',
  'SelectDB(Doris)',
  'TiDB',
  'Microsoft SQL Server',
  'Redshift',
  'Apache Impala',
  'Google BigQuery',
]);

export interface ReorcTarget {
  envId: string;
  envName: string;
  connectionId: string;
  connectionName: string;
  database: string;
}

interface EnvItem {
  id: string;
  name: string;
}
interface ConnItem {
  id: string;
  name: string;
  type?: string;
}

/** reorc-cli extractDatabaseNames 同款多形态兼容 */
export function extractDatabaseNames(payload: unknown): string[] {
  const arr = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? ['databases', 'database_names', 'items', 'list', 'names']
          .map((k) => (payload as Record<string, unknown>)[k])
          .find(Array.isArray)
      : undefined;
  return (arr as unknown[] | undefined ?? []).map((item) =>
    typeof item === 'string'
      ? item
      : String(
          (item as Record<string, unknown> | null)?.name ??
            (item as Record<string, unknown> | undefined)?.database ??
            (item as Record<string, unknown> | undefined)?.db ??
            JSON.stringify(item),
        ),
  );
}

export async function discoverReorcTarget(client: ReorcClient, log: (msg: string) => void): Promise<ReorcTarget> {
  // 1) 环境
  const envs = await client.get<{ items: EnvItem[] }>('/infra/environments');
  const items = envs.items || [];
  if (items.length === 0) throw new Error('ReOrc 无可用环境');
  const wantedEnv = process.env.REORC_ENV;
  const env = wantedEnv ? items.find((e) => e.name.toLowerCase() === wantedEnv.toLowerCase()) : undefined;
  const chosenEnv = env ?? items[0];
  if (!env) log(`REORC_ENV 未指定${wantedEnv ? `（${wantedEnv} 不存在）` : ''}，默认使用环境：${chosenEnv.name}`);

  // 2) SQL 连接
  const conns = await client.get<{ items: ConnItem[] }>('/conn/connections', { connection_type: 'destination' });
  const sqlConns = (conns.items || []).filter((c) => SQL_COMPATIBLE_TYPES.has(c.type || ''));
  if (sqlConns.length === 0) throw new Error('ReOrc 无 SQL 兼容连接（MySQL/ClickHouse/Doris 等）');
  const byId = process.env.REORC_CONNECTION_ID ? sqlConns.find((c) => c.id === process.env.REORC_CONNECTION_ID) : undefined;
  const byName = process.env.REORC_CONNECTION_NAME
    ? sqlConns.find((c) => c.name.toLowerCase() === process.env.REORC_CONNECTION_NAME!.toLowerCase())
    : undefined;
  // 默认优先 Doris 数仓层（ads_marketing_*/ads_facebook_* 聚合表所在），legacy ODS 只在显式指定时使用
  const preferred = sqlConns.find((c) => c.type === 'SelectDB(Doris)') ?? sqlConns[0];
  const conn = byId ?? byName ?? preferred;
  if (byId === undefined && byName === undefined) log(`默认使用连接：${conn.name}（${conn.type}）`);

  // 3) 数据库
  const dbPayload = await client.get<unknown>(`/conn/connections/${conn.id}/databases`, { env_id: chosenEnv.id });
  const databases = extractDatabaseNames(dbPayload);
  if (databases.length === 0) throw new Error(`连接 ${conn.name} 下未发现数据库，请设置 REORC_DATABASE 或检查权限`);
  const db = process.env.REORC_DATABASE ? databases.find((d) => d === process.env.REORC_DATABASE) : undefined;
  const database = db ?? databases[0];
  if (!db) log(`默认使用数据库：${database}（如不符请设 REORC_DATABASE）`);

  return { envId: chosenEnv.id, envName: chosenEnv.name, connectionId: conn.id, connectionName: conn.name, database };
}
