import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    // 数据层/store 测试无需 DOM；组件测试（feat/dashboard）引入时再切换 jsdom（需补 jsdom 依赖）
    environment: 'node',
  },
});
