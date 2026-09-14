// 自测：工具适配器自定义——注册表融合 / 扫描发现 / id 生成 / 配置校验 / 删除引用链
// 全部在系统临时目录造假环境，不碰用户真实的 ~/.zcode ~/.codex ~/.agent_skills
// 跑法：npm run selftest:tools
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert");

// 必须最先设置：中央仓库与 fake home 都指到临时目录
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "agent-skills-tools-"));
process.env.AGENT_SKILLS_HOME = path.join(TMP, "hub");
process.env.AGENT_SKILLS_FAKE_HOME = path.join(TMP, "home");
process.env.APPDATA = path.join(TMP, "appdata");
process.env.LOCALAPPDATA = path.join(TMP, "localappdata");
fs.mkdirSync(path.join(TMP, "home"), { recursive: true });

const adapter = require("../electron/backend/adapter.cjs");
const config = require("../electron/backend/config.cjs");
const syncer = require("../electron/backend/syncer.cjs");
const hub = require("../electron/backend/hub.cjs");
const mounter = require("../electron/backend/mounter.cjs");
const scanner = require("../electron/backend/scanner.cjs");

let passed = 0;
function check(name, cond) {
  if (!cond) {
    console.error(`✗ ${name}`);
    process.exitCode = 1;
    assert.fail(name);
  }
  passed++;
  console.log(`✓ ${name}`);
}

