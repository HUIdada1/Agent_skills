// 配置读写 + 中央仓库目录
// AGENT_SKILLS_HOME 是给自测脚本用的，把仓库指到临时目录，免得碰真实数据
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

// 便携版是临时解压目录，开机自启注册的路径退出即失效（自启开关要在设置页禁用）
function isPortable() {
  return !!process.env.PORTABLE_EXECUTABLE_DIR;
}

// WebDAV 密码用系统级密钥加密落盘（safeStorage 不可用就降级明文）。
// 渲染层永远只拿掩码，真值留在主进程
let safeStorage = null;
try { safeStorage = require("electron").safeStorage; } catch { /* 自测环境无 electron */ }
const ENC_PREFIX = "enc:v1:";

function encryptSecret(plain) {
  const s = String(plain || "");
  if (!s || s.startsWith(ENC_PREFIX)) return s; // 空值或已是密文不重复加密
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) return s;
  return ENC_PREFIX + safeStorage.encryptString(s).toString("base64");
}

function decryptSecret(stored) {
  const s = String(stored || "");
  if (!s.startsWith(ENC_PREFIX)) return s; // 明文（降级环境存的）直接用
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) return "";
  try {
    return safeStorage.decryptString(Buffer.from(s.slice(ENC_PREFIX.length), "base64"));
  } catch {
    return ""; // 密文来自其他机器解不开，让用户重填
  }
}

function hubDir() {
  const custom = process.env.AGENT_SKILLS_HOME;
  if (custom && custom.trim()) return path.resolve(custom.trim());
  return path.join(os.homedir(), ".agent_skills");
}

function ensureHub() {
  const root = hubDir();
  for (const sub of ["skills", "reports", ".trash"]) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }
  return root;
}

const DEFAULT_CONFIG = {
  // 各工具候选路径按顺序探测，取第一个存在的
  tools: {
    zcode: { enabled: true, paths: [".zcode/skills"] },
    codex: { enabled: true, paths: [".codex/skills"] },
    claude: { enabled: true, paths: [".claude/skills"] },
    antigravity: { enabled: true, paths: [".gemini/antigravity/skills", ".gemini/config/skills"] },
    agents: { enabled: true, paths: [".agents/skills"] },
  },
  customDirs: [],
  mountMode: "junction", // copy 是兜底
  l3: { enabled: false, threshold: 0.85 },
  trashDays: 7,
  update: { channel: "stable", autoCheck: true, notifiedVersion: "" },
  // WebDAV 跨设备同步（password 落盘是密文，内存里是明文）
  webdav: {
    endpoint: "",
    username: "",
    password: "",
    root: "/agent-skills",
    deviceId: "",     // 首次使用时惰性生成
    deviceName: "",   // 默认取计算机名
  },
  // 后台与调度
  schedule: {
    minimizeToTray: true, // 关窗缩到托盘
    autoStart: false,     // 开机自启（便携版无效）
    hourly: false,        // 每小时自动同步
    daily: false,         // 每天定时同步
    dailyTime: "09:00",
    notifyOnSuccess: false, // 同步成功也通知（失败总通知）
  },
  // 自动感知：后台每 15 秒快照各工具技能目录，有新技能且零冲突才自动收纳，有冲突只提醒
  watch: {
    enabled: true,
  },
};

function configFile() {
  return path.join(hubDir(), "config.json");
}

// 配置文件坏了就当没有，原件留个 .bad 好排查
function loadConfig() {
  const p = configFile();
  let disk = {};
  try {
    disk = JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (e) {
    if (fs.existsSync(p)) {
      try { fs.copyFileSync(p, p + ".bad"); } catch {}
    }
    disk = {};
  }
  // 整个文件不是对象（null/数字/数组）也当没有，不然合并完必炸
  if (!disk || typeof disk !== "object" || Array.isArray(disk)) disk = {};
  const c = mergeDeep(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), disk);
  c.webdav.password = decryptSecret(c.webdav.password);
  // deviceId / 本机名惰性补全并写回，保证多次调用稳定
  if (!c.webdav.deviceId || !c.webdav.deviceName) {
    if (!c.webdav.deviceId) c.webdav.deviceId = crypto.randomUUID();
    if (!c.webdav.deviceName) c.webdav.deviceName = os.hostname();
    try { saveConfig(c); } catch { /* 写不回去下次再补 */ }
  }
  return c;
}

