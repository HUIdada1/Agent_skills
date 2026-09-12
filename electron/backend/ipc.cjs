// IPC 命令注册中心：preload 白名单放行的命令在这里落地
"use strict";
const path = require("node:path");
const { app, shell, dialog, BrowserWindow } = require("electron");
const config = require("./config.cjs");
const adapter = require("./adapter.cjs");
const syncer = require("./syncer.cjs");
const hub = require("./hub.cjs");
const report = require("./report.cjs");
const scanner = require("./scanner.cjs");
const updater = require("./updater.cjs");

/** 全局配置内存缓存：命令处理共用，save_config 时刷新 */
let cfg = null;
function C() {
  if (!cfg) cfg = config.loadConfig();
  return cfg;
}

function ok(data) {
  return { ok: true, ...data };
}

function fail(message) {
  return { ok: false, message: String((message && message.message) || message) };
}

/** 统一异常收口：渲染层拿到 { ok:false, message } 而不是 rejected promise */
function handle(fn) {
  return async (_event, args) => {
    try {
      return await fn(args || {});
    } catch (e) {
      return fail(e);
    }
  };
}

function register({ ipcMain }) {
  // ===== 应用信息 =====
  ipcMain.handle("get_app_version", () => app.getVersion());
  ipcMain.handle("get_is_portable", () => updater.isPortable());

  // ===== 软件更新 =====
  ipcMain.handle("get_update_status", () => updater.getStatus());
  ipcMain.handle("check_update", () => updater.check(true));
  ipcMain.handle("download_update", () => updater.download());
  ipcMain.handle("install_update", () => updater.triggerInstall());
  ipcMain.handle("open_release_page", () => updater.openReleases());
  ipcMain.handle("open_repo_page", () => updater.openRepo());

  // ===== 配置 =====
  ipcMain.handle("load_config", handle(() => C()));
  ipcMain.handle("save_config", handle(({ config: next }) => {
    cfg = next;
    return config.saveConfig(cfg);
  }));

  // ===== 工具与扫描 =====
  ipcMain.handle("list_tools", handle(() => adapter.listTools(C())));
  ipcMain.handle("get_overview", handle(() => {
    const survey = syncer.survey(C());
    const conflicts = syncer.loadConflicts().items.filter((x) => !x.resolved);
    const reports = report.listReports(3);
    return {
      hubDir: config.hubDir(),
      skillCount: survey.dedup.unique.length,
      manifestCount: Object.keys(survey.manifest.skills || {}).length,
      sourceCount: survey.scanned.skills.length,
      l1Merged: survey.dedup.duplicates.length,
      l2Conflicts: survey.dedup.conflicts.length,
      tools: survey.scanned.targets.map(({ id, name, dir, skillCount, mountCount }) => ({ id, name, dir, skillCount, mountCount })),
      mountHealth: survey.mountHealth,
      orphans: survey.orphans,
      pendingConflicts: conflicts,
      recentReports: reports,
      trashCount: hub.listTrash().length,
    };
  }));
  ipcMain.handle("list_skills", handle(() => {
    const survey = syncer.survey(C());
    return survey.dedup.unique.map((e) => ({
      name: e.name,
      skillName: e.skillName,
      description: e.description,
      version: e.version,
      treeHash: e.treeHash,
      health: e.health,
      sources: e.sources,
      inManifest: !!survey.manifest.skills[e.name],
      mounts: survey.manifest.skills[e.name]?.mounts || [],
      mtimeMs: e.mtimeMs,
    }));
  }));
  ipcMain.handle("get_skill", handle(({ name }) => {
    const m = hub.loadManifest();
    const entry = m.skills[name];
    const dir = path.join(hub.skillsDir(), name);
    if (!entry && !require("node:fs").existsSync(dir)) return null;
    return {
      manifest: entry || null,
      dir,
      health: require("node:fs").existsSync(dir) ? scanner.healthCheck(dir) : [],
      // 详情页展示用：SKILL.md 原文（截断交给前端）
      skillMd: require("node:fs").existsSync(path.join(dir, "SKILL.md"))
        ? require("node:fs").readFileSync(path.join(dir, "SKILL.md"), "utf-8")
        : "",
    };
  }));

  // ===== 同步 =====
  ipcMain.handle("sync_plan", handle(() => syncer.planSync(C())));
  ipcMain.handle("sync_execute", handle(({ plan }) => syncer.executeSync(C(), plan)));
  ipcMain.handle("list_reports", handle(() => report.listReports(30)));
  ipcMain.handle("read_report", handle(({ file }) => ({ content: report.readReport(file) })));
  ipcMain.handle("open_report", handle(async ({ file }) => {
    const p = path.join(hub.reportsDir(), path.basename(file));
    await shell.openPath(p);
    return ok({});
  }));

  // ===== 冲突 =====
  ipcMain.handle("list_conflicts", handle(() => syncer.loadConflicts().items.filter((x) => !x.resolved)));
  ipcMain.handle("get_conflict_diff", handle(({ id }) => {
    const item = syncer.loadConflicts().items.find((x) => x.id === id);
    if (!item) return null;
    const fs = require("node:fs");
    const leftPath = item.kind === "content" ? path.join(item.dir, item.skill) : null;
    const rightPath = path.join(hub.skillsDir(), item.skill || "");
    const readMd = (p) => {
      const f = p && path.join(p, "SKILL.md");
      return f && fs.existsSync(f) ? fs.readFileSync(f, "utf-8") : "";
    };
    return {
      item,
      left: { label: item.kind === "content" ? `${item.toolId} 版` : "技能 A", path: leftPath || "", md: item.kind === "content" ? readMd(leftPath) : "" },
      right: { label: item.kind === "content" ? "中央版" : "技能 B", path: rightPath, md: item.kind === "content" ? readMd(rightPath) : "" },
    };
  }));
  ipcMain.handle("resolve_conflict", handle(({ id, choice }) => {
    const store = syncer.loadConflicts();
    const item = store.items.find((x) => x.id === id);
    if (!item) return fail("冲突不存在或已裁决");
    const r = item.kind === "norm"
      ? syncer.resolveNormConflict(item, choice, C())
      : syncer.resolveContentConflict(item, choice, C());
    if (r.ok) {
      item.resolved = { at: new Date().toISOString(), choice };
      syncer.saveConflicts(store);
    }
    return r;
  }));
  ipcMain.handle("dismiss_conflict", handle(({ id }) => {
    const store = syncer.loadConflicts();
    const item = store.items.find((x) => x.id === id);
    if (item) {
      item.resolved = { at: new Date().toISOString(), choice: "dismissed" };
      syncer.saveConflicts(store);
    }
    return ok({});
  }));

  // ===== 挂载管理 =====
  ipcMain.handle("toggle_mount", handle(({ skill, toolId, enable }) => syncer.toggleMount(skill, toolId, enable, C())));
  ipcMain.handle("repair_mounts", handle(() => syncer.repairMounts(C())));

  // ===== 回收站 =====
  ipcMain.handle("trash_list", handle(() => hub.listTrash()));
  ipcMain.handle("trash_restore", handle(({ name }) => hub.restoreFromTrash(name)));
  ipcMain.handle("trash_purge", handle(() => ({ purged: hub.purgeTrash(C().trashDays || 7) })));

  // ===== 技能管理 =====
  ipcMain.handle("remove_skill", handle(({ name }) => hub.removeSkill(name)));

  // ===== 目录与杂项 =====
  ipcMain.handle("open_data_dir", handle(async () => {
    await shell.openPath(config.hubDir());
    return ok({});
  }));
  ipcMain.handle("get_data_dir", handle(() => config.hubDir()));
  ipcMain.handle("browse_dir", handle(async () => {
    const r = await dialog.showOpenDialog(BrowserWindow.getAllWindows()[0], { properties: ["openDirectory"] });
    return { ok: true, canceled: r.canceled, path: r.canceled ? null : r.filePaths[0] };
  }));
}

module.exports = { register };
