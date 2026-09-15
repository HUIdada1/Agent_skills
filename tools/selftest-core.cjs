// 自测：临时目录里造假技能 + 造假工具目录，不碰用户真实数据
// 覆盖：解析/归一/哈希/去重/收纳/Junction/报告/裁决/启停/修复/回收站
// 跑法：npm run selftest:core
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert");

// 必须最先设置，config.cjs 读的就是它
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "agent-skills-selftest-"));
process.env.AGENT_SKILLS_HOME = path.join(TMP, "hub");

const scanner = require("../electron/backend/scanner.cjs");
const dedup = require("../electron/backend/dedup.cjs");
const config = require("../electron/backend/config.cjs");
const syncer = require("../electron/backend/syncer.cjs");
const hub = require("../electron/backend/hub.cjs");
const mounter = require("../electron/backend/mounter.cjs");

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

function mkSkill(dir, name, skillName, description, bodyExtra) {
  const d = path.join(dir, name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(
    path.join(d, "SKILL.md"),
    `---\nname: ${skillName}\ndescription: ${description}\nmetadata:\n  version: 1.0.0\n---\n\n# ${skillName}\n\n${description}\n${bodyExtra || ""}\n`,
    "utf-8"
  );
  fs.writeFileSync(path.join(d, "extra.txt"), bodyExtra || "same", "utf-8");
  return d;
}

// ---- 造假环境 ----
const zcode = path.join(TMP, "zcode-skills");
const codex = path.join(TMP, "codex-skills");
const claude = path.join(TMP, "claude-skills");
fs.mkdirSync(zcode, { recursive: true });
fs.mkdirSync(codex, { recursive: true });
fs.mkdirSync(claude, { recursive: true });

mkSkill(zcode, "alpha", "alpha", "Alpha 技能，用于基础收纳验证");
const brandkitV1 = "brandkit 统一内容标记 X";
mkSkill(zcode, "brandkit", "brandkit", "Premium brand-kit skill", brandkitV1);
mkSkill(codex, "brandkit", "brandkit", "Premium brand-kit skill", brandkitV1); // 和 zcode 一字不差 → L1
mkSkill(codex, "gpt-taste", "gpt-taste", "Elite taste skill 内容 Y");
mkSkill(codex, "taste-skill", "gpt-taste", "Elite taste skill 内容 Y"); // 目录改名副本：内容同 gpt-taste → L1 + 改名挂载
mkSkill(codex, "conflict1", "conflict1", "Codex 版本内容 P");
mkSkill(claude, "conflict1", "conflict1", "Claude 版本内容 P 与 Codex 不同"); // 同名异容 → 冲突
mkSkill(claude, "gsap", "gsap", "GSAP scroll skill 内容 Z");

// 全部指到临时目录，真实工具一律关掉
const cfg = config.loadConfig();
cfg.tools = {
  zcode: { enabled: true, paths: [zcode] },
  codex: { enabled: true, paths: [codex] },
  claude: { enabled: true, paths: [claude] },
  antigravity: { enabled: false, paths: [] },
  agents: { enabled: false, paths: [] },
};
cfg.customDirs = [];
config.saveConfig(cfg);

// ---- 名称归一 ----
check("归一 taste-skill → taste", dedup.normalizeName("taste-skill") === "taste");
check("归一 gpt-tasteskill → gpt-taste", dedup.normalizeName("gpt-tasteskill") === "gpt-taste");
check("归一 Gpt_Taste v1 → gpt-taste", dedup.normalizeName("Gpt_Taste v1") === "gpt-taste");

// ---- 块标量 description（anthropic 技能常见写法）----
{
  const blockDir = path.join(TMP, "block-scalar-probe");
  fs.mkdirSync(blockDir, { recursive: true });
  fs.writeFileSync(
    path.join(blockDir, "SKILL.md"),
    "---\nname: browser-skill\ndescription: |\n  Use when the user asks for automation\n  against their logged-in browser.\nmetadata:\n  version: 0.3.1\n---\n\n# body\n",
    "utf-8"
  );
  const parsed = scanner.parseSkillMd(blockDir);
  check("块标量 description 解析", parsed.ok && parsed.info.description.includes("logged-in browser"));
  check("块标量 metadata.version 解析", parsed.info.version === "0.3.1");
}

// ---- 扫描与哈希 ----
const scanned = scanner.scanAll(cfg, require("../electron/backend/adapter.cjs"));
check("扫描到 8 个技能目录", scanned.skills.length === 8);
check("frontmatter 解析出 description", scanned.skills.find((s) => s.name === "alpha").description.includes("Alpha"));
check("内容树哈希稳定（两次一致）", scanner.treeHash(path.join(zcode, "alpha")) === scanner.treeHash(path.join(zcode, "alpha")));
check("同内容不同目录哈希一致（brandkit×2）", scanner.treeHash(path.join(zcode, "brandkit")) === scanner.treeHash(path.join(codex, "brandkit")));
check("不同内容哈希不同", scanner.treeHash(path.join(zcode, "alpha")) !== scanner.treeHash(path.join(claude, "gsap")));

// ---- 去重 ----
const d = dedup.dedupe(scanned, cfg);
check("L1 合并 brandkit 副本", d.duplicates.some((x) => x.kept.name === "brandkit" && x.removed.name === "brandkit" && x.rule === "L1"));
check("L1 合并改名副本 taste-skill", d.duplicates.some((x) => x.removed.name === "taste-skill" && x.rule === "L1"));
check("去重后 unique = 6", d.unique.length === 6); // 8 - 2 个重复
check("unique 含 gpt-taste 且来源两条", d.unique.find((e) => e.name === "gpt-taste").sources.length === 2);

// ---- 干跑 ----
const plan = syncer.planSync(cfg);
check("计划包含 6 个收纳动作", plan.actions.filter((a) => a.type === "import").length === 6);
check("计划发现 conflict1 内容冲突", plan.conflicts.some((c) => c.id === "content:conflict1@claude"));
check("计划包含改名挂载（taste-skill→gpt-taste）", plan.actions.some((a) => a.type === "mount" && a.mountName === "taste-skill" && a.skill === "gpt-taste"));

// ---- 执行 ----
const result = syncer.executeSync(cfg, plan);
check("执行收纳 5 个技能（第二个同名 conflict1 走冲突）", result.summary.imported === 5);
check("中央 skills 有 5 个真身目录", fs.readdirSync(hub.skillsDir()).length === 5);
check("zcode/alpha 已转 Junction", mounter.isLink(path.join(zcode, "alpha")));
check("codex/brandkit 已转 Junction", mounter.isLink(path.join(codex, "brandkit")));
check("codex/taste-skill Junction 指向中央 gpt-taste", mounter.pointsTo(path.join(codex, "taste-skill"), path.join(hub.skillsDir(), "gpt-taste")));
check("claude/conflict1 保持真实目录（未裁决不动）", !mounter.isLink(path.join(claude, "conflict1")));
check("MD 报告已生成", !!result.reportFile && fs.existsSync(result.reportFile));
const reportText = fs.readFileSync(result.reportFile, "utf-8");
check("报告含概要骨架", reportText.includes("## 概要") && reportText.includes("## 新增收纳") && reportText.includes("## 重复合并") && reportText.includes("## 冲突"));
check("manifest 记录来源", hub.loadManifest().skills.brandkit.sources.some((s) => s.tool === "zcode"));

// ---- 裁决 ----
const r = syncer.resolveContentConflict({ skill: "conflict1", dir: claude, toolId: "claude" }, "keepHub", cfg);
check("冲突裁决 keepHub 成功", r.ok);
check("裁决后 claude/conflict1 已挂载", mounter.pointsTo(path.join(claude, "conflict1"), path.join(hub.skillsDir(), "conflict1")));
check("裁决后的旧目录进了回收站", hub.listTrash().some((x) => x.name.includes("conflict1")));

// ---- 启停 ----
const off = syncer.toggleMount("gpt-taste", "codex", false, cfg);
check("停用挂载成功", off.ok && !fs.existsSync(path.join(codex, "gpt-taste")));
const on = syncer.toggleMount("gpt-taste", "codex", true, cfg);
check("启用挂载成功", on.ok && mounter.isLink(path.join(codex, "gpt-taste")));

// ---- Junction 透传：改 zcode/alpha 要能直达中央真身 ----
const centralAlphaMd = path.join(hub.skillsDir(), "alpha", "SKILL.md");
const before = fs.readFileSync(centralAlphaMd, "utf-8");
fs.writeFileSync(path.join(zcode, "alpha", "SKILL.md"), before + "\n<!-- updated via junction -->\n", "utf-8");
check("经 Junction 修改直达中央真身", fs.readFileSync(centralAlphaMd, "utf-8").includes("updated via junction"));

// ---- 再同步：挂载发布到其他工具 ----
const plan2 = syncer.planSync(cfg);
const exec2 = syncer.executeSync(cfg, plan2);
check("alpha 变更后发布到 codex", mounter.isLink(path.join(codex, "alpha")));
check("发布到 claude", mounter.isLink(path.join(claude, "alpha")));

// ---- 修复 ----
fs.unlinkSync(path.join(claude, "alpha"));
const rep = syncer.repairMounts(cfg);
check("一键重建失效挂载", rep.repaired >= 1 && mounter.isLink(path.join(claude, "alpha")));

// ---- 回收站 7 天清理 ----
const oldTrash = path.join(hub.trashDir(), "2020-01-01T00-00-00-000Z-oldstuff");
fs.mkdirSync(oldTrash, { recursive: true });
const oldTime = new Date(Date.now() - 30 * 24 * 3600 * 1000);
fs.utimesSync(oldTrash, oldTime, oldTime);
const purged = hub.purgeTrash(7);
check("超期回收站被清理", purged >= 1 && !fs.existsSync(oldTrash));

// ---- 中央巡检与纳管：AI 绕过软件直接塞进中央仓库的场景 ----
const hxDir = path.join(hub.skillsDir(), "sneaky-ai-skill");
fs.mkdirSync(hxDir, { recursive: true });
fs.copyFileSync(path.join(hub.skillsDir(), "alpha", "SKILL.md"), path.join(hxDir, "SKILL.md"));
check("巡检发现未登记目录", hub.hubExtra().some((x) => x.name === "sneaky-ai-skill"));
const nonSkillDir = path.join(hub.skillsDir(), "not-a-skill");
fs.mkdirSync(nonSkillDir, { recursive: true });
check("纳管拒绝缺 SKILL.md 的目录", !syncer.adoptHubSkill("not-a-skill", cfg).ok);
const adopted = syncer.adoptHubSkill("xx/../sneaky-ai-skill", cfg); // 带路径只认目录名（与 removeSkill 同约定）
check("纳管成功且只补账不挂载", adopted.ok && !!hub.loadManifest().skills["sneaky-ai-skill"] && adopted.mounts === 0);
check("纳管后巡检不再报它", !hub.hubExtra().some((x) => x.name === "sneaky-ai-skill"));
check("重复纳管被拒", !syncer.adoptHubSkill("sneaky-ai-skill", cfg).ok);
fs.rmSync(nonSkillDir, { recursive: true, force: true });

// ---- 自动感知：快照变化 + 零冲突自动收纳 ----
const watch = require("../electron/backend/watch.cjs");
check("挂载类型按平台命名", mounter.linkType() === (process.platform === "win32" ? "junction" : "symlink"));
const fp1 = watch.fingerprint(cfg);
mkSkill(zcode, "watch-new", "watch-new", "自动感知新增技能 内容 W");
const fp2 = watch.fingerprint(cfg);
check("感知快照捕捉新增目录", fp1 !== fp2);
watch.handle(cfg, fp2); // 零冲突场景：自动收纳 + 原位转挂载
check("自动收纳进中央", !!hub.loadManifest().skills["watch-new"] && mounter.isLink(path.join(zcode, "watch-new")));
const fp3 = watch.fingerprint(cfg);
watch.handle(cfg, fp3); // 挂载替换后第二拍收敛
check("第二拍收敛后快照稳定", watch.fingerprint(cfg) === fp3);

// ---- 还原 ----
hub.toTrash(path.join(zcode), "zcode-test"); // 反正是临时目录
const item = hub.listTrash().find((x) => x.name.includes("zcode-test"));
check("回收站清单可见", !!item);
const restored = hub.restoreFromTrash(item.name, TMP);
check("回收站还原成功", restored.ok && fs.existsSync(restored.dest));

// ---- L3 ----
cfg.l3 = { enabled: true, threshold: 0.85 };
const d3 = dedup.dedupe(scanner.scanAll(cfg, require("../electron/backend/adapter.cjs")), cfg);
check("L3 开启后产出提示数组（不报错即可）", Array.isArray(d3.hints));

console.log(`\n全部通过：${passed} 项检查`);
console.log(`临时目录：${TMP}（自测数据，可手动删除）`);
