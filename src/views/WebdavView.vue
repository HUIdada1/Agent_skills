<script setup lang="ts">
// WebDAV 同步：配置服务器 -> 多台电脑之间同步中央仓库。实时进度 + 设备列表 + 报告
import { ref, computed, onMounted, onUnmounted } from "vue";
import {
  loadConfig, saveConfig, webdavTest, webdavSync, webdavCancel, webdavStatus,
  webdavLogs, webdavDevices, listReports, readReport, openReport, onUpdateEvent,
  type AppConfig, type WebDavStatus, type RemoteDevice, type WebDavLog, type ReportRow,
} from "../api/ipc";
import { fmtTime } from "../utils/format";
import { useAppStore } from "../stores/app";

const app = useAppStore();

const status = ref<WebDavStatus | null>(null);
const cfg = ref<AppConfig | null>(null);
const testing = ref(false);
const testMsg = ref("");
const saving = ref(false);
const saveMsg = ref("");
const logs = ref<WebDavLog[]>([]);
const devices = ref<RemoteDevice[]>([]);
const reports = ref<ReportRow[]>([]);
const activeReport = ref("");
const reportContent = ref("");
const lastSummary = ref("");
const newSkills = ref(0); // 本次同步从远端拉到的新技能数，提示去同步中心分发

// 存储预设：选中预填服务器地址（其余项用户自己改）
const PRESETS = [
  { id: "custom", label: "自定义", endpoint: "" },
  { id: "jianguoyun", label: "坚果云", endpoint: "https://dav.jianguoyun.com/dav" },
  { id: "nextcloud", label: "Nextcloud", endpoint: "https://" },
  { id: "synology", label: "群晖", endpoint: "http://:5005" },
  { id: "fnos", label: "飞牛 fnOS", endpoint: "http://:5005" },
];

const running = computed(() => !!status.value?.running);
const configured = computed(() => !!status.value?.configured);

const STAGES = [
  { key: "connect", label: "连接", desc: "检查远端可达" },
  { key: "pull", label: "拉取", desc: "远端台账与 diff" },
  { key: "download", label: "下载", desc: "远端新技能落库" },
  { key: "upload", label: "上传", desc: "本机变更推送" },
  { key: "push", label: "推送", desc: "合并台账回写" },
  { key: "done", label: "完成", desc: "报告与快照" },
];
const STAGE_ORDER = ["connect", "pull", "download", "upload", "push", "done"];

function stageIndex(stage: string): number {
  const i = STAGE_ORDER.indexOf(stage);
  return i < 0 ? -1 : i;
}
function stageDone(key: string): boolean {
  if (!status.value) return false;
  const cur = stageIndex(status.value.stage);
  const me = STAGE_ORDER.indexOf(key);
  if (status.value.stage === "error" || status.value.stage === "cancelled") return cur > me;
  return cur > me || (status.value.stage === "done" && me <= STAGE_ORDER.length - 1);
}
function stageActive(key: string): boolean {
  if (!status.value?.running) return false;
  return status.value.stage === key;
}

async function refreshStatus() {
  status.value = await webdavStatus();
}
async function refreshLogs() {
  logs.value = (await webdavLogs()) || [];
}
async function refreshDevices() {
  const r = await webdavDevices();
  devices.value = r?.devices || [];
}

async function testConn() {
  testMsg.value = "";
  testing.value = true;
  try {
    // 表单里可能还没保存过，用当前表单值测试（掩码密码由主进程回填）
    const r = await webdavTest(cfg.value || undefined);
    testMsg.value = r ? `${r.ok ? "✓ " : "✗ "}${r.message}` : "未检测到后端，请通过 Electron 应用打开";
  } catch (e) {
    testMsg.value = String((e as Error).message || e);
  } finally {
    testing.value = false;
  }
}

async function save() {
  if (!cfg.value) return;
  saveMsg.value = "";
  saving.value = true;
  try {
    const r = await saveConfig(cfg.value);
    saveMsg.value = r?.ok ? "已保存" : r?.message || "保存失败";
    await refreshStatus();
  } catch (e) {
    saveMsg.value = String((e as Error).message || e);
  } finally {
    saving.value = false;
  }
}

async function startSync() {
  const r = await webdavSync();
  if (r && !r.ok) saveMsg.value = r.message || "启动失败";
  else await refreshStatus();
}

