// 预加载脚本：通过 contextBridge 暴露安全的 IPC 调用桥给渲染进程
// 白名单机制：只放行后端 ipc.cjs 已注册的命令，防止渲染进程被注入后调用任意通道（纵深防御）
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

const ALLOWED_COMMANDS = new Set([
  // 应用信息
  "get_app_version",
  "get_is_portable",
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
