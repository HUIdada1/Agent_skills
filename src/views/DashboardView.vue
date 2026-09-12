<script setup lang="ts">
// 仪表盘：中央仓库统计 / 工具连接 / 最近同步 / 待办事项（对应设计图 dashboard.html）
import { ref, onMounted } from "vue";
import { getOverview, type Overview } from "../api/ipc";
import { useAppStore } from "../stores/app";
import { fmtTime } from "../utils/format";

const app = useAppStore();
const data = ref<Overview | null>(null);
const loading = ref(true);
const errMsg = ref("");

const TOOL_ICONS: Record<string, string> = {
  zcode: "ph-terminal-window",
  codex: "ph-command",
  claude: "ph-sparkle",
  antigravity: "ph-airplane-tilt",
  agents: "ph-package",
  custom: "ph-folder-open",
};

function toolIcon(id: string) {
  return TOOL_ICONS[id] || "ph-folder-open";
}

function mountOkCount(toolId: string, o: Overview) {
  return o.mountHealth.filter((m) => m.tool === toolId && m.valid).length;
}

function mountBroken(o: Overview) {
  return o.mountHealth.filter((m) => !m.valid);
}

function pendingCount(o: Overview): number {
  return o.pendingConflicts.length + o.orphans.length;
}

async function load() {
  loading.value = true;
  errMsg.value = "";
  try {
    data.value = await getOverview();
    if (!data.value) errMsg.value = "未检测到后端（浏览器预览模式），请通过 Electron 应用打开";
  } catch (e) {
    errMsg.value = String((e as Error).message || e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>仪表盘</h1>
        <p class="sub" v-if="data">中央仓库位于 <span class="mono">{{ data.hubDir }}</span>。同步仅手动触发，所有写入经回收站兜底。</p>
        <p class="sub" v-else>正在读取中央仓库状态…</p>
      </div>
      <div class="head-actions">
        <button class="btn" @click="app.go('sync')"><i class="ph ph-arrows-left-right"></i>去同步</button>
        <button class="btn btn-primary" :disabled="loading" @click="load"><i class="ph ph-lightning"></i>{{ loading ? "读取中" : "刷新" }}</button>
      </div>
    </div>

    <div class="note warn mt-8" v-if="errMsg"><i class="ph ph-warning"></i><div>{{ errMsg }}</div></div>

    <template v-if="data">
      <div class="grid grid-4">
        <div class="panel stat">
          <div class="label">中央技能库</div>
          <div class="num accent">{{ data.manifestCount || data.skillCount }}<small>个技能</small></div>
          <div class="hint">来自 {{ data.sourceCount }} 份原始副本的去重结果</div>
        </div>
        <div class="panel stat">
          <div class="label">去重消除</div>
          <div class="num">{{ data.l1Merged }}<small>份重复</small></div>
          <div class="hint">L1 内容树哈希精确命中</div>
        </div>
        <div class="panel stat">
          <div class="label">已连接工具</div>
          <div class="num">{{ data.tools.length }}<small>个目录</small></div>
          <div class="hint">Junction 按技能粒度挂载共用</div>
        </div>
        <div class="panel stat">
          <div class="label">待处理</div>
          <div class="num" :class="pendingCount(data) ? 'warn' : 'accent'">{{ pendingCount(data) }}<small>项</small></div>
          <div class="hint">{{ data.pendingConflicts.length }} 个冲突 + {{ data.orphans.length }} 个孤儿目录</div>
        </div>
      </div>

      <div class="section">
        <h2>工具连接</h2>
        <p class="desc">每个工具的全局技能目录。括号内为该目录当前可见的技能数，含 Junction 指入。</p>
        <div class="panel" style="padding: 6px 18px;">
          <div class="tool-row" v-for="t in data.tools" :key="t.id">
            <div class="tool-icon"><i class="ph" :class="toolIcon(t.id)"></i></div>
            <div class="t-main">
              <div class="t-name">{{ t.name }}</div>
              <div class="t-path">{{ t.dir }}</div>
            </div>
            <span class="t-count">{{ t.skillCount }}</span>
            <span class="badge ok" v-if="mountOkCount(t.id, data) > 0"><i class="ph ph-check-circle"></i>已挂载 {{ mountOkCount(t.id, data) }}</span>
            <span class="badge mute" v-else><i class="ph ph-minus-circle"></i>未挂载</span>
          </div>
          <div class="tool-row" v-if="!data.tools.length">
            <div class="t-main">
              <div class="t-name muted">未发现任何工具技能目录</div>
              <div class="t-path">可在设置中添加候选路径或自定义目录</div>
            </div>
          </div>
        </div>
        <div class="mt-16" v-if="mountBroken(data).length">
          <div class="note warn">
            <i class="ph ph-warning"></i>
            <div>发现 {{ mountBroken(data).length }} 个失效挂载（{{ mountBroken(data).slice(0, 3).map((m) => m.skill + "@" + m.tool).join("、") }}{{ mountBroken(data).length > 3 ? " 等" : "" }}），可在技能库一键重建。</div>
          </div>
        </div>
      </div>

      <div class="grid grid-2 section">
        <div>
          <h2>最近同步</h2>
          <p class="desc">每次同步都会在 <span class="mono">reports\</span> 生成 MD 报告。</p>
          <div class="panel timeline" v-if="data.recentReports.length">
            <div class="tl-row" v-for="r in data.recentReports" :key="r.file">
              <span class="tl-time">{{ fmtTime(r.mtimeMs) }}</span>
              <div class="tl-main">
                <div class="tl-title">同步 <span class="badge ok">完成</span></div>
                <div class="tl-desc">{{ r.file }}</div>
              </div>
              <button class="btn btn-sm" @click="app.go('sync')"><i class="ph ph-file-text"></i>报告</button>
            </div>
          </div>
          <div class="panel" v-else>
            <div class="empty-state" style="padding:28px 16px">
              <i class="ph ph-file-text"></i>
              <div class="es-title">还没有同步记录</div>
              <div class="es-desc">首次同步将把各工具技能去重收纳到中央仓库，并产出第一份 MD 报告。</div>
            </div>
          </div>
        </div>

        <div>
          <h2>待办事项</h2>
          <p class="desc">需要你决策的事项，处理后仪表盘计数归零。</p>
          <div class="panel" style="padding: 6px 18px;" v-if="pendingCount(data)">
            <div class="tool-row" v-for="c in data.pendingConflicts.slice(0, 4)" :key="c.id">
              <div class="tool-icon" style="color:var(--warn)"><i class="ph ph-git-merge"></i></div>
              <div class="t-main">
                <div class="t-name">{{ c.title }}</div>
                <div class="t-path">{{ c.detail }}</div>
              </div>
              <button class="btn btn-sm" @click="app.go('dedup')"><i class="ph ph-arrow-right"></i>裁决</button>
            </div>
            <div class="tool-row" v-for="o in data.orphans.slice(0, 3)" :key="o.dir + o.name">
              <div class="tool-icon"><i class="ph ph-folder-plus"></i></div>
              <div class="t-main">
                <div class="t-name">陌生目录：{{ o.name }}</div>
                <div class="t-path">存在于 {{ o.tool }}，待确认收纳</div>
              </div>
              <button class="btn btn-sm" @click="app.go('sync')"><i class="ph ph-arrow-right"></i>查看</button>
            </div>
          </div>
          <div class="panel" v-else>
            <div class="empty-state" style="padding:28px 16px">
              <i class="ph ph-check-circle" style="color:var(--accent)"></i>
              <div class="es-title">暂无待办</div>
              <div class="es-desc">没有待裁决冲突，也没有陌生孤儿目录。</div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
