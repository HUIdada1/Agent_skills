<script setup lang="ts">
import { onMounted } from "vue";
import { useAppStore } from "./stores/app";
import Sidebar from "./components/Sidebar.vue";
import DashboardView from "./views/DashboardView.vue";
import LibraryView from "./views/LibraryView.vue";
import SkillDetailView from "./views/SkillDetailView.vue";
import SyncView from "./views/SyncView.vue";
import DedupView from "./views/DedupView.vue";
import SettingsView from "./views/SettingsView.vue";
import UpdaterView from "./views/UpdaterView.vue";

const app = useAppStore();
onMounted(() => {
  app.load();
});
</script>

<template>
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
          <SettingsView v-else-if="app.activePage === 'settings'" />
          <UpdaterView v-else />
        </KeepAlive>
      </div>
    </main>
  </div>
</template>
