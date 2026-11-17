<script setup lang="ts">
/**
 * App 壳（对齐原型 HTML 结构）：
 * header（标题 + 数据更新 badge + 口径说明）→ 吸顶 topbar（FilterBar + lv1/lv2 两级导航）
 * → 路由视图 → 环比归因浮层（App 级单例）。
 * 等 data.init()（manifest/dims/channel）完成后再渲染筛选栏与视图，避免空账号列表闪烁；
 * 失败时顶栏 badge 显示错误、各视图自行兜底重试。
 */
import { computed, nextTick, onMounted, ref } from 'vue';
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
const calOpen = ref(false);
const guideOpen = ref(false);

/* 切页签滚回该页顶部（原型单页 setTab 无此问题，SPA 路由保留滚动位需显式归零） */
function scrollTop(): void {
  window.scrollTo(0, 0);
}

function goTab(tab: string): void {
  const to = `/${activeLv1.value}/${tab}`;
  if (route.path === to) return;
  void router.push(to);
  scrollTop();
}

function goLv1(to: string): void {
  if (route.path === to) return;
  void router.push(to);
  scrollTop();
}

onMounted(async () => {
  /* 表头页面级吸顶：测量吸顶 topbar 实际高度（筛选栏 wrap 可能两行）注入全局 --topbarH，
     供各表 thead sticky top 精确对齐（ResizeObserver 跟随后续尺寸变化） */
  const setTopbarH = (): void => {
    const topbar = document.querySelector('.topbar');
    if (!topbar) return;
    document.documentElement.style.setProperty('--topbarH', Math.round(topbar.getBoundingClientRect().height) + 'px');
    return;
  };
  setTopbarH();
  const topbar = document.querySelector('.topbar');
  if (topbar) new ResizeObserver(setTopbarH).observe(topbar);
  /* 加固：某些环境下 RO 回调不可靠（如隐藏窗口帧门控），resize/回到可见时补测一次 */
  window.addEventListener('resize', setTopbarH);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') setTopbarH();
  });
  try {
    await data.init();
  } catch {
    /* data.loadError 已记录；视图挂载后各自重试 */
  }
  inited.value = true;
  /* 兜底：FilterBar（v-if=inited）渲染后 topbar 实际高度已变，RO 之外再补测一次，
     避免 RO 异常环境下表头藏进 topbar 不透明背景后方 */
  await nextTick();
  setTopbarH();
});
</script>

