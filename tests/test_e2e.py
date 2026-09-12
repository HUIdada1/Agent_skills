"""端到端：tempfile 造假 home 与临时 hub，从 main() 走真实子命令全流程，不碰用户真实目录。

适配器注入走 config.json toolPaths（scan/sync/doctor 同一条发现路径），L3 开关走
--l3 参数与 config 的 enableL3 两条路都覆盖。
"""

import contextlib
import io
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from agent_skills import hub, scanner
from agent_skills.__main__ import main

BRANDKIT_MD = (
    "---\nname: brandkit\ndescription: 高端品牌物料生成\nmetadata:\n  version: 1.0.0\n---\n"
    "# brandkit\n正文\n"
)
GPT_TASTE_MD = (
    "---\nname: gpt-taste\ndescription: 精英 UX 与高级动效\nmetadata:\n  version: 2.0.0\n---\n"
    "# gpt-taste\n正文\n"
)
DTF_DESC = "反套路前端设计技能"


def write_skill(base: Path, name: str, skill_md: str, body: str) -> Path:
    d = base / name
    (d / "assets").mkdir(parents=True)
    (d / "SKILL.md").write_text(skill_md, encoding="utf-8")
    (d / "assets" / "note.txt").write_text(body, encoding="utf-8")
    return d


class EndToEndBase(unittest.TestCase):
    """造假 home：zcode 三件套 + codex 的同哈希副本、改名副本、同名异容。"""

    def setUp(self):
        tmp = Path(tempfile.mkdtemp(prefix="as_test_e2e_"))
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        self.home = tmp / "home"
        self.hub = tmp / "hub"
        self.zskills = self.home / ".zcode" / "skills"
        self.cskills = self.home / ".codex" / "skills"

        write_skill(self.zskills, "brandkit", BRANDKIT_MD, "brandkit 资源")
        write_skill(self.zskills, "gpt-taste", GPT_TASTE_MD, "gpt taste 内容")
        write_skill(self.zskills, "design-taste-frontend",
                    f"---\nname: design-taste-frontend\ndescription: {DTF_DESC}\n---\nv2 正文\n", "v2 独有")
        # codex：brandkit 原样副本；taste-skill 是 gpt-taste 的改名副本，SKILL.md 一字不动（方案 1.1 现场）
        shutil.copytree(self.zskills / "brandkit", self.cskills / "brandkit")
        shutil.copytree(self.zskills / "gpt-taste", self.cskills / "taste-skill")
        write_skill(self.cskills, "design-taste-frontend",
                    f"---\nname: design-taste-frontend\ndescription: {DTF_DESC}\n---\nv1 旧正文\n", "v1 独有")

        # 其余三家指到空目录，彻底隔离真实机器的 ~/.claude ~/.gemini ~/.agents
        self.empty = {}
        for tool in ("claude", "antigravity", "agents-generic"):
            d = self.home / f".{tool}" / "skills"
            d.mkdir(parents=True)
            self.empty[tool] = d

        hub.ensure_layout(self.hub)
        config = {"toolPaths": {
            "zcode": [str(self.zskills)],
            "codex": [str(self.cskills)],
            "claude": [str(self.empty["claude"])],
            "antigravity": [str(self.empty["antigravity"])],
            "agents-generic": [str(self.empty["agents-generic"])],
        }}
        (self.hub / "config.json").write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")

    def run_main(self, *argv: str) -> tuple[int, str]:
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = main(list(argv))
        return rc, buf.getvalue()


