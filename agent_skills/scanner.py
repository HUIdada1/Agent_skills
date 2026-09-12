"""扫描与体检：遍历各工具技能目录，解析 SKILL.md，给每个技能算内容树哈希。"""

import hashlib
import os
import stat
from pathlib import Path

from agent_skills import adapter, hub
from agent_skills.models import SkillFinding, ToolAdapter

DESCRIPTION_MAX = 1024


def detect_adapters(config_root: Path | None = None) -> list[ToolAdapter]:
    return adapter.discover_adapters(config_root=config_root)


def scan_all(adapters: list[ToolAdapter] | None = None) -> list[SkillFinding]:
    if adapters is None:
        adapters = detect_adapters()
    findings: list[SkillFinding] = []
    for a in adapters:
        findings.extend(scan_tool(a))
    return findings


def scan_tool(a: ToolAdapter) -> list[SkillFinding]:
    """扫一个工具：一级子目录里有 SKILL.md 的算技能；junction/symlink 目录是挂载点，真身在别处，跳过。"""
    if a.hit_path is None or not a.hit_path.is_dir():
        return []
    findings: list[SkillFinding] = []
    for child in sorted(a.hit_path.iterdir()):
        if not child.is_dir() or _is_mount_point(child):
            continue
        skill_md = child / "SKILL.md"
        if not skill_md.is_file():
            # 没有 SKILL.md 的目录不算技能，也不进清单；工具侧这类孤儿由 doctor 标记为未识别目录
            continue
        text = _read_text(skill_md)
        meta = parse_frontmatter(text)
        issues: list[str] = []
        if not text.strip():
            issues.append("SKILL.md 为空")
        if not meta["name"]:
            issues.append("缺 name")
        elif not hub.is_safe_dirname(meta["name"]):
            issues.append("name 当不了目录名（含非法字符 / Windows 保留名 / 超 100 字符）")
        if not meta["description"]:
            issues.append("缺 description")
        elif len(meta["description"]) > DESCRIPTION_MAX:
            issues.append(f"description 超过 {DESCRIPTION_MAX} 字符")
        findings.append(
            SkillFinding(
                tool=a.tool,
                dir_path=child,
                name=meta["name"],
                description=meta["description"],
                version=meta["version"],
                tree_hash=tree_hash(child),
                issues=issues,
            )
        )
    return findings


def tree_hash(root: Path) -> str:
    """整棵目录树一个 SHA-256：文件按相对路径排序、字节读入、CRLF 归一 LF。

    行尾归一是关键——brandkit 两侧副本可能一行不差但行尾不同，不归一就判不出同一技能。
    """
    h = hashlib.sha256()
    _feed_tree(root, root, h)
    return h.hexdigest()


def _feed_tree(cur: Path, base: Path, h) -> None:
    for p in sorted(cur.iterdir()):
        if p.is_dir():
            if _is_mount_point(p):
                continue  # junction 指向别处的真身，内容不属于这棵树，顺带防环
            _feed_tree(p, base, h)
            continue
        h.update(p.relative_to(base).as_posix().encode("utf-8") + b"\x00")
        try:
            content = p.read_bytes()
        except OSError:
            content = b""
        h.update(content.replace(b"\r\n", b"\n") + b"\x00")


def _is_mount_point(p: Path) -> bool:
    """junction/symlink 目录当挂载点：realpath 能解开但按 reparse 位判，避开短路径/大小写比对陷阱。"""
    if p.is_symlink():
        return True
    if os.name == "nt":
        try:
            return bool(os.lstat(p).st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT)
        except OSError:
            return False
    return False


def parse_frontmatter(text: str) -> dict[str, str]:
    """只取 name / description / metadata.version；未知字段宽容跳过（真身复制原文，天然透传）。"""
    lines = text.splitlines()
    out = {"name": "", "description": "", "version": ""}
    if not lines or lines[0].strip() != "---":
        return out
    in_meta = False
    block_key = ""  # 块标量（|、>-）的值在后续缩进行里，边走边拼
    for line in lines[1:]:
        stripped = line.strip()
        if stripped in ("---", "..."):
            break
        if not stripped or stripped.startswith("#"):
            continue
        if line[:1] in (" ", "\t"):
            if block_key:
                out[block_key] = (out[block_key] + " " + stripped).strip()
            elif in_meta:
                k, sep, v = stripped.partition(":")
                if sep and k.strip() == "version":
                    out["version"] = _unquote(v.strip())
            continue
        block_key = ""
        k, sep, v = stripped.partition(":")
        if not sep:
            in_meta = False
            continue
        k = k.strip()
        v = v.strip()
        if k == "metadata":
            in_meta = True
        elif k in ("name", "description"):
            in_meta = False
            if v and v[0] in "|>":
                out[k] = ""
                block_key = k
            else:
                out[k] = _unquote(v)
        else:
            in_meta = False
    return out


def _unquote(v: str) -> str:
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    return v


def _read_text(path: Path) -> str:
    # errors="replace"：个别 SKILL.md 不是 UTF-8 时不让整个扫描趴下
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
