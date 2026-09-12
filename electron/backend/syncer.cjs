// 同步状态机编排：扫描 → 去重 → 干跑预览 → 执行（收纳/发布/挂载/冲突队列）→ MD 报告
// 安全边界（D4/D4a）：删除/覆盖先进 .trash；同名异容一律人工裁决；孤儿目录只标记
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const config = require("./config.cjs");
const adapter = require("./adapter.cjs");
const scanner = require("./scanner.cjs");
const dedup = require("./dedup.cjs");
const hub = require("./hub.cjs");
const mounter = require("./mounter.cjs");
const report = require("./report.cjs");

const emptySummary = () => ({ imported: 0, merged: 0, conflicts: 0, skipped: 0, mounted: 0, repaired: 0, cleaned: 0 });

/** 冲突队列持久化：central 同名异容、工具目录异容、L2 归一疑似 */
function conflictsFile() {
  return path.join(config.hubDir(), "conflicts.json");
}

function loadConflicts() {
  try {
    return JSON.parse(fs.readFileSync(conflictsFile(), "utf-8"));
  } catch {
    return { items: [] };
  }
}

function saveConflicts(c) {
  config.ensureHub();
  fs.writeFileSync(conflictsFile(), JSON.stringify(c, null, 2), "utf-8");
}

/** 幂等落一条冲突（执行段发现的新冲突也进队列，GUI 统一裁决） */
function upsertConflict(item) {
  const store = loadConflicts();
  if (!store.items.some((x) => x.id === item.id && !x.resolved)) {
    store.items.push({ ...item, at: new Date().toISOString() });
    saveConflicts(store);
  }
}

/** 全量扫描 + 去重分组 + 孤儿识别（仪表盘/技能库/去重页共用） */
function survey(cfg) {
  const scanned = scanner.scanAll(cfg, adapter);
  const d = dedup.dedupe(scanned, cfg);
  const manifest = hub.loadManifest();
  // 孤儿：工具目录里存在、既不是中央真身也不是任何中央技能的来源/挂载名
  const known = new Set();
  for (const name of Object.keys(manifest.skills)) {
    known.add(name);
    for (const s of manifest.skills[name].sources || []) known.add(s.originalName);
    for (const mt of manifest.skills[name].mounts || []) known.add(mt.name);
  }
  const orphans = scanned.skills.filter((s) => !known.has(s.name)).map((s) => ({ name: s.name, tool: s.tool, dir: s.dir }));
  const mountHealth = mounter.verifyAll(manifest);
  return { scanned, dedup: d, manifest, orphans, mountHealth };
}

/**
 * 干跑预览：产出动作清单（不写盘）。
 * 动作：import（收纳）、mount（原位转挂载/发布/重建的统一执行粒度）、conflict、skip
 */