class SyncDryRunTest(EndToEndBase):
    def test_dry_run_previews_without_writing(self):
        rc, out = self.run_main("sync", "--hub", str(self.hub))
        self.assertEqual(rc, 0)
        self.assertIn("dry-run", out)
        self.assertIn("将收纳 2 个：brandkit, gpt-taste", out)
        self.assertIn("zcode:design-taste-frontend", out)
        self.assertIn("codex:design-taste-frontend", out)
        self.assertEqual(json.loads((self.hub / "manifest.json").read_text(encoding="utf-8")), [])
        self.assertEqual(list((self.hub / "skills").iterdir()), [])
        self.assertEqual(list((self.hub / "reports").iterdir()), [])

    def test_dry_run_announces_overwrite_trash(self):
        rc, _ = self.run_main("sync", "--hub", str(self.hub), "--execute")
        self.assertEqual(rc, 0)
        # 两侧副本同步改内容保持同哈希，模拟技能升级后中央将整体覆盖
        new_md = BRANDKIT_MD.replace("正文", "正文 v2")
        (self.zskills / "brandkit" / "SKILL.md").write_text(new_md, encoding="utf-8")
        (self.cskills / "brandkit" / "SKILL.md").write_text(new_md, encoding="utf-8")
        rc, out = self.run_main("sync", "--hub", str(self.hub))
        self.assertEqual(rc, 0)
        self.assertIn("将收纳 1 个：brandkit", out)
        self.assertIn("将覆盖进回收站 1 个：brandkit", out)


class SyncExecuteTest(EndToEndBase):
    def test_full_flow(self):
        rc, out = self.run_main("sync", "--hub", str(self.hub), "--execute")
        self.assertEqual(rc, 0)
        self.assertIn("同步完成", out)
        self.assertIn("MD 报告", out)

        # manifest.json 可解析、字段与方案 4.2 一一在场
        raw = json.loads((self.hub / "manifest.json").read_text(encoding="utf-8"))
        self.assertIsInstance(raw, list)
        self.assertEqual({e["name"] for e in raw}, {"brandkit", "gpt-taste"})
        for e in raw:
            self.assertEqual(
                set(e),
                {"name", "version", "description", "treeHash", "sources", "mounts", "mergeHistory"},
            )
        manifest = hub.load_manifest(self.hub)

        # brandkit 判定同一：一份真身、两个来源、L1 合并记录
        entry = manifest["brandkit"]
        self.assertEqual(entry.to_dict()["treeHash"], scanner.tree_hash(self.zskills / "brandkit"))
        self.assertEqual([(s.tool, s.original_name) for s in entry.sources],
                         [("zcode", "brandkit"), ("codex", "brandkit")])
        self.assertEqual(entry.to_dict()["mounts"], [])
        self.assertEqual(entry.merge_history[0].action, "L1 merge")
        self.assertEqual(entry.merge_history[0].removed, ["codex:brandkit"])

        # taste-skill 改名副本归并进中央 gpt-taste：codex 侧没有 gpt-taste 目录，
        # sources 里的 codex:gpt-taste 只可能来自 taste-skill
        taste = manifest["gpt-taste"]
        self.assertEqual([(s.tool, s.original_name) for s in taste.sources],
                         [("zcode", "gpt-taste"), ("codex", "gpt-taste")])
        self.assertEqual([h.removed for h in taste.merge_history], [["codex:gpt-taste"]])
        self.assertFalse((self.cskills / "gpt-taste").exists())
        self.assertEqual((self.cskills / "taste-skill" / "SKILL.md").read_text(encoding="utf-8"),
                         GPT_TASTE_MD)

        # 同名异容进冲突且不覆盖：不进 manifest、不进 skills，工具侧两份原样保留
        self.assertNotIn("design-taste-frontend", manifest)
        self.assertEqual({p.name for p in (self.hub / "skills").iterdir()}, {"brandkit", "gpt-taste"})
        self.assertEqual((self.zskills / "design-taste-frontend" / "assets" / "note.txt").read_text(encoding="utf-8"),
                         "v2 独有")
        self.assertEqual((self.cskills / "design-taste-frontend" / "assets" / "note.txt").read_text(encoding="utf-8"),
                         "v1 独有")

        # reports/ 产出 MD，概要 / 收纳入库 / 冲突各节齐全
        reports = list((self.hub / "reports").glob("sync-*.md"))
        self.assertEqual(len(reports), 1)
        md = reports[0].read_text(encoding="utf-8")
        for head in ("## 概要", "## 收纳入库", "## 重复合并", "## 冲突待裁决（1）"):
            self.assertIn(head, md)
        self.assertIn("收纳 2 · 发布 0 · 合并重复 2 · 冲突 2 · 疑似 0 · 跳过 0 · 清理 0", md)
        self.assertIn("| brandkit | zcode:brandkit、codex:brandkit | 收纳 |", md)
        self.assertIn("zcode:design-taste-frontend（", md)
        self.assertIn("codex:design-taste-frontend（", md)


