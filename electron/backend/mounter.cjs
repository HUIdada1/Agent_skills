// Junction 挂载管理：建立 / 校验 / 摘除 / 重建；复制模式兜底。
// 铁律：摘除只删链接本身，绝不穿透目标；目标已有同名真实目录 → 冲突，不静默替换。
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const hub = require("./hub.cjs");

/** 判定路径是否为链接（junction / symlink 在 Node lstat 下均为 isSymbolicLink） */
function isLink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** 规范链接目标比较：junction readlink 返回 \\?\C:\... 前缀，去之；Windows 大小写不敏感 */
function normalizeTarget(t) {
  const s = String(t || "").replace(/^\\\?\\/, "");
  return process.platform === "win32" ? s.toLowerCase() : s;
}

/** 链接指向是否等于期望目标 */
function pointsTo(linkPath, expectedTarget) {
  try {
    return normalizeTarget(fs.readlinkSync(linkPath)) === normalizeTarget(expectedTarget);
  } catch {
    return false;
  }
}

/**
 * 挂载：在 toolDir 下建立名为 mountName 的 Junction，指向中央 skills/<skillName>。
 * mountName 与 skillName 可以不同（改名副本场景：gpt-taste → 中央 taste-skill）。
 * 返回 { action }：mounted（新建）/ already（已是指向中央的链接）/ copied（复制模式）/
 *                 conflict-real-dir（同名真实目录）/ conflict-diff-link（链接指向别处）/ error
 */
function mount(skillName, toolDir, mode, mountName) {
  const name = mountName || skillName;
  const target = path.join(hub.skillsDir(), skillName);
  const linkPath = path.join(toolDir, name);
  if (!fs.existsSync(target)) return { action: "error", message: "中央真身不存在：" + target, linkPath };

  if (isLink(linkPath)) {
    if (pointsTo(linkPath, target)) return { action: "already", linkPath };
    return { action: "conflict-diff-link", linkPath, message: "现有链接指向别处：" + linkPath };
  }
  if (fs.existsSync(linkPath)) {
    return { action: "conflict-real-dir", linkPath, message: "工具目录已有同名真实目录：" + linkPath };
  }

  if (mode === "copy") {
    fs.cpSync(target, linkPath, { recursive: true });
    return { action: "copied", linkPath };
  }
  fs.symlinkSync(target, linkPath, "junction");
  return fs.existsSync(linkPath) ? { action: "mounted", linkPath } : { action: "error", message: "Junction 创建失败", linkPath };
}

/** 摘除挂载：仅当路径是链接才删除，真实目录绝不触碰 */
function unmount(linkPath) {
  if (isLink(linkPath)) {
    fs.unlinkSync(linkPath);
    return { ok: true };
  }
  if (fs.existsSync(linkPath)) return { ok: false, message: "不是链接，拒绝删除真实目录：" + linkPath };
  return { ok: true }; // 本就不存在，视为已摘除
}

/** 体检全部挂载：valid = 链接存在且指向中央真身且真身存在 */
function verifyAll(manifest) {
  const rows = [];
  for (const name of Object.keys(manifest.skills || {})) {
    for (const mt of manifest.skills[name].mounts || []) {
      if (mt.enabled === false) continue;
      const isLinkNow = isLink(mt.path);
      const valid = isLinkNow && pointsTo(mt.path, path.join(hub.skillsDir(), name)) && fs.existsSync(mt.path);
      rows.push({ skill: name, ...mt, isLink: isLinkNow, valid });
    }
  }
  return rows;
}

module.exports = { isLink, pointsTo, mount, unmount, verifyAll };