<template>
  <header>
    <span class="ttl">广告流量分析看板</span>
    <span class="hright">
      <span class="badge" v-if="!data.loadError"><i></i>数据更新：{{ genAt }}（T+1 05:00 自动同步）</span>
      <span class="badge badge-err" v-else>{{ data.loadError }}</span>
      <button type="button" class="btn" @click="guideOpen = true">使用指引</button>
      <button type="button" class="btn" @click="calOpen = true">口径说明</button>
    </span>
  </header>

  <div class="topbar">
    <FilterBar v-if="inited" />
    <nav class="lv1">
      <button v-for="l in LV1" :key="l.key" type="button" :class="{ on: activeLv1 === l.key }" @click="goLv1(l.to)">
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
        <li><b>数据说明</b>：本看板覆盖 Meta、Google 广告数据；T日业务数据通常在 T+1 05:00 前同步到看板，并滚动更新最近 10 个自然日。</li>
        <li><b>范围</b>：Meta×(Shopify+Shoplazza) + Google×Shopify；当前覆盖接入 2025-01-01至今。</li>
        <li><b>筛选</b>：「大盘」联动日期范围和销售站点；账号筛选不影响该卡片。</li>
        <li><b>口径</b>：主看板 CVR = 订单数 / 统一交互数；Google 渠道分析按字段名区分 google / shopify / 归因口径。</li>
        <li><b>Meta 数据口径</b>：前端修改归因将不会联动该看板数据；看板数据来源为 Meta 导出报告，与 Meta 前端显示存在平台自身差异，核对时请以导出报告为准。</li>
        <li><b>Meta 国家/年龄细分</b>：Meta 平台对分维度数据有内部取整，国家、年龄模块与 Meta 前端可能有个位数级别出入，不影响汇总数据准确性。</li>
      </ul>
    </div>
  </div>

  <div class="modal-mask" v-if="guideOpen" @click.self="guideOpen = false">
    <div class="modal guide-modal">
      <button class="x" type="button" @click="guideOpen = false">✕</button>
      <h3>使用指引</h3>
      <p class="guide-lead">广告投放数据一站式看板：查看花费、订单、转化价值、ROAS 等核心指标，定位账户、商品、素材、国家、年龄各维度的投放效果。数据每日凌晨自动同步，页面右上角徽章显示最近更新时间。</p>
      <h4>一、页面怎么选</h4>
      <ul>
        <li><b>大盘</b>：Meta + Google 合并的整体健康度总览，先看这里掌握大盘趋势。</li>
        <li><b>Meta 页签</b>：大盘健康度（渠道趋势）/ 账号定位（哪个账户效果好）/ 商品投产（哪个商品值得加投）/ 素材效率（哪条素材在跑量）/ 国家维度（哪些市场在出单）/ 年龄维度（受众年龄表现）。</li>
        <li><b>Google 页签</b>：页签逻辑与 Meta 一致，另含「广告类型分析」（各广告类型与品牌 / 非品牌词的表现）。</li>
      </ul>
      <h4>二、筛选条件怎么用</h4>
      <ul>
        <li><b>日期范围</b>：默认最近两周，可改为任意区间。</li>
        <li><b>销售站点</b>：Meta 数据可选 Shopify / Shoplazza；Google 数据目前仅覆盖 Shopify。</li>
        <li><b>广告账号</b>：可多选，支持搜索与批量粘贴；不选 = 全部账号。</li>
        <li>修改后点「应用」生效，「重置」恢复默认。<b>注意</b>：大盘页总览卡只受日期和站点影响，广告账号筛选不影响它。</li>
      </ul>
      <h4>三、环比对比</h4>
      <ul>
        <li>勾选「开启环比」：明细表每行下方会多出对比期数据与涨跌百分比。</li>
        <li>「环比设置」可选对比基准（上一周期 / 上月 / 去年同期 / 自定义）与对比周期数（1-4 个）。按钮蓝色 = 有修改未应用，灰色 = 环比开启中，白色 = 未开启。</li>
      </ul>
      <h4>四、表格小技巧</h4>
      <ul>
        <li><b>排序</b>：点击任意指标表头按该列降序 / 升序切换（包括「花费占比」等占比列）。</li>
        <li><b>显示占比</b>：勾选后出现各指标占当前筛选范围总量的百分比列。</li>
        <li><b>加载更多</b>：明细默认显示前 10 行，点底部按钮查看全部；部分表首列可点击展开看细分。</li>
        <li><b>悬浮提示</b>：鼠标停在指标表头可看口径说明；停在环比涨跌格可看涨跌归因拆解。</li>
        <li><b>导出</b>：点「⇩ 导出」勾选所需列、拖动调整列顺序、选择区间汇总或按日粒度、xls / csv 格式；页面若开了环比，导出文件同样包含环比行。</li>
      </ul>
      <h4>五、常见问题</h4>
      <ul>
        <li><b>数据什么时候更新？</b>每天凌晨自动同步截至昨日的数据，白天迟到的平台回传会在晚间批次补齐。</li>
        <li><b>和 Meta / Google 后台数字对不上？</b>看板取自平台官方导出报告口径，Meta 前端修改归因不影响看板；核对请以后台导出报告为准（详见「口径说明」）。</li>
        <li><b>国家 / 年龄细分汇总和总览有个位数差异？</b>平台对分维度数据有内部取整，属正常现象。</li>
      </ul>
      <h4>六、明细指标口径</h4>
      <div class="guide-ph">（占位：待补充各明细页指标口径定义——花费、展示、点击、订单、转化价值、ROAS、CVR、CPA 等在各模块的取数来源与计算规则）</div>
    </div>
  </div>
</template>

<style scoped src="./styles/app.css"></style>