class L3HintTest(EndToEndBase):
    """L3 是"疑似重复仅提示"：既不能混进冲突队列，也不能自作主张合并（方案 1.3 / D4a）。"""

    def setUp(self):
        super().setUp()
        # 名字归一后不同名（datatools / datatoolz），描述相同，L3 相似度 0.96 命中
        write_skill(self.zskills, "data-tools",
                    "---\nname: data-tools\ndescription: 查询工具集\n---\nbody a\n", "a")
        write_skill(self.cskills, "data-toolz",
                    "---\nname: data-toolz\ndescription: 查询工具集\n---\nbody b\n", "b")

    def test_l3_flag_surfaces_hints_not_conflicts(self):
        rc, out = self.run_main("sync", "--hub", str(self.hub), "--l3")
        self.assertEqual(rc, 0)
        self.assertIn("疑似重复（仅提示，不合并）2 个：zcode:data-tools, codex:data-toolz", out)
        # 提示不许污染冲突行
        conflict_line = next(line for line in out.splitlines() if "冲突待裁决" in line)
        self.assertNotIn("data-tool", conflict_line)

    def test_config_enable_l3_works_without_flag(self):
        config = json.loads((self.hub / "config.json").read_text(encoding="utf-8"))
        config["enableL3"] = True
        (self.hub / "config.json").write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")
        rc, out = self.run_main("sync", "--hub", str(self.hub))
        self.assertEqual(rc, 0)
        self.assertIn("疑似重复（仅提示，不合并）2 个", out)

    def test_hints_do_not_block_normal_import_and_get_own_section(self):
        # "仅提示不动作"：hint 成员照各自主分组（unique）正常收纳，提示只是额外报告
        rc, _ = self.run_main("sync", "--hub", str(self.hub), "--execute", "--l3")
        self.assertEqual(rc, 0)
        manifest = hub.load_manifest(self.hub)
        self.assertIn("data-tools", manifest)
        self.assertIn("data-toolz", manifest)
        reports = list((self.hub / "reports").glob("sync-*.md"))
        md = reports[0].read_text(encoding="utf-8")
        self.assertIn("疑似 2", md)
        self.assertIn("## 疑似重复（仅提示，共 2 份）", md)
        self.assertIn("确认重复后请人工保留一份", md)


class EdgeCaseTest(EndToEndBase):
    def test_illegal_name_is_flagged_and_sync_survives(self):
        # name 带冒号当不了目录名：dry-run 预警、execute 跳过它但报告照常产出（硬性约束）
        write_skill(self.zskills, "foo-bar",
                    "---\nname: foo:bar\ndescription: x\n---\nbody\n", "x")
        rc, out = self.run_main("sync", "--hub", str(self.hub))
        self.assertEqual(rc, 0)
        self.assertIn("name 当不了目录名", out)
        rc, out = self.run_main("sync", "--hub", str(self.hub), "--execute")
        self.assertEqual(rc, 0)
        self.assertIn("MD 报告", out)
        self.assertEqual({p.name for p in (self.hub / "skills").iterdir()}, {"brandkit", "gpt-taste"})
        self.assertNotIn("foo:bar", hub.load_manifest(self.hub))

    def test_broken_manifest_falls_back_to_empty(self):
        # manifest 被手改坏：dry-run 不裸崩，execute 重建清单（真身都在 skills/）
        self.run_main("sync", "--hub", str(self.hub), "--execute")
        (self.hub / "manifest.json").write_text("{broken", encoding="utf-8")
        rc, _ = self.run_main("sync", "--hub", str(self.hub))
        self.assertEqual(rc, 0)
        rc, out = self.run_main("sync", "--hub", str(self.hub), "--execute")
        self.assertEqual(rc, 0)
        self.assertIn("同步完成", out)
        self.assertEqual({e["name"] for e in json.loads((self.hub / "manifest.json").read_text(encoding="utf-8"))},
                         {"brandkit", "gpt-taste"})

    def test_wrong_shape_manifest_falls_back_too(self):
        # 形状错误（dict 顶、带扩展名保留名之外的花活）与坏 JSON 同罪，一并按空仓库回退
        self.run_main("sync", "--hub", str(self.hub), "--execute")
        (self.hub / "manifest.json").write_text('{"name": "x"}', encoding="utf-8")
        rc, out = self.run_main("sync", "--hub", str(self.hub))
        self.assertEqual(rc, 0)
        self.assertIn("将收纳 2 个", out)


