// 主进程通信封装。有 Electron 桥就走桥，纯浏览器预览时返回 null
import type {
  AppConfig, SkillRow, SkillDetail, Overview, SyncPlan, SyncResult, ConflictItem, ConflictDiff,
  ReportRow, ToolRow, TrashRow, UpdateStatus, UpdateEvent,
  WebDavStatus, RemoteDevice, WebDavLog,
} from "../types";

export type {
  AppConfig, SkillRow, SkillDetail, Overview, SyncPlan, SyncResult, ConflictItem, ConflictDiff,
  ReportRow, ToolRow, TrashRow, UpdateStatus, UpdateEvent,
  WebDavStatus, RemoteDevice, WebDavLog, WebDavEvent,
} from "../types";

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

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
    const res = (await window.agentSkills!.invoke(cmd, args)) as unknown;
    // 后端失败的返回也是对象，混进正常数据会把页面打花，这里统一拦下来转异常
    if (res && typeof res === "object" && (res as { ok?: unknown }).ok === false) {
      const msg = (res as { message?: unknown }).message;
      throw new Error(typeof msg === "string" && msg ? msg : `命令 ${cmd} 执行失败`);
    }
    return res as T;
  }
  // 纯浏览器预览（npm run dev:web）：开发模式下用假数据，方便直接调 UI
  if (import.meta.env.DEV) {
    const { mockCall } = await import("./mock-preview");
    const mocked = await mockCall(cmd);
    if (mocked !== undefined) return mocked as T;
  }
  return Promise.resolve(null as T);
}

export const getAppVersion = () => call<string>("get_app_version");
export const getIsPortable = () => call<boolean>("get_is_portable");
export const setTitlebarTheme = (theme: string) => call<void>("set_titlebar_theme", { theme });

export const loadConfig = () => call<AppConfig>("load_config");
export const saveConfig = (config: AppConfig) => call<{ ok: boolean; message: string }>("save_config", { config: JSON.parse(JSON.stringify(config)) });

export const webdavTest = (config?: AppConfig) => call<{ ok: boolean; message: string; latencyMs?: number }>("webdav_test", config ? { config: JSON.parse(JSON.stringify(config)) } : {});
export const webdavSync = () => call<{ ok: boolean; message?: string }>("webdav_sync");
export const webdavCancel = () => call<{ ok: boolean }>("webdav_cancel");
export const webdavStatus = () => call<WebDavStatus>("webdav_status");
export const webdavLogs = () => call<WebDavLog[]>("webdav_logs");
export const webdavDevices = () => call<{ devices: RemoteDevice[]; error?: string }>("webdav_devices");

export const listTools = () => call<ToolRow[]>("list_tools");
export const getOverview = () => call<Overview>("get_overview");
export const listSkills = () => call<SkillRow[]>("list_skills");
export const getSkill = (name: string) => call<SkillDetail | null>("get_skill", { name });

export const syncPlan = () => call<SyncPlan>("sync_plan");
export const syncExecute = (plan: SyncPlan) => call<SyncResult>("sync_execute", { plan: JSON.parse(JSON.stringify(plan)) });
export const listReports = () => call<ReportRow[]>("list_reports");
export const readReport = (file: string) => call<{ content: string }>("read_report", { file });
export const openReport = (file: string) =>
  call<{ ok: boolean }>("open_report", { file }).catch(() => ({ ok: false }));

export const listConflicts = () => call<ConflictItem[]>("list_conflicts");
export const getConflictDiff = (id: string) => call<ConflictDiff | null>("get_conflict_diff", { id });
export const resolveConflict = (id: string, choice: string) => call<{ ok: boolean; message: string }>("resolve_conflict", { id, choice });
export const dismissConflict = (id: string) => call<{ ok: boolean }>("dismiss_conflict", { id });

export const toggleMount = (skill: string, toolId: string, enable: boolean) =>
  call<{ ok: boolean; message: string }>("toggle_mount", { skill, toolId, enable });
export const repairMounts = () => call<{ repaired: number; details: string[] }>("repair_mounts");

export const trashList = () => call<TrashRow[]>("trash_list");
export const trashRestore = (name: string) => call<{ ok: boolean; message?: string; dest?: string }>("trash_restore", { name });
export const trashPurge = () => call<{ purged: number }>("trash_purge");

export const removeSkill = (name: string) => call<{ ok: boolean; message?: string }>("remove_skill", { name });

export const openDataDir = () =>
  call<{ ok: boolean }>("open_data_dir").catch(() => ({ ok: false }));
export const getDataDir = () => call<string>("get_data_dir");
export const browseDir = () => call<{ ok: boolean; canceled?: boolean; path: string | null }>("browse_dir");

export const onUpdateEvent = (cb: (payload: unknown) => void): (() => void) | undefined =>
  window.agentSkills?.onUpdateEvent?.((payload) => cb(payload));

export const getUpdateStatus = () => call<UpdateStatus>("get_update_status");
export const checkUpdate = () => call<UpdateStatus>("check_update");
export const downloadUpdate = () => call<UpdateStatus>("download_update");
export const installUpdate = () => call<UpdateStatus>("install_update");
export const openReleasePage = () => call<void>("open_release_page");
export const openRepoPage = () => call<void>("open_repo_page");
