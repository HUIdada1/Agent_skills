<script setup lang="ts">
// WebDAV 同步：配置服务器 -> 多台电脑之间同步中央仓库。实时进度 + 设备列表 + 报告
import { ref, computed, watch, nextTick, onMounted, onUnmounted, onActivated } from "vue";
import {
  loadConfig, saveConfig, webdavTest, webdavSync, webdavCancel, webdavStatus,
  webdavLogs, webdavDevices, listReports, readReport, openReport, onUpdateEvent,
  type AppConfig, type WebDavStatus, type RemoteDevice, type WebDavLog, type ReportRow, type WebDavEvent,
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

const running = computed(() => !!status.value?.running);
const configured = computed(() => !!status.value?.configured);

// ===== 同步进度：百分比 + 步骤状态 + 简要日志 =====

const pct = computed(() => {
  const st = status.value;
  if (!st) return 0;
  if (st.stage === "done") return 100;
  return Math.min(100, Math.max(0, Math.round(st.pct ?? 0)));
});

const progressStatus = computed<"success" | "exception" | "warning" | undefined>(() => {
  const s = status.value?.stage;
  if (s === "error") return "exception";
  if (s === "cancelled") return "warning";
  if (s === "done") return "success";
  return undefined;
});

// 六阶段步骤条；出错/取消时隐藏步骤条，只留异常色进度条与日志
const STEPS = [
  { key: "connect", title: "连接" },
  { key: "pull", title: "拉取" },
  { key: "download", title: "下载" },
  { key: "upload", title: "上传" },
  { key: "push", title: "推送" },
  { key: "done", title: "完成" },
];
const stepActive = computed(() => {
  const i = STEPS.findIndex((s) => s.key === status.value?.stage);
  return i < 0 ? 0 : i; // idle/未知阶段回 0（全部待命），不能回落到末步造成"假完成"
});
const showSteps = computed(() => {
  const s = status.value?.stage;
  return running.value || s === "done"; // idle/未配置时不显示，避免看起来像"已跑完一轮"
});

// 运行中标签显示当前阶段名；事件广播只带 stage 不带 label，前端自己映射
const runningStageLabel = computed(() => STEPS.find((s) => s.key === status.value?.stage)?.title || "同步中");

const progressHint = computed(() => {
  const st = status.value;
  if (!st) return "还没有同步过";
  if (st.stage === "error") return `上次同步失败：${st.lastError}`;
  if (st.stage === "cancelled") return "上次同步已取消";
  if (st.stage === "done") return `同步完成：${st.detail}`;
  return st.lastSyncAt ? `上次同步 ${fmtTime(st.lastSyncAt)}` : "还没有同步过";
});

// 日志按内容着级：失败红 / 冲突黄 / 计划与完成绿
function logLevel(text: string): string {
  if (/失败|错误|error/i.test(text)) return "bad";
  if (/冲突/.test(text)) return "warn";
  if (/计划|完成|已入队/.test(text)) return "ok";
  return "";
}
function fmtClock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("zh-CN", { hour12: false });
  } catch {
    return "";
  }
}

const logBox = ref<HTMLElement | null>(null);
watch(() => logs.value.length, async () => {
  await nextTick();
  logBox.value?.scrollTo({ top: logBox.value.scrollHeight });
});

// 后台刷新拉不到就保留旧值，别把页面已有状态冲掉
async function refreshStatus() {
  try {
    status.value = await webdavStatus();
  } catch { /* 保留旧值 */ }
}
async function refreshLogs() {
  try {
    logs.value = (await webdavLogs()) || [];
  } catch { /* 保留旧值 */ }
}
async function refreshDevices() {
  try {
    const r = await webdavDevices();
    devices.value = r?.devices || [];
  } catch { /* 保留旧值 */ }
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
  try {
    const r = await webdavSync();
    if (r && !r.ok) saveMsg.value = r.message || "启动失败";
    else await refreshStatus();
  } catch (e) {
    saveMsg.value = String((e as Error).message || e);
  }
}

