"""scanner 的单元测试：tempfile 造假技能目录，不碰用户真实的 ~/.zcode ~/.codex ~/.agent_skills。"""

import os
import shutil
import tempfile
import unittest
from pathlib import Path

from agent_skills import scanner
from agent_skills.models import ToolAdapter

VALID_SKILL_MD = """---
name: brandkit
description: 高端品牌物料生成
metadata:
  version: 1.0.0
---
# brandkit
正文
"""


def make_adapter(tools: Path) -> ToolAdapter:
    return ToolAdapter(tool="test", candidate_paths=[tools], hit_path=tools)


class ScanTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="as_test_"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.tools = self.tmp / "skills"
        self.tools.mkdir()

    def test_valid_skill_recognized(self):
        skill = self.tools / "brandkit"
        skill.mkdir()
        (skill / "SKILL.md").write_text(VALID_SKILL_MD, encoding="utf-8")
        notes = self.tools / "notes"
        notes.mkdir()
        (notes / "README.md").write_text("没有 SKILL.md，不算技能\n", encoding="utf-8")

        findings = scanner.scan_tool(make_adapter(self.tools))
        self.assertEqual(len(findings), 1)
        f = findings[0]
        self.assertEqual(f.tool, "test")
        self.assertEqual(f.dir_path, skill)
        self.assertEqual(f.name, "brandkit")
        self.assertEqual(f.description, "高端品牌物料生成")
        self.assertEqual(f.version, "1.0.0")
        self.assertEqual(f.issues, [])
        self.assertRegex(f.tree_hash, r"^[0-9a-f]{64}$")

    def test_missing_description_flagged(self):
        no_desc = self.tools / "no-desc"
        no_desc.mkdir()
        (no_desc / "SKILL.md").write_text("---\nname: no-desc\n---\n正文\n", encoding="utf-8")
        self.assertEqual(scanner.scan_tool(make_adapter(self.tools))[0].issues, ["缺 description"])

        nameless = self.tools / "nameless"
        nameless.mkdir()
        (nameless / "SKILL.md").write_text("---\ndescription: 有描述没名字\n---\n", encoding="utf-8")
        by_dir = {f.dir_path.name: f for f in scanner.scan_tool(make_adapter(self.tools))}
        self.assertEqual(by_dir["nameless"].issues, ["缺 name"])

    def test_empty_and_oversize_flagged(self):
        empty = self.tools / "empty"
        empty.mkdir()
        (empty / "SKILL.md").write_text("", encoding="utf-8")
        big = self.tools / "big-desc"
        big.mkdir()
        (big / "SKILL.md").write_text(
            "---\nname: big-desc\ndescription: \"" + "x" * 1025 + "\"\n---\n", encoding="utf-8"
        )
        by_dir = {f.dir_path.name: f for f in scanner.scan_tool(make_adapter(self.tools))}
        self.assertEqual(by_dir["empty"].issues, ["SKILL.md 为空", "缺 name", "缺 description"])
        self.assertEqual(by_dir["big-desc"].issues, ["description 超过 1024 字符"])


class TreeHashTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="as_test_"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    @staticmethod
    def build_skill(root: Path, crlf: bool) -> None:
        # 先按 LF 写整棵树，crlf=True 再统一改行尾，保证两侧只有行尾差异
        skill_md = "---\nname: brandkit\ndescription: 高端品牌物料生成\n---\n正文\n"
        logo = "圆标资源\n"
        (root / "SKILL.md").write_bytes(skill_md.encode("utf-8"))
        assets = root / "assets"
        assets.mkdir()
        (assets / "logo.txt").write_bytes(logo.encode("utf-8"))
        if crlf:
            for p in (root / "SKILL.md", assets / "logo.txt"):
                p.write_bytes(p.read_bytes().replace(b"\n", b"\r\n"))

    def test_crlf_and_lf_same_hash(self):
        crlf_dir = self.tmp / "crlf"
        lf_dir = self.tmp / "lf"
        crlf_dir.mkdir()
        lf_dir.mkdir()
        self.build_skill(crlf_dir, crlf=True)
        self.build_skill(lf_dir, crlf=False)

        self.assertEqual(scanner.tree_hash(crlf_dir), scanner.tree_hash(lf_dir))

        # 防退化：哈希函数若恒等输出，上一条断言会假通过，这里必须算出不同值
        (lf_dir / "extra.txt").write_bytes(b"change\n")
        self.assertNotEqual(scanner.tree_hash(crlf_dir), scanner.tree_hash(lf_dir))

    def test_subtree_changes_hash(self):
        a = self.tmp / "a"
        b = self.tmp / "b"
        a.mkdir()
        b.mkdir()
        self.build_skill(a, crlf=False)
        self.build_skill(b, crlf=False)
        (b / "assets" / "logo.txt").write_bytes("改过的资源\n".encode("utf-8"))

        self.assertNotEqual(scanner.tree_hash(a), scanner.tree_hash(b))


class MountPointTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="as_test_"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.tools = self.tmp / "skills"
        self.tools.mkdir()

    @staticmethod
    def make_mount(target: Path, link: Path) -> None:
        if os.name == "nt":
            import _winapi

            _winapi.CreateJunction(str(target), str(link))
        else:
            os.symlink(str(target), str(link), target_is_directory=True)

    def test_junction_not_a_skill(self):
        central = self.tmp / "central" / "brandkit"
        central.mkdir(parents=True)
        (central / "SKILL.md").write_text(VALID_SKILL_MD, encoding="utf-8")
        self.make_mount(central, self.tools / "brandkit")

        findings = scanner.scan_tool(make_adapter(self.tools))
        self.assertEqual(findings, [])

    def test_junction_skipped_but_real_skill_kept(self):
        central = self.tmp / "central" / "brandkit"
        central.mkdir(parents=True)
        (central / "SKILL.md").write_text(VALID_SKILL_MD, encoding="utf-8")
        self.make_mount(central, self.tools / "brandkit")
        good = self.tools / "normal"
        good.mkdir()
        (good / "SKILL.md").write_text(VALID_SKILL_MD, encoding="utf-8")

        findings = scanner.scan_tool(make_adapter(self.tools))
        self.assertEqual([f.dir_path.name for f in findings], ["normal"])
        # junction 本身不是 finding；normal 目录的 frontmatter 名恰好也叫 brandkit，不能按技能名判
        self.assertNotIn(self.tools / "brandkit", [f.dir_path for f in findings])


if __name__ == "__main__":
    unittest.main()
