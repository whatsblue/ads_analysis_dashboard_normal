<script setup lang="ts">
import { useRoute } from 'vue-router';

/** Phase 0 骨架占位视图：展示当前路由与骨架状态，feat/dashboard 分支替换为 13 真实视图 */
const route = useRoute();
</script>

<template>
  <section class="panel">
    <div class="ptitle">
      <h2>看板骨架已就绪</h2>
      <span class="desc">当前路由：{{ route.fullPath }}（Phase 0 占位，真实视图在 feat/dashboard 分支实现）</span>
    </div>
    <div class="banner">
      本仓库为正式版架构骨架：契约（docs/DATA_CONTRACT.md）+ 指标层（shared/metrics.ts）+ 数据管道（pipeline）+ 前端骨架（frontend）。
      数据文件由管道生成于 frontend/public/data/（当前为 rdfile 通道种子数据）。
    </div>
  </section>
</template>
