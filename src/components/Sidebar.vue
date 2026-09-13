<script setup lang="ts">
import { useAppStore } from "../stores/app";

const app = useAppStore();
</script>

<template>
  <aside class="sidebar">
    <nav>
      <div class="nav-group">导航</div>
      <a class="nav-item" :class="{ active: app.activePage === 'dashboard' }" @click="app.go('dashboard')"><i class="ph ph-squares-four"></i>仪表盘</a>
      <div class="nav-group">技能管理</div>
      <a class="nav-item" :class="{ active: app.activePage === 'library' || app.activePage === 'skill-detail' }" @click="app.go('library')"><i class="ph ph-books"></i>中央技能库</a>
      <a class="nav-item" :class="{ active: app.activePage === 'sync' }" @click="app.go('sync')"><i class="ph ph-arrows-left-right"></i>同步中心</a>
      <a class="nav-item" :class="{ active: app.activePage === 'dedup' }" @click="app.go('dedup')"><i class="ph ph-git-merge"></i>去重与冲突</a>
      <div class="nav-group">系统</div>
      <a class="nav-item" :class="{ active: app.activePage === 'webdav' }" @click="app.go('webdav')"><i class="ph ph-cloud"></i>WebDAV 同步</a>
      <a class="nav-item" :class="{ active: app.activePage === 'settings' }" @click="app.go('settings')"><i class="ph ph-gear-six"></i>设置</a>
      <a class="nav-item" :class="{ active: app.activePage === 'updater' }" @click="app.go('updater')"><i class="ph ph-arrows-clockwise"></i>更新中心</a>
    </nav>
    <div class="sidebar-foot">
      <span>{{ app.version }}</span>
      <span class="foot-right">
        <button class="theme-toggle" type="button" title="切换明亮 / 黑暗主题" @click="app.toggleTheme()">
          <i class="ph" :class="app.theme === 'light' ? 'ph-moon' : 'ph-sun'"></i>
        </button>
      </span>
    </div>
  </aside>
</template>
