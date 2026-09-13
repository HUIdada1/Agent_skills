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
const chip = ref<"all" | "mounted" | "conflict" | "health" | "orphan">("all");
const actionMsg = ref("");

async function load() {
  loading.value = true;
  try {
    skills.value = (await listSkills()) || [];
  } finally {
    loading.value = false;
  }
}

const SKILL_ICONS = ["ph-paint-brush-broad", "ph-browsers", "ph-palette", "ph-scroll", "ph-magic-wand", "ph-diamond", "ph-image", "ph-device-mobile", "ph-code", "ph-framer-logo", "ph-brackets-angle", "ph-factory"];

function iconFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return SKILL_ICONS[h % SKILL_ICONS.length];
}

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return skills.value.filter((s) => {
    if (q && !(s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))) return false;
    const mounted = s.mounts.some((m) => m.enabled);
    const hasIssue = s.health.some((h) => h.level === "bad" || h.level === "warn");
    if (chip.value === "mounted") return mounted;
    if (chip.value === "conflict") return !mounted && s.inManifest;
    if (chip.value === "health") return hasIssue;
    if (chip.value === "orphan") return !s.inManifest;
    return true;
  });
});

function chipCount(kind: typeof chip.value): number {
  return skills.value.filter((s) => {
    const mounted = s.mounts.some((m) => m.enabled);
    const hasIssue = s.health.some((h) => h.level === "bad" || h.level === "warn");
    if (kind === "mounted") return mounted;
    if (kind === "conflict") return !mounted && s.inManifest;
    if (kind === "health") return hasIssue;
    if (kind === "orphan") return !s.inManifest;
    return true;
  }).length;
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

    <div class="row-between" style="margin-bottom:16px">
      <div class="search-box" style="max-width:420px; flex:1">
        <i class="ph ph-magnifying-glass"></i>
        <input class="input" v-model="query" placeholder="搜索技能名称或描述，例如 gsap、设计、部署" />
      </div>
      <div class="chips">
        <span class="chip" :class="{ on: chip === 'all' }" @click="chip = 'all'">全部<span class="n">{{ skills.length }}</span></span>
        <span class="chip" :class="{ on: chip === 'mounted' }" @click="chip = 'mounted'">已挂载<span class="n">{{ chipCount('mounted') }}</span></span>
        <span class="chip" :class="{ on: chip === 'conflict' }" @click="chip = 'conflict'">未挂载<span class="n">{{ chipCount('conflict') }}</span></span>
        <span class="chip" :class="{ on: chip === 'health' }" @click="chip = 'health'">健康警告<span class="n">{{ chipCount('health') }}</span></span>
        <span class="chip" :class="{ on: chip === 'orphan' }" @click="chip = 'orphan'">待收纳<span class="n">{{ chipCount('orphan') }}</span></span>
      </div>
    </div>

    <div class="panel" v-if="loading" style="text-align:center; color:var(--text-3)">扫描中…</div>

    <div class="skill-grid" v-else-if="filtered.length">
      <div class="skill-card" v-for="s in filtered" :key="s.name" @click="app.openSkillDetail(s.name)">
        <div class="s-top">
          <div class="s-icon"><i class="ph" :class="iconFor(s.name)"></i></div>
          <span class="s-name">{{ s.name }}</span>
          <span class="badge ok" v-if="s.mounts.some((m) => m.enabled)"><i class="ph ph-check-circle"></i>已挂载</span>
          <span class="badge mute" v-else-if="s.inManifest"><i class="ph ph-minus-circle"></i>未挂载</span>
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
      <span class="muted small">共 {{ filtered.length }} / {{ skills.length }} 个技能（点击卡片查看详情与挂载管理）</span>
      <span class="muted small mono">manifest.json</span>
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
