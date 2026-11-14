<script setup lang="ts">
/**
 * App 壳（对齐原型 HTML 结构）：
 * header（标题 + 数据更新 badge + 口径说明）→ 吸顶 topbar（FilterBar + lv1/lv2 两级导航）
 * → 路由视图 → 环比归因浮层（App 级单例）。
 * 等 data.init()（manifest/dims/channel）完成后再渲染筛选栏与视图，避免空账号列表闪烁；
 * 失败时顶栏 badge 显示错误、各视图自行兜底重试。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDataStore } from '@/stores/data';
import FilterBar from '@/components/FilterBar.vue';
import AttrTip from '@/components/AttrTip.vue';

const route = useRoute();
const router = useRouter();
const data = useDataStore();

const inited = ref(false);

const LV1 = [
  { key: 'ca', label: '大盘', to: '/' },
  { key: 'meta', label: 'Meta', to: '/meta/m1' },
  { key: 'google', label: 'Google', to: '/google/gm1' },
];

interface Lv2Def {
  cap: string;
  tabs: { key: string; label: string }[];
}

const LV2: Record<'meta' | 'google', Lv2Def> = {
  meta: {
    cap: 'Meta ·',
    tabs: [
      { key: 'm1', label: '大盘健康度' },
      { key: 'm2', label: '账号定位' },
      { key: 'm3', label: '商品投产' },
      { key: 'm4', label: '素材效率' },
      { key: 'm5', label: '国家维度' },
      { key: 'm6', label: '年龄维度' },
    ],
  },
  google: {
    cap: 'Google ·',
    tabs: [
      { key: 'gm1', label: '大盘健康度' },
      { key: 'gm2', label: '账号定位' },
      { key: 'gm3', label: '商品投产' },
      { key: 'g1', label: '广告类型分析' },
      { key: 'g2', label: '国家维度' },
      { key: 'gm6', label: '年龄维度' },
    ],
  },
};

const activeLv1 = computed<'ca' | 'meta' | 'google'>(() => {
  if (route.path === '/') return 'ca';
  if (route.path.startsWith('/meta/')) return 'meta';
  if (route.path.startsWith('/google/')) return 'google';
  return 'ca';
});

const activeLv2 = computed<Lv2Def | null>(() => (activeLv1.value === 'meta' || activeLv1.value === 'google' ? LV2[activeLv1.value] : null));

/** 当前 tab 键（= 路由 name；overview 页为空） */
const activeTab = computed(() => (route.name && typeof route.name === 'string' && route.name !== 'overview' ? route.name : ''));

const genAt = computed(() => data.manifest?.genAt ?? '…');
const calRangeTxt = computed(() => data.manifest?.scope ?? '');
const calOpen = ref(false);

function goTab(tab: string): void {
  void router.push(`/${activeLv1.value}/${tab}`);
}

onMounted(async () => {
  try {
    await data.init();
  } catch {
    /* data.loadError 已记录；视图挂载后各自重试 */
  }
  inited.value = true;
});
</script>

<template>
  <header>
    <span class="ttl">广告流量分析看板 · Shopify × Meta × Google</span>
    <span class="hright">
      <span class="badge" v-if="!data.loadError"><i></i>数据更新：{{ genAt }}（T+1 05:00 自动同步）</span>
      <span class="badge badge-err" v-else>{{ data.loadError }}</span>
      <button type="button" class="btn" @click="calOpen = true">口径说明</button>
    </span>
  </header>

  <div class="topbar">
    <FilterBar v-if="inited" />
    <nav class="lv1">
      <button v-for="l in LV1" :key="l.key" type="button" :class="{ on: activeLv1 === l.key }" @click="router.push(l.to)">
        {{ l.label }}
      </button>
    </nav>
    <nav class="lv2" v-if="activeLv2">
      <span class="cap">{{ activeLv2.cap }}</span>
      <button
        v-for="t in activeLv2.tabs"
        :key="t.key"
        type="button"
        class="tab-btn"
        :class="{ on: activeTab === t.key }"
        @click="goTab(t.key)"
      >
        {{ t.label }}
      </button>
    </nav>
  </div>

  <main>
    <RouterView v-if="inited && data.rangeReady" />
    <div class="loading-mask" v-else-if="inited">
      <span class="spin"></span>加载月分片数据中…
    </div>
  </main>

  <AttrTip />

  <div class="modal-mask" v-if="calOpen" @click.self="calOpen = false">
    <div class="modal">
      <button class="x" type="button" @click="calOpen = false">✕</button>
      <h3>口径说明</h3>
      <ul>
        <li><b>数据说明</b>：本看板覆盖 2026-01-01 以来的 Meta、Google 广告数据；日业务数据通常在 T+1 05:00 前同步，并每日滚动重写最近 3 个自然月（历史月份的迟到回传随同步逐日收敛）。月度分片按需加载，切换日期区间时可能短暂提示加载。</li>
        <li><b>范围</b>：Meta×(Shopify+Shoplazza) + Google×Shopify；当前接入 {{ calRangeTxt }}</li>
        <li><b>筛选</b>：「大盘」联动日期范围和销售站点；账号筛选不影响该卡片。</li>
        <li><b>口径</b>：主看板 CVR = 订单数 / 统一交互数；Google 深度分析按字段名区分 google / shopify / 归因口径。</li>
        <li><b>Meta 数据口径</b>：前端修改归因将不会联动该看板数据；看板数据来源为 Meta 导出报告，与 Meta 前端显示存在平台自身差异，核对时请以导出报告为准。</li>
        <li><b>Meta 国家/年龄细分</b>：Meta 平台对分维度数据有内部取整，国家、年龄模块与 Meta 前端可能有个位数级别出入，不影响汇总数据准确性。</li>
        <li><b>整站 GMV 收敛</b>：整站 GMV 取易仓已付款订单（status=4）按下单日期统计；历史月份订单的付款/状态在次月仍会延迟回填，看板为每日 T+1 快照，历史区间数值可能略低于实时数仓并随每日同步逐日收敛，精确对账以数仓实时查询为准。</li>
      </ul>
    </div>
  </div>
</template>

<style scoped src="./styles/app.css"></style>
