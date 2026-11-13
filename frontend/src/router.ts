import { createRouter, createWebHistory } from 'vue-router';

/**
 * 路由 = 三级导航映射（对齐原型 lv1/lv2）：
 *   /            渠道归因总览（ca）
 *   /meta/m1..m6 Meta 看板
 *   /google/gm1|gm2|gm3|g1|g2|gm6 Google 看板
 *
 * Phase 0 骨架：全部指向 HomeView 占位；真实视图在 feat/dashboard 分支按 spec 实现。
 */
export const router = createRouter({
  history: createWebHistory('/ads_analysis_dashboard_normal/'),
  routes: [
    { path: '/', name: 'overview', component: () => import('./views/HomeView.vue') },
    { path: '/:lv1(meta|google)/:tab(m1|m2|m3|m4|m5|m6|gm1|gm2|gm3|g1|g2|gm6)', name: 'tab', component: () => import('./views/HomeView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
