// IPC 命令都注册在这，preload 白名单和这里要一一对应
"use strict";
const path = require("node:path");
const { app, shell, dialog, BrowserWindow } = require("electron");
const config = require("./config.cjs");
const adapter = require("./adapter.cjs");
const syncer = require("./syncer.cjs");
const hub = require("./hub.cjs");
const report = require("./report.cjs");
const scanner = require("./scanner.cjs");
const mounter = require("./mounter.cjs");
const updater = require("./updater.cjs");
const remotesync = require("./remotesync.cjs");
const webdav = require("./webdav.cjs");

// 渲染层拿到的密码一律是掩码；保存/测试连接收到精确掩码时回填磁盘真值
const PASSWORD_MASK = "••••••••";

function maskConfig(c) {
  const out = JSON.parse(JSON.stringify(c));
  if (out.webdav && out.webdav.password) out.webdav.password = PASSWORD_MASK;
  return out;
}

// 表单传回的密码是掩码时用磁盘真值替换，防止掩码被当密码存盘
function unmaskPassword(next) {
  if (next && next.webdav && next.webdav.password === PASSWORD_MASK) {
    const disk = config.loadConfig();
    next.webdav.password = disk.webdav.password || "";
  }
  return next;
}

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

// 异常统一收口，渲染层拿到 { ok:false } 而不是 rejected promise
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
  ipcMain.handle("get_app_version", () => app.getVersion());
  ipcMain.handle("get_is_portable", () => updater.isPortable());

  // 渲染层切主题时同步 overlay 按钮底色与图标色（自绘标题栏跟随明暗主题）
  ipcMain.handle("set_titlebar_theme", handle(({ theme }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win || typeof win.setTitleBarOverlay !== "function") return ok({});
    win.setTitleBarOverlay(theme === "light"
      ? { color: "#fbfcfd", symbolColor: "#46516a" }
      : { color: "#0d1015", symbolColor: "#9aa3b5" });
    return ok({});
  }));

  // 软件更新
  ipcMain.handle("get_update_status", () => updater.getStatus());
  ipcMain.handle("check_update", () => updater.check(true));
  ipcMain.handle("download_update", () => updater.download());
  ipcMain.handle("install_update", () => updater.triggerInstall());
  ipcMain.handle("open_release_page", () => updater.openReleases());
  ipcMain.handle("open_repo_page", () => updater.openRepo());

  ipcMain.handle("load_config", handle(() => maskConfig(C())));
  ipcMain.handle("save_config", handle(({ config: next }) => {
    cfg = unmaskPassword(JSON.parse(JSON.stringify(next)));
    const r = config.saveConfig(cfg);
    config.applyAutoStart(cfg);
    return r;
  }));

  // WebDAV 跨设备同步
  ipcMain.handle("webdav_test", handle(({ config: form }) => {
    const c = form ? unmaskPassword(JSON.parse(JSON.stringify(form))) : C();
    return webdav.test(c.webdav);
  }));
  ipcMain.handle("webdav_sync", handle(() => {
    const c = C();
    if (remotesync.isRunning()) return fail("同步已在进行中");
    if (!remotesync.configured(c)) return fail("WebDAV 未配置完整（服务器地址 / 账号 / 密码）");
    remotesync.run(c).catch(() => {}); // 后台跑，进度走事件广播；异常已在 run 内收口
    return ok({});
  }));
  ipcMain.handle("webdav_cancel", handle(() => remotesync.cancel()));
  ipcMain.handle("webdav_status", handle(() => {
    const c = C();
    const rstate = remotesync.loadRemoteState();
    return {
      running: remotesync.isRunning(),
      configured: remotesync.configured(c),
      deviceId: c.webdav.deviceId,
      deviceName: c.webdav.deviceName,
      lastSyncAt: rstate.lastSyncAt || "",
      ...remotesync.progress(),
    };
  }));
  ipcMain.handle("webdav_logs", handle(() => remotesync.recentLogs()));
  ipcMain.handle("webdav_devices", handle(async () => {
    const c = C();
    if (!remotesync.configured(c)) return { devices: [], error: "未配置" };
    try {
      const entries = await webdav.list(webdav.joinUrl(c.webdav.endpoint, c.webdav.root, "devices"), c.webdav);
      const devices = [];
      for (const e of entries) {
        if (e.isDir || !e.name.endsWith(".json")) continue;
        try {
          const d = JSON.parse(await webdav.getText(webdav.joinUrl(c.webdav.endpoint, c.webdav.root, "devices", e.name), c.webdav));
          devices.push({ id: e.name.replace(/\.json$/, ""), name: d.name || e.name, appVersion: d.appVersion || "", lastSyncAt: d.lastSyncAt || "", self: e.name === `${c.webdav.deviceId}.json` });
        } catch { /* 单个设备信息坏了不影响其他 */ }
      }
      return { devices };
    } catch (e) {
      return { devices: [], error: String((e && e.message) || e) };
    }
  }));

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
  // 已收纳：返回 manifest + 中央真身内容；未收纳：去各工具目录找同名真身，
  // 让详情页能展示内容和"去同步中心收纳"引导，而不是卡在加载态
  ipcMain.handle("get_skill", handle(({ name }) => {
    const fs = require("node:fs");
    const m = hub.loadManifest();
    const entry = m.skills[name];
    const dir = path.join(hub.skillsDir(), name);
    if (entry || fs.existsSync(dir)) {
      return {
        manifest: entry ? {
          ...entry,
          sources: entry.sources || [],
          mounts: entry.mounts || [],
          mergeHistory: entry.mergeHistory || [],
        } : null,
        dir,
        health: fs.existsSync(dir) ? scanner.healthCheck(dir) : [],
        skillMd: fs.existsSync(path.join(dir, "SKILL.md"))
          ? fs.readFileSync(path.join(dir, "SKILL.md"), "utf-8")
          : "",
        sources: [],
      };
    }
    for (const t of adapter.resolveScanTargets(C())) {
      const p = path.join(t.dir, name);
      if (fs.existsSync(p) && !mounter.isLink(p)) {
        return {
          manifest: null,
          dir: "",
          health: scanner.healthCheck(p),
          skillMd: fs.existsSync(path.join(p, "SKILL.md"))
            ? fs.readFileSync(path.join(p, "SKILL.md"), "utf-8")
            : "",
          sources: [{ tool: t.id, name }],
        };
      }
    }
    return null;
  }));

  ipcMain.handle("sync_plan", handle(() => syncer.planSync(C())));
  ipcMain.handle("sync_execute", handle(({ plan }) => {
    const busy = remotesync.runningHint();
    if (busy) return fail(busy); // 两个同步都动中央仓库，禁止并发
    return syncer.executeSync(C(), plan);
  }));
  ipcMain.handle("list_reports", handle(() => report.listReports(30, ""))); // 全部报告（sync-*/webdav-*），前端按前缀过滤
  ipcMain.handle("read_report", handle(({ file }) => ({ content: report.readReport(file) })));
  ipcMain.handle("open_report", handle(async ({ file }) => {
    const p = path.join(hub.reportsDir(), path.basename(file));
    await shell.openPath(p);
    return ok({});
  }));

  ipcMain.handle("list_conflicts", handle(() => syncer.loadConflicts().items.filter((x) => !x.resolved)));
  ipcMain.handle("get_conflict_diff", handle(({ id }) => {
    const item = syncer.loadConflicts().items.find((x) => x.id === id);
    if (!item) return null;
    const fs = require("node:fs");
    const readMd = (p) => {
      const f = p && path.join(p, "SKILL.md");
      return f && fs.existsSync(f) ? fs.readFileSync(f, "utf-8") : "";
    };
    // remote 冲突：左边是本机中央版，右边是同步时暂存的远端版
    if (item.kind === "remote") {
      const localDir = path.join(hub.skillsDir(), item.skill);
      const remoteDir = remotesync.stagingDir(item.skill);
      return {
        item,
        left: { label: "本机版", path: localDir, md: readMd(localDir) },
        right: { label: "远端版", path: remoteDir, md: readMd(remoteDir) },
      };
    }
    const leftPath = item.kind === "content" ? path.join(item.dir, item.skill) : null;
    const rightPath = path.join(hub.skillsDir(), item.skill || "");
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
      : item.kind === "remote"
        ? remotesync.resolveRemoteConflict(item, choice, C())
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

  ipcMain.handle("toggle_mount", handle(({ skill, toolId, enable }) => syncer.toggleMount(skill, toolId, enable, C())));
  ipcMain.handle("repair_mounts", handle(() => syncer.repairMounts(C())));

  ipcMain.handle("trash_list", handle(() => hub.listTrash()));
  ipcMain.handle("trash_restore", handle(({ name }) => hub.restoreFromTrash(name)));
  ipcMain.handle("trash_purge", handle(() => ({ purged: hub.purgeTrash(C().trashDays || 7) })));

  ipcMain.handle("remove_skill", handle(({ name }) => hub.removeSkill(name)));

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
