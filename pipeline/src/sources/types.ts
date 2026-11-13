/**
 * 数据源通道抽象。所有通道产出统一的 RawDataset（契约文件的内存形态），
 * 由 build/emit.ts 写盘——切换通道不改口径层与校验。
 */
import type {
  ChannelData,
  Dims,
  GoogleBucket,
  GoogleDimData,
  GoogleTypeData,
  Manifest,
  MetaBucket,
  MetaCreativeData,
  MetaDimData,
} from '@ads/shared';

/** 管道中间产物：各契约文件的内存形态 */
export interface RawDataset {
  manifest: Manifest;
  dims: Dims;
  channel: ChannelData;
  metaAcc: Record<string, MetaBucket>;
  metaCamp: Record<string, MetaBucket>;
  metaSpu: Record<string, MetaBucket>;
  metaDim: MetaDimData;
  metaCreative: MetaCreativeData;
  metaAd: Record<string, MetaBucket>;
  googleAcc: Record<string, GoogleBucket>;
  googleDim: GoogleDimData;
  googleSpu: Record<string, GoogleBucket>;
  googleType: GoogleTypeData;
}

export type SourceKind = 'reorc' | 'db' | 'rdfile';

export interface Source {
  readonly kind: SourceKind;
  /** 拉取全量数据（含滚动 10 天重算语义由实现方保证） */
  fetch(): Promise<RawDataset>;
}
