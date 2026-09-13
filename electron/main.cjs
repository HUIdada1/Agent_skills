// 主进程入口：窗口、托盘常驻、单实例锁、定时同步调度、退出时静默装更新
"use strict";
const path = require("node:path");
const { app, BrowserWindow, ipcMain, Tray, Menu, Notification } = require("electron");
const config = require("./backend/config.cjs");
const ipc = require("./backend/ipc.cjs");
const updater = require("./backend/updater.cjs");
const remotesync = require("./backend/remotesync.cjs");
const scheduler = require("./backend/scheduler.cjs");

const DEV_URL = process.env.VITE_DEV_SERVER_URL || "http://localhost:1420";

let mainWindow = null;
let tray = null;
let quitting = false;

function iconPath(name) {
  const p = app.isPackaged
    ? path.join(process.resourcesPath, "build", name || "icon.png")
    : path.join(__dirname, "..", "build", name || "icon.png");
  try {
    return require("electron").nativeImage.createFromPath(p);
  } catch {
    return require("electron").nativeImage.createEmpty();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    title: "Agent_skills",
    icon: iconPath(),
    autoHideMenuBar: true,
    // 隐藏系统标题栏（点击左上角图标弹系统菜单的行为随之消失），保留边缘缩放，
    // 右上角三按钮由系统 overlay 绘制；左上角品牌区由渲染层 titlebar 自绘
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#0d1015",
      symbolColor: "#9aa3b5",
      height: 40,
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  } else {
    mainWindow.loadURL(DEV_URL);
  }

  // 关闭 → 缩到托盘（除非真正退出），后台才能持续跑定时同步
  mainWindow.on("close", (e) => {
    const cfg = config.loadConfig();
    if (!quitting && cfg.schedule && cfg.schedule.minimizeToTray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function triggerSync() {
  const cfg = config.loadConfig();
  if (remotesync.isRunning()) return;
  if (!remotesync.configured(cfg)) {
    notify("Agent_skills", "请先在「WebDAV 同步」页配置服务器地址和账号");
    return;
  }
  remotesync.run(cfg).catch(() => {});
}

// ===== 托盘 =====

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 托盘菜单（动态构建：同步状态 + 更新提示 + 暂停/恢复定时同步） */
function buildTrayMenu() {
  const cfg = config.loadConfig();
  const running = remotesync.isRunning();
  const p = remotesync.progress();
  const statusText = running
    ? `同步中…（${p.stageLabel}）`
    : remotesync.configured(cfg)
      ? `上次同步 ${fmtTime(remotesync.loadRemoteState().lastSyncAt) || "—"}`
      : "未配置 WebDAV";
  const items = [
    { label: statusText, enabled: false },
    { type: "separator" },
  ];
  const st = updater.getStatus();
  if (st.status === "available" || st.status === "downloaded") {
    items.push({ label: `发现新版本 v${st.latestVersion} →`, click: () => { showWindow(); focusUpdater(); } });
    items.push({ type: "separator" });
  }
  items.push(
    { label: "显示主界面", click: showWindow },
    { label: "立即同步", enabled: remotesync.configured(cfg) && !running, click: triggerSync },
    {
      label: scheduler.isPaused() ? "恢复定时同步" : "暂停定时同步",
      enabled: remotesync.configured(cfg) && !!(cfg.schedule && (cfg.schedule.hourly || cfg.schedule.daily)),
      click: () => { scheduler.setPaused(!scheduler.isPaused()); refreshTrayMenu(); },
    },
    { type: "separator" },
    { label: "退出", click: () => { quitting = true; app.quit(); } },
  );
  return Menu.buildFromTemplate(items);
}

function focusUpdater() {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("app:event", { event: "focus-update" });
    }
  } catch { /* 无窗口就算了 */ }
}

function refreshTrayMenu() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  const small = iconPath("tray.png");
  tray = new Tray(small.isEmpty() ? iconPath() : small);
  tray.setToolTip("Agent_skills");
  refreshTrayMenu();
  tray.on("double-click", showWindow);
}

// ===== 桌面通知：默认仅同步失败提醒，设置页可开启「成功也通知」；失败持续期间不重复弹 =====

let lastNotifiedOk = null;
function notifySync(ok, message) {
  try {
    refreshTrayMenu();
    if (!Notification.isSupported()) return;
    if (ok) {
      lastNotifiedOk = true;
      const cfg = config.loadConfig();
      if (!(cfg.schedule && cfg.schedule.notifyOnSuccess)) return;
    } else {
      // 失败持续中不重复打扰；首次失败/失败恢复后再失败才提醒
      if (lastNotifiedOk === false) return;
      lastNotifiedOk = false;
    }
    const n = new Notification({
      title: ok ? "WebDAV 同步完成" : "WebDAV 同步失败",
      body: message || (ok ? "中央仓库已与远端同步" : "请检查 WebDAV 配置与网络"),
      icon: iconPath(),
    });
    n.show();
  } catch {
    /* 通知失败静默 */
  }
}

function notify(title, body) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: iconPath() });
  n.show();
}

// ===== 单实例锁 =====
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());

  app.whenReady().then(() => {
    ipc.register({ ipcMain, app, shell: require("electron").shell });
    remotesync.setOnFinish(notifySync);
    createWindow();
    createTray();
    scheduler.start();
    updater.init({ onShowWindow: showWindow, onTrayRefresh: refreshTrayMenu });

    // 依据配置启用开机自启（便携版不支持：注册的会是临时解压副本路径，退出即失效）
    config.applyAutoStart(config.loadConfig());

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });

  app.on("before-quit", (e) => {
    // 下载完的更新：拦下这次退出，静默装完自动重启
    if (updater.pendingInstall()) {
      e.preventDefault();
      quitting = true;
      scheduler.stop();
      updater.triggerInstall();
      return;
    }
    quitting = true;
    scheduler.stop();
  });

  app.on("window-all-closed", () => {
    // Windows 常驻托盘，不随窗口关闭退出（定时同步要后台跑）
  });
}
