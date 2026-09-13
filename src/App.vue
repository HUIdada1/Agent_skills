<script setup lang="ts">
import { onMounted } from "vue";
import { useAppStore } from "./stores/app";
import Sidebar from "./components/Sidebar.vue";
import HelpDialog from "./components/HelpDialog.vue";
import DashboardView from "./views/DashboardView.vue";
import LibraryView from "./views/LibraryView.vue";
import SkillDetailView from "./views/SkillDetailView.vue";
import SyncView from "./views/SyncView.vue";
import DedupView from "./views/DedupView.vue";
import WebdavView from "./views/WebdavView.vue";
import SettingsView from "./views/SettingsView.vue";
import UpdaterView from "./views/UpdaterView.vue";
import logoUrl from "./assets/logo.png";

const app = useAppStore();
onMounted(() => {
  app.load();
});
</script>

<template>
  <!-- 自绘标题条：系统标题栏已隐藏，点击左上角不再弹系统菜单；
       整条可拖拽移动窗口，双击最大化/还原，右上角三按钮由系统 overlay 提供 -->
  <div class="titlebar">
    <img class="tb-logo" :src="logoUrl" alt="Agent_skills" draggable="false" />
    <span class="tb-name">Agent_skills</span>
  </div>
  <div class="app-shell">
    <Sidebar />
    <main class="main">
      <div class="main-inner">
        <!-- 按需挂载：页面首次进入才加载数据，KeepAlive 让切页不丢状态 -->
        <KeepAlive>
          <DashboardView v-if="app.activePage === 'dashboard'" />
          <LibraryView v-else-if="app.activePage === 'library'" />
          <SkillDetailView v-else-if="app.activePage === 'skill-detail'" />
          <SyncView v-else-if="app.activePage === 'sync'" />
          <DedupView v-else-if="app.activePage === 'dedup'" />
          <WebdavView v-else-if="app.activePage === 'webdav'" />
          <SettingsView v-else-if="app.activePage === 'settings'" />
          <UpdaterView v-else />
        </KeepAlive>
      </div>
    </main>
    <HelpDialog />
  </div>
</template>
