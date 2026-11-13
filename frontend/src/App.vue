<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { loadManifest } from '@/data';

/**
 * App 壳：顶栏（标题 + 数据更新 badge）+ 两级导航 + 路由视图。
 * 真实筛选栏（FilterBar）与视图在 feat/dashboard 分支接入。
 */
const route = useRoute();
const genAt = ref('…');
const loadError = ref('');

const LV1 = [
  { key: 'ca', label: '渠道归因', to: '/' },
  { key: 'meta', label: 'Meta', to: '/meta/m1' },
  { key: 'google', label: 'Google', to: '/google/gm1' },
];
const activeLv1 = computed(() => {
  if (route.path === '/') return 'ca';
  if (route.path.startsWith('/meta/')) return 'meta';
  if (route.path.startsWith('/google/')) return 'google';
  return '';
});

onMounted(async () => {
  try {
    const m = await loadManifest();
    genAt.value = m.genAt;
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e);
  }
});
</script>

<template>
  <header>
    <span class="ttl">广告流量分析看板 · Shopify × Meta × Google</span>
    <span class="hright">
      <span class="badge" v-if="!loadError"><i></i>数据更新：{{ genAt }}（T+1 05:00 自动同步）</span>
      <span class="badge badge-err" v-else>{{ loadError }}</span>
    </span>
  </header>
  <nav class="lv1">
    <RouterLink v-for="l in LV1" :key="l.key" :to="l.to" class="lv1-btn" :class="{ on: activeLv1 === l.key }">
      {{ l.label }}
    </RouterLink>
  </nav>
  <main>
    <RouterView />
  </main>
</template>

<style scoped src="./styles/app.css"></style>
