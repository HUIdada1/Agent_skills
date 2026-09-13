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

// 是否已发现可升级的新版本：决定箭头与新版号是否点亮
const hasNew = computed(
  () => !!st.value?.latestVersion && ["available", "downloading", "downloaded", "error"].includes(st.value.status)
);

// 步骤条状态机：done 完成 / cur 进行中 / fail 失败；c1-c3 为节点前连接线
const stepsState = computed(() => {
  const s = st.value?.status || "idle";
  const portable = !!st.value?.isPortable && s === "available";
  const hasLatest = !!st.value?.latestVersion;
  const dlFailed = s === "error" && hasLatest; // 检查通过、栽在下载或校验
  const checked = ["up-to-date", "available", "downloading", "downloaded"].includes(s);
  return {
    n1: !checked && !dlFailed && s === "error" ? "fail" : checked || dlFailed ? "done" : "",
    n2: dlFailed ? "fail" : ["available", "downloading"].includes(s) ? "cur" : s === "downloaded" ? "done" : "",
    n3: s === "downloaded" ? "cur" : "",
    n4: portable ? "warn" : "",
    c1: dlFailed ? "link-err" : checked ? "link-on" : "",
    c2: s === "downloaded" ? "link-on" : "",
    c3: portable ? "link-on" : "",
  };
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
        <p class="sub">
          软件自更新走 GitHub Releases：版本检查 → blockmap 增量下载与 SHA-512 校验 → 退出时静默安装。
          <template v-if="st">当前版本 <span class="mono">v{{ st.currentVersion }}</span><span v-if="st.isPortable"> · 便携版</span></template>
        </p>
        <p class="sub" v-if="!st">正在读取更新状态…</p>
      </div>
      <div class="head-actions" v-if="st">
        <button class="btn" :disabled="st.status === 'checking'" @click="doCheck"><i class="ph ph-arrows-clockwise"></i>检查更新</button>
        <button class="btn btn-primary" v-if="st.status === 'available' && !st.isPortable" @click="doDownload"><i class="ph ph-download-simple"></i>下载 v{{ st.latestVersion }}</button>
        <button class="btn btn-primary" v-else-if="st.status === 'downloading'" disabled><i class="ph ph-download-simple"></i>下载中 {{ st.percent }}%</button>
        <button class="btn btn-primary" v-else-if="st.status === 'downloaded'" @click="doInstall"><i class="ph ph-play"></i>立即重启安装</button>
        <button class="btn btn-primary" v-else-if="st.status === 'available' && st.isPortable" @click="openReleasePage()"><i class="ph ph-arrow-square-out"></i>到 Releases 手动下载</button>
        <button class="btn" v-else-if="st.status === 'error'" @click="openReleasePage()"><i class="ph ph-github-logo"></i>打开 Releases</button>
      </div>
    </div>

    <template v-if="st">
      <!-- 面板 A：版本对比 + 状态 + 下载进度 -->
      <section class="panel">
        <div class="cmp-row">
          <div class="cmp-ver">
            <div class="cmp-label">当前版本 <span class="chip-portable" v-if="st.isPortable">便携版</span></div>
            <div class="cmp-num mono">v{{ st.currentVersion }}</div>
          </div>
          <div class="cmp-arrow" :class="{ hot: hasNew }"><i class="ph ph-arrow-right"></i></div>
          <div class="cmp-ver">
            <div class="cmp-label">最新版本 <span class="badge ok">stable</span></div>
            <div class="cmp-num mono" :class="{ new: hasNew }">{{ st.latestVersion ? "v" + st.latestVersion : "—" }}</div>
          </div>
          <div class="cmp-status">
            <template v-if="st.status === 'idle'">
              <span class="badge mute">尚未检查</span>
              <span class="msg">点右上角「检查更新」开始</span>
            </template>
            <template v-else-if="st.status === 'checking'">
              <span class="badge info"><i class="ph ph-arrow-clockwise"></i>正在检查…</span>
            </template>
            <template v-else-if="st.status === 'up-to-date'">
              <span class="badge ok"><i class="ph ph-check-circle"></i>已是最新版本</span>
              <span class="msg">与 GitHub Releases latest 一致，无需操作</span>
            </template>
            <template v-else-if="st.status === 'available' && !st.isPortable">
              <span class="badge warn"><i class="ph ph-sparkle"></i>发现新版本</span>
              <span class="msg">v{{ st.latestVersion }} 已发布，下载后退出时静默安装</span>
            </template>
            <template v-else-if="st.status === 'available'">
              <span class="badge warn"><i class="ph ph-shield-warning"></i>便携版需手动更新</span>
              <span class="msg">便携版不支持自动更新，请手动下载新版 exe</span>
            </template>
            <template v-else-if="st.status === 'downloading'">
              <span class="badge info"><i class="ph ph-download-simple"></i>正在下载…</span>
              <span class="msg">后台下载中，可正常使用软件</span>
            </template>
            <template v-else-if="st.status === 'downloaded'">
              <span class="badge ok"><i class="ph ph-seal-check"></i>新版本已就绪</span>
              <span class="msg">退出应用时自动静默安装并重启</span>
            </template>
            <template v-else>
              <span class="badge bad"><i class="ph ph-x-circle"></i>更新失败</span>
              <span class="msg">{{ st.message || "下载或校验失败，可重试或手动下载" }}</span>
            </template>
          </div>
        </div>

        <template v-if="st.status === 'downloading'">
          <hr class="divider" />
          <div class="pg-head">
            <div class="pg-title"><i class="ph ph-download-simple"></i>正在下载 <span class="mono">v{{ st.latestVersion }}</span></div>
            <div class="pg-pct mono">{{ st.percent }}<small>%</small></div>
          </div>
          <div class="pg-bar"><div class="pg-fill" :style="{ width: st.percent + '%' }"></div></div>
          <div class="pg-note">
            下载范围由 blockmap 增量确定，完整包经 <code>SHA-512</code> 校验通过才会进入安装；
            安装动作由退出钩子 <code>before-quit</code> 接管：退出时静默安装并自动重启。
          </div>
        </template>
      </section>

      <!-- 面板 B：更新流程 -->
      <section class="panel" style="margin-top: 16px">
        <div class="steps-head">
          <h2>更新流程</h2>
          <span class="desc">固定四步：检查 → 下载校验 → 退出安装，第 4 步为失败的兜底路径</span>
        </div>
        <div class="steps">
          <div class="step" :class="stepsState.n1">
            <div class="node">
              <span class="num">1</span>
              <span class="ic"><i class="ph" :class="stepsState.n1 === 'fail' ? 'ph-x' : 'ph-check'"></i></span>
            </div>
            <div class="st-title">版本检查</div>
            <div class="st-desc">GitHub Releases latest 与本地 semver 对比</div>
          </div>
          <div class="step" :class="[stepsState.n2, stepsState.c1]">
            <div class="node">
              <span class="num">2</span>
              <span class="ic"><i class="ph" :class="stepsState.n2 === 'fail' ? 'ph-x' : 'ph-check'"></i></span>
            </div>
            <div class="st-title">下载与校验</div>
            <div class="st-desc">electron-updater 按 blockmap 增量下载并校验</div>
          </div>
          <div class="step" :class="[stepsState.n3, stepsState.c2]">
            <div class="node">
              <span class="num">3</span>
              <span class="ic"><i class="ph ph-check"></i></span>
            </div>
            <div class="st-title">退出安装</div>
            <div class="st-desc">下载完成后退出应用时静默安装并重启</div>
            <div class="wait-chip" v-if="st.status === 'downloaded'">待退出时自动安装</div>
          </div>
          <div class="step st-fallback" :class="[stepsState.n4, stepsState.c3]">
            <div class="node">
              <span class="num">4</span>
              <span class="ic"><i class="ph ph-shield-check"></i></span>
            </div>
            <div class="st-title">失败兜底 <span class="st-sup">兜底</span></div>
            <div class="st-desc">便携版不支持自动更新，提示手动到 GitHub 下载</div>
          </div>
        </div>
      </section>

      <!-- 面板 C：更新日志 / 失败与便携版提示 -->
      <section class="section" v-if="st.notes || st.status === 'error' || (st.isPortable && st.status === 'available')">
        <h2>更新日志</h2>
        <p class="desc">来自 GitHub Releases 正文。</p>
        <div class="panel" v-if="st.notes">
          <div class="cl-head">
            <span class="cl-v mono">v{{ st.latestVersion }}</span>
            <span class="badge ok">stable</span>
          </div>
          <hr class="divider" />
          <div class="cl-item" v-for="(l, i) in notesLines" :key="i" :class="l.startsWith('·') ? 'bullet' : 'group'">
            <i class="ph" :class="l.startsWith('·') ? 'ph-plus-circle' : 'ph-list'"></i>{{ l.startsWith('·') ? l.slice(1).trim() : l }}
          </div>
        </div>
        <div class="note err mt-8" v-if="st.status === 'error'">
          <i class="ph ph-plugs-connected"></i>
          <div>{{ st.message }}。也可直接到 GitHub Releases 手动下载安装包：<a style="cursor: pointer" @click="openReleasePage()">打开 Releases 页</a></div>
        </div>
        <div class="note warn mt-8" v-if="st.isPortable && st.status === 'available'">
          <i class="ph ph-shield-warning"></i>
          <div>便携版不支持自动更新（无安装器、无法静默替换自身）。请到 <a style="cursor: pointer" @click="openReleasePage()">GitHub Releases 页</a> 下载 v{{ st.latestVersion }} 便携版 exe 手动替换。</div>
        </div>
      </section>

      <!-- 底部链接 -->
      <div class="foot-links">
        <button class="btn btn-sm" @click="openReleasePage()"><i class="ph ph-github-logo"></i>GitHub Releases</button>
        <button class="btn btn-sm" @click="openRepoPage()"><i class="ph ph-house"></i>仓库主页</button>
        <span class="foot-hint mono">autoDownload=false · 下载由用户触发 · 安装由 before-quit 钩子接管</span>
      </div>
    </template>
  </div>
</template>
