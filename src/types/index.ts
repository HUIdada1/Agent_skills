// 跟 electron/backend 返回的数据结构一一对应

export type HealthIssue = { level: "warn" | "bad"; text: string };

export type SkillSource = { tool: string; originalName?: string; name?: string; dir?: string; firstSeen?: string; origin?: string };

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
  /** user=用户安装；system=工具自带（默认隐藏，搜索可见，永不收纳） */
  origin?: "user" | "system";
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
  orphans: OrphanRow[];
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
  orphans: OrphanRow[];
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
  kind: "content" | "diff-link" | "norm" | "remote";
  skill?: string;
  toolId?: string;
  dir?: string;
  title: string;
  detail: string;
  a?: string;
  b?: string;
  localHash?: string;
  remoteHash?: string;
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
  webdav: {
    endpoint: string;
    username: string;
    password: string;
    root: string;
    deviceId: string;
    deviceName: string;
  };
  schedule: {
    minimizeToTray: boolean;
    autoStart: boolean;
    hourly: boolean;
    daily: boolean;
    dailyTime: string;
    notifyOnSuccess: boolean;
  };
};

export type ToolRow = { id: string; name: string; icon: string; enabled: boolean; dir: string | null; candidatePaths: string[] };

// 孤儿目录：工具目录里真实存在、但中央仓库 manifest 还没记录的技能目录
export type OrphanRow = { name: string; tool: string; dir: string; mtimeMs?: number };

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
  /** 未收纳技能：探测到的工具目录来源 */
  sources?: SkillSource[];
};

export type UpdateStatus = {
  status: "idle" | "checking" | "up-to-date" | "available" | "downloading" | "downloaded" | "error";
  isPortable: boolean;
  currentVersion: string;
  latestVersion: string;
  percent: number;
  notes: string;
  message: string;
};

export type UpdateEvent = UpdateStatus & { event: "state" | "focus-update" };

// ===== WebDAV 跨设备同步 =====

export type WebDavStatus = {
  running: boolean;
  configured: boolean;
  deviceId: string;
  deviceName: string;
  lastSyncAt: string;
  stage: "idle" | "connect" | "pull" | "download" | "upload" | "push" | "done" | "cancelled" | "error";
  stageLabel: string;
  detail: string;
  pct?: number;
  lastError: string;
};

export type RemoteDevice = { id: string; name: string; appVersion: string; lastSyncAt: string; self: boolean };

export type WebDavLog = { at: string; text: string };

export type WebDavEvent = { event: "webdav"; stage: string; detail: string; pct?: number; running: boolean };

