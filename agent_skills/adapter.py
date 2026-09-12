"""工具适配器：五个内置技能目录的多候选探测，外加 config.json 的手动配置与自定义目录。"""

import json
from pathlib import Path

from agent_skills.hub import DEFAULT_ROOT
from agent_skills.models import ToolAdapter


def builtin_adapters(home: Path | None = None) -> list[ToolAdapter]:
    """候选路径照方案 1.1；Antigravity 的目录跨版本漂移，给旧版、新版、通用三条候选。"""
    home = Path.home() if home is None else home
    return [
        ToolAdapter(tool="zcode", candidate_paths=[home / ".zcode" / "skills"]),
        ToolAdapter(tool="codex", candidate_paths=[home / ".codex" / "skills"]),
        ToolAdapter(tool="claude", candidate_paths=[home / ".claude" / "skills"]),
        ToolAdapter(
            tool="antigravity",
            candidate_paths=[
                home / ".gemini" / "antigravity" / "skills",
                home / ".gemini" / "config" / "skills",
                home / ".agents" / "skills",
            ],
        ),
        ToolAdapter(tool="agents-generic", candidate_paths=[home / ".agents" / "skills"]),
    ]


def _read_config(path: Path) -> tuple[dict[str, list[str]], list[str]]:
    # config.json 是用户手写的，坏了或形状不对就当没有，扫描不该被它炸掉
    if not path.is_file():
        return {}, []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}, []
    if not isinstance(data, dict):
        return {}, []

    tool_paths: dict[str, list[str]] = {}
    raw_paths = data.get("toolPaths")
    if isinstance(raw_paths, dict):
        for tool, paths in raw_paths.items():
            if isinstance(paths, list) and paths and all(isinstance(p, str) and p for p in paths):
                tool_paths[str(tool)] = paths
    custom_dirs: list[str] = []
    raw_dirs = data.get("customSkillDirs")
    if isinstance(raw_dirs, list):
        custom_dirs = [d for d in raw_dirs if isinstance(d, str) and d]
    return tool_paths, custom_dirs


def discover_adapters(home: Path | None = None, config_root: Path | None = None) -> list[ToolAdapter]:
    """内置五家 + config.json 覆盖/追加，逐个候选探测，取第一个存在的目录。"""
    home = Path.home() if home is None else home
    if config_root is None:
        config_root = DEFAULT_ROOT
    tool_paths, custom_dirs = _read_config(config_root / "config.json")

    adapters = builtin_adapters(home)
    by_tool = {a.tool: a for a in adapters}
    for tool, paths in tool_paths.items():
        candidates = [Path(p).expanduser() for p in paths]
        if tool in by_tool:
            by_tool[tool].candidate_paths = candidates
        else:
            extra = ToolAdapter(tool=tool, candidate_paths=candidates)
            adapters.append(extra)
            by_tool[tool] = extra
    for d in custom_dirs:
        p = Path(d).expanduser()
        adapters.append(ToolAdapter(tool=p.name or "custom", candidate_paths=[p]))

    for a in adapters:
        resolve_hit(a)
    return adapters


def resolve_hit(adapter: ToolAdapter) -> None:
    """多候选依次探测，取第一个存在的目录；全不存在则 hit_path 留空。"""
    for p in adapter.candidate_paths:
        if p.is_dir():
            adapter.hit_path = p
            return
