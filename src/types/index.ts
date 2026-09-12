// 与 electron/backend 数据契约对齐的前端类型定义

export type HealthIssue = { level: "warn" | "bad"; text: string };

export type SkillSource = { tool: string; originalName?: string; name?: string; dir?: string; firstSeen?: string };

export type SkillMount = {
  tool: string;
  name: string;
  path: string;
  type: "junction" | "copy";
  enabled: boolean;
};

export type SkillRow = {
  name: string;
  skillName: string;
  description: string;
  version: string;
  treeHash: string;
  health: HealthIssue[];
  sources: SkillSource[];
  inManifest: boolean;
  mounts: SkillMount[];
  mtimeMs: number;
};

export type Overview = {
  hubDir: string;
  skillCount: number;
  manifestCount: number;
  sourceCount: number;
  l1Merged: number;
  l2Conflicts: number;
  tools: { id: string; name: string; dir: string; skillCount: number; mountCount: number }[];
  mountHealth: { skill: string; tool: string; name: string; path: string; type: string; enabled: boolean; isLink: boolean; valid: boolean }[];
  orphans: { name: string; tool: string; dir: string }[];
  pendingConflicts: ConflictItem[];
  recentReports: ReportRow[];
  trashCount: number;
};

export type ReportRow = { file: string; path: string; mtimeMs: number };

export type SyncAction = {
  type: "import" | "mount" | "skip" | "error" | "conflict";
  skill: string;
  mountName?: string;
  toolId?: string;
  parentDir?: string;
  dir?: string;
  replaceReal?: boolean;
  note: string;
  sources?: { tool: string; name: string; dir: string }[];
};

export type SyncPlan = {
  mode: "junction" | "copy";
  actions: SyncAction[];
  conflicts: ConflictItem[];
  orphans: { name: string; tool: string; dir: string }[];
  dedup: { duplicates: { kept: { name: string; tool: string }; removed: { name: string; tool: string }; rule: string; basis: string }[]; hints: { a: string; b: string; sim: number }[] };
  scannedSummary: { id: string; name: string; dir: string; skillCount: number; mountCount: number }[];
};

export type SyncResult = {
  mode: string;
  summary: { imported: number; merged: number; conflicts: number; skipped: number; mounted: number; repaired: number; cleaned: number };
  imports: { name: string; sources: string; action: string; path: string }[];
  merges: { kept: string; removed: string; basis: string }[];
  conflicts: { title: string; detail: string }[];
  mounts: { skill: string; dir: string; action: string; outcome: string }[];
  manifestDiff: string[];
  reportFile: string;
};

export type ConflictItem = {
  id: string;
  kind: "content" | "diff-link" | "norm";
  skill?: string;
  toolId?: string;
  dir?: string;
  title: string;
  detail: string;
  a?: string;
  b?: string;
  at: string;
  resolved?: { at: string; choice: string };
};

export type ConflictDiff = {
  item: ConflictItem;
  left: { label: string; path: string; md: string };
  right: { label: string; path: string; md: string };
};

export type AppConfig = {
  tools: Record<string, { enabled: boolean; paths: string[] }>;
  customDirs: string[];
  mountMode: "junction" | "copy";
  l3: { enabled: boolean; threshold: number };
  trashDays: number;
  update: { channel: string; autoCheck: boolean; notifiedVersion: string };
};

export type ToolRow = { id: string; name: string; icon: string; enabled: boolean; dir: string | null; candidatePaths: string[] };

export type TrashRow = { name: string; path: string; trashedAt: number; sizeBytes: number };

export type SkillDetail = {
  manifest: {
    name: string;
    version: string;
    description: string;
    treeHash: string;
    skillName: string;
    sources: SkillSource[];
    mounts: SkillMount[];
    mergeHistory: { at: string; action: string; detail: string }[];
    health?: HealthIssue[];
  } | null;
  dir: string;
  health: HealthIssue[];
  skillMd: string;
};

/** 更新状态快照（主进程 updater.cjs 维护，经 invoke 拉取 + app:event 事件推送） */
export type UpdateStatus = {
  status: "idle" | "checking" | "up-to-date" | "available" | "downloading" | "downloaded" | "error";
  isPortable: boolean;
  currentVersion: string;
  latestVersion: string;
  percent: number;
  notes: string;
  message: string;
};

/** 主进程推送的更新事件：event="state" 时其余字段为完整状态；event="focus-update" 为通知点击跳转信号 */
export type UpdateEvent = UpdateStatus & { event: "state" | "focus-update" };
