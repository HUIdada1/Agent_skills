"""中央仓库：目录布局、manifest 读写、技能收纳。M1 只把真身复制进来，各工具原目录一律不动。"""

import json
import os
import re
import shutil
from datetime import datetime
from pathlib import Path

from agent_skills.models import DedupGroup, ManifestEntry, MergeRecord, SkillFinding, SourceRecord

DEFAULT_ROOT = Path.home() / ".agent_skills"

# Windows 目录名的雷区：非法字符、保留设备名、结尾的空格与点。
# 保留名只匹配裸名；con.txt 这类带扩展名的在旧版 Windows API 才受限，Win11 已放开，不做过度拦截。
_UNSAFE_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_RESERVED_NAMES = {"con", "prn", "aux", "nul",
                   *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}


def is_safe_dirname(name: str) -> bool:
    """技能名要当中央仓库里的目录名，先过一遍 Windows 的规矩。"""
    if not name or name in (".", "..") or len(name) > 100:
        return False
    if _UNSAFE_CHARS.search(name) or name.endswith((" ", ".")):
        return False
    return name.lower() not in _RESERVED_NAMES


def ensure_layout(root: Path) -> None:
    # 方案 4.2 的仓库布局，缺哪块补哪块；都带 parents，root 不存在也能一把建齐
    (root / "skills").mkdir(parents=True, exist_ok=True)
    (root / "reports").mkdir(parents=True, exist_ok=True)
    (root / ".trash").mkdir(parents=True, exist_ok=True)
    if not (root / "manifest.json").exists():
        _write_json(root / "manifest.json", [])
    if not (root / "config.json").exists():
        _write_json(root / "config.json", {})


def read_config(root: Path) -> dict:
    """读仓库根的 config.json（enableL3 等开关住在它里面）；坏了或没有就当空配置。"""
    path = root / "config.json"
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_json(path: Path, data) -> None:
    # 先写临时文件再原子替换，写一半断电也不会留下半截 manifest
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def load_manifest(root: Path) -> dict[str, ManifestEntry]:
    path = root / "manifest.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            raise TypeError("manifest.json 顶层必须是数组")
        entries = [ManifestEntry.from_dict(item) for item in data]
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError, AttributeError):
        # manifest 被手改坏（坏 JSON、形状不对、元素缺字段）时按空仓库继续，别让 dry-run 裸崩；
        # 真身都在 skills/，--execute 会重建清单
        return {}
    return {e.name: e for e in entries}


def save_manifest(root: Path, manifest: dict[str, ManifestEntry]) -> None:
    _write_json(root / "manifest.json", [manifest[name].to_dict() for name in sorted(manifest)])


def skill_path(root: Path, name: str) -> Path:
    return root / "skills" / name


def _to_trash(root: Path, name: str) -> None:
    # D4 红线：覆盖前旧版先进 .trash；目录名带时间戳，doctor --clean 靠它算 7 天保留期
    trash = root / ".trash"
    trash.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dst = trash / f"{name}-{stamp}"
    n = 1
    while dst.exists():
        dst = trash / f"{name}-{stamp}-{n}"
        n += 1
    shutil.move(str(skill_path(root, name)), str(dst))


def import_skill(root: Path, keep: SkillFinding, group: DedupGroup,
                 existing: ManifestEntry | None = None) -> ManifestEntry:
    if not is_safe_dirname(keep.name):
        raise ValueError(f"技能名当不了目录名：{keep.name!r}")

    target = skill_path(root, keep.name)
    replaced = target.exists()
    if replaced:
        # 中央已有旧版：先移 .trash 再放新真身，__main__ 的 trashed 统计依赖这一步
        _to_trash(root, keep.name)
    shutil.copytree(keep.dir_path, target)

    # M1 收纳不删被合并副本的原目录，去向记进 SyncOutcome.trashed，等 M2 做 junction 替换时统一搬
    # existing 由调用方带进来（批量收纳时省得每份都重读 manifest）；单独调用才回读一次
    if existing is None:
        existing = load_manifest(root).get(keep.name)
    now = datetime.now().isoformat(timespec="seconds")
    entry = ManifestEntry(name=keep.name, version=keep.version,
                          description=keep.description, tree_hash=keep.tree_hash)

    # 来源只增不删：老来源保住 firstSeen，这轮新出现的才补当前时间
    entry.sources = list(existing.sources) if existing else []
    members = ([group.keep] if group.keep is not None else []) + group.merged
    for f in members:
        if not any(s.tool == f.tool and s.original_name == f.name for s in entry.sources):
            entry.sources.append(SourceRecord(tool=f.tool, first_seen=now, original_name=f.name))

    entry.merge_history = list(existing.merge_history) if existing else []
    if replaced:
        entry.merge_history.append(MergeRecord(at=now, action="覆盖旧版（旧版移入回收站）"))
    if group.kind in ("l1", "l2"):
        entry.merge_history.append(MergeRecord(
            at=now, action=f"{group.kind.upper()} merge",
            removed=[f"{f.tool}:{f.name}" for f in group.merged]))
    return entry


def diff_manifest(before: dict[str, ManifestEntry], after: dict[str, ManifestEntry]) -> dict[str, dict]:
    names = sorted(set(before) | set(after))
    return {
        name: {
            "before": before[name].to_dict() if name in before else None,
            "after": after[name].to_dict() if name in after else None,
        }
        for name in names
    }