// 保存前校验工具适配器：id 合法、自定义工具必须有名字、候选路径不许落进中央仓库（自己扫自己）
function validateToolConfig(cfg) {
  const { isBuiltinId, expandPath } = require("./adapter.cjs");
  const hub = path.resolve(hubDir());
  const errors = [];
  const pathOk = (p) => {
    if (typeof p !== "string" || !p.trim()) return true; // 空白交给探测层报"未命中"
    const abs = expandPath(p).toLowerCase();
    return abs !== hub.toLowerCase() && !abs.startsWith(hub.toLowerCase() + path.sep);
  };
  for (const [id, t] of Object.entries(cfg.tools || {})) {
    if (!isBuiltinId(id) && !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(id)) errors.push(`工具 id "${id}" 不合法（小写字母数字开头，可含 -_，最长 32 位）`);
    if (!t || typeof t !== "object" || Array.isArray(t)) { errors.push(`工具 ${id} 的配置损坏`); continue; }
    if (!isBuiltinId(id) && !String(t.name || "").trim()) errors.push(`工具 ${id} 缺显示名`);
    for (const p of t.paths || []) {
      if (!pathOk(p)) errors.push(`工具 ${id} 的候选路径指向中央仓库内部，会自己扫自己`);
    }
  }
  for (const p of cfg.customDirs || []) {
    if (!pathOk(p)) errors.push(`自定义目录 ${p} 指向中央仓库内部，会自己扫自己`);
  }
  return errors;
}

function saveConfig(cfg) {
  const errors = validateToolConfig(cfg);
  if (errors.length) {
    const e = new Error("配置校验未通过：" + errors.slice(0, 3).join("；"));
    e.toolErrors = errors;
    throw e;
  }
  ensureHub();
  const disk = JSON.parse(JSON.stringify(cfg));
  disk.webdav.password = encryptSecret(disk.webdav.password);
  fs.writeFileSync(configFile(), JSON.stringify(disk, null, 2), "utf-8");
  return { ok: true, message: "已保存" };
}

function mergeDeep(base, over) {
  if (!over || typeof over !== "object" || Array.isArray(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) {
    if (base && typeof base[k] === "object" && !Array.isArray(base[k]) && over[k] && typeof over[k] === "object" && !Array.isArray(over[k])) {
      out[k] = mergeDeep(base[k], over[k]);
    } else if (over[k] !== undefined && over[k] !== null) {
      // null 一律不收：磁盘上 webdav:null 这类值会把必填子对象打穿，读配置直接崩
      out[k] = over[k];
    }
  }
  return out;
}

function getUpdateNotified() {
  try {
    return loadConfig().update.notifiedVersion || "";
  } catch {
    return "";
  }
}

function setUpdateNotified(version) {
  try {
    const cfg = loadConfig();
    cfg.update.notifiedVersion = version || "";
    saveConfig(cfg);
  } catch {
    // 写不进去就算了，只是通知去重失效
  }
}

// 开机自启即时生效；便携版注册的是临时解压路径，开发模式不必注册
function applyAutoStart(cfg) {
  if (isPortable() || !require("electron").app || process.env.VITE_DEV_SERVER_URL) return;
  try {
    const app = require("electron").app;
    if (!app.isPackaged) return;
    app.setLoginItemSettings({ openAtLogin: !!(cfg.schedule && cfg.schedule.autoStart) });
  } catch { /* 注册失败不拦保存 */ }
}

module.exports = { hubDir, ensureHub, loadConfig, saveConfig, getUpdateNotified, setUpdateNotified, DEFAULT_CONFIG, isPortable, encryptSecret, decryptSecret, applyAutoStart };
