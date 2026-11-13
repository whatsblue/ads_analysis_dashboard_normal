import { createRouter, createWebHistory } from 'vue-router';

/**
 * 路由 = 三级导航映射（对齐原型 lv1/lv2，13 视图全部懒加载）：
 *   /            渠道归因总览（ca / 大盘）
 *   /meta/m1..m6 Meta 看板
 *   /google/gm1|gm2|gm3|g1|g2|gm6 Google 看板
 */
export const router = createRouter({
  history: createWebHistory('/ads_analysis_dashboard_normal/'),
  routes: [
    { path: '/', name: 'overview', component: () => import('./views/OvView.vue') },

    { path: '/meta/m1', name: 'm1', component: () => import('./views/meta/M1View.vue') },
    { path: '/meta/m2', name: 'm2', component: () => import('./views/meta/M2View.vue') },
    { path: '/meta/m3', name: 'm3', component: () => import('./views/meta/M3View.vue') },
    { path: '/meta/m4', name: 'm4', component: () => import('./views/meta/M4View.vue') },
    { path: '/meta/m5', name: 'm5', component: () => import('./views/meta/M5View.vue') },
    { path: '/meta/m6', name: 'm6', component: () => import('./views/meta/M6View.vue') },

    { path: '/google/gm1', name: 'gm1', component: () => import('./views/google/Gm1View.vue') },
    { path: '/google/gm2', name: 'gm2', component: () => import('./views/google/Gm2View.vue') },
    { path: '/google/gm3', name: 'gm3', component: () => import('./views/google/Gm3View.vue') },
    { path: '/google/g1', name: 'g1', component: () => import('./views/google/G1View.vue') },
    { path: '/google/g2', name: 'g2', component: () => import('./views/google/G2View.vue') },
    { path: '/google/gm6', name: 'gm6', component: () => import('./views/google/Gm6View.vue') },

    // 一级导航直跳默认 tab + 兜底
    { path: '/meta', redirect: '/meta/m1' },
    { path: '/google', redirect: '/google/gm1' },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
