<script setup lang="ts">
// 同步中心：干跑预览 -> 确认执行 -> 看报告
import { ref, computed, onMounted } from "vue";
import { syncPlan, syncExecute, listReports, readReport, openReport, type SyncPlan, type SyncResult, type ReportRow } from "../api/ipc";
import { fmtTime } from "../utils/format";
import { useAppStore } from "../stores/app";

const app = useAppStore();
const plan = ref<SyncPlan | null>(null);
const result = ref<SyncResult | null>(null);
const executing = ref(false);
const errMsg = ref("");
const reportContent = ref("");
const reports = ref<ReportRow[]>([]);
const activeReport = ref("");

const STATS = [
  { key: "import", label: "收纳 Import", cls: "accent", hint: "工具目录有、中央仓库没有" },
  { key: "replace", label: "转挂载 Mount", cls: "accent", hint: "同内容目录原位转 Junction（先备份）" },
  { key: "publish", label: "发布 Publish", cls: "accent", hint: "中央仓库有、工具目录缺失" },
  { key: "conflict", label: "冲突 Conflict", cls: "warn", hint: "同名但内容哈希不同" },
  { key: "skip", label: "健康 Skip", cls: "", hint: "挂载有效，无需动作" },
] as const;

const counts = computed(() => {
  const c: Record<string, number> = { import: 0, replace: 0, publish: 0, conflict: 0, skip: 0, error: 0 };
  if (!plan.value) return c;
  for (const a of plan.value.actions) {
    if (a.type === "import") c.import++;
    else if (a.type === "mount") (a.replaceReal ? c.replace++ : c.publish++);
    else if (a.type === "skip") c.skip++;
    else if (a.type === "error") c.error++;
  }
  c.conflict = plan.value.conflicts.length;
  return c;
});

type Row = { skill: string; kind: "import" | "mount" | "publish" | "conflict" | "skip" | "error"; source: string; detail: string; conflictId?: string };

const rows = computed<Row[]>(() => {
  if (!plan.value) return [];
  const out: Row[] = [];
  for (const a of plan.value.actions) {
    if (a.type === "import") {
      out.push({ skill: a.skill, kind: "import", source: (a.sources || []).map((s) => s.tool).join(" + "), detail: a.note });
    } else if (a.type === "mount") {
      out.push({ skill: `${a.mountName || a.skill} @ ${a.toolId || ""}`, kind: a.replaceReal ? "mount" : "publish", source: "hub", detail: a.note });
    } else if (a.type === "skip") {
      out.push({ skill: a.skill, kind: "skip", source: a.dir || "", detail: a.note });
    } else if (a.type === "error") {
      out.push({ skill: a.skill, kind: "error", source: "hub", detail: a.note });
    }
  }
  for (const c of plan.value.conflicts) {
    out.push({ skill: c.skill || c.title, kind: "conflict", source: c.toolId || "", detail: c.detail, conflictId: c.id });
  }
  return out;
});

const KIND_BADGE: Record<Row["kind"], { cls: string; icon: string; text: string }> = {
  import: { cls: "ok", icon: "ph-download-simple", text: "收纳" },
  mount: { cls: "ok", icon: "ph-link", text: "转挂载" },
  publish: { cls: "info", icon: "ph-upload-simple", text: "发布" },
  conflict: { cls: "warn", icon: "ph-git-merge", text: "冲突" },
  skip: { cls: "mute", icon: "ph-check", text: "健康" },
  error: { cls: "bad", icon: "ph-warning-octagon", text: "异常" },
};

async function scan() {
  errMsg.value = "";
  result.value = null;
  reportContent.value = "";
  try {
    plan.value = await syncPlan();
    if (!plan.value) errMsg.value = "未检测到后端，请通过 Electron 应用打开";
  } catch (e) {
    errMsg.value = String((e as Error).message || e);
  }
}

async function execute() {
  if (!plan.value) return;
  if (!confirm(`确认执行同步吗？\n收纳 ${counts.value.import} · 转挂载 ${counts.value.replace} · 发布 ${counts.value.publish} · 冲突 ${counts.value.conflict} 条进入人工裁决。\n所有覆盖/删除先进入回收站。`)) return;
  executing.value = true;
  try {
    result.value = await syncExecute(plan.value);
    plan.value = null;
    reports.value = (await listReports()) || [];
    if (result.value?.reportFile) {
      const name = result.value.reportFile.replace(/\\/g, "/").split("/").pop() || "";
      activeReport.value = name;
      const r = await readReport(name);
      reportContent.value = r?.content || "";
    }
  } catch (e) {
    errMsg.value = String((e as Error).message || e);
  } finally {
    executing.value = false;
  }
}

async function openReportFile(file: string) {
  activeReport.value = file;
  const r = await readReport(file);
  reportContent.value = r?.content || "";
}

