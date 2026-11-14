/**
 * ReOrc 通道公共入口（实现在 ./reorc/ 子模块，此处保持 cli.ts 的既有 import 路径稳定）。
 */
export { beijingYesterday, createReorcSource, ReorcConfigError, REORC_BASE_URL_DEFAULT, REORC_SCOPE } from './reorc/index';
export type { ReorcSourceOptions } from './reorc/index';
export { REORC_QUERIES, REORC_TOPIC_IDS } from './reorc/queries';
export type { QueryTopic, QueryParams } from './reorc/queries';
export { rowsToDataset } from './reorc/rows';
export type { RowsByTopic, RowsContext } from './reorc/rows';
export { createReorcClient } from './reorc/client';
export type { ReorcClient, Row } from './reorc/client';
export { discoverReorcTarget, extractDatabaseNames } from './reorc/discover';
export type { ReorcTarget } from './reorc/discover';
