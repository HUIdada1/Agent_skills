"""命令行入口：scan 只读体检，sync 收纳进中央仓库，doctor 出诊断报告。"""

import argparse
import json
import sys
from pathlib import Path

from agent_skills import dedup, hub, report, scanner
from agent_skills._version import __version__
from agent_skills.models import DedupGroup, SkillFinding, SyncOutcome, ToolAdapter


def _tame_console() -> None:
    # Windows 下输出重定向到文件/管道时默认 GBK，中文会炸，统一按 UTF-8 走
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def _hub_root(args: argparse.Namespace) -> Path:
    return Path(args.hub).expanduser() if args.hub else hub.DEFAULT_ROOT


def _wants_l3(args: argparse.Namespace, root: Path) -> bool:
    # L3 默认关；config.json 的 enableL3 是常驻开关，--l3 是当次强制开
    return bool(getattr(args, "l3", False)) or bool(hub.read_config(root).get("enableL3"))


def _render_scan(adapters: list[ToolAdapter], findings: list[SkillFinding], groups: list[DedupGroup]) -> None:
    print("\n".join(report.adapter_lines(adapters, findings)))
    print(f"\n== 技能清单（共 {len(findings)} 个）==")
    for f in findings:
        head = f"  [{f.tool}] {f.name or '(未命名)'}"
        if f.version:
            head += f"  v{f.version}"
        if f.tree_hash:
            head += f"  hash:{f.tree_hash[:12]}"
        print(head)
        for issue in f.issues:
            print(f"      ! {issue}")
    print(f"\n== 去重预览（共 {len(groups)} 组）==")
    for g in groups:
        members = ", ".join(report.label(x) for x in ([g.keep] if g.keep is not None else []) + g.merged)
        print(f"  [{g.kind}] {members or '(空)'}")
        if g.reason:
            print(f"      {g.reason}")
    print("\nscan 全程只读，没有改动任何文件。")


