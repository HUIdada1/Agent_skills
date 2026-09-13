<script setup lang="ts">
// 中央技能库
import { ref, computed, onMounted } from "vue";
import { listSkills, repairMounts, removeSkill, type SkillRow } from "../api/ipc";
import { useAppStore } from "../stores/app";
import { fmtSize } from "../utils/format";

const app = useAppStore();
const skills = ref<SkillRow[]>([]);
const loading = ref(true);
const query = ref("");
const actionMsg = ref("");

async function load() {
  loading.value = true;
  try {
    skills.value = (await listSkills()) || [];
  } finally {
    loading.value = false;
  }
}

// 状态灯：一个技能可能同时命中多个状态，按异常优先取最需处理的一个；
// 上方筛选 chips 与这里的五种状态一一对应，chip 颜色即圆点颜色
const STATE_META = {
  error: { color: "var(--danger)", label: "错误：体检未通过，需修复后才能正常使用" },
  pending: { color: "var(--info)", label: "待收纳：新发现的技能，尚未入库" },
  warn: { color: "var(--warn)", label: "警告：可用，有优化建议" },
  active: { color: "var(--accent)", label: "已挂载：挂载在至少一个工具目录" },
  stopped: { color: "var(--text-3)", label: "未挂载：在库中，当前没有启用的挂载" },
};

type SkillState = keyof typeof STATE_META;

function stateOf(s: SkillRow): SkillState {
  if (s.health.some((h) => h.level === "bad")) return "error";
  if (!s.inManifest) return "pending";
  if (s.health.some((h) => h.level === "warn")) return "warn";
  if (s.mounts.some((m) => m.enabled)) return "active";
  return "stopped";
}

function dotOf(s: SkillRow) {
  return STATE_META[stateOf(s)];
}

const chip = ref<"all" | SkillState>("all");

// 工具自带的系统技能（如 Codex .system 里的）默认隐藏，输入搜索词才现身
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return skills.value.filter((s) => {
    if (s.origin === "system" && !q) return false;
    if (q && !(s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))) return false;
    if (chip.value === "all") return true;
    return stateOf(s) === chip.value;
  });
});

// 统计口径跟列表一致：没在搜索时不计系统技能
const visibleTotal = computed(() =>
  query.value.trim() ? skills.value.length : skills.value.filter((s) => s.origin !== "system").length
);

function chipCount(kind: typeof chip.value): number {
  const pool = skills.value.filter((s) => s.origin !== "system" || !!query.value.trim());
  if (kind === "all") return pool.length;
  return pool.filter((s) => stateOf(s) === kind).length;
}

const healthIssues = computed(() =>
  skills.value
    .filter((s) => s.health.length)
    .map((s) => ({ name: s.name, issues: s.health }))
);

const brokenMounts = computed(() => {
  const rows: { skill: string; tool: string; path: string }[] = [];
  for (const s of skills.value) {
    for (const m of s.mounts) {
      if (m.enabled && m.type === "junction") rows.push({ skill: s.name, tool: m.tool, path: m.path });
    }
  }
  return rows;
});

async function doRepair() {
  actionMsg.value = "正在重建失效挂载…";
  const r = await repairMounts();
  actionMsg.value = `已重建 ${r?.repaired ?? 0} 个失效挂载`;
  await load();
}

