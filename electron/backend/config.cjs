// 配置读写 + 中央仓库目录
// AGENT_SKILLS_HOME 是给自测脚本用的，把仓库指到临时目录，免得碰真实数据
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

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
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
  return mergeDeep(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), disk);
}

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

module.exports = { hubDir, ensureHub, loadConfig, saveConfig, getUpdateNotified, setUpdateNotified, DEFAULT_CONFIG };