def cmd_scan(args: argparse.Namespace) -> int:
    root = _hub_root(args)
    # 只读命令的 --hub 只决定从哪个仓库读适配器配置，不写任何东西
    adapters = scanner.detect_adapters(config_root=root)
    findings = scanner.scan_all(adapters)
    groups = dedup.group(findings, enable_l3=_wants_l3(args, root))
    if args.format == "json":
        payload = {
            "adapters": [a.to_dict() for a in adapters],
            "findings": [f.to_dict() for f in findings],
            "groups": [g.to_dict() for g in groups],
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        _render_scan(adapters, findings, groups)
    return 0


def cmd_sync(args: argparse.Namespace) -> int:
    root = _hub_root(args)
    # config.json 由 ensure_layout 建在仓库根下，--hub 换了仓库配置就得跟着换
    adapters = scanner.detect_adapters(config_root=root)
    findings = scanner.scan_all(adapters)
    groups = dedup.group(findings, enable_l3=_wants_l3(args, root))
    manifest = hub.load_manifest(root)

    outcome = SyncOutcome()
    unnamed: list[str] = []
    for g in groups:
        if g.keep is None:
            # conflict 与 l3-hint 的 keep 都是 None：前者是待裁决，后者只是提示，分开统计
            bucket = outcome.hints if g.kind == "l3-hint" else outcome.conflicts
            bucket.extend(report.label(x) for x in g.merged)
        elif not g.keep.name or not hub.is_safe_dirname(g.keep.name):
            # 缺 name 或 name 当不了目录名（Windows 非法字符等），硬收会让 import_skill 抛错
            unnamed.append(str(g.keep.dir_path))
        elif g.keep.name in manifest and manifest[g.keep.name].tree_hash == g.keep.tree_hash:
            outcome.skipped.append(g.keep.name)
        else:
            outcome.imported.append(g.keep.name)
            if hub.skill_path(root, g.keep.name).exists():
                # 中央已有同名目录，execute 会把旧版移进 .trash，预览同样预告
                outcome.trashed.append(g.keep.name)

    if not args.execute:
        print("== 同步预览（dry-run，未写盘）==")
        print(f"  中央仓库：{root}")
        print(f"  将收纳 {len(outcome.imported)} 个：{', '.join(outcome.imported) or '无'}")
        if outcome.trashed:
            print(f"  将覆盖进回收站 {len(outcome.trashed)} 个：{', '.join(outcome.trashed)}")
        print(f"  已是最新 {len(outcome.skipped)} 个：{', '.join(outcome.skipped) or '无'}")
        print(f"  冲突待裁决 {len(outcome.conflicts)} 个：{', '.join(outcome.conflicts) or '无'}")
        if outcome.hints:
            print(f"  疑似重复（仅提示，不合并）{len(outcome.hints)} 个：{', '.join(outcome.hints)}")
        for p in unnamed:
            print(f"  跳过无法收纳的技能（缺 name 或 name 当不了目录名，先修 SKILL.md）：{p}")
        print("\n确认后执行 python -m agent_skills sync --execute 落盘。")
        return 0

    hub.ensure_layout(root)
    merged = dict(manifest)
    for g in groups:
        if g.keep is None or g.keep.name in outcome.skipped:
            continue
        if not g.keep.name or not hub.is_safe_dirname(g.keep.name):
            continue
        try:
            merged[g.keep.name] = hub.import_skill(root, g.keep, g, existing=manifest.get(g.keep.name))
        except OSError as e:
            # 单个技能收不进去（磁盘/权限之类）不拖垮整轮，报告照常产出，重跑会再试
            print(f"  ! 收纳 {g.keep.name} 失败，本轮跳过：{e}")
    hub.save_manifest(root, merged)
    diff = hub.diff_manifest(manifest, merged)
    report_path = report.write_sync_report(root, outcome, groups, diff)

    print("== 同步完成 ==")
    print(f"  收纳 {len(outcome.imported)} 个技能到 {root / 'skills'}")
    if outcome.trashed:
        print(f"  {len(outcome.trashed)} 个旧版已移入回收站：{', '.join(outcome.trashed)}")
    if outcome.conflicts:
        print(f"  {len(outcome.conflicts)} 个冲突未动，待人工裁决")
    if outcome.hints:
        print(f"  {len(outcome.hints)} 个疑似重复仅提示，未合并：{', '.join(outcome.hints)}")
    for p in unnamed:
        print(f"  跳过无法收纳的技能（缺 name 或 name 当不了目录名，先修 SKILL.md）：{p}")
    if outcome.conflicts:
        # M1 还没有裁决入口，把出路说清楚，别让用户卡在"待裁决"上
        print("  裁决方式：手动保留某一份后重跑 sync；交互式裁决在 M2 的同步中心提供")
    print(f"  manifest：{root / 'manifest.json'}")
    print(f"  MD 报告：{report_path}")
    return 0


def cmd_doctor(args: argparse.Namespace) -> int:
    adapters = scanner.detect_adapters(config_root=_hub_root(args))
    findings = scanner.scan_all(adapters)
    print(report.doctor_text(adapters, findings))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="Agent_skills",
        description="把各 AI Agent 工具的技能目录扫出来、去重、收进中央仓库统一管理。",
    )
    parser.add_argument("--version", action="version", version=f"Agent_skills {__version__}")
    sub = parser.add_subparsers(dest="command", metavar="<command>")

    p = sub.add_parser("scan", help="只读扫描：技能清单 + 体检问题 + 去重预览")
    p.add_argument("--format", choices=("text", "json"), default="text", help="输出格式，默认 text")
    p.add_argument("--hub", default=None, metavar="DIR", help="中央仓库目录，读取其中的适配器配置，默认 ~/.agent_skills")
    p.add_argument("--l3", action="store_true", help="开启 L3 语义相似提示（常驻开关是 config.json 的 enableL3）")
    p.set_defaults(func=cmd_scan)

    p = sub.add_parser("sync", help="同步：默认 dry-run 预览动作，--execute 才真正写盘")
    p.add_argument("--execute", action="store_true", help="真正收纳、写 manifest、生成 MD 报告")
    p.add_argument("--hub", default=None, metavar="DIR", help="中央仓库目录，默认 ~/.agent_skills")
    p.add_argument("--l3", action="store_true", help="开启 L3 语义相似提示（常驻开关是 config.json 的 enableL3）")
    p.set_defaults(func=cmd_sync)

    p = sub.add_parser("doctor", help="体检报告：适配器探测 + 技能健康诊断")
    p.add_argument("--hub", default=None, metavar="DIR", help="中央仓库目录，读取其中的适配器配置，默认 ~/.agent_skills")
    p.set_defaults(func=cmd_doctor)
    return parser


def main(argv: list[str] | None = None) -> int:
    _tame_console()
    parser = build_parser()
    args = parser.parse_args(argv)
    if getattr(args, "func", None) is None:
        # M1 尚无图形界面（M3 才有），无参先给帮助
        parser.print_help()
        return 0
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
