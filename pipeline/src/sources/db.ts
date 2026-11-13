/**
 * DB 直连通道（降级/备用）：直连数据库只读账号执行口径 SQL。
 *
 * 实现状态：接口预留。启用条件：用户提供公网可达的只读连接与表结构说明。
 * 环境变量：DB_URL（如 mysql://readonly:***@host:3306/warehouse）
 *
 * 注意：与 ReOrc 通道互为替代，二者产出的 RawDataset 必须通过同一套
 * validate.ts 交叉自洽断言（口径一致性不因通道而异）。
 */
import type { RawDataset, Source } from './types';

export class DbConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'DbConfigError';
  }
}

export function createDbSource(): Source {
  const dbUrl = process.env.DB_URL;
  return {
    kind: 'db',
    async fetch(): Promise<RawDataset> {
      if (!dbUrl) {
        throw new DbConfigError('缺少 DB_URL。提供只读连接后启用本通道（见 docs/DATA_CONTRACT.md 与 docs/DEVELOPMENT.md）。');
      }
      // TODO(连接信息就绪后实现)：加载对应驱动 → 执行各维度口径 SQL → aggregate → RawDataset
      throw new Error('DB 直连通道尚未接入。当前请使用 --source=rdfile 或 --source=reorc。');
    },
  };
}
