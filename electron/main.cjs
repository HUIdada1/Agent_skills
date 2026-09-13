// 主进程入口：窗口、单实例锁、退出时静默装更新
"use strict";
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");
const ipc = require("./backend/ipc.cjs");
const updater = require("./backend/updater.cjs");

const DEV_URL = process.env.VITE_DEV_SERVER_URL || "http://localhost:1420";

let mainWindow = null;

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

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());

  app.whenReady().then(() => {
    ipc.register({ ipcMain, app, shell: require("electron").shell });
    createWindow();
    updater.init({ onShowWindow: showWindow });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });

  app.on("before-quit", (e) => {
    // 下载完的更新：拦下这次退出，静默装完自动重启
    if (updater.pendingInstall()) {
      e.preventDefault();
      updater.triggerInstall();
    }
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
