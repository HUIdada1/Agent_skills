// 用户配置与中央仓库目录管理（Node 主进程侧）
// 中央仓库默认 ~/.agent_skills（D6）；自测脚本用环境变量 AGENT_SKILLS_HOME 重定向，绝不碰真实数据
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/** 中央仓库根目录：环境变量优先（自测用），默认用户主目录/.agent_skills */
function hubDir() {
  const custom = process.env.AGENT_SKILLS_HOME;
  if (custom && custom.trim()) return path.resolve(custom.trim());
  return path.join(os.homedir(), ".agent_skills");
}

/** 中央仓库布局：skills/ 唯一真身、reports/ MD 报告、.trash/ 回收站 */
function ensureHub() {
  const root = hubDir();
  for (const sub of ["skills", "reports", ".trash"]) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }
  return root;
}

const DEFAULT_CONFIG = {
  // 各工具候选路径（按序探测，存在即用）；id 与 adapter.cjs 内置表对应
  tools: {
    zcode: { enabled: true, paths: [".zcode/skills"] },
    codex: { enabled: true, paths: [".codex/skills"] },
    claude: { enabled: true, paths: [".claude/skills"] },
    antigravity: { enabled: true, paths: [".gemini/antigravity/skills", ".gemini/config/skills"] },
    agents: { enabled: true, paths: [".agents/skills"] },
  },
  // 自定义目录（绝对路径数组），同样参与扫描/挂载
  customDirs: [],
  // 挂载模式：junction（首选，无需管理员）/ copy（兜底）
  mountMode: "junction",
  // L3 语义相似度提示（默认关闭，D4/R4）
  l3: { enabled: false, threshold: 0.85 },
  // 回收站保留天数，超期由清理动作删除
  trashDays: 7,
  // 软件更新（R4 生效）
  update: { channel: "stable", autoCheck: true, notifiedVersion: "" },
};

const CONFIG_FILE = "config.json";

/** 配置文件路径（在中央仓库根下） */
function configFile() {
  return path.join(hubDir(), CONFIG_FILE);
}

/** 读取配置：默认值深合并磁盘配置；文件损坏时回落默认并保留坏文件为 config.json.bad */
function loadConfig() {
  const p = configFile();
  let disk = {};
  try {
    disk = JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (e) {
    if (fs.existsSync(p)) {
      try { fs.copyFileSync(p, p + ".bad"); } catch { /* 忽略 */ }
    }
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
  return mergeDeep(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), disk);
}

/** 保存配置：整体写入（渲染层持完整配置对象） */
function saveConfig(cfg) {
  ensureHub();
  fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2), "utf-8");
  return { ok: true, message: "已保存" };
}

function mergeDeep(base, over) {
  if (!over || typeof over !== "object" || Array.isArray(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) {
    if (base && typeof base[k] === "object" && !Array.isArray(base[k]) && over[k] && typeof over[k] === "object" && !Array.isArray(over[k])) {
      out[k] = mergeDeep(base[k], over[k]);
    } else if (over[k] !== undefined) {
      out[k] = over[k];
    }
  }
  return out;
}

/** 更新通知去重记录（updater 用） */
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
    /* 通知去重失败不影响主流程 */
  }
}

module.exports = { hubDir, ensureHub, loadConfig, saveConfig, getUpdateNotified, setUpdateNotified, DEFAULT_CONFIG };
