// 每次同步固定骨架写一份 MD 报告到 reports/
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const hub = require("./hub.cjs");

const pad = (n) => String(n).padStart(2, "0");

function reportFileName(date) {
  return `sync-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.md`;
}

function writeSyncReport(result) {
  hub.ensureHub();
  const now = new Date();
  const s = result.summary;
  const lines = [];
  lines.push(`# 同步报告 ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`);
  lines.push("");
  lines.push(`模式：${result.mode === "dry" ? "干跑预览（未写盘）" : "执行"} ｜ 中央仓库：\`${hub.hubDir()}\``);
  lines.push("");
  lines.push("## 概要");
  lines.push("");
  lines.push(`新增 ${s.imported} · 合并重复 ${s.merged} · 挂载变更 ${s.mounted} · 冲突 ${s.conflicts} · 跳过 ${s.skipped} · 修复 ${s.repaired} · 清理 ${s.cleaned}`);
  lines.push("");

  lines.push("## 新增收纳");
  lines.push("");
  if (result.imports.length) {
    lines.push("| 技能 | 来源 | 动作 | 路径 |");
    lines.push("|---|---|---|---|");
    for (const i of result.imports) {
      lines.push(`| ${i.name} | ${i.sources} | ${i.action} | \`${i.path}\` |`);
    }
  } else {
    lines.push("（无）");
  }
  lines.push("");

  lines.push("## 重复合并");
  lines.push("");
  if (result.merges.length) {
    lines.push("| 保留 | 合并掉 | 判定依据 |");
    lines.push("|---|---|---|");
    for (const d of result.merges) {
      lines.push(`| ${d.kept} | ${d.removed} | ${d.basis} |`);
    }
  } else {
    lines.push("（无）");
  }
  lines.push("");

  lines.push("## 冲突（待处理）");
  lines.push("");
  if (result.conflicts.length) {
    for (const c of result.conflicts) {
      lines.push(`- **${c.title}**：${c.detail}`);
    }
    lines.push("");
    lines.push("同名异容冲突一律人工裁决，请在「去重与冲突」页处理。");
  } else {
    lines.push("（无）");
  }
  lines.push("");

  lines.push("## 挂载变更");
  lines.push("");
  if (result.mounts.length) {
    lines.push("| 技能 | 工具目录 | 动作 | 结果 |");
    lines.push("|---|---|---|---|");
    for (const mt of result.mounts) {
      lines.push(`| ${mt.skill} | \`${mt.dir}\` | ${mt.action} | ${mt.outcome} |`);
    }
  } else {
    lines.push("（无）");
  }
  lines.push("");

  lines.push("## 变更明细（manifest diff）");
  lines.push("");
  if (result.manifestDiff && result.manifestDiff.length) {
    lines.push("```text");
    for (const d of result.manifestDiff) lines.push(d);
    lines.push("```");
  } else {
    lines.push("（manifest 无变化）");
  }
  lines.push("");

  const file = path.join(hub.reportsDir(), reportFileName(now));
  fs.writeFileSync(file, lines.join("\n"), "utf-8");
  return file;
}

function listReports(limit) {
  const dir = hub.reportsDir();
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.startsWith("sync-") && f.endsWith(".md")).sort().reverse();
  return files.slice(0, limit || 20).map((f) => {
    const st = fs.statSync(path.join(dir, f));
    return { file: f, path: path.join(dir, f), mtimeMs: st.mtimeMs };
  });
}

function readReport(file) {
  // 只让读 reports 目录里的东西
  const dir = hub.reportsDir();
  const p = path.join(dir, path.basename(file));
  if (!p.startsWith(dir)) throw new Error("非法路径");
  return fs.readFileSync(p, "utf-8");
}

module.exports = { writeSyncReport, listReports, readReport };
