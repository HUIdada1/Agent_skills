"""report 的单元测试：报告骨架、概要计数、表格行数、文件名 ASCII；tempfile 造临时仓库，不碰用户真实目录。"""

import shutil
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from agent_skills import report
from agent_skills.models import DedupGroup, ManifestEntry, SkillFinding, SourceRecord, SyncOutcome, ToolAdapter

STARTED = datetime(2026, 9, 12, 16, 5, 32)


def _finding(tool: str, name: str, path: Path, tree_hash: str) -> SkillFinding:
    return SkillFinding(tool, path, name, "描述", "1.0.0", tree_hash)


class SyncReportTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="as_test_"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.hub = self.tmp / "hub"

        z = Path(r"C:\Users\u\.zcode\skills")
        c = Path(r"C:\Users\u\.codex\skills")
        zcode_brandkit = _finding("zcode", "brandkit", z / "brandkit", "a1b2c3d4e5f67890")
        codex_brandkit = _finding("codex", "brandkit", c / "brandkit", "a1b2c3d4e5f67890")
        brutalist = _finding("codex", "brutalist-skill", c / "brutalist-skill", "b7d031fc99aa1122")
        stitch = _finding("zcode", "stitch-design-taste", z / "stitch-design-taste", "c3d4e5f60718293a")
        gpt_taste = _finding("zcode", "gpt-taste", z / "gpt-taste", "d4e5f60718293a4b")
        soft_skill = _finding("codex", "soft-skill", c / "soft-skill", "e5f60718293a4b5c")

        self.groups = [
            DedupGroup("unique", keep=stitch),
            DedupGroup("l1", keep=zcode_brandkit, merged=[codex_brandkit], reason="内容树哈希完全一致"),
            DedupGroup("unique", keep=brutalist),
            DedupGroup("conflict", merged=[gpt_taste, soft_skill], reason="L2 名称归一命中，但内容哈希不同"),
        ]
        self.outcome = SyncOutcome(
            imported=["brandkit", "brutalist-skill"],
            published=[],
            conflicts=["zcode:gpt-taste", "codex:soft-skill"],
            skipped=["stitch-design-taste"],
            trashed=["brandkit"],
        )
        old = ManifestEntry("brandkit", "0.9.0", "旧描述", "0000000000000000",
                            sources=[SourceRecord("codex", "2026-08-24T23:23:00", "brandkit")])
        new = ManifestEntry("brandkit", "1.0.0", "描述", "a1b2c3d4e5f67890",
                            sources=[SourceRecord("zcode", "2026-09-12T16:05:00", "brandkit"),
                                     SourceRecord("codex", "2026-09-12T16:05:00", "brandkit")])
        brut = ManifestEntry("brutalist-skill", "0.2.0", "描述", "b7d031fc99aa1122",
                             sources=[SourceRecord("codex", "2026-09-12T16:05:00", "brutalist-skill")])
        same = ManifestEntry("stitch-design-taste", "1.0.0", "描述", "c3d4e5f60718293a")
        self.diff = {
            "brandkit": {"before": old.to_dict(), "after": new.to_dict()},
            "brutalist-skill": {"before": None, "after": brut.to_dict()},
            "stitch-design-taste": {"before": same.to_dict(), "after": same.to_dict()},
        }
        self.content = report.render_sync_report(
            self.outcome, self.groups, STARTED, 3.2, "execute", hub_dir=self.hub, diff=self.diff)
        self.content_plain = report.render_sync_report(
            self.outcome, self.groups, STARTED, 0.0, "dry-run", hub_dir=self.hub)

    def test_sections_present(self):
        for head in (
            "# Agent_skills 同步报告 2026-09-12 16:05:32",
            "## 概要",
            "## 收纳入库",
            "## 重复合并",
            "## 发布到工具",
            "## 冲突待裁决（1）",
            "## 跳过",
            "## 清理",
            "## 变更明细（manifest diff）",
        ):
            self.assertIn(head, self.content)
        self.assertIn("模式：execute · 耗时 3.2s", self.content)

    def test_summary_counts(self):
        self.assertIn("收纳 2 · 发布 0 · 合并重复 1 · 冲突 2 · 疑似 0 · 跳过 1 · 清理 1", self.content)

    def test_import_table_rows(self):
        # 数据行数与收纳数一致：一行全新收纳、一行更新覆盖，中央路径逐行给出
        self.assertEqual(self.content.count(" | 收纳 | "), 1)
        self.assertEqual(self.content.count(" | 更新覆盖（旧版入回收站） | "), 1)
        self.assertIn(str(self.hub / "skills" / "brandkit"), self.content)
        self.assertIn(str(self.hub / "skills" / "brutalist-skill"), self.content)

    def test_merge_conflict_skip_rows(self):
        self.assertEqual(self.content.count("| L1 内容哈希一致 |"), 1)
        self.assertIn(str(self.groups[1].keep.dir_path), self.content)
        self.assertIn(str(self.groups[1].merged[0].dir_path), self.content)
        self.assertEqual(self.content.count("| gpt-taste |"), 1)
        self.assertIn("zcode:gpt-taste（", self.content)
        self.assertIn("codex:soft-skill（", self.content)
        self.assertIn("treeHash：d4e5f6071829 / e5f60718293a", self.content)
        self.assertEqual(self.content.count("| stitch-design-taste |"), 1)

    def test_empty_outcome_all_none(self):
        empty = report.render_sync_report(
            SyncOutcome(), [DedupGroup("unique", keep=self.groups[0].keep)], STARTED, 0.0, "execute", hub_dir=self.hub)
        self.assertEqual(empty.count("本次无"), 8)

    def test_diff_derived_from_actions_without_manifest(self):
        self.assertIn("+ skills/brandkit  treeHash=a1b2c3d4e5f6  sources: [zcode、codex]", self.content_plain)
        self.assertIn("! zcode:gpt-taste  同名异容，待人工裁决", self.content_plain)
        self.assertIn("= skills/stitch-design-taste  未变", self.content_plain)

    def test_report_filename_is_ascii(self):
        p1 = report.write_report(self.hub, self.content, STARTED)
        self.assertEqual(Path(p1).name, "sync-20260912-160532.md")
        self.assertTrue(Path(p1).name.isascii())
        self.assertEqual(Path(p1).parent, self.hub / "reports")
        # 同一秒出第二份：文件名追加毫秒，两份并存不覆盖
        p2 = report.write_report(self.hub, self.content, STARTED)
        self.assertNotEqual(p1, p2)
        self.assertTrue(Path(p2).name.isascii())
        self.assertIn("-160532-", Path(p2).name)
        self.assertTrue(Path(p1).exists())
        self.assertTrue(Path(p2).exists())
        self.assertEqual(Path(p1).read_text(encoding="utf-8"), self.content)

    def test_write_sync_report_four_args(self):
        # __main__.py cmd_sync 的调用形状：root, outcome, groups, diff
        p = report.write_sync_report(self.hub, self.outcome, self.groups, self.diff)
        self.assertTrue(Path(p).exists())
        self.assertEqual(Path(p).parent, self.hub / "reports")
        name = Path(p).name
        self.assertTrue(name.isascii())
        self.assertTrue(name.startswith("sync-") and name.endswith(".md"))

    def test_write_sync_report_renders_diff(self):
        p = report.write_sync_report(self.hub, self.outcome, self.groups, self.diff,
                                     started_at=STARTED, duration_sec=1.5)
        body = Path(p).read_text(encoding="utf-8")
        self.assertIn("~ skills/brandkit  treeHash 000000000000 -> a1b2c3d4e5f6", body)
        self.assertIn("+ skills/brutalist-skill  treeHash=b7d031fc99aa  sources: [codex]", body)
        self.assertIn("= skills/stitch-design-taste  未变", body)
        self.assertIn("耗时 1.5s", body)


class DoctorTextTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="as_test_"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.tool_dir = self.tmp / "z"
        self.tool_dir.mkdir()

    def test_marks_issues_strays_and_missing_adapter(self):
        (self.tool_dir / "junk-dir").mkdir()  # 陌生目录要建在 hit_path 之下才会被标记
        adapters = [
            ToolAdapter("zcode", [self.tool_dir], self.tool_dir),
            ToolAdapter("claude code", [self.tmp / "none"], None),
        ]
        bad = SkillFinding("zcode", self.tool_dir / "bad", "bad", "", "", "", ["描述缺失"])
        ok = SkillFinding("zcode", self.tool_dir / "ok", "ok", "fine", "1.0", "f60718293a4b5c6d")
        txt = report.doctor_text(adapters, [bad, ok])
        self.assertIn("描述缺失", txt)
        self.assertIn("1 个有体检问题", txt)
        self.assertIn(str(self.tool_dir / "junk-dir"), txt)
        self.assertIn("未找到", txt)


if __name__ == "__main__":
    unittest.main()