function planSync(cfg) {
  const { scanned, dedup: d, manifest, orphans } = survey(cfg);
  const mode = cfg.mountMode === "copy" ? "copy" : "junction";
  const actions = [];
  const targets = scanned.targets;

  // A) 新技能收纳：L1 去重后的唯一条目，中央没有的 → 收纳 + 所有来源原位转挂载。
  //    模拟导入顺序：同名（L2 归一疑似）条目只有第一个能收纳成功，其余走冲突。
  const simImported = new Set();
  const importedSources = new Set(); // "toolDir\u0000name" → 这些目录由 A 段排 mount，B 段跳过
  for (const e of d.unique) {
    if (manifest.skills[e.name]) continue;
    const canImport = !simImported.has(e.name);
    if (canImport) simImported.add(e.name);
    actions.push({
      type: "import",
      skill: e.name,
      note: `收纳 ${e.sources.map((s) => s.tool + ":" + s.name).join(", ")}`,
      sources: e.sources.map((s) => ({ tool: s.tool, name: s.name, dir: s.dir })),
      entry: { name: e.name, dir: e.dir, skillName: e.skillName, description: e.description, version: e.version, treeHash: e.treeHash, health: e.health, sources: e.sources },
    });
    for (const s of e.sources) {
      actions.push({ type: "mount", skill: e.name, mountName: s.name, toolId: s.tool, parentDir: path.dirname(s.dir), replaceReal: true, note: `${s.tool}:${s.name} 原位转挂载` });
      if (canImport) importedSources.add(`${path.dirname(s.dir)}\u0000${s.name}`);
    }
  }

  // B) 中央已有技能（含本轮将收纳的）→ 对每个工具目录做状态机判定。
  //    本轮新收纳技能的来源目录已由 A 段处理，B 段跳过；其余目录按发布逻辑走（装一次全工具生效）。
  const importedNames = new Set(d.unique.filter((e) => !manifest.skills[e.name]).map((e) => e.name));
  const allNames = [...Object.keys(manifest.skills), ...importedNames];
  for (const name of allNames) {
    const target = path.join(hub.skillsDir(), name);
    const isNew = importedNames.has(name);
    if (!isNew && !fs.existsSync(target)) {
      actions.push({ type: "error", skill: name, note: "中央真身丢失（被手动删除？），请从回收站还原或删除该条目" });
      continue;
    }
    for (const t of targets) {
      if (isNew && importedSources.has(`${t.dir}\u0000${name}`)) continue;
      const linkPath = path.join(t.dir, name);
      if (mounter.isLink(linkPath)) {
        if (mounter.pointsTo(linkPath, target) && fs.existsSync(linkPath)) {
          actions.push({ type: "skip", skill: name, dir: t.dir, note: `${t.id} 挂载有效` });
        } else {
          actions.push({ type: "conflict", skill: name, toolId: t.id, dir: t.dir, kind: "diff-link", title: `${t.id}:${name} 链接指向异常`, detail: "现有链接不指向中央真身，需人工确认" });
        }
        continue;
      }
      if (fs.existsSync(linkPath)) {
        const localHash = scanner.treeHash(linkPath);
        if (localHash === scanner.treeHash(target)) {
          actions.push({ type: "mount", skill: name, mountName: name, toolId: t.id, parentDir: t.dir, replaceReal: true, note: `${t.id} 版与中央一致，原位转挂载（原目录备份进回收站）` });
        } else {
          actions.push({ type: "conflict", skill: name, toolId: t.id, dir: t.dir, kind: "content", title: `${t.id}:${name} 内容冲突`, detail: "工具版与中央版内容不同，需人工裁决（D4a）" });
        }
      } else {
        actions.push({ type: "mount", skill: name, mountName: name, toolId: t.id, parentDir: t.dir, replaceReal: false, note: `${t.id} 无此技能 → 发布挂载` });
      }
    }
  }

  // C) L2 归一疑似冲突（提示性，不阻塞收纳；两技能仍按各自名字收纳）
  const l2Conflicts = d.conflicts.map((c) => ({
    id: `norm:${c.key}`,
    kind: "norm",
    title: `${c.variants[0].name} ≈ ${c.variants[1].name}`,
    detail: `名称归一后疑似同一技能（${c.basis}），当前按两个技能分别收纳；如确认同一可合并`,
    a: c.variants[0].name, b: c.variants[1].name,
  }));

  // D) 冲突落库（保留历史 id 的未裁决项 + 本轮新冲突）
  const store = loadConflicts();
  const newItems = [];
  for (const a of actions.filter((x) => x.type === "conflict")) {
    const id = `${a.kind}:${a.skill}@${a.toolId}`;
    newItems.push({ id, kind: a.kind, skill: a.skill, toolId: a.toolId, dir: a.dir, title: a.title, detail: a.detail, at: new Date().toISOString() });
  }
  for (const c of l2Conflicts) {
    if (!store.items.some((x) => x.id === c.id) && !newItems.some((x) => x.id === c.id)) newItems.push({ ...c, at: new Date().toISOString() });
  }
  // 保留未裁决旧项，剔除已不在本轮的（目录消失等）——仅清理 content/diff-link 类，norm 类一直保留直到裁决
  const kept = store.items.filter((x) => {
    if (x.resolved) return false;
    if (x.kind === "norm") return true;
    return newItems.some((n) => n.id === x.id);
  });
  const merged = [...kept];
  for (const n of newItems) if (!merged.some((x) => x.id === n.id)) merged.push(n);
  saveConflicts({ items: merged });

  return {
    mode,
    actions: actions.filter((a) => a.type !== "conflict"),
    conflicts: merged.filter((x) => !x.resolved),
    orphans,
    dedup: d,
    scannedSummary: scanned.targets.map((t) => ({ id: t.id, name: t.name, dir: t.dir, skillCount: t.skillCount, mountCount: scanned.mounts.filter((m) => m.tool === t.id).length })),
  };
}

