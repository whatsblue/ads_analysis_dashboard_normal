/**
 * rdfile 通道：读取原型 ads_real.js（window.RD 全局变量）转为契约数据集。
 * 用途：迁移期种子数据 + 前端开发不阻塞数据源。
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  CONTRACT_VERSION,
  type ChannelData,
  type Dims,
  type GoogleDimData,
  type GoogleTypeData,
  type Manifest,
  type MetaCreativeData,
  type MetaDimData,
} from '@ads/shared';
import type { RawDataset, Source } from './types';

/** 原型 window.RD 原始形状（键名与 ads_real.js 完全一致） */
interface RD {
  v: number;
  genAt: string;
  range: { min: string; max: string; viewStart: string; viewEnd: string };
  scope: string;
  metaAccounts: string[];
  gAccounts: string[];
  metaCampaigns: string[];
  gCampaigns: string[];
  spus: string[];
  gSpus: string[];
  spuAccs: Record<string, string[]>;
  types: string[];
  countries: string[];
  ages: string[];
  combos: [string, string][];
  adList: [string, string, string][];
  ch: { meta: Record<string, ChannelData['meta'][string]>; google: Record<string, number[]> };
  acc: Record<string, Record<string, Record<string, number[]>>>;
  gacc: Record<string, Record<string, number[]>>;
  camp: Record<string, Record<string, Record<string, number[]>>>;
  gcmp: Record<string, Record<string, number[]>>;
  spu: Record<string, Record<string, Record<string, number[]>>>;
  gspu: Record<string, Record<string, number[]>>;
  sub: Record<string, Record<string, Record<string, Record<string, number[]>>>>;
  sub2: Record<string, Record<string, Record<string, Record<string, number[]>>>>;
  ctype: Record<string, Record<string, Record<string, number[]>>>;
  ad: Record<string, Record<string, Record<string, number[]>>>;
  ctry: Record<string, Record<string, Record<string, number[]>>>;
  age: Record<string, Record<string, Record<string, number[]>>>;
  gcty: Record<string, Record<string, number[]>>;
  gage: Record<string, Record<string, number[]>>;
  gc: Record<string, Record<string, number[]>>;
  gmv: Record<string, Record<string, number[]>>;
  edm: Record<string, number[]>;
}

export function parseRdFile(path: string): RD {
  const code = readFileSync(path, 'utf8');
  const sandbox: { window: { RD?: RD } } = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const rd = sandbox.window.RD;
  if (!rd || rd.v !== 1) throw new Error(`ads_real.js 缺少 window.RD 或版本不支持（v=${rd?.v}）`);
  return rd;
}

export function createRdFileSource(inputPath: string): Source {
  return {
    kind: 'rdfile',
    async fetch(): Promise<RawDataset> {
      const rd = parseRdFile(inputPath);
      return rdToDataset(rd);
    },
  };
}

/** RD → 契约数据集（rdfile 通道已是聚合桶，直接重组文件归属） */
export function rdToDataset(rd: RD): RawDataset {
  const manifest: Manifest = {
    v: CONTRACT_VERSION,
    genAt: rd.genAt,
    range: rd.range,
    scope: rd.scope,
  };

  const dims: Dims = {
    metaAccounts: rd.metaAccounts,
    gAccounts: rd.gAccounts,
    metaCampaigns: rd.metaCampaigns,
    gCampaigns: rd.gCampaigns,
    spus: rd.spus,
    gSpus: rd.gSpus,
    spuAccs: rd.spuAccs,
    types: rd.types,
    countries: rd.countries,
    ages: rd.ages,
    combos: rd.combos,
    adList: rd.adList,
  };

  const channel: ChannelData = {
    meta: rd.ch.meta,
    google: rd.ch.google,
    gmv: rd.gmv,
    edm: rd.edm,
  };

  const metaCreative: MetaCreativeData = {
    sub: rd.sub,
    sub2: rd.sub2,
    ctype: rd.ctype,
  };

  const metaDim: MetaDimData = { ctry: rd.ctry, age: rd.age };

  const googleDim: GoogleDimData = { ctry: rd.gcty, age: rd.gage };

  // Google 系列 ID → 名称映射：gcmp 键为平台数字 ID；原型 RD 未携带 ID→名称对应关系，
  // 此处留空（前端展示原始 ID）；reorc 通道接入后从平台元数据补全。
  const cmpNames: Record<string, string> = {};

  const googleType: GoogleTypeData = { typeBrand: rd.gc, cmpNames };

  return {
    manifest,
    dims,
    channel,
    metaAcc: rd.acc,
    metaCamp: rd.camp,
    metaSpu: rd.spu,
    metaDim,
    metaCreative,
    metaAd: rd.ad,
    googleAcc: rd.gacc,
    googleDim,
    googleSpu: rd.gspu,
    googleType,
    googleCmp: rd.gcmp,
  };
}
