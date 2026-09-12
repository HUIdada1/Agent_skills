// 扫描与技能解析：SKILL.md frontmatter（宽容解析）、体检、内容树哈希（L1 基础）
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

/** 解析 SKILL.md frontmatter：只认 name/description/metadata.version，未知字段透传保留（R6）。
 *  宽容策略：无 frontmatter / 字段缺失不报错，由体检层给健康度。 */
function parseSkillMd(dir) {
  const file = path.join(dir, "SKILL.md");
  const raw = fs.readFileSync(file, "utf-8");
  const info = { name: "", description: "", version: "", extra: {} };
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { ok: false, info, reason: "no-frontmatter", raw };
  const block = m[1];
  let currentKey = null;
  for (const line of block.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const nested = line.match(/^\s+(\S+):\s*(.*)$/);
    if (nested && currentKey === "metadata") {
      if (nested[1] === "version") info.version = stripQuotes(nested[2]);
      continue;
    }
    const top = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (!top) continue;
    currentKey = top[1];
    if (top[1] === "name") info.name = stripQuotes(top[2]);
    else if (top[1] === "description") info.description = stripQuotes(top[2]);
    else if (top[1] === "metadata") continue;
    else info.extra[top[1]] = stripQuotes(top[2]);
  }
  return { ok: true, info, raw };
}

function stripQuotes(v) {
  const s = String(v || "").trim();
  return s.length >= 2 && (s.startsWith('"') || s.startsWith("'")) && s.endsWith(s[0]) ? s.slice(1, -1) : s;
}

/** 内容树哈希：文件按相对路径排序、文本换行统一 LF、忽略 mtime，整体 SHA-256（L1）。
 *  二进制判定：前 8KB 含 0x00 即按原样哈希，不做换行归一。 */
function treeHash(dir) {
  const files = [];
  collect(dir, "", files);
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const h = crypto.createHash("sha256");
  h.update(`files:${files.length}\n`);
  for (const f of files) {
    h.update(f.rel.replace(/\\/g, "/")).update("\0");
    const buf = fs.readFileSync(f.abs);
    h.update(isBinary(buf) ? buf : Buffer.from(buf.toString("utf-8").replace(/\r\n/g, "\n"), "utf-8"));
    h.update("\0");
  }
  return h.digest("hex");
}

function collect(absDir, relBase, out) {
  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const abs = path.join(absDir, e.name);
    const rel = relBase ? relBase + "/" + e.name : e.name;
    if (e.isDirectory()) collect(abs, rel, out);
    else if (e.isFile()) out.push({ rel, abs });
  }
}

function isBinary(buf) {
  const head = buf.subarray(0, 8192);
  for (let i = 0; i < head.length; i++) if (head[i] === 0) return true;
  return false;
}

/** 体检：SKILL.md 存在性、frontmatter 合法性、描述缺失/超长、空目录 */
function healthCheck(dir) {
  const issues = [];
  const skillFile = path.join(dir, "SKILL.md");
  if (!fs.existsSync(skillFile)) {
    issues.push({ level: "bad", text: "缺少 SKILL.md" });
    return issues;
  }
  let parsed;
  try {
    parsed = parseSkillMd(dir);
  } catch {
    issues.push({ level: "bad", text: "SKILL.md 读取失败（编码或权限）" });
    return issues;
  }
  if (!parsed.ok) issues.push({ level: "warn", text: "无 YAML frontmatter，工具可能无法识别" });
  if (parsed.ok && !parsed.info.name) issues.push({ level: "warn", text: "frontmatter 缺 name 字段" });
  if (parsed.ok && !parsed.info.description) issues.push({ level: "bad", text: "缺 description，Agent 无法触发该技能" });
  else if (parsed.ok && parsed.info.description.length > 1024) issues.push({ level: "warn", text: "description 超长（>1024 字符），可能被截断" });
  if (fs.readdirSync(dir).length <= 1) issues.push({ level: "warn", text: "目录近乎为空（仅 SKILL.md 或更少）" });
  return issues;
}

/** 扫描一个工具目录，产出技能条目。
 *  Junction/符号链接子目录不算技能本体：返回 mounts 区分（挂载校验在 syncer）。 */
function scanDir(dir, toolId) {
  const skills = [];
  const mounts = [];
  const foreignLinks = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { skills, mounts, foreignLinks };
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const abs = path.join(dir, e.name);
    let st;
    try {
      st = fs.lstatSync(abs);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      // Junction：指向中央仓库的是正常挂载，其余算外部链接（只记录不动作）
      let target = "";
      try {
        target = fs.readlinkSync(abs);
      } catch { /* 读取失败按外部链接 */ }
      mounts.push({ tool: toolId, name: e.name, path: abs, target, valid: fs.existsSync(target) });
      continue;
    }
    const hasSkillMd = fs.existsSync(path.join(abs, "SKILL.md"));
    let info = { name: "", description: "", version: "" };
    try {
      info = parseSkillMd(abs).info;
    } catch { /* 无 SKILL.md 等由体检标记 */ }
    skills.push({
      name: e.name,
      dir: abs,
      tool: toolId,
      skillName: info.name || e.name,
      description: info.description || "",
      version: info.version || "",
      treeHash: hasSkillMd || fs.readdirSync(abs).length ? treeHash(abs) : "",
      health: healthCheck(abs),
      mtimeMs: st.mtimeMs,
      fileCount: countFiles(abs),
    });
  }
  return { skills, mounts, foreignLinks };
}

function countFiles(dir) {
  let n = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isFile()) n++;
      else if (e.isDirectory()) walk(path.join(d, e.name));
    }
  };
  walk(dir);
  return n;
}

/** 全量扫描：所有有效工具目录 + 自定义目录 */
function scanAll(cfg, adapter) {
  const targets = adapter.resolveScanTargets(cfg);
  const result = { targets: [], skills: [], mounts: [] };
  for (const t of targets) {
    const r = scanDir(t.dir, t.id);
    result.targets.push({ ...t, skillCount: r.skills.length, mountCount: r.mounts.length });
    result.skills.push(...r.skills);
    result.mounts.push(...r.mounts);
  }
  return result;
}

module.exports = { parseSkillMd, treeHash, healthCheck, scanDir, scanAll, isBinary };
