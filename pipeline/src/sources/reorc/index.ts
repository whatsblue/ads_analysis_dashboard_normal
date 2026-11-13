/**
 * ReOrc 通道组装：发现目标 → 逐主题执行 SQL（滚动重算窗口）→ 行映射 → RawDataset。
 *
 * 环境变量：
 *   REORC_BASE_URL  平台 API 地址（默认 https://api.cn.reorc.cloud/api）
 *   REORC_TOKEN     authorization 令牌（必需；reorc-cli login 获取）
 *   REORC_ENV / REORC_CONNECTION_ID / REORC_CONNECTION_NAME / REORC_DATABASE  目标选择（默认自动探测）
 *   REORC_WINDOW_DAYS  滚动重算窗口天数（默认 10，end=昨日）
 */
import { addDays } from '@ads/shared';
import type { RawDataset, Source } from '../types';
import { createReorcClient, ReorcConfigError, type Row } from './client';
import { discoverReorcTarget } from './discover';
import { REORC_QUERIES } from './queries';
import { rowsToDataset, type RowsByTopic } from './rows';

export const REORC_BASE_URL_DEFAULT = 'https://api.cn.reorc.cloud/api';

export const REORC_SCOPE =
  'Meta×(shopify+shoplazza) + Google×shopify；TikTok/Snapchat、Google×shoplazza 未接入；口径=unified';

/** 数据口径为北京时间 T+1；北京 = UTC+8（无夏令时），不依赖 runner 本地时区 */
function beijingYesterday(): string {
  const beijingToday = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  return addDays(beijingToday, -1);
}

export interface ReorcSourceOptions {
  baseUrl?: string;
  token?: string;
  windowDays?: number;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
}

export function createReorcSource(opts: ReorcSourceOptions = {}): Source {
  const log = opts.log ?? ((msg: string) => console.log(`[pipeline][reorc] ${msg}`));
  return {
    kind: 'reorc',
    async fetch(): Promise<RawDataset> {
      // 用 || 而非 ??：GitHub 未配置的 Secret 会传入空字符串，需降级到默认地址
      const baseUrl = opts.baseUrl || process.env.REORC_BASE_URL || REORC_BASE_URL_DEFAULT;
      const token = opts.token ?? process.env.REORC_TOKEN;
      if (!token) {
        throw new ReorcConfigError(
          '缺少 REORC_TOKEN。请设置环境变量（本地 .env 或 GitHub Actions Secrets）；' +
            'token 获取方式：本地终端 reorc-cli login，或从 DevTools 复制 authorization 头。',
        );
      }

      const client = createReorcClient({ baseUrl, token, fetchImpl: opts.fetchImpl });
      const target = await discoverReorcTarget(client, log);
      log(`目标：env=${target.envName} conn=${target.connectionName} db=${target.database}`);

      const windowDays = opts.windowDays ?? (Number(process.env.REORC_WINDOW_DAYS) || 10);
      const end = beijingYesterday();
      const start = addDays(end, -(windowDays - 1));
      log(`滚动窗口：${start} ~ ${end}（${windowDays} 天）`);

      const rows: RowsByTopic = {};
      for (const topic of REORC_QUERIES) {
        const sql = topic.sql({ start, end });
        const result: Row[] = await client.sqlQueryAll(target.connectionId, sql, target.database, target.envId);
        rows[topic.id] = result;
        log(`主题 ${topic.id}：${result.length} 行`);
        if (/TODO_/.test(sql) && result.length > 0) {
          log(`警告：主题 ${topic.id} 的 SQL 仍含 TODO_* 占位表名但返回了数据，请核对表名是否已替换`);
        }
      }

      return rowsToDataset(rows, {
        genAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
        start,
        end,
        scope: REORC_SCOPE,
      });
    },
  };
}

export { ReorcConfigError };
