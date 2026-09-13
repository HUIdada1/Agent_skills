<script setup lang="ts">
// 更新中心
import { ref, computed, onMounted, onUnmounted } from "vue";
import {
  getUpdateStatus, checkUpdate, downloadUpdate, installUpdate, openReleasePage, openRepoPage,
  onUpdateEvent, type UpdateStatus,
} from "../api/ipc";
import { useAppStore } from "../stores/app";

const app = useAppStore();
const st = ref<UpdateStatus | null>(null);
let unsubscribe: (() => void) | undefined;

const STATUS_TEXT: Record<UpdateStatus["status"], string> = {
  idle: "尚未检查",
  checking: "正在检查…",
  "up-to-date": "已是最新版本",
  available: "发现新版本",
  downloading: "正在下载…",
  downloaded: "新版本已就绪",
  error: "更新失败",
};

async function refresh(partial?: UpdateStatus | null) {
  st.value = partial || (await getUpdateStatus());
}

async function doCheck() {
  refresh(await checkUpdate());
}

async function doDownload() {
  refresh(await downloadUpdate());
}

async function doInstall() {
  // 触发后主进程会退出并静默安装；状态仅作界面反馈
  refresh(await installUpdate());
}

const stepState = computed(() => {
  // 步骤条：1 检查 / 2 下载 / 3 安装 / 4 兜底
  const s = st.value?.status || "idle";
  const done = (n: number) =>
    (n === 1 && ["up-to-date", "available", "downloading", "downloaded"].includes(s)) ||
    (n === 2 && ["downloading", "downloaded"].includes(s)) ||
    (n === 3 && s === "downloaded");
  return { done };
});

const notesLines = computed(() =>
  (st.value?.notes || "").split("\n").map((l) => l.trim()).filter(Boolean)
);

