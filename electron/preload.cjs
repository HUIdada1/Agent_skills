// 给渲染进程暴露 IPC 桥。白名单只放行 ipc.cjs 里注册过的命令
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

const ALLOWED_COMMANDS = new Set([
  "get_app_version",
  "get_is_portable",
  "set_titlebar_theme",
  "get_update_status",
  "check_update",
  "download_update",
  "install_update",
  "open_release_page",
  "open_repo_page",
  "load_config",
  "save_config",
  "webdav_test",
  "webdav_sync",
  "webdav_cancel",
  "webdav_status",
  "webdav_logs",
  "webdav_devices",
  "list_tools",
  "get_overview",
  "list_skills",
  "get_skill",
  "sync_plan",
  "sync_execute",
  "list_reports",
  "read_report",
  "open_report",
  "list_conflicts",
  "get_conflict_diff",
  "resolve_conflict",
  "dismiss_conflict",
  "toggle_mount",
  "repair_mounts",
  "trash_list",
  "trash_restore",
  "trash_purge",
  "remove_skill",
  "open_data_dir",
  "get_data_dir",
  "browse_dir",
]);

contextBridge.exposeInMainWorld("agentSkills", {
  invoke: (cmd, args) => {
    if (!ALLOWED_COMMANDS.has(cmd)) {
      return Promise.reject(new Error(`未授权的 IPC 命令：${cmd}`));
    }
    return ipcRenderer.invoke(cmd, args);
  },
  // 主进程广播（目前只有更新状态），返回退订函数
  onUpdateEvent: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("app:event", listener);
    return () => ipcRenderer.removeListener("app:event", listener);
  },
});
