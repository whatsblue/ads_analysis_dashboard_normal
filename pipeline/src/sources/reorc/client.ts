/**
 * ReOrc API 客户端（零依赖，Node 18+ 全局 fetch；fetchImpl 可注入便于单测）。
 *
 * 端点与响应格式对齐 reorc-cli@1.2.2（axios 实现）：
 *   响应统一 { code: '0', msg, data }，code !== '0' 视为业务失败；
 *   HTTP 401 视为 token 失效（ReorcConfigError，提示刷新步骤）。
 */
export type Row = Record<string, unknown>;

export class ReorcConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'ReorcConfigError';
  }
}

export class ReorcApiError extends Error {
  constructor(
    msg: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(msg);
    this.name = 'ReorcApiError';
  }
}

export interface ReorcClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** 对 429/5xx/网络错误的重试次数（指数退避 1s、3s） */
  maxRetries?: number;
  /** sqlQueryAll 分页大小（默认 5000；测试可注入小值） */
  queryPageSize?: number;
}

interface Envelope<T> {
  code: string;
  msg?: string;
  data?: T;
}

export interface ReorcClient {
  get<T>(path: string, query?: Record<string, string | number>): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  /** 分页执行只读 SQL，返回列名→值的对象行 */
  sqlQueryAll(connectionId: string, sql: string, database: string, envId: string, queryPageSize?: number): Promise<Row[]>;
}

const SQL_QUERY_PAGE_SIZE_DEFAULT = 5000;

export function createReorcClient(opts: ReorcClientOptions): ReorcClient {
  // 归一化：容忍 DevTools 粘贴的 "Bearer xxx" 形式与首尾空白（docs/SECRETS.md 方式 B）
  const token = opts.token.replace(/^\s*[Bb]earer\s+/, '').trim();
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const maxRetries = opts.maxRetries ?? 2;
  const pageSize = opts.queryPageSize ?? SQL_QUERY_PAGE_SIZE_DEFAULT;

  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, query?: Record<string, string | number>): Promise<T> {
    // 拼接方式对齐 axios baseURL 语义（path 为绝对路径时 new URL 会丢 base 的路径前缀）
    const url = new URL(opts.baseUrl.replace(/\/+$/, '') + path);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));

    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) await sleep(attempt === 1 ? 1_000 : 3_000);
      try {
        const res = await doFetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.status === 401) {
          throw new ReorcConfigError(
            'ReOrc 返回 401：token 缺失或已过期。请本地终端执行 reorc-cli login 刷新，' +
              '并同步更新环境变量/GitHub Secrets REORC_TOKEN（见 docs/SECRETS.md）。',
          );
        }
        const payload = (await res.json()) as Envelope<T>;
        if (!res.ok || payload.code !== '0') {
          throw new ReorcApiError(payload.msg || `HTTP ${res.status}`, res.status, path);
        }
        return payload.data as T;
      } catch (err) {
        // 配置错误（401）与业务错误（4xx/code!=0）不重试；仅网络错误、429、5xx 重试
        if (err instanceof ReorcConfigError) throw err;
        if (err instanceof ReorcApiError && err.status !== 429 && err.status < 500) throw err;
        lastErr = err;
      }
    }
    throw lastErr instanceof Error
      ? new ReorcApiError(`${path} 重试 ${maxRetries} 次后仍失败：${lastErr.message}`, 0, path)
      : new ReorcApiError(`${path} 重试后失败`, 0, path);
  }

  return {
    get: (path, query) => request('GET', path, undefined, query),
    post: (path, body) => request('POST', path, body),
    async sqlQueryAll(connectionId, sql, database, envId, queryPageSize) {
      const size = queryPageSize ?? pageSize;
      const rows: Row[] = [];
      for (let offset = 0; ; offset += size) {
        const page = await request<{ columns: { name: string }[]; data: unknown[][] }>(
          'POST',
          '/conn/connections/sql-query',
          { connection_id: connectionId, sql, env_id: envId, database, limit: size, offset },
        );
        const cols = (page.columns || []).map((c) => c.name);
        for (const values of page.data || []) {
          const row: Row = {};
          cols.forEach((name, i) => (row[name] = values[i]));
          rows.push(row);
        }
        if ((page.data || []).length < size) return rows;
      }
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
