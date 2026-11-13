/**
 * 数据契约 zod schema（仅 pipeline 校验使用；前端不引用本文件，避免 zod 进包体）。
 * 结构规范见 docs/DATA_CONTRACT.md。
 */
import { z } from 'zod';
import { CONTRACT_VERSION } from './contract';

const num = z.number().finite();

export const MetaCellSchema = z.array(num).min(7).max(8);
export const GoogleCellSchema = z.array(num).length(6);
export const GoogleCtyCellSchema = z.array(num).length(7);
export const GmvCellSchema = z.array(num).length(2);
export const EdmCellSchema = z.array(num).length(1);

export const MetaDaySchema = z.record(z.array(num).min(7).max(8));
export const DateStrSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ManifestSchema = z.object({
  v: z.literal(CONTRACT_VERSION),
  genAt: z.string().min(1),
  range: z.object({
    min: DateStrSchema,
    max: DateStrSchema,
    viewStart: DateStrSchema,
    viewEnd: DateStrSchema,
  }),
  scope: z.string(),
});

const StrArray = z.array(z.string());

export const DimsSchema = z.object({
  metaAccounts: StrArray,
  gAccounts: StrArray,
  metaCampaigns: StrArray,
  gCampaigns: StrArray,
  spus: StrArray,
  gSpus: StrArray,
  spuAccs: z.record(StrArray),
  types: StrArray,
  countries: StrArray,
  ages: StrArray,
  combos: z.array(z.tuple([z.string(), z.string()])),
  adList: z.array(z.tuple([z.string(), z.string(), z.string()])),
});

export const ChannelSchema = z.object({
  meta: z.record(MetaDaySchema),
  google: z.record(GoogleCellSchema),
  gmv: z.record(z.record(GmvCellSchema)),
  edm: z.record(EdmCellSchema),
});

/** 数字键名容器的桶（meta/acc、meta/camp、meta/spu 等） */
export const MetaDimBucketSchema = z.record(z.record(MetaDaySchema));
export const GoogleDimBucketSchema = z.record(z.record(GoogleCellSchema));
export const GoogleCtyDimBucketSchema = z.record(z.record(GoogleCtyCellSchema));

export const MetaDimSchema = z.object({ ctry: MetaDimBucketSchema, age: MetaDimBucketSchema });

/** 无站点层的素材分桶（sub/sub2：维度→子维度→日期→站点cell） */
const SiteDaySchema = z.record(z.array(num).min(7).max(8));
export const MetaCreativeSchema = z.object({
  sub: z.record(z.record(z.record(SiteDaySchema))),
  sub2: z.record(z.record(z.record(SiteDaySchema))),
  ctype: MetaDimBucketSchema,
});

export const GoogleDimSchema = z.object({ ctry: GoogleCtyDimBucketSchema, age: GoogleDimBucketSchema });

export const GoogleTypeSchema = z.object({
  typeBrand: GoogleDimBucketSchema,
  cmpNames: z.record(z.string()),
});
