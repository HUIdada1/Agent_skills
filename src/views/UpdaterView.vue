<script setup lang="ts">
// 更新中心：R3 先呈现当前版本与更新机制说明，R4 接入 electron-updater 后展示检查/下载/安装
import { ref, onMounted } from "vue";
import { getAppVersion } from "../api/ipc";

const version = ref("");
onMounted(async () => {
  version.value = (await getAppVersion()) || "";
});
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>更新中心</h1>
        <p class="sub">软件自更新走 GitHub Releases，下载校验后退出时静默安装。当前版本 <span class="mono">v{{ version || "—" }}</span>。</p>
      </div>
    </div>

    <div class="panel">
      <div class="steps">
        <div class="step">
          <div class="st-num">1</div>
          <div class="st-title">版本检查</div>
          <div class="st-desc">GitHub Releases latest 与本地 semver 对比</div>
        </div>
        <div class="step">
          <div class="st-num">2</div>
          <div class="st-title">下载与校验</div>
          <div class="st-desc">electron-updater 按 blockmap 增量下载并校验</div>
        </div>
        <div class="step">
          <div class="st-num">3</div>
          <div class="st-title">退出安装</div>
          <div class="st-desc">下载完成后退出应用时静默安装并重启</div>
        </div>
        <div class="step">
          <div class="st-num">4</div>
          <div class="st-title">失败兜底</div>
          <div class="st-desc">便携版不支持自动更新，提示手动到 GitHub 下载</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="note">
        <i class="ph ph-gear-six"></i>
        <div>热更新通道将在下一轮（R4）接入 electron-updater，届时这里展示「检查更新 / 下载进度 / 一键安装」与 Release 更新日志。</div>
      </div>
    </div>
  </div>
</template>