async function doRemove(name: string) {
  if (!confirm(`确定把技能 ${name} 移到回收站吗？\n真身将移入 .trash 保留 7 天，各工具挂载点会在下次同步清理。`)) return;
  const r = await removeSkill(name);
  actionMsg.value = r?.ok ? `${name} 已移入回收站（7 天内可还原）` : r?.message || "操作失败";
  await load();
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>中央技能库</h1>
        <p class="sub">唯一真身存放在 <span class="mono">skills\</span>，各工具目录中的同名条目均为指向此处的 Junction。</p>
      </div>
      <div class="head-actions">
        <button class="btn" :disabled="!brokenMounts.length" @click="doRepair" title="重建全部失效挂载"><i class="ph ph-link-break"></i>修复挂载</button>
        <button class="btn btn-primary" @click="load"><i class="ph ph-arrows-counter-clockwise"></i>刷新</button>
      </div>
    </div>

    <div class="note mt-8" v-if="actionMsg"><i class="ph ph-info"></i><div>{{ actionMsg }}</div></div>

    <!-- 搜索框与筛选 chips 弹性两行布局：宽屏同行两端，窄屏 chips 自动换行，永不贴死 -->
    <div class="row-between" style="margin-bottom:16px; flex-wrap:wrap; row-gap:12px">
      <div class="search-box" style="max-width:420px; flex:1 1 320px; min-width:280px">
        <i class="ph ph-magnifying-glass"></i>
        <input class="input" v-model="query" placeholder="搜索技能名称或描述，例如 gsap、设计、部署" />
      </div>
      <div class="chips" style="margin-left:auto">
        <span class="chip" :class="{ on: chip === 'all' }" @click="chip = 'all'">全部<span class="n">{{ chipCount('all') }}</span></span>
        <span class="chip" :class="{ on: chip === 'active' }" @click="chip = 'active'"><i class="chip-dot" style="color:var(--accent)"></i>已挂载<span class="n">{{ chipCount('active') }}</span></span>
        <span class="chip" :class="{ on: chip === 'stopped' }" @click="chip = 'stopped'"><i class="chip-dot" style="color:var(--text-3)"></i>未挂载<span class="n">{{ chipCount('stopped') }}</span></span>
        <span class="chip" :class="{ on: chip === 'error' }" @click="chip = 'error'"><i class="chip-dot" style="color:var(--danger)"></i>错误<span class="n">{{ chipCount('error') }}</span></span>
        <span class="chip" :class="{ on: chip === 'warn' }" @click="chip = 'warn'"><i class="chip-dot" style="color:var(--warn)"></i>警告<span class="n">{{ chipCount('warn') }}</span></span>
        <span class="chip" :class="{ on: chip === 'pending' }" @click="chip = 'pending'"><i class="chip-dot" style="color:var(--info)"></i>待收纳<span class="n">{{ chipCount('pending') }}</span></span>
      </div>
    </div>

    <div class="panel" v-if="loading" style="text-align:center; color:var(--text-3)">扫描中…</div>

    <div class="skill-grid" v-else-if="filtered.length">
      <div class="skill-card" v-for="s in filtered" :key="s.name" @click="app.openSkillDetail(s.name)">
        <div class="s-top">
          <div class="s-icon" :title="dotOf(s).label"><span class="s-dot" :style="{ color: dotOf(s).color }"></span></div>
          <span class="s-name">{{ s.name }}</span>
          <span class="badge ok" v-if="s.mounts.some((m) => m.enabled)"><i class="ph ph-check-circle"></i>已挂载</span>
          <span class="badge mute" v-else-if="s.inManifest"><i class="ph ph-minus-circle"></i>未挂载</span>
          <span class="badge warn" v-else-if="s.origin === 'system'"><i class="ph ph-shield-check"></i>系统自带</span>
          <span class="badge info" v-else><i class="ph ph-download-simple"></i>待收纳</span>
        </div>
        <div class="s-desc">{{ s.description || "（无描述，建议补齐 SKILL.md 的 description 字段）" }}</div>
        <div class="s-meta">
          <span class="src-badge" v-for="src in s.sources" :key="src.tool + (src.name || '')">{{ src.tool }}</span>
          <span v-if="s.version">v{{ s.version }}</span>
          <span v-if="s.health.length" style="color:var(--warn)">体检 {{ s.health.length }} 项提醒</span>
        </div>
      </div>
    </div>

    <div class="panel" v-else>
      <div class="empty-state">
        <i class="ph ph-books"></i>
        <div class="es-title">没有匹配的技能</div>
        <div class="es-desc">换个关键词，或先去同步中心做一次扫描收纳。</div>
      </div>
    </div>

    <div class="mt-16 row-between">
      <span class="muted small">共 {{ filtered.length }} / {{ visibleTotal }} 个技能（点击卡片查看详情与挂载管理；工具自带技能仅在搜索时出现）</span>
      <span class="muted small mono">数据来源 manifest.json</span>
    </div>

    <div class="section" v-if="healthIssues.length">
      <h2>健康检查</h2>
      <p class="desc">同步引擎在扫描时顺带做合法性体检，问题集中在这里呈现。</p>
      <div class="panel" style="padding: 6px 18px;">
        <div class="tool-row" v-for="h in healthIssues" :key="h.name">
          <div class="tool-icon" :style="{ color: h.issues.some((i) => i.level === 'bad') ? 'var(--danger)' : 'var(--warn)' }">
            <i class="ph" :class="h.issues.some((i) => i.level === 'bad') ? 'ph-warning-octagon' : 'ph-warning'"></i>
          </div>
          <div class="t-main">
            <div class="t-name">{{ h.name }}</div>
            <div class="t-path">{{ h.issues.map((i) => i.text).join("；") }}</div>
          </div>
          <span class="badge" :class="h.issues.some((i) => i.level === 'bad') ? 'bad' : 'warn'">
            <i class="ph" :class="h.issues.some((i) => i.level === 'bad') ? 'ph-x-circle' : 'ph-warning'"></i>{{ h.issues.some((i) => i.level === 'bad') ? "缺失字段" : "建议优化" }}
          </span>
        </div>
        <div class="tool-row" v-if="skills.length > healthIssues.length">
          <div class="tool-icon" style="color:var(--accent)"><i class="ph ph-check-circle"></i></div>
          <div class="t-main">
            <div class="t-name">其余 {{ skills.length - healthIssues.length }} 个技能全部通过体检</div>
            <div class="t-path">frontmatter 合法 · 描述非空 · 目录结构完整</div>
          </div>
          <span class="badge ok"><i class="ph ph-check"></i>健康</span>
        </div>
      </div>
    </div>
  </div>
</template>