async function cancelSync() {
  await webdavCancel().catch(() => {});
}

async function openReportFile(file: string) {
  activeReport.value = file;
  try {
    const r = await readReport(file);
    reportContent.value = r?.content || "";
  } catch {
    reportContent.value = "";
  }
}

// 同步进度走主进程广播（event:"webdav"）；运行中日志实时长出来；
// 结束（done/error/cancelled running=false）时刷新全部数据
let unsub: (() => void) | undefined;
// KeepAlive 下每次切回本页都重新拉磁盘配置与状态，避免设置页与本页的快照互相回滚
onActivated(async () => {
  try {
    cfg.value = await loadConfig();
  } catch { /* 后端没起来就先不填表单 */ }
  await refreshStatus();
  await refreshLogs();
  if (configured.value) await refreshDevices();
  const all = (await listReports().catch(() => [])) || [];
  reports.value = all.filter((r) => r.file.startsWith("webdav-"));
});
// 事件订阅只挂一次
onMounted(() => {
  unsub = onUpdateEvent((payload) => {
    const p = payload as WebDavEvent;
    if (!p || p.event !== "webdav") return;
    if (status.value) {
      status.value.stage = (p.stage as WebDavStatus["stage"]) || status.value.stage;
      status.value.detail = p.detail || "";
      status.value.pct = p.pct ?? status.value.pct;
      status.value.running = !!p.running;
    }
    if (p.running) {
      refreshLogs();
    } else {
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
      }).catch(() => {});
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
        <el-tag :type="running ? 'primary' : configured ? 'success' : 'info'" effect="plain" round style="align-self:center">
          <i class="ph" :class="running ? 'ph-circle-notch' : configured ? 'ph-cloud-check' : 'ph-cloud-slash'"></i>
          {{ running ? runningStageLabel : configured ? "已连接就绪" : "未配置" }}
        </el-tag>
        <el-button :disabled="!running" @click="cancelSync"><i class="ph ph-x"></i>取消</el-button>
        <el-button type="primary" :loading="running" @click="startSync">{{ running ? "同步中…" : "立即同步" }}</el-button>
      </div>
    </div>

    <div class="note warn mt-8" v-if="status && status.stage === 'error'"><i class="ph ph-warning"></i><div>上次同步失败：{{ status.lastError }}</div></div>
    <div class="note ok mt-8" v-if="lastSummary"><i class="ph ph-check-circle"></i><div>同步完成：{{ lastSummary }}<template v-if="newSkills">，<a href="#" @click.prevent="app.go('sync')">去同步中心分发到工具 →</a></template></div></div>

    <!-- 同步进度 -->
    <div class="section">
      <h2>同步进度</h2>
      <p class="desc">一次同步 = 拉取远端台账、下载别人的更新、推送本机变更、合并台账回写。全部动作都有报告可查。</p>
      <div class="panel">
        <el-steps v-if="showSteps" :active="stepActive" align-center finish-status="success" class="sync-steps">
          <el-step v-for="s in STEPS" :key="s.key" :title="s.title" />
        </el-steps>

        <el-progress
          :percentage="pct"
          :status="progressStatus"
          :stroke-width="10"
          :striped="running"
          :striped-flow="running"
          :duration="16"
        />

        <div class="row-between mt-12">
          <span class="muted small" :class="{ 'is-running': running }">{{ running ? status?.detail || "进行中…" : progressHint }}</span>
          <span class="badge mute mono small" v-if="status?.lastSyncAt">上次 {{ fmtTime(status.lastSyncAt) }}</span>
        </div>

        <hr class="divider" />
        <div class="log-head">
          <span class="log-title"><i class="ph ph-list-dashes"></i>简要日志</span>
          <span class="muted small" v-if="logs.length">{{ logs.length }} 条</span>
        </div>
        <div class="log-list" ref="logBox">
          <div v-if="!logs.length" class="log-empty">还没有日志，点「立即同步」开始一轮同步。</div>
          <div v-for="(l, i) in logs" :key="i" class="log-line" :class="logLevel(l.text)">
            <span class="log-time">{{ fmtClock(l.at) }}</span>
            <span class="log-text">{{ l.text }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 连接设置 -->
    <div class="section" v-if="cfg">
      <h2>连接设置</h2>
      <p class="desc">密码经系统密钥加密保存，界面上只显示掩码；换电脑后重新填一次即可。</p>
      <div class="panel">
        <div class="grid grid-2">
          <div class="field">
            <label>服务器地址（WebDAV）</label>
            <el-input v-model="cfg!.webdav.endpoint" placeholder="https://dav.jianguoyun.com/dav" />
          </div>
          <div class="field">
            <label>根目录</label>
            <el-input v-model="cfg!.webdav.root" placeholder="/agent-skills" class="mono-in" />
          </div>
          <div class="field">
            <label>账号</label>
            <el-input v-model="cfg!.webdav.username" autocomplete="off" />
          </div>
          <div class="field">
            <label>应用密码</label>
            <el-input type="password" v-model="cfg!.webdav.password" show-password autocomplete="new-password" placeholder="••••••••" />
          </div>
          <div class="field">
            <label>本机名称（多设备列表里显示）</label>
            <el-input v-model="cfg!.webdav.deviceName" :placeholder="status?.deviceName || '这台电脑'" />
          </div>
          <div class="field" v-if="status?.deviceId">
            <label>本机设备 ID</label>
            <el-input :model-value="status.deviceId" disabled class="mono-in" />
          </div>
        </div>
        <div class="row" style="gap:10px">
          <el-button :loading="testing" :disabled="running" @click="testConn">{{ testing ? "测试中…" : "测试连接" }}</el-button>
          <el-button type="primary" :loading="saving" @click="save">保存设置</el-button>
          <span class="muted small" style="align-self:center" v-if="testMsg">{{ testMsg }}</span>
          <span class="muted small" style="align-self:center" v-else-if="saveMsg">{{ saveMsg }}</span>
        </div>
      </div>
    </div>

    <!-- 设备列表 -->
    <div class="section" v-if="devices.length">
      <h2>已注册设备</h2>
      <p class="desc">在同一 WebDAV 根目录下同步过的电脑。每台写自己的设备档案，互不覆盖。</p>
      <div class="panel" style="padding:6px 8px; overflow-x:auto">
        <table class="table">
          <thead><tr><th>设备</th><th>软件版本</th><th>最后同步</th><th style="text-align:right">设备 ID</th></tr></thead>
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
        <el-button size="small" @click="openReport(activeReport)"><i class="ph ph-folder-open"></i>打开 reports 目录</el-button>
      </div>
    </details>
  </div>
</template>

<style scoped>
.mt-12 { margin-top: 12px; }

/* 步骤条与进度条之间留出呼吸空间（标题文字略溢出容器，靠这个 margin 隔开） */
.sync-steps { margin-bottom: 22px; }

/* 运行中的 detail 文字给一点呼吸感 */
.is-running { color: var(--accent); }

/* 简要日志 */
.log-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.log-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-2);
}
.log-list {
  background: var(--code-bg);
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  padding: 10px 14px;
  height: 200px;
  overflow-y: auto;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.9;
}
.log-line {
  display: flex;
  gap: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}
.log-time { flex: none; color: var(--text-3); }
.log-text { color: var(--code-text); }
.log-line.bad .log-text { color: var(--danger); }
.log-line.warn .log-text { color: var(--warn); }
.log-line.ok .log-text { color: var(--accent); }
.log-empty {
  color: var(--text-3);
  text-align: center;
  padding: 66px 0;
  font-family: var(--font-body);
}

/* 根目录 / 设备 ID 用等宽字体 */
.mono-in :deep(.el-input__inner) { font-family: var(--font-mono); font-size: 12px; }
</style>