async function cancelSync() {
  await webdavCancel();
}

function applyPreset(id: string) {
  if (!cfg.value) return;
  cfg.value.webdav.preset = id;
  const p = PRESETS.find((x) => x.id === id);
  if (p && p.endpoint) cfg.value.webdav.endpoint = p.endpoint;
}

async function openReportFile(file: string) {
  activeReport.value = file;
  const r = await readReport(file);
  reportContent.value = r?.content || "";
}

// 同步进度走主进程广播（event:"webdav"）；结束（done/error/cancelled running=false）时刷新全部数据
let unsub: (() => void) | undefined;
onMounted(async () => {
  cfg.value = await loadConfig();
  await refreshStatus();
  await refreshLogs();
  if (configured.value) await refreshDevices();
  const all = (await listReports()) || [];
  reports.value = all.filter((r) => r.file.startsWith("webdav-"));
  unsub = onUpdateEvent((payload) => {
    const p = payload as { event?: string; stage?: string; detail?: string; running?: boolean };
    if (!p || p.event !== "webdav") return;
    if (status.value) {
      status.value.stage = (p.stage as WebDavStatus["stage"]) || status.value.stage;
      status.value.detail = p.detail || "";
      status.value.running = !!p.running;
    }
    if (!p.running) {
      // 一轮同步结束：拉结果、日志、设备与报告
      refreshStatus().then(() => {
        const st = status.value;
        if (st && st.stage === "done") {
          lastSummary.value = st.detail;
          const m = st.detail.match(/下载 (\d+)/);
          newSkills.value = m ? parseInt(m[1], 10) : 0;
        }
      });
      refreshLogs();
      refreshDevices();
      listReports().then((all) => {
        reports.value = (all || []).filter((r) => r.file.startsWith("webdav-"));
      });
    }
  });
});
onUnmounted(() => {
  if (unsub) unsub();
});
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>WebDAV 同步</h1>
        <p class="sub">把中央仓库同步到你的 WebDAV 网盘（坚果云 / Nextcloud / 群晖…），多台电脑各自拉取合并，双向增删全记录，冲突由你裁决。</p>
      </div>
      <div class="head-actions">
        <span class="badge" :class="running ? 'info' : configured ? 'ok' : 'mute'" style="align-self:center">
          <i class="ph" :class="running ? 'ph-circle-notch' : configured ? 'ph-cloud-check' : 'ph-cloud-slash'"></i>
          {{ running ? (status?.stageLabel || "同步中") : configured ? "已连接就绪" : "未配置" }}
        </span>
        <button class="btn" :disabled="!running" @click="cancelSync"><i class="ph ph-x"></i>取消</button>
        <button class="btn btn-primary" :disabled="running" @click="startSync"><i class="ph ph-cloud-arrow-up"></i>{{ running ? "同步中…" : "立即同步" }}</button>
      </div>
    </div>

    <div class="note warn mt-8" v-if="status && status.stage === 'error'"><i class="ph ph-warning"></i><div>上次同步失败：{{ status.lastError }}</div></div>
    <div class="note ok mt-8" v-if="lastSummary"><i class="ph ph-check-circle"></i><div>同步完成：{{ lastSummary }}<template v-if="newSkills">，<a href="#" @click.prevent="app.go('sync')">去同步中心分发到工具 →</a></template></div></div>

    <!-- 连接设置 -->
    <div class="section" v-if="cfg">
      <h2>连接设置</h2>
      <p class="desc">密码经系统密钥加密保存，界面上只显示掩码；换电脑后重新填一次即可。</p>
      <div class="panel">
        <div class="field">
          <label>存储预设</label>
          <div class="chips">
            <span class="chip" v-for="p in PRESETS" :key="p.id" :class="{ on: cfg?.webdav.preset === p.id }" @click="applyPreset(p.id)">{{ p.label }}</span>
          </div>
        </div>
        <div class="grid grid-2">
          <div class="field">
            <label>服务器地址（WebDAV）</label>
            <input class="input" v-model="cfg!.webdav.endpoint" placeholder="https://dav.jianguoyun.com/dav" />
          </div>
          <div class="field">
            <label>根目录</label>
            <input class="input mono" v-model="cfg!.webdav.root" placeholder="/agent-skills" />
          </div>
          <div class="field">
            <label>账号</label>
            <input class="input" v-model="cfg!.webdav.username" autocomplete="off" />
          </div>
          <div class="field">
            <label>应用密码</label>
            <input class="input" type="password" v-model="cfg!.webdav.password" autocomplete="new-password" placeholder="••••••••" />
          </div>
          <div class="field">
            <label>本机名称（多设备列表里显示）</label>
            <input class="input" v-model="cfg!.webdav.deviceName" :placeholder="status?.deviceName || '这台电脑'" />
          </div>
          <div class="field" v-if="status?.deviceId">
            <label>本机设备 ID</label>
            <input class="input mono" :value="status.deviceId" disabled />
          </div>
        </div>
        <div class="row mt-16" style="gap:10px">
          <button class="btn" :disabled="testing || running" @click="testConn"><i class="ph ph-plug"></i>{{ testing ? "测试中…" : "测试连接" }}</button>
          <button class="btn btn-primary" :disabled="saving" @click="save"><i class="ph ph-floppy-disk"></i>{{ saving ? "保存中…" : "保存设置" }}</button>
          <span class="muted small" style="align-self:center" v-if="testMsg">{{ testMsg }}</span>
          <span class="muted small" style="align-self:center" v-else-if="saveMsg">{{ saveMsg }}</span>
        </div>
      </div>
    </div>

    <!-- 同步进度 -->
    <div class="section">
      <h2>同步进度</h2>
      <p class="desc">一次同步 = 拉取远端台账、下载别人的更新、推送本机变更、合并台账回写。全部动作都有报告可查。</p>
      <div class="panel">
        <div class="steps">
          <div class="step" v-for="s in STAGES" :key="s.key" :class="{ done: stageDone(s.key) }">
            <div class="st-num"><i class="ph" :class="stageActive(s.key) ? 'ph-circle-notch' : 'ph-check'" v-if="stageDone(s.key) || stageActive(s.key)"></i><template v-else>{{ STAGES.indexOf(s) + 1 }}</template></div>
            <div class="st-title">{{ s.label }}</div>
            <div class="st-desc">{{ s.desc }}</div>
          </div>
        </div>
        <div class="row-between mt-16">
          <span class="muted small">{{ running ? status?.detail || "进行中…" : status?.detail || (status?.lastSyncAt ? `上次同步 ${fmtTime(status.lastSyncAt)}` : "还没有同步过") }}</span>
          <span class="badge mute mono small" v-if="status?.lastSyncAt">上次 {{ fmtTime(status.lastSyncAt) }}</span>
        </div>
        <template v-if="logs.length">
          <hr class="divider" />
          <div class="code" style="max-height:180px; overflow-y:auto; white-space:pre-wrap">{{ logs.map((l) => l.text).join("\n") }}</div>
        </template>
      </div>
    </div>

    <!-- 设备列表 -->
    <div class="section" v-if="devices.length">
      <h2>已注册设备</h2>
      <p class="desc">在同一 WebDAV 根目录下同步过的电脑。每台写自己的设备档案，互不覆盖。</p>
      <div class="panel" style="padding:6px 8px; overflow-x:auto">
        <table class="table">
          <thead><tr><th>设备</th><th>软件版本</th><th>最后同步</th><th></th></tr></thead>
          <tbody>
            <tr v-for="d in devices" :key="d.id">
              <td class="strong">{{ d.name }} <span class="badge ok" v-if="d.self">本机</span></td>
              <td class="mono">{{ d.appVersion || "—" }}</td>
              <td>{{ fmtTime(d.lastSyncAt) }}</td>
              <td class="mono muted small">{{ d.id.slice(0, 8) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <details class="fold" v-if="reports.length">
      <summary>同步报告（{{ reports.length }} 份）</summary>
      <div class="chips" style="margin:8px 0 12px">
        <span class="chip" v-for="r in reports.slice(0, 8)" :key="r.file" :class="{ on: activeReport === r.file }" @click="openReportFile(r.file)">
          <i class="ph ph-file-text"></i> {{ fmtTime(r.mtimeMs) }}
        </span>
      </div>
      <div class="code" v-if="reportContent">{{ reportContent }}</div>
      <div class="row mt-16" style="gap:10px" v-if="activeReport">
        <button class="btn btn-sm" @click="openReport(activeReport)"><i class="ph ph-folder-open"></i>打开 reports 目录</button>
      </div>
    </details>
  </div>
</template>