function mkSkill(dir, name, desc) {
  const d = path.join(dir, name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(
    path.join(d, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${desc}\nmetadata:\n  version: 1.0.0\n---\n\n# ${name}\n\n${desc}\n`,
    "utf-8"
  );
  return d;
}

// ---- 造假环境：fake home 下建 agent 目录，中央仓库指临时 hub ----
const home = process.env.AGENT_SKILLS_FAKE_HOME;
const cursorDir = path.join(home, ".cursor", "skills");
const qoderDir = path.join(home, ".qoder", "skills");
const rooDir = path.join(home, ".roo", "skills");
fs.mkdirSync(cursorDir, { recursive: true });
fs.mkdirSync(qoderDir, { recursive: true });
fs.mkdirSync(rooDir, { recursive: true });
mkSkill(cursorDir, "c-skill", "Cursor 技能");
mkSkill(qoderDir, "q-skill", "Qoder 技能");

const cfg = config.loadConfig();
cfg.tools = {
  zcode: { enabled: false, paths: [] },
  codex: { enabled: false, paths: [] },
  claude: { enabled: false, paths: [] },
  antigravity: { enabled: false, paths: [] },
  agents: { enabled: false, paths: [] },
};
cfg.customDirs = [];
config.saveConfig(cfg);

// ---- id 生成 ----
check("slugify 英文名", adapter.slugifyId("Cursor") === "cursor");
check("slugify 中文名压成 agent", adapter.slugifyId("我的 Agent") === "agent");
check("slugify 大小写与空格", adapter.slugifyId("My Tool") === "my-tool");
check("freshId 与内置不撞", adapter.freshId(cfg, "zcode") === "zcode-2");

// ---- 内置条目融合 ----
{
  const e = adapter.toolEntry({ tools: {} }, "zcode");
  check("内置默认名与图标", e.name === "ZCode" && e.icon === "ph-terminal-window");
  check("内置 paths 清空回退默认候选", e.paths.includes(".zcode/skills"));
  const c2 = { tools: { zcode: { name: "我改了名", icon: "ph-code", enabled: false, paths: ["D:\\xx"] } } };
  const e2 = adapter.toolEntry(c2, "zcode");
  check("内置显示名/图标可覆盖", e2.name === "我改了名" && e2.icon === "ph-code");
  check("内置停用生效", e2.enabled === false);
  check("内置 paths 用配置值", e2.paths[0] === "D:\\xx");
}

// ---- 自定义条目 ----
{
  cfg.tools.cursor = { name: "Cursor", icon: "ph-robot", enabled: true, paths: ["~/.cursor/skills"] };
  config.saveConfig(cfg);
  const e = adapter.toolEntry(cfg, "cursor");
  check("自定义条目字段全来自配置", e.builtin === false && e.deletable === true && e.icon === "ph-robot");
  const r = adapter.resolveToolDir(cfg, "cursor");
  check("自定义工具 ~ 展开命中", r && r.dir === cursorDir);
  const rows = adapter.listTools(cfg);
  check("listTools 含内置与自定义", rows.length === 6 && rows.find((x) => x.id === "cursor")?.builtin === false);
  const targets = adapter.resolveScanTargets(cfg);
  check("扫描目标含自定义工具", targets.some((t) => t.id === "cursor" && t.dir === cursorDir));
  const scanned = scanner.scanAll(cfg, adapter);
  check("自定义工具目录扫到技能", scanned.skills.some((s) => s.name === "c-skill" && s.tool === "cursor"));
}

// ---- 扫描发现 ----
{
  const detected = adapter.probeAgents(cfg);
  check("发现 qoder 与 roo", detected.some((d) => d.suggestId === "qoder") && detected.some((d) => d.suggestId === "roo"));
  check("已注册 cursor 不再建议", !detected.some((d) => d.suggestId === "cursor"));
  const q = detected.find((d) => d.suggestId === "qoder");
  check("命中目录与技能数", q && q.hitDirs[0] === qoderDir && q.skillCount === 1);
  check("%APPDATA% 前缀展开", adapter.expandPath("%APPDATA%/X") === path.join(process.env.APPDATA, "X"));
  check("%LOCALAPPDATA% 前缀展开", adapter.expandPath("%LOCALAPPDATA%/Y") === path.join(process.env.LOCALAPPDATA, "Y"));
}

// ---- 配置校验 ----
{
  const bad1 = JSON.parse(JSON.stringify(cfg));
  bad1.tools["Bad Id!"] = { name: "x", paths: [] };
  let threw1 = false;
  try { config.saveConfig(bad1); } catch { threw1 = true; }
  check("非法 id 拒绝保存", threw1);

  const bad2 = JSON.parse(JSON.stringify(cfg));
  bad2.tools.cursor2 = { icon: "ph-robot", enabled: true, paths: [] }; // 自定义缺 name
  let threw2 = false;
  try { config.saveConfig(bad2); } catch { threw2 = true; }
  check("自定义工具缺显示名拒绝保存", threw2);

  const bad3 = JSON.parse(JSON.stringify(cfg));
  bad3.tools.cursor2 = { name: "x", paths: [path.join(process.env.AGENT_SKILLS_HOME, "skills")] }; // 扫中央仓库自己
  let threw3 = false;
  try { config.saveConfig(bad3); } catch { threw3 = true; }
  check("候选路径指进中央仓库拒绝保存", threw3);

  const bad4 = JSON.parse(JSON.stringify(cfg));
  bad4.customDirs = [process.env.AGENT_SKILLS_HOME];
  let threw4 = false;
  try { config.saveConfig(bad4); } catch { threw4 = true; }
  check("自定义目录指进中央仓库拒绝保存", threw4);

  const ok1 = JSON.parse(JSON.stringify(cfg));
  ok1.tools.zcode.name = ""; // 内置名可空（回退注册表默认）
  config.saveConfig(ok1);
  check("内置工具缺名不拦（回退默认名）", true);
}

// ---- 删除自定义工具：干跑 / 冲突拦截 / 摘挂载 ----
{
  // 造一个已收纳技能 + 挂载到 cursor 目录，并放一条未裁决冲突引用
  const skillDir = mkSkill(path.join(TMP, "src"), "mount-me", "挂载测试技能");
  const entry = { name: "mount-me", dir: skillDir, skillName: "mount-me", description: "挂载测试技能", version: "", treeHash: scanner.treeHash(skillDir), health: [], sources: [{ tool: "cursor", name: "mount-me", dir: skillDir }] };
  check("收纳技能成功", hub.importSkill(entry).action === "imported");
  const r = mounter.mount("mount-me", cursorDir, cfg.mountMode, "mount-me");
  check("挂载到自定义工具目录成功", r.action === "mounted" && fs.existsSync(path.join(cursorDir, "mount-me")));
  hub.setMount("mount-me", "cursor", path.join(cursorDir, "mount-me"), "junction", true);
  syncer.upsertConflict({ id: "content:mount-me@cursor", kind: "content", skill: "mount-me", toolId: "cursor", dir: cursorDir, title: "cursor:mount-me 内容冲突", detail: "x" });

  const plan = syncer.removeCustomTool(cfg, "cursor", false);
  check("干跑报挂载/来源/冲突", plan.ok && plan.mounts.length === 1 && plan.sourceCount === 1 && plan.openConflicts === 1);
  const refused = syncer.removeCustomTool(cfg, "cursor", true);
  check("有未裁决冲突拒绝删除", refused.ok === false);

  // 裁决掉冲突再删
  const store = syncer.loadConflicts();
  store.items[0].resolved = { at: new Date().toISOString(), choice: "dismissed" };
  syncer.saveConflicts(store);
  const done = syncer.removeCustomTool(cfg, "cursor", true);
  check("裁决后删除成功", done.ok === true && done.unmounted === 1);
  check("挂载链接已摘除", !fs.existsSync(path.join(cursorDir, "mount-me")));
  check("中央真身还在", fs.existsSync(path.join(process.env.AGENT_SKILLS_HOME, "skills", "mount-me")));
  check("技能目录本体还在", fs.existsSync(skillDir));
  const m = hub.loadManifest();
  check("manifest 挂载记录已清", (m.skills["mount-me"].mounts || []).length === 0);
  check("来源记录保留为历史", (m.skills["mount-me"].sources || []).some((s) => s.tool === "cursor"));
  check("mergeHistory 有删除交代", (m.skills["mount-me"].mergeHistory || []).some((h) => h.action === "tool-removed"));
  check("config 里已无 cursor", !config.loadConfig().tools.cursor);
  check("内置工具拒绝删除", syncer.removeCustomTool(config.loadConfig(), "zcode", true).ok === false);
}

console.log(`\n全部通过：${passed} 项`);
