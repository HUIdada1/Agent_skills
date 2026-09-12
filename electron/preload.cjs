// 预加载脚本：通过 contextBridge 暴露安全的 IPC 调用桥给渲染进程
// 白名单机制：只放行后端 ipc.cjs 已注册的命令，防止渲染进程被注入后调用任意通道（纵深防御）
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

const ALLOWED_COMMANDS = new Set([
  // 应用信息
  "get_app_version",
  "get_is_portable",
  // 软件更新
  "get_update_status",
  "check_update",
  "download_update",
  "install_update",
  "open_release_page",
  "open_repo_page",
  // 配置
  "load_config",
  "save_config",
  // 工具与扫描
  "list_tools",
  "get_overview",
  "list_skills",
  "get_skill",
  // 同步
  "sync_plan",
  "sync_execute",
  "list_reports",
  "read_report",
  "open_report",
  // 冲突
  "list_conflicts",
  "get_conflict_diff",
  "resolve_conflict",
  "dismiss_conflict",
  // 挂载管理
  "toggle_mount",
  "repair_mounts",
  // 回收站
  "trash_list",
  "trash_restore",
  "trash_purge",
  // 技能管理
  "remove_skill",
  // 目录与杂项
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
  /** 订阅主进程事件（固定通道，主进程模块广播）；返回取消订阅函数 */
  onUpdateEvent: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("app:event", listener);
    return () => ipcRenderer.removeListener("app:event", listener);
  },
});
