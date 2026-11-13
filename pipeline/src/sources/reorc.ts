/**
 * ReOrc 通道：经 ReOrc 平台（api.cn.reorc.cloud）查询数仓聚合数据。
 *
 * 环境变量（GitHub Secrets / 本地 .env）：
 *   REORC_BASE_URL  平台 API 地址（默认 https://api.cn.reorc.cloud/api）
 *   REORC_TOKEN     authorization 头（reorc-cli login 后的 token）
 *
 * 实现状态：骨架。token 就绪后按以下步骤补全（见 docs/DEVELOPMENT.md §7）：
 *   1. reorc-cli projects list → 定位广告数据项目与数据模型 ID
 *   2. 按模型 preview-data / 导出接口拉取各维度源行
 *   3. aggregate：源行 → 契约桶（滚动 10 天重算；口径对齐原型 extract_real.py）
 */
import type { RawDataset, Source } from './types';

export const REORC_BASE_URL_DEFAULT = 'https://api.cn.reorc.cloud/api';

export class ReorcConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'ReorcConfigError';
  }
}

export function createReorcSource(): Source {
  const baseUrl = process.env.REORC_BASE_URL || REORC_BASE_URL_DEFAULT;
  const token = process.env.REORC_TOKEN;
  return {
    kind: 'reorc',
    async fetch(): Promise<RawDataset> {
      if (!token) {
        throw new ReorcConfigError(
          '缺少 REORC_TOKEN。请设置环境变量（本地 .env 或 GitHub Actions Secrets）；' +
            'token 获取方式：本地终端 reorc-cli login，或从 DevTools 复制 authorization 头。',
        );
      }
      // TODO(token 就绪后实现)：项目/模型发现 → 分维度拉取 → aggregate → RawDataset
      throw new Error(
        `ReOrc 通道尚未接入（baseUrl=${baseUrl}）。当前请使用 --source=rdfile 通道；` +
          'ReOrc 数据模型清单确认后在此实现拉取逻辑。',
      );
    },
  };
}
