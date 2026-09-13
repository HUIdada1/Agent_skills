// 中央仓库：manifest 读写、收纳、回收站
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const config = require("./config.cjs");

function manifestFile() {
  return path.join(config.hubDir(), "manifest.json");
}

function skillsDir() {
  return path.join(config.ensureHub(), "skills");
}

function trashDir() {
  return path.join(config.ensureHub(), ".trash");
}

function reportsDir() {
  return path.join(config.ensureHub(), "reports");
}

function loadManifest() {
  try {
    return JSON.parse(fs.readFileSync(manifestFile(), "utf-8"));
  } catch {
    return { version: 1, skills: {}, updatedAt: null };
  }
}

function saveManifest(m) {
  m.updatedAt = new Date().toISOString();
  fs.writeFileSync(manifestFile(), JSON.stringify(m, null, 2), "utf-8");
}

function importSkill(entry) {
  const m = loadManifest();
  const dest = path.join(skillsDir(), entry.name);
  if (fs.existsSync(dest)) {
    const old = m.skills[entry.name];
    if (old && old.treeHash === entry.treeHash) {
      mergeSources(old, entry);
      saveManifest(m);
      return { action: "source-added", name: entry.name };
    }
    return { action: "conflict", name: entry.name, message: "中央已存在同名不同内容的技能" };
  }
  fs.cpSync(entry.dir, dest, { recursive: true });
  m.skills[entry.name] = {
    name: entry.name,
    version: entry.version || "",
    description: entry.description || "",
    treeHash: entry.treeHash,
    skillName: entry.skillName || entry.name,
    sources: entry.sources.map((s) => ({ tool: s.tool, originalName: s.name, firstSeen: new Date().toISOString() })),
    mounts: [],
    mergeHistory: [{ at: new Date().toISOString(), action: "import", detail: `收纳自 ${entry.sources.map((s) => s.tool + ":" + s.name).join(", ")}` }],
    health: entry.health || [],
  };
  saveManifest(m);
  return { action: "imported", name: entry.name };
}

function mergeSources(oldEntry, entry) {
  for (const s of entry.sources) {
    if (!oldEntry.sources.some((x) => x.tool === s.tool && x.originalName === s.name)) {
      oldEntry.sources.push({ tool: s.tool, originalName: s.name, firstSeen: new Date().toISOString() });
    }
  }
}

function setMount(name, tool, mountPath, type, enabled) {
  const m = loadManifest();
  const s = m.skills[name];
  if (!s) return;
  s.mounts = (s.mounts || []).filter((x) => !(x.tool === tool && x.name === mountNameOf(mountPath)));
  s.mounts.push({ tool, name: mountNameOf(mountPath), path: mountPath, type, enabled: enabled !== false });
  saveManifest(m);
}

function removeMount(name, mountPath) {
  const m = loadManifest();
  const s = m.skills[name];
  if (!s) return;
  s.mounts = (s.mounts || []).filter((x) => x.path !== mountPath);
  saveManifest(m);
}

function mountNameOf(mountPath) {
  return path.basename(mountPath);
}

// 删除/覆盖都走这里，先进 .trash
function toTrash(absPath, tag) {
  const trash = trashDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(trash, `${stamp}-${tag || path.basename(absPath)}`);
  fs.renameSync(absPath, dest);
  return dest;
}

function listTrash() {
  const trash = trashDir();
  const items = [];
  for (const name of fs.readdirSync(trash)) {
    const p = path.join(trash, name);
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      continue;
    }
    items.push({ name, path: p, trashedAt: st.mtimeMs, sizeBytes: dirSize(p) });
  }
  items.sort((a, b) => b.trashedAt - a.trashedAt);
  return items;
}

function restoreFromTrash(trashName, destParent) {
  const src = path.join(trashDir(), trashName);
  const base = destParent || skillsDir();
  // 剥掉回收站命名里的时间戳前缀
  const original = trashName.replace(/^\d{4}-\d{2}-\d{2}T[0-9-]+Z-/, "");
  const dest = path.join(base, original);
  if (fs.existsSync(dest)) return { ok: false, message: `目标已存在：${dest}` };
  fs.renameSync(src, dest);
  return { ok: true, dest };
}

function purgeTrash(days) {
  const limit = Date.now() - (days || 7) * 24 * 3600 * 1000;
  let purged = 0;
  for (const item of listTrash()) {
    if (item.trashedAt < limit) {
      fs.rmSync(item.path, { recursive: true, force: true });
      purged++;
    }
  }
  return purged;
}

function dirSize(p) {
  let n = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(d, e.name);
      if (e.isFile()) {
        try { n += fs.statSync(abs).size; } catch {}
      } else if (e.isDirectory()) walk(abs);
    }
  };
  walk(p);
  return n;
}

// 删中央技能：真身进回收站，manifest 移除（挂载不在这处理）
function removeSkill(name) {
  const dir = path.join(skillsDir(), name);
  if (!fs.existsSync(dir)) return { ok: false, message: "技能不存在" };
  const trashPath = toTrash(dir, name);
  const m = loadManifest();
  delete m.skills[name];
  saveManifest(m);
  return { ok: true, trashPath };
}

module.exports = {
  hubDir: config.hubDir, ensureHub: config.ensureHub,
  skillsDir, trashDir, reportsDir,
  manifestFile, loadManifest, saveManifest,
  importSkill, setMount, removeMount,
  toTrash, listTrash, restoreFromTrash, purgeTrash, removeSkill, dirSize,
};
