/**
 * 环比值 hover 归因计算（迁移自原型 attrDims/ATTR_JUMP）：
 * 大盘三表（ca/m1/gm1）Δ格 hover → 五维度（账号/商品/素材类型/国家/年龄段）环比 Top3 对象。
 * 增长取涨幅最大三项、下降取降幅最大三项；上期基数为 0 的对象不参与排序；unknown 对象排除。
 */
import { derive, deriveG, zero } from '@ads/shared';
import type { Metrics } from '@ads/shared';
import { useDataStore } from '@/stores/data';
import { useFilterStore } from '@/stores/filter';

export interface AttrItem {
  n: string;
  vn: number;
  vp: number;
  dv: number | null;
}
export interface AttrDim {
  name: string;
  items: AttrItem[];
}

/** 维度对象点击跳转（对齐原型 ATTR_JUMP 的页签映射 → 路由路径） */
export const ATTR_JUMP: Record<'meta' | 'google', Record<string, string>> = {
  meta: { 账号: '/meta/m2', 商品: '/meta/m3', 素材类型: '/meta/m4', 国家: '/meta/m5', 年龄段: '/meta/m6' },
  google: { 账号: '/google/gm2', 商品: '/google/gm3', 素材类型: '/google/g1', 国家: '/google/g2', 年龄段: '/google/gm6' },
};

function top(name: string, pairs: [string, Metrics | null, Metrics | null][], k: string, dir: number, g = false): AttrDim {
  const DF = g ? deriveG : derive;
  const arr = pairs.map((p) => {
    const a = p[1] ? (DF(p[1]) as unknown as Record<string, number>)[k] : NaN;
    const b = p[2] ? (DF(p[2]) as unknown as Record<string, number>)[k] : NaN;
    return {
      n: p[0],
      vn: a,
      vp: b,
      dv: a == null || isNaN(a) || b == null || isNaN(b) || !b ? null : ((a - b) / b) * 100,
    };
  });
  const valid = arr.filter((x) => x.dv != null && !/^unknown$/i.test(x.n));
  valid.sort((x, y) => (dir > 0 ? y.dv! - x.dv! : x.dv! - y.dv!));
  return { name, items: valid.slice(0, 3) };
}

/**
 * 计算归因维度（依赖相关维度桶已 ensure；未加载的桶返回空集合）。
 * @param dir up=1（增长 Top3） / down=-1
 */
export function attrDims(ch: 'meta' | 'google', k: string, dir: number, s: string, e: string, ps: string, pe: string): AttrDim[] {
  const data = useDataStore();
  const filter = useFilterStore();
  const dims: AttrDim[] = [];
  if (ch === 'meta') {
    const allow = filter.applied.metaAccounts;
    dims.push(
      top(
        '账号',
        data.metaAccounts
          .filter((a) => !allow || allow.includes(a))
          .map((a) => [a, data.metaAccRange(a, s, e), data.metaAccRange(a, ps, pe)]),
        k,
        dir,
      ),
    );
    const DIMC: [string, 'spu' | 'ctype' | 'ctry' | 'age'][] = [
      ['商品', 'spu'],
      ['素材类型', 'ctype'],
      ['国家', 'ctry'],
      ['年龄段', 'age'],
    ];
    for (const [label, dim] of DIMC) {
      const now = data.metaDimRange(dim, s, e);
      const pv = data.metaDimRange(dim, ps, pe);
      const ks = dim === 'ctype' ? data.types : Object.keys(now);
      const pairs: [string, Metrics | null, Metrics | null][] = ks.map((kk) => [kk, now[kk] ?? null, pv[kk] ?? null]);
      if (!pairs.length) {
        dims.push({ name: label, items: [] });
        continue;
      }
      dims.push(top(label, pairs, k, dir));
    }
  } else {
    dims.push(
      top(
        '账号',
        data.gAccounts.map((a) => [a, data.gAccRange(a, s, e), data.gAccRange(a, ps, pe)]),
        k,
        dir,
        true,
      ),
    );
    dims.push(
      top(
        '商品',
        data.gSpus.map((kk) => [kk, data.gSpuRange(kk, s, e), data.gSpuRange(kk, ps, pe)]),
        k,
        dir,
        true,
      ),
    );
    const ta = data.gTypeAgg(s, e);
    const tp = data.gTypeAgg(ps, pe);
    dims.push(
      top(
        '素材类型',
        Object.keys(ta).map((kk) => [kk, ta[kk], tp[kk] ?? zero()]),
        k,
        dir,
        true,
      ),
    );
    dims.push(
      top(
        '国家',
        data.countries.map((kk) => [kk, data.gCtyRange(kk, s, e), data.gCtyRange(kk, ps, pe)]),
        k,
        dir,
        true,
      ),
    );
    dims.push(
      top(
        '年龄段',
        data.ages.map((kk) => [kk, data.gAgeRange(kk, s, e), data.gAgeRange(kk, ps, pe)]),
        k,
        dir,
        true,
      ),
    );
  }
  return dims;
}
