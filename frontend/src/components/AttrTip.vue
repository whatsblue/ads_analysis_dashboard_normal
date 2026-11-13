<script setup lang="ts">
/**
 * 环比值 hover 归因浮层（迁移自原型 #attrTip）：App 级单例，读 useAttrState 渲染。
 * 五维度 Top3 + 涨跌色 + 对象点击跳转对应模块。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useDataStore } from '@/stores/data';
import { useFilterStore } from '@/stores/filter';
import { attrDims, ATTR_JUMP, type AttrDim } from '@/specs/attr';
import { cancelHide, hideAttr, hideAttrLater, useAttrState } from '@/composables/useAttrTip';
import { COL_NAME } from '@/specs/columns';
import { deltaPct } from '@ads/shared';

const state = useAttrState();
const router = useRouter();
const data = useDataStore();
const filter = useFilterStore();

const el = ref<HTMLDivElement | null>(null);
const pos = ref({ left: 0, top: 0 });

const ch = computed<'meta' | 'google' | 'edm'>(() => {
  const tid = state.payload?.tid ?? '';
  if (tid === 'm1') return 'meta';
  if (tid === 'gm1') return 'google';
  const rk = state.payload?.rk ?? '';
  if (rk.indexOf('Meta') === 0) return 'meta';
  if (rk.indexOf('Google') === 0) return 'google';
  return 'edm';
});

const ATTR_KN: Record<string, string> = {
  impressions: '展示',
  vs: '转化价值(Shopify)',
  va: '转化价值(Google)',
  roas_s: 'ROAS(Shopify)',
  roas_a: 'ROAS(Google)',
  inter: '全部点击',
  atc: '加购',
  ckt: '发起结帐',
};

const kName = computed(() => COL_NAME[state.payload?.hk ?? ''] ?? ATTR_KN[state.payload?.hk ?? ''] ?? state.payload?.hk ?? '');

const dims = ref<AttrDim[]>([]);

watch(
  () => state.on,
  (on) => {
    if (!on || !state.payload) {
      dims.value = [];
      return;
    }
    const p = state.payload;
    if (ch.value === 'edm') {
      dims.value = [];
    } else {
      dims.value = attrDims(ch.value, p.hk, p.dir === 'up' ? 1 : -1, filter.applied.start, filter.applied.end, p.cs, p.ce);
    }
    // 定位（下一帧：内容渲染后测量）
    requestAnimationFrame(() => {
      const r = state.rect;
      const node = el.value;
      if (!r || !node) return;
      const tw = node.offsetWidth;
      const th = node.offsetHeight;
      let left = r.right + 10;
      let top = r.bottom + 8;
      if (left + tw > window.innerWidth - 8) left = r.left - tw - 10;
      if (top + th > window.innerHeight - 8) top = r.top - th - 8;
      if (left < 8) left = 8;
      if (top < 8) top = 8;
      pos.value = { left, top };
    });
  },
);

function dvTxt(cur: number, prev: number): { up: boolean; txt: string } {
  const p = deltaPct(cur, prev);
  if (p == null) return { up: false, txt: '—' };
  return { up: p >= 0, txt: (p >= 0 ? '↑ ' : '↓ ') + Math.abs(p).toFixed(2) + '%' };
}

function jump(dimName: string): void {
  const jt = ATTR_JUMP[ch.value as keyof typeof ATTR_JUMP]?.[dimName];
  if (jt) {
    router.push(jt);
    hideAttr();
  }
}

function onScroll(): void {
  hideAttr();
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, true);
  void data;
});
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll, true);
});
</script>

<template>
  <div
    v-if="state.on && state.payload"
    ref="el"
    class="attr-tip"
    :style="{ left: pos.left + 'px', top: pos.top + 'px' }"
    @mouseenter="cancelHide()"
    @mouseleave="hideAttrLater()"
  >
    <div class="at-t">{{ kName }} · {{ state.payload.dir === 'up' ? '环比增长' : '环比下降' }} Top3</div>
    <div class="at-sub">
      {{ ch === 'meta' ? 'Meta' : ch === 'google' ? 'Google' : 'EDM' }}　环比期 {{ state.payload.cs }} ~ {{ state.payload.ce }}　本期
      {{ filter.applied.start }} ~ {{ filter.applied.end }}
    </div>
    <div v-if="ch === 'edm'" class="at-empty">该渠道无细分维度拆分数据</div>
    <template v-else>
      <template v-for="d in dims" :key="d.name">
        <div class="at-h">{{ d.name }}</div>
        <div v-if="!d.items.length" class="at-empty">无有效环比对象（上期基数为 0 不参与）</div>
        <div v-for="it in d.items" :key="d.name + it.n" class="at-r">
          <b v-if="ATTR_JUMP[ch]?.[d.name]" class="at-lk" :title="'点击查看 ' + it.n" @click="jump(d.name)">{{ it.n }}</b>
          <b v-else :title="it.n">{{ it.n }}</b>
          <span class="delta" :class="dvTxt(it.vn, it.vp).up ? 'd' : 'u'">{{ dvTxt(it.vn, it.vp).txt }}</span>
        </div>
      </template>
    </template>
  </div>
</template>
