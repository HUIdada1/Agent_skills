// IPC 命令注册中心：preload 白名单放行的命令在这里落地
"use strict";
const { app } = require("electron");

function register({ ipcMain }) {
  ipcMain.handle("get_app_version", () => app.getVersion());
  ipcMain.handle("get_is_portable", () => {
    // 便携版判定：electron-builder portable 目标运行时设置 PORTABLE_EXECUTABLE_DIR
    return !!(process.env.PORTABLE_EXECUTABLE_DIR);
  });
}

module.exports = { register };
