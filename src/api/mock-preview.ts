// 纯浏览器预览用的假数据：没有 Electron 桥时（npm run dev:web 直接开浏览器调 UI）
// 按 IPC 命令返回一份贴真实的样例，方便看布局与状态。打包产物走不到这里（DEV 才加载）。

const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60000).toISOString();

const CONFIG = {
  tools: {
    zcode: { enabled: true, paths: ["~/.zcode/skills"] },
    codex: { enabled: true, paths: ["~/.codex/skills"] },
    claude: { enabled: true, paths: ["~/.claude/skills"] },
    antigravity: { enabled: true, paths: ["~/.gemini/antigravity/skills", "~/.gemini/config/skills"] },
    agents: { enabled: false, paths: ["~/.agents/skills"] },
  },
  customDirs: ["D:\\我的技能库"],
  mountMode: "junction" as const,
  l3: { enabled: true, threshold: 0.85 },
  trashDays: 7,
  update: { channel: "stable", autoCheck: true, notifiedVersion: "0.1.1" },
  webdav: {
    endpoint: "https://dav.jianguoyun.com/dav",
    username: "me@example.com",
    password: "••••••••",
    root: "/agent-skills",
    deviceId: "b3f2a1c8-77d2-4e5a-9b01-3f6c8d2e4a7b",
    deviceName: "DESK-01",
  },
  schedule: { minimizeToTray: true, autoStart: true, hourly: false, daily: true, dailyTime: "09:00", notifyOnSuccess: false },
};

const TOOLS = [
  { id: "zcode", name: "ZCode", icon: "", enabled: true, dir: "C:\\Users\\demo\\.zcode\\skills", candidatePaths: [] },
  { id: "codex", name: "Codex", icon: "", enabled: true, dir: "C:\\Users\\demo\\.codex\\skills", candidatePaths: [] },
  { id: "claude", name: "Claude", icon: "", enabled: true, dir: "C:\\Users\\demo\\.claude\\skills", candidatePaths: [] },
  { id: "antigravity", name: "Antigravity", icon: "", enabled: false, dir: null, candidatePaths: [] },
  { id: "agents", name: "Agents", icon: "", enabled: false, dir: null, candidatePaths: [] },
];

// 摆在"同步进行中"的下载阶段，方便看进度条 / 步骤条 / 日志的运行时状态
const WEBDAV_STATUS = {
  running: true,
  configured: true,
  deviceId: "b3f2a1c8-77d2-4e5a-9b01-3f6c8d2e4a7b",
  deviceName: "DESK-01",
  lastSyncAt: ago(130),
  stage: "download",
  stageLabel: "下载技能",
  detail: "下载 code-review（远端有更新，本机未改动）",
  pct: 47,
  lastError: "",
};

const WEBDAV_LOGS = [
  { at: ago(3), text: "[连接检查] 检查远端连接…" },
  { at: ago(3), text: "[拉取清单] 拉取远端台账…" },
  { at: ago(2), text: "[拉取清单] 远端 12 个技能 / 12 个目录，本机 11 个" },
  { at: ago(2), text: "计划：下载 2 · 上传 1 · 冲突 0 · 删远端 0 · 删本机 0" },
  { at: ago(1), text: "[下载技能] 下载 code-review（远端有更新，本机未改动）" },
];

const DEVICES = {
  devices: [
    { id: "b3f2a1c8-77d2-4e5a-9b01-3f6c8d2e4a7b", name: "DESK-01", appVersion: "0.2.0", lastSyncAt: ago(3), self: true },
    { id: "5c9d2e71-1a44-4cbb-8f2a-90b6d3e7c1f4", name: "MACBOOK-AIR", appVersion: "0.2.0", lastSyncAt: ago(95), self: false },
  ],
};

const REPORTS = [
  { file: "webdav-20260913-1542.md", path: "C:\\Users\\demo\\.agent_skills\\reports\\webdav-20260913-1542.md", mtimeMs: NOW - 3 * 60000 },
  { file: "webdav-20260913-0930.md", path: "C:\\Users\\demo\\.agent_skills\\reports\\webdav-20260913-0930.md", mtimeMs: NOW - 375 * 60000 },
];

const TRASH = [
  { name: "old-skill-20260913-091501", path: "C:\\Users\\demo\\.agent_skills\\.trash\\old-skill-20260913-091501", trashedAt: NOW - 6 * 3600000, sizeBytes: 48213 },
];

const REPORT_TEXT = "# Agent_skills 同步报告\n\n- 设备：DESK-01\n- 下载 2 · 上传 1 · 冲突 0 · 跳过 0\n\n全部动作已记录。";

export async function mockCall(cmd: string): Promise<unknown> {
  switch (cmd) {
    case "load_config": return CONFIG;
    case "get_is_portable": return false;
    case "get_data_dir": return "C:\\Users\\demo\\.agent_skills";
    case "get_app_version": return "0.2.0";
    case "list_tools": return TOOLS;
    case "webdav_status": return WEBDAV_STATUS;
    case "webdav_logs": return WEBDAV_LOGS;
    case "webdav_devices": return DEVICES;
    case "list_reports": return REPORTS;
    case "read_report": return { content: REPORT_TEXT };
    case "trash_list": return TRASH;
    case "save_config": return { ok: true, message: "已保存" };
    case "webdav_test": return { ok: true, message: "连接成功（218ms）", latencyMs: 218 };
    case "get_update_status":
      return { status: "up-to-date", isPortable: false, currentVersion: "0.2.0", latestVersion: "0.2.0", percent: 0, notes: "", message: "" };
    case "get_overview":
      return {
        hubDir: "C:\\Users\\demo\\.agent_skills", skillCount: 11, manifestCount: 11, sourceCount: 14,
        l1Merged: 3, l2Conflicts: 0, tools: [], mountHealth: [], orphans: [], pendingConflicts: [],
        recentReports: [], trashCount: TRASH.length,
      };
    case "list_skills": return [];
    case "list_conflicts": return [];
    default: return undefined; // 没造的命令走原来的 null 降级
  }
}