/** 执行：逐动作落盘，最后写 MD 报告 */
function executeSync(cfg, planResult) {
  const s = emptySummary();
  const result = { mode: "exec", summary: s, imports: [], merges: [], conflicts: [], mounts: [], manifestDiff: [] };
  const addDiff = (line) => result.manifestDiff.push(line);

  for (const a of planResult.actions) {
    if (a.type === "import") {
      const r = hub.importSkill(a.entry);
      if (r.action === "imported") {
        s.imported++;
        result.imports.push({ name: a.skill, sources: a.sources.map((x) => x.tool + ":" + x.name).join(", "), action: "收纳", path: path.join(hub.skillsDir(), a.skill) });
        addDiff(`+ skills/${a.skill} ← ${a.sources.map((x) => x.tool + ":" + x.name).join(", ")} (${a.entry.treeHash.slice(0, 12)})`);
      } else if (r.action === "source-added") {
        result.imports.push({ name: a.skill, sources: a.sources.map((x) => x.tool + ":" + x.name).join(", "), action: "补充来源", path: path.join(hub.skillsDir(), a.skill) });
      } else {
        s.conflicts++;
        result.conflicts.push({ title: `${a.skill} 收纳冲突`, detail: r.message || "中央已有同名不同内容" });
      }
    } else if (a.type === "mount") {
      doMount(cfg, a, result, s);
    } else if (a.type === "skip") {
      s.skipped++;
    } else if (a.type === "error") {
      result.conflicts.push({ title: a.skill, detail: a.note });
    }
  }

  s.cleaned = hub.purgeTrash(cfg.trashDays || 7);
  result.reportFile = report.writeSyncReport(result);
  return result;
}

