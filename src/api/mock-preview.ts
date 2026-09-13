// 纯浏览器预览用的假数据：没有 Electron 桥时（npm run dev:web 直接开浏览器调 UI）
// 按 IPC 命令返回一份贴真实的样例，方便看布局与状态。打包产物走不到这里（DEV 才加载）。
import { version as APP_VERSION } from "../../package.json";

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

// 样例技能覆盖五种状态：挂载启用 / 已停止 / 体检报错 / 体检警告 / 待收纳
const SKILLS = [
  {
    name: "design-taste-frontend", skillName: "design-taste-frontend",
    description: "反模板化前端设计技能：从需求推断设计方向，落地不像套模板的界面。",
    version: "1.2.0", treeHash: "a3f19c", health: [], inManifest: true,
    sources: [{ tool: "zcode" }, { tool: "codex", name: "design-taste" }],
    mounts: [
      { tool: "zcode", name: "design-taste-frontend", path: "C:\\Users\\demo\\.zcode\\skills\\design-taste-frontend", type: "junction" as const, enabled: true },
      { tool: "codex", name: "design-taste-frontend", path: "C:\\Users\\demo\\.codex\\skills\\design-taste-frontend", type: "junction" as const, enabled: true },
    ],
    mtimeMs: NOW - 40 * 60000,
  },
  {
    name: "browser-skill", skillName: "browser-skill",
    description: "操作用户已登录浏览器执行自动化：访问页面、填表、抓取与回归测试。",
    version: "0.9.4", treeHash: "77bd21", health: [], inManifest: true,
    sources: [{ tool: "zcode" }],
    mounts: [{ tool: "zcode", name: "browser-skill", path: "C:\\Users\\demo\\.zcode\\skills\\browser-skill", type: "junction" as const, enabled: false }],
    mtimeMs: NOW - 3 * 3600000,
  },
  {
    name: "selftest-core", skillName: "selftest-core",
    description: "核心引擎自测脚本：临时目录造假技能，校验去重、收纳与回收站全链路。",
    version: "", treeHash: "e01a5b",
    health: [{ level: "bad" as const, text: "缺少 SKILL.md，无法解析描述与元信息" }],
    inManifest: true,
    sources: [{ tool: "codex" }],
    mounts: [],
    mtimeMs: NOW - 26 * 3600000,
  },
  {
    name: "yunxiao-git-tasks", skillName: "yunxiao-git-tasks",
    description: "根据 Git 提交记录为云效项目拆分任务、批量创建工作项并登记工时。",
    version: "2.0.1", treeHash: "c49f02",
    health: [{ level: "warn" as const, text: "frontmatter 缺少 author 字段" }],
    inManifest: true,
    sources: [{ tool: "claude" }],
    mounts: [{ tool: "claude", name: "yunxiao-git-tasks", path: "C:\\Users\\demo\\.claude\\skills\\yunxiao-git-tasks", type: "junction" as const, enabled: true }],
    mtimeMs: NOW - 2 * 86400000,
  },
  {
    name: "brandkit", skillName: "brandkit",
    description: "高端品牌套件生成：logo 系统、视觉世界与品牌规范板。",
    version: "", treeHash: "9b7e30", health: [], inManifest: false,
    sources: [{ tool: "zcode" }],
    mounts: [],
    mtimeMs: NOW - 12 * 60000,
  },
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
    { id: "b3f2a1c8-77d2-4e5a-9b01-3f6c8d2e4a7b", name: "DESK-01", appVersion: APP_VERSION, lastSyncAt: ago(3), self: true },
    { id: "5c9d2e71-1a44-4cbb-8f2a-90b6d3e7c1f4", name: "MACBOOK-AIR", appVersion: APP_VERSION, lastSyncAt: ago(95), self: false },
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
    case "load_config": return JSON.parse(JSON.stringify(CONFIG));
    case "get_is_portable": return false;
    case "get_data_dir": return "C:\\Users\\demo\\.agent_skills";
    case "get_app_version": return APP_VERSION;
    case "list_tools": return TOOLS;
    case "list_skills": return SKILLS;
    case "webdav_status": return JSON.parse(JSON.stringify(WEBDAV_STATUS));
    case "webdav_logs": return WEBDAV_LOGS;
    case "webdav_devices": return DEVICES;
    case "list_reports": return REPORTS;
    case "read_report": return { content: REPORT_TEXT };
    case "trash_list": return TRASH;
    case "save_config": return { ok: true, message: "已保存" };
    case "webdav_test": return { ok: true, message: "连接成功（218ms）", latencyMs: 218 };
    case "get_update_status":
      return { status: "up-to-date", isPortable: false, currentVersion: APP_VERSION, latestVersion: APP_VERSION, percent: 0, notes: "", message: "" };
    case "get_overview":
      return {
        hubDir: "C:\\Users\\demo\\.agent_skills", skillCount: SKILLS.length, manifestCount: 4, sourceCount: 6,
        l1Merged: 2, l2Conflicts: 0, tools: [], mountHealth: [], orphans: [], pendingConflicts: [],
        recentReports: [], trashCount: TRASH.length,
      };
    case "list_skills": return [];
    case "list_conflicts": return [];
    default: return undefined; // 没造的命令走原来的 null 降级
  }
}
