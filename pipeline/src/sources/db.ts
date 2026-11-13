/**
 * db 通道（骨架）：数据库直连适配器——ReOrc 平台不可用时的降级通道。
 *
 * 环境变量：
 *   DB_URL   只读连接串（如 mysql://ro_user:***@host:3306/ads_dw?ssl-mode=REQUIRED）
 *            schema 决定驱动：mysql:// → mysql2；postgres:// → pg
 *
 * 实现状态：等待用户提供只读账号/地址/表结构后接入（口径 SQL 与 reorc 通道的
 * queries.ts 模板同源，仅执行端点不同——行映射层完全复用，无需改动）。
 * 依赖届时按需安装：pnpm --filter pipeline add mysql2 / pg
 */
import type { RawDataset, Source } from './types';

export class DbConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'DbConfigError';
  }
}

export function createDbSource(): Source {
  return {
    kind: 'db',
    async fetch(): Promise<RawDataset> {
      const url = process.env.DB_URL;
      if (!url) {
        throw new DbConfigError(
          '缺少 DB_URL。db 通道需要数据库只读连接串（mysql:// 或 postgres://）；' +
            '若使用 ReOrc 平台通道请改用 --source=reorc（REORC_TOKEN）。',
        );
      }
      const kind = url.startsWith('postgres') ? 'pg' : url.startsWith('mysql') ? 'mysql2' : '';
      if (!kind) throw new DbConfigError(`DB_URL 协议不支持（当前支持 mysql:// 与 postgres://）：${url.slice(0, 20)}...`);
      // TODO(连接信息就绪后实现)：驱动连接 → 执行 queries.ts 同源 SQL → rowsToDataset
      throw new Error(
        'db 通道尚未接入：拿到只读账号与表结构后，复用 reorc/queries.ts 模板与 reorc/rows.ts 行映射实现。' +
          `（已识别驱动：${kind}）`,
      );
    },
  };
}