/** 挂载执行：replaceReal 时先校验内容一致 → 原目录备份进回收站 → 建链接 */
function doMount(cfg, a, result, s) {
  const toolDir = a.parentDir || a.dir;
  if (!toolDir || !fs.existsSync(toolDir)) {
    result.mounts.push({ skill: a.skill, dir: toolDir || "?", action: "mount", outcome: "目录不存在，跳过" });
    return;
  }
  const mountName = a.mountName || a.skill;
  const linkPath = path.join(toolDir, mountName);
  const realExists = fs.existsSync(linkPath) && !mounter.isLink(linkPath);

  if (realExists) {
    if (!a.replaceReal) {
      s.conflicts++;
      result.conflicts.push({ title: `${mountName} 挂载冲突`, detail: "工具目录已有同名真实目录，需人工裁决" });
      return;
    }
    const central = path.join(hub.skillsDir(), a.skill);
    if (scanner.treeHash(linkPath) !== scanner.treeHash(central)) {
      s.conflicts++;
      result.conflicts.push({ title: `${a.skill} 内容冲突`, detail: "工具版与中央版内容不同，需人工裁决（D4a）" });
      upsertConflict({ id: `content:${a.skill}@${a.toolId || "custom"}`, kind: "content", skill: a.skill, toolId: a.toolId || "custom", dir: toolDir, title: `${a.toolId || "custom"}:${a.skill} 内容冲突`, detail: "工具版与中央版内容不同，需人工裁决（D4a）" });
      return;
    }
    const backed = hub.toTrash(linkPath, mountName);
    result.manifestDiff.push(`~ ${mountName} @ ${toolDir} 原目录备份 → .trash/${path.basename(backed)}`);
    s.merged++;
    result.merges.push({ kept: a.skill, removed: `${a.toolId || "?"}:${mountName}`, basis: "内容一致，原位转挂载" });
  }

  const r = mounter.mount(a.skill, toolDir, cfg.mountMode, mountName);
  const outcomes = { mounted: "已挂载", already: "已是指向中央的挂载", copied: "已复制", error: r.message || "失败" };
  const outcome = outcomes[r.action] || r.action;

  if (r.action === "conflict-real-dir" || r.action === "conflict-diff-link" || r.action === "error") {
    if (r.action !== "conflict-real-dir") s.conflicts++; // real-dir 冲突已在上方计过
    result.conflicts.push({ title: `${mountName} 挂载异常`, detail: r.message || outcome });
    result.mounts.push({ skill: a.skill, dir: toolDir, action: "mount", outcome });
    return;
  }
  if (r.action === "already") s.skipped++;
  else s.mounted++;
  if (r.action === "mounted") s.repaired += 0;
  result.mounts.push({ skill: a.skill, dir: toolDir, action: a.replaceReal && realExists ? "replace-mount" : "mount", outcome });
  hub.setMount(a.skill, a.toolId || "custom", linkPath, cfg.mountMode === "copy" ? "copy" : "junction", true);
  if (r.action === "mounted") result.manifestDiff.push(`+ mount ${mountName} @ ${toolDir} → skills/${a.skill}`);
}

/** 裁决内容冲突（GUI 调用）
 *  choice: keepHub（保留中央，工具版进回收站后挂载）| keepTool（工具版覆盖中央，旧中央进回收站）| keepBoth（工具版改名收纳）*/
function resolveContentConflict(item, choice, cfg) {
  const { skill, dir, toolId } = item;
  const central = path.join(hub.skillsDir(), skill);
  const toolCopy = path.join(dir, skill);
  if (!fs.existsSync(toolCopy)) return { ok: false, message: "工具目录已不存在该技能" };

  if (choice === "keepHub") {
    const backed = hub.toTrash(toolCopy, skill);
    const r = mounter.mount(skill, dir, cfg.mountMode, skill);
    if (r.action === "mounted" || r.action === "already") {
      hub.setMount(skill, toolId, path.join(dir, skill), cfg.mountMode, true);
      noteHistory(skill, `冲突裁决：保留中央版，${toolId} 版进回收站（${path.basename(backed)}）`);
      return { ok: true, message: "已保留中央版并挂载" };
    }
    return { ok: false, message: "挂载失败：" + (r.message || r.action) };
  }

  if (choice === "keepTool") {
    const oldBacked = fs.existsSync(central) ? hub.toTrash(central, skill) : "";
    fs.cpSync(toolCopy, central, { recursive: true });
    const m = hub.loadManifest();
    if (m.skills[skill]) {
      m.skills[skill].treeHash = scanner.treeHash(central);
      m.skills[skill].mergeHistory.push({ at: new Date().toISOString(), action: "conflict-keepTool", detail: `保留 ${toolId} 版覆盖中央${oldBacked ? `，旧中央版进回收站（${path.basename(oldBacked)}）` : ""}` });
      hub.saveManifest(m);
    }
    const r = mounter.mount(skill, dir, cfg.mountMode, skill);
    if (r.action === "mounted" || r.action === "already") hub.setMount(skill, toolId, path.join(dir, skill), cfg.mountMode, true);
    return { ok: true, message: "已用工具版覆盖中央并分发到其他挂载点" };
  }

  if (choice === "keepBoth") {
    const newName = `${skill}-${toolId}`;
    const entry = {
      name: newName,
      dir: toolCopy,
      skillName: newName,
      description: "",
      version: "",
      treeHash: scanner.treeHash(toolCopy),
      health: [],
      sources: [{ tool: toolId, name: skill, dir: toolCopy }],
    };
    const r = hub.importSkill(entry);
    if (r.action !== "imported") return { ok: false, message: r.message || "改名收纳失败" };
    noteHistory(skill, `冲突裁决：双保留，${toolId} 版改名收纳为 ${newName}`);
    return { ok: true, message: `工具版已改名收纳为 ${newName}` };
  }

  return { ok: false, message: "未知裁决选项：" + choice };
}

