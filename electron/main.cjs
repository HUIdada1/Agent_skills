// Electron 主进程入口：窗口 / 单实例锁（托盘与热更新在 R4 轮接入）
"use strict";
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");
const ipc = require("./backend/ipc.cjs");

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

// ===== 单实例锁 =====
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    ipc.register({ ipcMain, app, shell: require("electron").shell });
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else if (mainWindow) mainWindow.show();
    });
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