class ScanDoctorTest(EndToEndBase):
    def test_scan_text_is_readonly_preview(self):
        # --hub 让 scan 与 sync 走同一份 config.json 适配器配置
        rc, out = self.run_main("scan", "--hub", str(self.hub))
        self.assertEqual(rc, 0)
        self.assertIn("[zcode] brandkit", out)
        # 技能名以 frontmatter 为准：codex 清单里的 gpt-taste 只可能来自 taste-skill 改名目录
        self.assertIn("[codex] gpt-taste", out)
        self.assertIn("去重预览", out)
        self.assertIn("[l1]", out)
        self.assertIn("[conflict]", out)
        self.assertIn("scan 全程只读", out)
        self.assertEqual(list((self.hub / "skills").iterdir()), [])

    def test_scan_json_hashes_and_groups(self):
        rc, out = self.run_main("scan", "--hub", str(self.hub), "--format", "json")
        self.assertEqual(rc, 0)
        payload = json.loads(out)
        self.assertEqual(len(payload["findings"]), 6)
        by_dir = {f["dirPath"]: f for f in payload["findings"]}

        # 同哈希副本与改名副本：内容一字不差才判同一
        self.assertEqual(by_dir[str(self.zskills / "brandkit")]["treeHash"],
                         by_dir[str(self.cskills / "brandkit")]["treeHash"])
        self.assertEqual(by_dir[str(self.zskills / "gpt-taste")]["treeHash"],
                         by_dir[str(self.cskills / "taste-skill")]["treeHash"])
        self.assertNotEqual(by_dir[str(self.zskills / "design-taste-frontend")]["treeHash"],
                            by_dir[str(self.cskills / "design-taste-frontend")]["treeHash"])

        groups = payload["groups"]
        self.assertEqual(sorted(g["kind"] for g in groups), ["conflict", "l1", "l1"])
        conflict = next(g for g in groups if g["kind"] == "conflict")
        self.assertEqual([m["dirPath"] for m in conflict["merged"]],
                         [str(self.zskills / "design-taste-frontend"),
                          str(self.cskills / "design-taste-frontend")])
        # conflict 组 keep 恒为 None，先挡掉再按名找
        merged = next(g for g in groups if g["keep"] and g["keep"]["name"] == "gpt-taste")
        self.assertEqual(merged["keep"]["dirPath"], str(self.zskills / "gpt-taste"))
        self.assertEqual([m["dirPath"] for m in merged["merged"]],
                         [str(self.cskills / "taste-skill")])

    def test_doctor_sums_up_health(self):
        # 工具自留地（点开头的隐藏目录）不算可疑孤儿，不该出现在未识别列表里
        (self.cskills / ".system" / "cache").mkdir(parents=True)
        rc, out = self.run_main("doctor", "--hub", str(self.hub))
        self.assertEqual(rc, 0)
        self.assertIn("== Agent_skills doctor", out)
        self.assertIn(str(self.zskills), out)
        self.assertIn("共 6 个技能，全部健康", out)
        self.assertIn("== 未识别目录（只标记不处理）==", out)
        self.assertNotIn(".system", out)


if __name__ == "__main__":
    unittest.main()
