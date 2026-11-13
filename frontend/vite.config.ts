import { copyFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';

// GitHub Pages 无 SPA rewrite：深链接/刷新命中未存在路径时服务 404.html，
// 复制 index.html 作 404.html 后 Vue 应用照常启动并按 location 恢复路由
function ghPages404(): Plugin {
  return {
    name: 'gh-pages-spa-404',
    apply: 'build',
    closeBundle() {
      copyFileSync(
        fileURLToPath(new URL('./dist/index.html', import.meta.url)),
        fileURLToPath(new URL('./dist/404.html', import.meta.url)),
      );
    },
  };
}

// Pages 子路径部署：https://whatsblue.github.io/ads_analysis_dashboard_normal/
export default defineConfig({
  base: '/ads_analysis_dashboard_normal/',
  plugins: [vue(), ghPages404()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          echarts: ['echarts'],
          vendor: ['vue', 'vue-router', 'pinia'],
        },
      },
    },
  },
});