onMounted(async () => {
  await scan();
  reports.value = (await listReports()) || [];
});
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>同步中心</h1>
        <p class="sub">先扫描预览，确认无误后执行。每一次同步都会产出 Markdown 报告存入 <span class="mono">reports\</span>。</p>
      </div>
      <div class="head-actions">
        <span class="badge info" style="align-self:center" v-if="plan"><i class="ph ph-eye"></i>当前为干跑预览</span>
        <span class="badge ok" style="align-self:center" v-else-if="result"><i class="ph ph-check-circle"></i>已执行</span>
        <button class="btn" @click="scan"><i class="ph ph-arrows-counter-clockwise"></i>重新扫描</button>
        <button class="btn btn-primary" :disabled="!plan || executing" @click="execute"><i class="ph ph-play"></i>{{ executing ? "执行中…" : "执行同步" }}</button>
      </div>
    </div>

    <div class="note warn mt-8" v-if="errMsg"><i class="ph ph-warning"></i><div>{{ errMsg }}</div></div>

    <div class="grid grid-4" v-if="plan">
      <div class="panel stat">
        <div class="label">收纳 Import</div>
        <div class="num accent">{{ counts.import }}</div>
        <div class="hint">工具目录有、中央仓库没有</div>
      </div>
      <div class="panel stat">
        <div class="label">挂载变更</div>
        <div class="num accent">{{ counts.replace + counts.publish }}</div>
        <div class="hint">转挂载 {{ counts.replace }} · 发布 {{ counts.publish }}</div>
      </div>
      <div class="panel stat">
        <div class="label">冲突 Conflict</div>
        <div class="num" :class="counts.conflict ? 'warn' : ''">{{ counts.conflict }}</div>
        <div class="hint">同名异容，等待人工裁决</div>
      </div>
      <div class="panel stat">
        <div class="label">健康 Skip</div>
        <div class="num">{{ counts.skip }}</div>
        <div class="hint">挂载有效，无需动作</div>
      </div>
    </div>

    <div class="section" v-if="plan">
      <h2>同步动作预览</h2>
      <p class="desc">扫描各工具目录与中央仓库得到的差异清单（{{ plan.mode === "copy" ? "复制模式" : "Junction 模式" }}）。</p>
      <div class="panel" style="padding: 6px 8px; overflow-x:auto" v-if="rows.length">
        <table class="table">
          <thead>
            <tr><th>技能</th><th>动作</th><th>来源</th><th>说明</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in rows" :key="i">
              <td class="strong">{{ r.skill }}</td>
              <td><span class="badge" :class="KIND_BADGE[r.kind].cls"><i class="ph" :class="KIND_BADGE[r.kind].icon"></i>{{ KIND_BADGE[r.kind].text }}</span></td>
              <td class="mono">{{ r.source }}</td>
              <td class="muted small">{{ r.detail }}</td>
              <td><button class="btn btn-sm" v-if="r.kind === 'conflict'" @click="app.go('dedup')">去裁决</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="panel" v-else>
        <div class="empty-state">
          <i class="ph ph-check-circle" style="color:var(--accent)"></i>
          <div class="es-title">全部就绪，没有需要执行的动作</div>
          <div class="es-desc">各工具与中央仓库内容一致，Junction 全部有效。</div>
        </div>
      </div>
      <p class="muted small mt-8" v-if="plan.orphans.length">另有 {{ plan.orphans.length }} 个陌生孤儿目录仅标记（{{ plan.orphans.slice(0, 3).map((o) => o.name).join("、") }}{{ plan.orphans.length > 3 ? " 等" : "" }}），不会自动删除。</p>
    </div>

    <div class="section" v-if="result">
      <h2>执行结果</h2>
      <div class="grid grid-4">
        <div class="panel stat"><div class="label">收纳</div><div class="num accent">{{ result.summary.imported }}</div></div>
        <div class="panel stat"><div class="label">挂载变更</div><div class="num">{{ result.summary.mounted }}</div></div>
        <div class="panel stat"><div class="label">合并重复</div><div class="num">{{ result.summary.merged }}</div></div>
        <div class="panel stat"><div class="label">冲突</div><div class="num" :class="result.summary.conflicts ? 'warn' : ''">{{ result.summary.conflicts }}</div></div>
      </div>
    </div>

    <div class="section" v-if="reportContent || reports.length">
      <h2>MD 同步报告</h2>
      <p class="desc">同步完成后自动写入的报告。所有同步记录可追溯、可粘贴到笔记或 Issue。</p>
      <div class="chips" style="margin-bottom:12px" v-if="reports.length">
        <span class="chip" v-for="r in reports.slice(0, 8)" :key="r.file" :class="{ on: activeReport === r.file }" @click="openReportFile(r.file)">
          <i class="ph ph-file-text"></i> {{ fmtTime(r.mtimeMs) }}
        </span>
      </div>
      <div class="code" v-if="reportContent">{{ reportContent }}</div>
      <div class="row mt-16" style="gap:10px" v-if="activeReport">
        <button class="btn btn-sm" @click="openReport(activeReport)"><i class="ph ph-folder-open"></i>打开 reports 目录</button>
      </div>
    </div>
  </div>
</template>