/** 裁决 L2 归一疑似：确认同一 → 保留 a，b 不收纳（其原目录改挂 a）；判为不同 → 撤销提示 */
function resolveNormConflict(item, choice, cfg) {
  const aName = item.a, bName = item.b;
  const manifest = hub.loadManifest();
  if (choice === "same") {
    // b 已收纳则摘除回收，b 的来源目录转挂到 a
    if (manifest.skills[bName]) {
      hub.removeSkill(bName);
    }
    const bEntry = survey(cfg).scanned.skills.find((x) => x.name === bName);
    if (bEntry) {
      const r = mounter.mount(aName, path.dirname(bEntry.dir), cfg.mountMode, bName);
      if (r.action === "mounted" || r.action === "already") {
        hub.setMount(aName, bEntry.tool, path.join(path.dirname(bEntry.dir), bName), cfg.mountMode, true);
      }
    }
    noteHistory(aName, `L2 裁决：确认 ${bName} 为同一技能，原目录改挂到 ${aName}`);
    return { ok: true, message: `已合并：${bName} → ${aName}` };
  }
  if (choice === "different") {
    return { ok: true, message: "已标记为不同技能" };
  }
  return { ok: false, message: "未知裁决选项：" + choice };
}

function noteHistory(skill, detail) {
  const m = hub.loadManifest();
  if (!m.skills[skill]) return;
  m.skills[skill].mergeHistory.push({ at: new Date().toISOString(), action: "conflict-resolved", detail });
  hub.saveManifest(m);
}

/** 启停开关 = 摘除 / 重建某工具的挂载（技能粒度） */
function toggleMount(skill, toolId, enable, cfg) {
  const m = hub.loadManifest();
  const s = m.skills[skill];
  if (!s) return { ok: false, message: "技能不存在" };
  const mt = (s.mounts || []).find((x) => x.tool === toolId);
  if (!mt) return { ok: false, message: "该工具未挂载此技能" };
  if (enable) {
    const r = mounter.mount(skill, path.dirname(mt.path), cfg.mountMode, mt.name);
    if (r.action === "error") return { ok: false, message: r.message };
    mt.enabled = true;
  } else {
    const r = mounter.unmount(mt.path);
    if (!r.ok) return { ok: false, message: r.message };
    mt.enabled = false;
  }
  hub.saveManifest(m);
  return { ok: true, message: enable ? "已启用" : "已停用" };
}

/** 一键重建全部失效挂载 */
function repairMounts(cfg) {
  const m = hub.loadManifest();
  const rows = mounter.verifyAll(m);
  let repaired = 0;
  const details = [];
  for (const row of rows) {
    if (row.valid) continue;
    if (mounter.isLink(row.path)) mounter.unmount(row.path);
    const r = mounter.mount(row.skill, path.dirname(row.path), cfg.mountMode, row.name);
    if (r.action === "mounted") {
      repaired++;
      details.push(`${row.skill}@${row.tool}`);
    } else {
      details.push(`${row.skill}@${row.tool} 失败：${r.message || r.action}`);
    }
  }
  return { repaired, details };
}

module.exports = { survey, planSync, executeSync, loadConflicts, saveConflicts, upsertConflict, resolveContentConflict, resolveNormConflict, toggleMount, repairMounts };
