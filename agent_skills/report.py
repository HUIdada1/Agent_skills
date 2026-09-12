"""MD 报告：sync 产出固定骨架报告写入中央仓库 reports/，doctor 输出自诊断文本。"""

from datetime import datetime
from pathlib import Path

from agent_skills._version import __version__
from agent_skills.hub import DEFAULT_ROOT
from agent_skills.models import DedupGroup, SkillFinding, SyncOutcome, ToolAdapter

_KIND_TEXT = {"l1": "L1 内容哈希一致", "l2": "L2 名称归一相同"}


def label(f: SkillFinding) -> str:
    return f"{f.tool}:{f.name}"


def adapter_lines(adapters: list[ToolAdapter], findings: list[SkillFinding]) -> list[str]:
    """工具目录探测块的渲染，doctor 文本与 scan 输出共用一份。"""
    lines = ["== 工具目录探测 =="]
    for a in adapters:
        if a.hit_path is None:
            candidates = ", ".join(str(p) for p in a.candidate_paths) or "无"
            lines.append(f"  {a.tool:<12} 未找到（候选：{candidates}）")
        else:
            count = sum(1 for f in findings if f.tool == a.tool)
            lines.append(f"  {a.tool:<12} {a.hit_path}  ({count} 个技能)")
    return lines


def _merged_copies(groups: list[DedupGroup]) -> int:
    # conflict 组的 merged 是待裁决候选、unique 组恒空，都不算合并
    return sum(len(g.merged) for g in groups if g.kind in _KIND_TEXT)


def _keep_group(groups: list[DedupGroup]) -> dict[str, DedupGroup]:
    return {g.keep.name: g for g in groups if g.keep is not None}


def _tools_of(g: DedupGroup) -> str:
    members = ([g.keep] if g.keep is not None else []) + g.merged
    return "、".join(dict.fromkeys(x.tool for x in members))


def render_sync_report(
    outcome: SyncOutcome,
    groups: list[DedupGroup],
    started_at: datetime,
    duration_sec: float,
    mode: str,
    *,
    hub_dir: Path | None = None,
    diff: dict[str, dict] | None = None,
) -> str:
    # hub_dir 与 diff 由 write_sync_report 带入；单独调用时用默认仓库、按动作推导明细
    hub = hub_dir if hub_dir is not None else DEFAULT_ROOT
    keep_group = _keep_group(groups)
    out: list[str] = []
    out.append(f"# Agent_skills 同步报告 {started_at:%Y-%m-%d %H:%M:%S}")
    out.append("")
    out.append(f"模式：{mode} · 耗时 {duration_sec:.1f}s")
    out.append(f"中央仓库：{hub}")
    out.append("")
    out.append("## 概要")
    out.append("")
    out.append(
        f"收纳 {len(outcome.imported)} · 发布 {len(outcome.published)} · 合并重复 {_merged_copies(groups)}"
        f" · 冲突 {len(outcome.conflicts)} · 疑似 {len(outcome.hints)} · 跳过 {len(outcome.skipped)}"
        f" · 清理 {len(outcome.trashed)}"
    )
    out.append("")

    out.append("## 收纳入库")
    out.append("")
    if outcome.imported:
        out.append("| 技能 | 来源 | 动作 | 中央路径 |")
        out.append("|---|---|---|---|")
        for name in outcome.imported:
            g = keep_group.get(name)
            if g is None:
                sources = name
            else:
                sources = "、".join(label(x) for x in ([g.keep] if g.keep is not None else []) + g.merged)
            action = "更新覆盖（旧版入回收站）" if name in outcome.trashed else "收纳"
            out.append(f"| {name} | {sources} | {action} | {hub / 'skills' / name} |")
    else:
        out.append("本次无")
    out.append("")

    out.append("## 重复合并")
    out.append("")
    dup = [g for g in groups if g.kind in _KIND_TEXT]
    if dup:
        out.append("| 判定层级 | 保留 | 合并掉 | 说明 |")
        out.append("|---|---|---|---|")
        for g in dup:
            keep_cell = f"{label(g.keep)}（{g.keep.dir_path}）" if g.keep is not None else "无"
            merged_cell = "；".join(f"{label(x)}（{x.dir_path}）" for x in g.merged) or "无"
            out.append(f"| {_KIND_TEXT[g.kind]} | {keep_cell} | {merged_cell} | {g.reason} |")
    else:
        out.append("本次无")
    out.append("")

    out.append("## 发布到工具")
    out.append("")
    # M2 Junction 分发落地前 published 恒空，有值时先列名字，挂载点等 MountRecord 可查再补
    if outcome.published:
        out.extend(f"- {name}" for name in outcome.published)
    else:
        out.append("本次无")
    out.append("")

    conflicts = [g for g in groups if g.kind == "conflict"]
    out.append(f"## 冲突待裁决（{len(conflicts)}）" if conflicts else "## 冲突待裁决")
    out.append("")
    if conflicts:
        out.append("| 技能 | 候选 | 差异 |")
        out.append("|---|---|---|")
        for g in conflicts:
            candidates = "；".join(f"{label(x)}（{x.dir_path}）" for x in g.merged)
            hashes = " / ".join(x.tree_hash[:12] or "无哈希" for x in g.merged)
            detail = f"treeHash：{hashes}"
            if g.reason:
                detail += f"；{g.reason}"
            out.append(f"| {g.merged[0].name} | {candidates} | {detail} |")
    else:
        out.append("本次无")
    out.append("")

    hints = [g for g in groups if g.kind == "l3-hint"]
    out.append(f"## 疑似重复（仅提示，共 {len(outcome.hints)} 份）" if hints else "## 疑似重复（仅提示）")
    out.append("")
    if hints:
        out.append("| 技能 | 相似对象 | 说明 |")
        out.append("|---|---|---|")
        for g in hints:
            others = "；".join(label(x) for x in g.merged if x is not g.merged[0]) or label(g.merged[-1])
            out.append(f"| {label(g.merged[0])} | {others} | {g.reason} |")
        out.append("")
        out.append("以上技能已按各自主分组正常收纳；确认重复后请人工保留一份（交互式裁决在 M2 提供）。")
    else:
        out.append("本次无")
    out.append("")

    out.append("## 跳过")
    out.append("")
    if outcome.skipped:
        out.append(f"共 {len(outcome.skipped)} 个（两侧哈希一致，无需动作）")
        out.append("")
        out.append("| 技能 | 中央路径 |")
        out.append("|---|---|---|")
        for name in outcome.skipped:
            out.append(f"| {name} | {hub / 'skills' / name} |")
    else:
        out.append("本次无")
    out.append("")

    out.append("## 清理")
    out.append("")
    if outcome.trashed:
        out.append(f"被覆盖的旧版已移入回收站 {hub / '.trash'}（保留 7 天，doctor --clean 清理）：")
        out.append("")
        out.extend(f"- {name}" for name in outcome.trashed)
    else:
        out.append("本次无")
    out.append("")

    out.append("## 变更明细（manifest diff）")
    out.append("")
    detail: list[str] = []
    if diff is not None:
        for name in sorted(diff):
            entry = diff[name]
            before = entry.get("before")
            after = entry.get("after")
            if after is None:
                detail.append(f"- skills/{name}  移出 manifest")
            elif before is None:
                tools = "、".join(s.get("tool", "") for s in after.get("sources", []))
                detail.append(f"+ skills/{name}  treeHash={after.get('treeHash', '')[:12]}  sources: [{tools}]")
            elif before == after:
                detail.append(f"= skills/{name}  未变")
            else:
                detail.append(
                    f"~ skills/{name}  treeHash {before.get('treeHash', '')[:12]}"
                    f" -> {after.get('treeHash', '')[:12]}"
                )
    else:
        for name in outcome.imported:
            g = keep_group.get(name)
            h = g.keep.tree_hash[:12] if g is not None and g.keep is not None else ""
            tools = _tools_of(g) if g is not None else ""
            detail.append(f"+ skills/{name}  treeHash={h}  sources: [{tools}]")
        detail.extend(f"+ {name}（发布）" for name in outcome.published)
        detail.extend(f"! {item}  同名异容，待人工裁决" for item in outcome.conflicts)
        detail.extend(f"= skills/{name}  未变" for name in outcome.skipped)
    if detail:
        out.append("```diff")
        out.extend(detail)
        out.append("```")
    else:
        out.append("本次无")
    out.append("")

    out.append("---")
    out.append("")
    out.append(f"*由 Agent_skills {__version__} 生成于 {started_at:%Y-%m-%d %H:%M:%S}*")
    out.append("")
    return "\n".join(out) + "\n"


