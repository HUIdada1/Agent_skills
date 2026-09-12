// IPC 封装：Electron 环境下通过 preload 桥接调用主进程；浏览器环境下回退到本地 mock（便于独立开发/预览 UI）。

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

/** Electron preload 桥接（window.agentSkills.invoke / onUpdateEvent） */
declare global {
  interface Window {
    agentSkills?: {
      invoke: InvokeFn;
      onUpdateEvent?: (callback: (payload: unknown) => void) => () => void;
    };
  }
}

function isElectron(): boolean {
  return typeof window !== "undefined" && !!window.agentSkills;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isElectron()) {
    return (await window.agentSkills!.invoke(cmd, args)) as T;
  }
  // 浏览器回退：无后端，返回适合骨架展示的空值
  return Promise.resolve(null as T);
}

// ===== 应用信息 =====
export const getAppVersion = () => call<string>("get_app_version");
export const getIsPortable = () => call<boolean>("get_is_portable");
