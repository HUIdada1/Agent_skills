// Electron 主进程入口：窗口 / 单实例锁 / 退出时静默安装更新
"use strict";
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");
const ipc = require("./backend/ipc.cjs");
const updater = require("./backend/updater.cjs");

const DEV_URL = process.env.VITE_DEV_SERVER_URL || "http://localhost:1420";

let mainWindow = null;

/** 资源目录：打包后为 process.resourcesPath 的相邻 build，开发时为项目 build/ */
function iconPath() {
  const p = app.isPackaged
    ? path.join(process.resourcesPath, "build", "icon.png")
    : path.join(__dirname, "..", "build", "icon.png");
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

// ===== 单实例锁 =====
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());

  app.whenReady().then(() => {
    ipc.register({ ipcMain, app, shell: require("electron").shell });
    createWindow();
    // 软件更新：启动后由 updater 自行定时检查（启动 60 秒 + 每 6 小时）
    updater.init({ onShowWindow: showWindow });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });

  app.on("before-quit", (e) => {
    // 已下载完成的更新：拦截本次退出，静默安装后自动重启（triggerInstall 内部防重入）
    if (updater.pendingInstall()) {
      e.preventDefault();
      updater.triggerInstall();
      return;
    }
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