def write_report(hub_dir: Path, content: str, started_at: datetime) -> str:
    reports = Path(hub_dir) / "reports"
    reports.mkdir(parents=True, exist_ok=True)
    path = reports / f"sync-{started_at:%Y%m%d-%H%M%S}.md"
    if path.exists():
        # 同一秒出第二份时文件名追加毫秒，不覆盖旧报告
        path = reports / f"sync-{started_at:%Y%m%d-%H%M%S}-{started_at.microsecond // 1000:03d}.md"
    path.write_text(content, encoding="utf-8")
    return str(path)


def write_sync_report(
    root: Path,
    outcome: SyncOutcome,
    groups: list[DedupGroup],
    diff: dict[str, dict],
    started_at: datetime | None = None,
    duration_sec: float = 0.0,
) -> Path:
    # M1 的 CLI 没埋计时点，耗时显示 0.0s，M2 接同步引擎后由调用方传真实值
    started = started_at if started_at is not None else datetime.now()
    content = render_sync_report(outcome, groups, started, duration_sec, "execute", hub_dir=root, diff=diff)
    return Path(write_report(root, content, started))


def doctor_text(adapters: list[ToolAdapter], findings: list[SkillFinding]) -> str:
    lines: list[str] = [f"== Agent_skills doctor v{__version__} ==", ""]
    lines.extend(adapter_lines(adapters, findings))
    lines.append("")
    lines.append("== 体检 ==")
    problems = 0
    for f in findings:
        if not f.issues:
            continue
        problems += 1
        lines.append(f"  [{f.tool}] {f.name or '(未命名)'}")
        lines.extend(f"      ! {issue}" for issue in f.issues)
    if problems:
        lines.append(f"  共 {len(findings)} 个技能，{problems} 个有体检问题")
    else:
        lines.append(f"  共 {len(findings)} 个技能，全部健康")
    lines.append("")
    # 陌生孤儿目录只标记不处理（方案 1.7 红线 3）；点开头的隐藏目录是工具自留地（如 codex 的 .system），不算可疑
    lines.append("== 未识别目录（只标记不处理）==")
    known = {f.dir_path for f in findings}
    strays = 0
    for a in adapters:
        if a.hit_path is None or not a.hit_path.is_dir():
            continue
        for child in sorted(a.hit_path.iterdir()):
            if child.is_dir() and not child.name.startswith(".") and child not in known:
                lines.append(f"  {child}")
                strays += 1
    if not strays:
        lines.append("  无")
    return "\n".join(lines)