onMounted(async () => {
  await refresh();
  unsubscribe = onUpdateEvent((payload) => {
    const e = payload as { event?: string; status?: string } | null;
    if (e && e.event === "state" && e.status) refresh(payload as UpdateStatus);
    if (e && e.event === "focus-update") app.go("updater");
  });
});
onUnmounted(() => unsubscribe?.());
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>更新中心</h1>
        <p class="sub" v-if="st">
          软件自更新走 GitHub Releases，下载校验通过后退出时静默安装。当前版本
          <span class="mono">v{{ st.currentVersion }}</span><span v-if="st.isPortable"> · 便携版（不支持自动更新）</span>
        </p>
        <p class="sub" v-else>正在读取更新状态…</p>
      </div>
      <div class="head-actions">
        <button class="btn" :disabled="st?.status === 'checking'" @click="doCheck"><i class="ph ph-arrows-clockwise"></i>检查更新</button>
        <button class="btn btn-primary" v-if="st?.status === 'available'" @click="doDownload"><i class="ph ph-download-simple"></i>下载 v{{ st.latestVersion }}</button>
        <button class="btn btn-primary" v-else-if="st?.status === 'downloaded'" @click="doInstall"><i class="ph ph-play"></i>立即重启安装</button>
      </div>
    </div>

    <template v-if="st">
      <div class="panel">
        <div class="row-between">
          <div class="row" style="gap:28px">
            <div>
              <div class="label muted small">当前版本</div>
              <div class="mono" style="font-size:26px; font-weight:700; margin-top:2px">v{{ st.currentVersion }}</div>
            </div>
            <i class="ph ph-arrow-right" style="font-size:20px; color:var(--text-3); align-self:center; margin-top:14px"></i>
            <div>
              <div class="label muted small">最新版本 <span class="badge ok" style="margin-left:4px; vertical-align:middle">stable</span></div>
              <div class="mono" style="font-size:26px; font-weight:700; margin-top:2px" :style="st.status === 'available' || st.status === 'downloaded' ? 'color:var(--accent)' : ''">
                {{ st.latestVersion ? "v" + st.latestVersion : "—" }}
              </div>
            </div>
          </div>
          <div style="text-align:right; max-width:340px">
            <span class="badge" :class="{ 'ok': ['up-to-date', 'downloaded'].includes(st.status), 'info': ['idle', 'checking'].includes(st.status), 'warn': st.status === 'available', 'bad': st.status === 'error' }">
              <i class="ph" :class="{ 'ph-check-circle': st.status === 'up-to-date', 'ph-arrow-clockwise': st.status === 'checking', 'ph-download-simple': st.status === 'downloading', 'ph-party-popper': st.status === 'downloaded', 'ph-warning': st.status === 'error' }"></i>{{ STATUS_TEXT[st.status] }}
            </span>
            <div class="muted small mt-8" v-if="st.status === 'downloading'">下载进度 {{ st.percent }}%</div>
            <div class="muted small mt-8" v-if="st.message">{{ st.message }}</div>
            <div class="muted small mt-8" v-if="st.isPortable && (st.status === 'available')">便携版请到 GitHub Releases 手动下载新版 exe</div>
          </div>
        </div>
        <div class="mt-16" v-if="st.status === 'downloading'">
          <div style="height:6px; background:var(--panel-3); border-radius:3px; overflow:hidden">
            <div :style="{ width: st.percent + '%', height: '100%', background: 'var(--accent)', transition: 'width .3s' }"></div>
          </div>
        </div>
        <hr class="divider" />
        <div class="steps">
          <div class="step" :class="{ done: stepState.done(1) }">
            <div class="st-num"><i class="ph ph-check" v-if="stepState.done(1)"></i><template v-else>1</template></div>
            <div class="st-title">版本检查</div>
            <div class="st-desc">GitHub Releases latest 与本地 semver 对比</div>
          </div>
          <div class="step" :class="{ done: stepState.done(2) }">
            <div class="st-num"><i class="ph ph-check" v-if="stepState.done(2)"></i><template v-else>2</template></div>
            <div class="st-title">下载与校验</div>
            <div class="st-desc">electron-updater 按 blockmap 增量下载并校验</div>
          </div>
          <div class="step" :class="{ done: st.status === 'downloaded' }">
            <div class="st-num"><i class="ph ph-check" v-if="st.status === 'downloaded'"></i><template v-else>3</template></div>
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

      <div class="section" v-if="st.notes || st.status === 'error'">
        <h2>更新日志</h2>
        <p class="desc">来自 GitHub Releases 正文。</p>
        <div class="panel" v-if="st.notes">
          <div class="row-between">
            <div class="row" style="gap:10px">
              <span class="mono" style="font-weight:700; font-size:15px">v{{ st.latestVersion }}</span>
              <span class="badge ok">stable</span>
            </div>
          </div>
          <hr class="divider" />
          <div class="small" style="color:var(--text-2); line-height:1.9">
            <div class="row" style="gap:8px" v-for="(l, i) in notesLines" :key="i" :style="l.startsWith('·') ? '' : 'font-weight:600; margin-top:6px'">
              <i class="ph" :class="l.startsWith('·') ? 'ph-plus-circle' : 'ph-list'" :style="{ color: l.startsWith('·') ? 'var(--accent)' : 'var(--text-3)' }"></i>{{ l.startsWith('·') ? l.slice(1).trim() : l }}
            </div>
          </div>
        </div>
        <div class="note warn mt-8" v-if="st.status === 'error'">
          <i class="ph ph-shield-warning"></i>
          <div>{{ st.message }}。也可直接到 GitHub Releases 手动下载：
            <a style="color:var(--accent); cursor:pointer" @click="openReleasePage()">打开 Releases 页</a>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="row" style="gap:10px">
          <button class="btn btn-sm" @click="openReleasePage()"><i class="ph ph-github-logo"></i>GitHub Releases</button>
          <button class="btn btn-sm" @click="openRepoPage()"><i class="ph ph-house"></i>仓库主页</button>
        </div>
      </div>
    </template>
  </div>
</template>
