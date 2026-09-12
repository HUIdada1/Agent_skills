// IPC 封装：Electron 环境下通过 preload 桥接调用主进程；浏览器环境下回退到本地空数据（便于独立开发/预览 UI）。
import type {
  AppConfig, SkillRow, SkillDetail, Overview, SyncPlan, SyncResult, ConflictItem, ConflictDiff,
  ReportRow, ToolRow, TrashRow,
} from "../types";

// 类型随 API 一并供应（视图统一从本模块导入）
export type {
  AppConfig, SkillRow, SkillDetail, Overview, SyncPlan, SyncResult, ConflictItem, ConflictDiff,
  ReportRow, ToolRow, TrashRow,
} from "../types";

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
  // 浏览器回退：无后端，返回空值（视图层做空态呈现）
  return Promise.resolve(null as T);
}

// ===== 应用信息 =====
export const getAppVersion = () => call<string>("get_app_version");
export const getIsPortable = () => call<boolean>("get_is_portable");

// ===== 配置 =====
export const loadConfig = () => call<AppConfig>("load_config");
export const saveConfig = (config: AppConfig) => call<{ ok: boolean; message: string }>("save_config", { config: JSON.parse(JSON.stringify(config)) });

// ===== 工具与扫描 =====
export const listTools = () => call<ToolRow[]>("list_tools");
export const getOverview = () => call<Overview>("get_overview");
export const listSkills = () => call<SkillRow[]>("list_skills");
export const getSkill = (name: string) => call<SkillDetail | null>("get_skill", { name });

// ===== 同步 =====
export const syncPlan = () => call<SyncPlan>("sync_plan");
export const syncExecute = (plan: SyncPlan) => call<SyncResult>("sync_execute", { plan: JSON.parse(JSON.stringify(plan)) });
export const listReports = () => call<ReportRow[]>("list_reports");
export const readReport = (file: string) => call<{ content: string }>("read_report", { file });
export const openReport = (file: string) => call<{ ok: boolean }>("open_report", { file });

// ===== 冲突 =====
export const listConflicts = () => call<ConflictItem[]>("list_conflicts");
export const getConflictDiff = (id: string) => call<ConflictDiff | null>("get_conflict_diff", { id });
export const resolveConflict = (id: string, choice: string) => call<{ ok: boolean; message: string }>("resolve_conflict", { id, choice });
export const dismissConflict = (id: string) => call<{ ok: boolean }>("dismiss_conflict", { id });

// ===== 挂载管理 =====
export const toggleMount = (skill: string, toolId: string, enable: boolean) =>
  call<{ ok: boolean; message: string }>("toggle_mount", { skill, toolId, enable });
export const repairMounts = () => call<{ repaired: number; details: string[] }>("repair_mounts");

// ===== 回收站 =====
export const trashList = () => call<TrashRow[]>("trash_list");
export const trashRestore = (name: string) => call<{ ok: boolean; message?: string; dest?: string }>("trash_restore", { name });
export const trashPurge = () => call<{ purged: number }>("trash_purge");

// ===== 技能管理 =====
export const removeSkill = (name: string) => call<{ ok: boolean; message?: string }>("remove_skill", { name });

// ===== 目录与杂项 =====
export const openDataDir = () => call<{ ok: boolean }>("open_data_dir");
export const getDataDir = () => call<string>("get_data_dir");
export const browseDir = () => call<{ ok: boolean; canceled?: boolean; path: string | null }>("browse_dir");

// ===== 主进程事件 =====
export const onUpdateEvent = (cb: (payload: unknown) => void): (() => void) | undefined =>
  window.agentSkills?.onUpdateEvent?.((payload) => cb(payload));
