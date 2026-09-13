// 五个内置工具的目录探测，外加用户自己加的自定义目录
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// icon 是 phosphor 图标名，paths 按 ~ 下相对路径写
const BUILTIN_TOOLS = [
  { id: "zcode", name: "ZCode", icon: "ph-terminal-window" },
  { id: "codex", name: "Codex CLI", icon: "ph-command" },
  { id: "claude", name: "Claude Code", icon: "ph-sparkle" },
  { id: "antigravity", name: "Antigravity", icon: "ph-airplane-tilt" },
  { id: "agents", name: "通用 ~/.agents", icon: "ph-package" },
];

// 候选路径按顺序找，全都没有就返回 dir: null（调用方自己看着办）
function resolveToolDir(cfg, toolId) {
  const t = (cfg.tools || {})[toolId];
  const meta = BUILTIN_TOOLS.find((b) => b.id === toolId);
  if (!t || !meta || t.enabled === false) return null;
  const home = os.homedir();
  for (const rel of t.paths || []) {
    const p = rel.startsWith("~") ? path.join(home, rel.slice(1)) : path.isAbsolute(rel) ? rel : path.join(home, rel);
    if (fs.existsSync(p)) return { id: toolId, name: meta.name, icon: meta.icon, dir: p, candidatePaths: t.paths };
  }
  return { id: toolId, name: meta.name, icon: meta.icon, dir: null, candidatePaths: t.paths };
}

function resolveScanTargets(cfg) {
  const out = [];
  for (const meta of BUILTIN_TOOLS) {
    const r = resolveToolDir(cfg, meta.id);
    if (r && r.dir) out.push(r);
  }
  for (const abs of cfg.customDirs || []) {
    if (abs && fs.existsSync(abs)) out.push({ id: "custom", name: "自定义目录", icon: "ph-folder-open", dir: abs });
  }
  return out;
}

// 设置页用：包含没启用/没找到的，好让界面上能看出来
function listTools(cfg) {
  const rows = [];
  for (const meta of BUILTIN_TOOLS) {
    const t = (cfg.tools || {})[meta.id] || {};
    const r = resolveToolDir(cfg, meta.id);
    rows.push({
      id: meta.id,
      name: meta.name,
      icon: meta.icon,
      enabled: t.enabled !== false,
      dir: r && r.dir ? r.dir : null,
      candidatePaths: t.paths || [],
    });
  }
  return rows;
}

module.exports = { BUILTIN_TOOLS, resolveToolDir, resolveScanTargets, listTools };
