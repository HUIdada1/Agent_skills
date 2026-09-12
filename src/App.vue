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
        <DashboardView v-show="app.activePage === 'dashboard'" />
        <LibraryView v-show="app.activePage === 'library'" />
        <SkillDetailView v-show="app.activePage === 'skill-detail'" />
        <SyncView v-show="app.activePage === 'sync'" />
        <DedupView v-show="app.activePage === 'dedup'" />
        <SettingsView v-show="app.activePage === 'settings'" />
        <UpdaterView v-show="app.activePage === 'updater'" />
      </div>
    </main>
  </div>
</template>
