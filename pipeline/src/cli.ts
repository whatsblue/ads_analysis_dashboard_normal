/**
 * 管道入口。
 *
 * 用法：
 *   tsx pipeline/src/cli.ts --source=rdfile --in <ads_real.js> [--out <dir>] [--dry]
 *   tsx pipeline/src/cli.ts --source=reorc   [--out <dir>] [--dry]
 *   tsx pipeline/src/cli.ts --source=db      [--out <dir>] [--dry]
 *
 * 默认输出目录：frontend/public/data
 * --dry：只拉取+校验，不写盘（本地复现口径问题用）
 */
import { resolve } from 'node:path';
import { createDbSource } from './sources/db';
import { createReorcSource } from './sources/reorc';
import { createRdFileSource } from './sources/rdfile';
import type { Source, SourceKind } from './sources/types';
import { emitDataset } from './build/emit';
import { validateDataset } from './validate';

interface Args {
  source: SourceKind;
  input?: string;
  out: string;
  dry: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { source: 'rdfile', out: resolve(import.meta.dirname, '../../frontend/public/data'), dry: false };
  for (const a of argv) {
    if (a.startsWith('--source=')) args.source = a.slice('--source='.length) as SourceKind;
    else if (a.startsWith('--in=')) args.input = a.slice('--in='.length);
    else if (a.startsWith('--out=')) args.out = a.slice('--out='.length);
    else if (a === '--dry') args.dry = true;
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

async function main() {
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
