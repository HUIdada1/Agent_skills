// 工具适配器：内置五工具 + 自定义目录，多候选路径探测（R1 路径漂移对策）
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/** 内置工具元数据：icon 为 Phosphor 图标名，paths 为 ~ 下候选相对路径（按序取第一个存在的） */
const BUILTIN_TOOLS = [
  { id: "zcode", name: "ZCode", icon: "ph-terminal-window" },
  { id: "codex", name: "Codex CLI", icon: "ph-command" },
  { id: "claude", name: "Claude Code", icon: "ph-sparkle" },
  { id: "antigravity", name: "Antigravity", icon: "ph-airplane-tilt" },
  { id: "agents", name: "通用 ~/.agents", icon: "ph-package" },
];

/** 单个工具的目录解析：候选路径按序探测，全部不存在时返回 null（status=missing） */
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

/** 全部工具 + 自定义目录的有效扫描列表（dir 存在的才参与扫描） */
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

/** 设置页工具状态列表：含未启用/未找到，供 GUI 呈现 */
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
