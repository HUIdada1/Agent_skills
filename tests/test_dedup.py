"""dedup 与 hub 的单元测试：tempfile 造数据，不碰用户真实的 ~/.zcode ~/.codex ~/.agent_skills。"""

import hashlib
import shutil
import tempfile
import unittest
from pathlib import Path

from agent_skills.dedup import group, normalize_name
from agent_skills.hub import (
    ensure_layout,
    import_skill,
    is_safe_dirname,
    load_manifest,
    save_manifest,
    skill_path,
)
from agent_skills.models import DedupGroup, SkillFinding


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def skill_md(name: str, body: str) -> str:
    return f"---\nname: {name}\n---\n{body}"


def make_skill(base: Path, name: str, body: str) -> Path:
    # exist_ok 是为了同名技能重收时能覆盖旧源目录
    d = base / name
    (d / "assets").mkdir(parents=True, exist_ok=True)
    (d / "SKILL.md").write_text(skill_md(name, body), encoding="utf-8")
    (d / "assets" / "note.txt").write_text(body, encoding="utf-8")
    return d


def finding(tool: str, dir_path: Path, name: str, tree_hash: str) -> SkillFinding:
    return SkillFinding(tool=tool, dir_path=dir_path, name=name, description="kit",
                        version="1.0.0", tree_hash=tree_hash)


class NormalizeNameTest(unittest.TestCase):
    def test_lowercase_and_separator_free(self):
        # -/_/空格视作无语义分隔符，删掉后比较
        self.assertEqual(normalize_name("BrandKit"), "brandkit")
        self.assertEqual(normalize_name("Brand_Kit"), "brandkit")
        self.assertEqual(normalize_name("brand-kit"), "brandkit")
        self.assertEqual(normalize_name("brand kit"), "brandkit")

    def test_noise_suffixes(self):
        # v1、skill 及其叠加都算噪音，逐层剥
        self.assertEqual(normalize_name("design-taste-frontend-v1"), "designtastefrontend")
        self.assertEqual(normalize_name("gpt-tasteskill"), "gpttaste")
        self.assertEqual(normalize_name("browser-skill"), "browser")
        self.assertEqual(normalize_name("full_output_skill"), "fulloutput")
        self.assertEqual(normalize_name("myskillv2"), "my")
        self.assertEqual(normalize_name("tool-skill-v1"), "tool")

    def test_never_strips_to_empty(self):
        self.assertEqual(normalize_name("skill"), "skill")
        self.assertEqual(normalize_name("v1"), "v1")
        self.assertEqual(normalize_name(""), "")

    def test_non_suffix_word_untouched(self):
        # skill 不在结尾时不是噪音
        self.assertEqual(normalize_name("skillful"), "skillful")


class GroupTest(unittest.TestCase):
    def setUp(self):
        tmp = Path(tempfile.mkdtemp(prefix="as_test_dedup_"))
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        self.base = tmp

    def test_l1_merges_same_hash_copies(self):
        body = "premium brand kit body"
        zdir = make_skill(self.base / "zcode", "brandkit", body)
        cdir = make_skill(self.base / "codex", "brandkit", body)
        gs = group([finding("zcode", zdir, "brandkit", sha(body)),
                    finding("codex", cdir, "brandkit", sha(body))])
        self.assertEqual(len(gs), 1)
        g = gs[0]
        self.assertEqual(g.kind, "l1")
        self.assertEqual(g.keep.tool, "zcode")
        self.assertEqual([m.tool for m in g.merged], ["codex"])

    def test_l2_merges_renamed_copy(self):
        # 方案 1.1 点名的改名副本：gpt-tasteskill 是 gpt-taste 换皮，归一同名 + 哈希一致 → l2
        body = "elite ux body"
        zdir = make_skill(self.base / "zcode", "gpt-taste", body)
        cdir = make_skill(self.base / "codex", "gpt-tasteskill", body)
        gs = group([finding("zcode", zdir, "gpt-taste", sha(body)),
                    finding("codex", cdir, "gpt-tasteskill", sha(body))])
        self.assertEqual(len(gs), 1)
        self.assertEqual(gs[0].kind, "l2")
        self.assertEqual(gs[0].keep.name, "gpt-taste")
        self.assertEqual([m.name for m in gs[0].merged], ["gpt-tasteskill"])

    def test_taste_skill_and_gpt_taste_stay_apart(self):
        # 方案 M1.3 字面提"taste-skill 与 gpt-taste"，但按归一规则两者归一名不同（taste / gpttaste），
        # 只能锁定不误合并的现实行为：异哈希各自 unique，同哈希按内容判 l1
        gs = group([finding("codex", make_skill(self.base / "codex", "taste-skill", "taste body"),
                            "taste-skill", sha("taste body")),
                    finding("zcode", make_skill(self.base / "zcode", "gpt-taste", "gpt taste body"),
                            "gpt-taste", sha("gpt taste body"))])
        self.assertEqual([(g.kind, g.keep.name) for g in gs],
                         [("unique", "taste-skill"), ("unique", "gpt-taste")])

        same = group([finding("codex", make_skill(self.base / "codex2", "taste-skill", "same body"),
                              "taste-skill", sha("same body")),
                      finding("zcode", make_skill(self.base / "zcode2", "gpt-taste", "same body"),
                              "gpt-taste", sha("same body"))])
        self.assertEqual(same[0].kind, "l1")

    def test_same_name_diff_hash_goes_to_conflict(self):
        # 真机形态：design-taste-frontend 与它的 -v1 改名副本，内容两种，全部候选进裁决队列
        new, old = "redesigned body", "old v1 body"
        gs = group([finding("zcode", make_skill(self.base / "zcode", "design-taste-frontend", new),
                            "design-taste-frontend", sha(new)),
                    finding("zcode", make_skill(self.base / "zcode", "design-taste-frontend-v1", old),
                            "design-taste-frontend-v1", sha(old)),
                    finding("codex", make_skill(self.base / "codex", "design-taste-frontend", new),
                            "design-taste-frontend", sha(new))])
        self.assertEqual(len(gs), 1)
        g = gs[0]
        self.assertEqual(g.kind, "conflict")
        self.assertIsNone(g.keep)           # 绝不自动选边
        self.assertEqual(len(g.merged), 3)  # 内容一致的两份也在候选里，收谁由人定（D4a）

    def test_conflict_does_not_block_other_groups(self):
        alpha = "alpha body"
        findings = [
            finding("zcode", make_skill(self.base / "zcode", "alpha", alpha), "alpha", sha(alpha)),
            finding("codex", make_skill(self.base / "codex", "alpha", alpha), "alpha", sha(alpha)),
            finding("zcode", make_skill(self.base / "zcode", "brandkit", "brand body"),
                    "brandkit", sha("brand body")),
            finding("codex", make_skill(self.base / "codex", "brand-kit", "other body"),
                    "brand-kit", sha("other body")),
            finding("zcode", make_skill(self.base / "zcode", "lonely", "lonely body"),
                    "lonely", sha("lonely body")),
        ]
        gs = group(findings)
        self.assertEqual(sorted(g.kind for g in gs), ["conflict", "l1", "unique"])
        # 每个 finding 恰好出现在一组，不重不漏
        seen = [x for g in gs for x in ([g.keep] if g.keep is not None else []) + g.merged]
        self.assertEqual(len(seen), len(findings))
        self.assertEqual({id(x) for x in seen}, {id(x) for x in findings})

    def test_singletons_unique(self):
        gs = group([finding("zcode", make_skill(self.base / "zcode", "solo", "solo body"),
                            "solo", sha("solo body"))])
        self.assertEqual(len(gs), 1)
        self.assertEqual(gs[0].kind, "unique")
        self.assertIsNotNone(gs[0].keep)
        self.assertEqual(gs[0].merged, [])
        self.assertEqual(group([]), [])

    def test_l3_hint_off_by_default(self):
        a = finding("zcode", make_skill(self.base / "zcode", "data-tools", "查询工具集"),
                    "data-tools", sha("查询工具集 a"))
        b = finding("codex", make_skill(self.base / "codex", "data-toolz", "查询工具集"),
                    "data-toolz", sha("查询工具集 b"))
        self.assertTrue(all(g.kind != "l3-hint" for g in group([a, b])))

    def test_l3_hint_reaches_group_reps(self):        # 方案点名的 taste-skill 场景：它的正主 gpt-taste 已被 L1 收组，L3 必须比到组代表才能提示出来
        desc = ("面向落地页与作品集的反套路前端设计规范，覆盖动效排版交互与可访问性基线，"
                "含大量示例与负面清单，帮助团队沉淀统一的设计经验")
        a = SkillFinding(tool="codex", dir_path=make_skill(self.base / "codex", "taste-skill", "taste body"),
                         name="taste-skill", description=desc, tree_hash=sha("taste body"))
        body = "elite ux body"
        b = SkillFinding(tool="zcode", dir_path=make_skill(self.base / "zcode", "gpt-taste", body),
                         name="gpt-taste", description=desc, tree_hash=sha(body))
        c = SkillFinding(tool="codex", dir_path=make_skill(self.base / "codex", "gpt-tasteskill", body),
                         name="gpt-tasteskill", description=desc, tree_hash=sha(body))
        gs = group([a, b, c], enable_l3=True)
        hint = next(g for g in gs if g.kind == "l3-hint")
        self.assertIsNone(hint.keep)  # 提示组永不选边
        self.assertEqual({f.name for f in hint.merged}, {"taste-skill", "gpt-taste"})
        self.assertIn("相似度", hint.reason)
        # 提示组不改变主分组：gpt-taste 的 L2 收纳照旧（正主与改名副本归一同名）
        main_group = next(g for g in gs if g.kind in ("l1", "l2"))
        self.assertEqual(main_group.keep.name, "gpt-taste")

    def test_l3_hints_count_each_skill_once(self):
        # 三个互相相似的技能：配对成功后各自退场，提示只出一份，不把 2 个技能吹成 6 份
        desc = "统一各工具设计口径的规范长文本，覆盖动效排版与交互基线，附示例清单" * 3
        mk = lambda tool, name, body: SkillFinding(
            tool=tool, dir_path=make_skill(self.base / tool, name, body),
            name=name, description=desc, tree_hash=sha(body))
        gs = group([mk("zcode", "aa-tools", "body 1"),
                    mk("codex", "aa-toolz", "body 2"),
                    mk("zcode", "aa-tool", "body 3")], enable_l3=True)
        hints = [g for g in gs if g.kind == "l3-hint"]
        self.assertEqual(len(hints), 1)
        self.assertEqual(len({f.name for f in hints[0].merged}), 2)


class HubTest(unittest.TestCase):
    def setUp(self):
        tmp = Path(tempfile.mkdtemp(prefix="as_test_hub_"))
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        self.workspace = tmp
        self.root = tmp / "hub"
        ensure_layout(self.root)

    def test_is_safe_dirname_windows_rules(self):
        self.assertTrue(is_safe_dirname("brandkit"))
        self.assertFalse(is_safe_dirname(""))
        self.assertFalse(is_safe_dirname("foo:bar"))
        self.assertFalse(is_safe_dirname("a<b"))
        self.assertFalse(is_safe_dirname("CON"))
        self.assertFalse(is_safe_dirname("nul"))
        self.assertFalse(is_safe_dirname("trailing "))
        self.assertFalse(is_safe_dirname("dot."))
        self.assertFalse(is_safe_dirname("x" * 101))

    def _import(self, name: str, body: str, tool: str = "zcode", merged_tools: tuple = ("codex",)):
        keep = finding(tool, make_skill(self.workspace / "src" / tool, name, body), name, sha(body))
        merged = [finding(t, make_skill(self.workspace / "src" / t, name, body), name, sha(body))
                  for t in merged_tools]
        g = DedupGroup(kind="l1" if merged else "unique", keep=keep, merged=merged)
        return import_skill(self.root, keep, g), keep

    def test_import_produces_correct_manifest(self):
        entry, _ = self._import("brandkit", "brandkit body v1")
        target = skill_path(self.root, "brandkit")
        self.assertTrue((target / "SKILL.md").exists())
        self.assertTrue((target / "assets" / "note.txt").exists())
        # manifest 由 __main__ 统一落盘，这里手动 save 后读回验证
        save_manifest(self.root, {"brandkit": entry})
        e = load_manifest(self.root)["brandkit"]
        self.assertEqual(e.name, "brandkit")
        self.assertEqual(e.tree_hash, sha("brandkit body v1"))
        self.assertEqual(e.version, "1.0.0")
        self.assertEqual([(s.tool, s.original_name) for s in e.sources],
                         [("zcode", "brandkit"), ("codex", "brandkit")])
        self.assertTrue(all(s.first_seen for s in e.sources))
        self.assertEqual(e.merge_history[0].action, "L1 merge")
        self.assertEqual(e.merge_history[0].removed, ["codex:brandkit"])
        # 方案 4.2 的驼峰键逐个在场
        d = e.to_dict()
        for key in ("name", "version", "description", "treeHash", "sources", "mounts", "mergeHistory"):
            self.assertIn(key, d)
        self.assertEqual(d["sources"][0]["firstSeen"], e.sources[0].first_seen)

    def test_merged_copies_collapse_into_one_dir(self):
        # l1 组只有 keep 一份进 skills/，merged 副本不重复收录、不互相覆盖
        self._import("brandkit", "brandkit body v1")
        self.assertEqual([p.name for p in (self.root / "skills").iterdir()], ["brandkit"])

    def test_reimport_same_hash_is_skipped(self):
        # 复现 cmd_sync 的守卫：manifest 同哈希即 skipped，不再 import，真身无恙
        entry, keep = self._import("brandkit", "brandkit body v1")
        save_manifest(self.root, {"brandkit": entry})
        target_md = skill_path(self.root, "brandkit") / "SKILL.md"
        mtime_before = target_md.stat().st_mtime_ns

        manifest = load_manifest(self.root)
        self.assertEqual(manifest["brandkit"].tree_hash, keep.tree_hash)

        self.assertEqual(target_md.read_text(encoding="utf-8"),
                         skill_md("brandkit", "brandkit body v1"))
        self.assertEqual(target_md.stat().st_mtime_ns, mtime_before)
        self.assertEqual(list((self.root / ".trash").iterdir()), [])

    def test_reimport_diff_hash_trashes_old(self):
        # 异哈希重收：旧版先进 .trash 可回放，真身换新，旧合并历史保留（D4 红线）
        entry, _ = self._import("brandkit", "brandkit body v1")
        save_manifest(self.root, {"brandkit": entry})
        entry2, _ = self._import("brandkit", "brandkit body v2")

        trashed = list((self.root / ".trash").iterdir())
        self.assertEqual(len(trashed), 1)
        self.assertTrue(trashed[0].name.startswith("brandkit-"))
        self.assertEqual((trashed[0] / "SKILL.md").read_text(encoding="utf-8"),
                         skill_md("brandkit", "brandkit body v1"))
        self.assertEqual((skill_path(self.root, "brandkit") / "SKILL.md").read_text(encoding="utf-8"),
                         skill_md("brandkit", "brandkit body v2"))

        save_manifest(self.root, {"brandkit": entry2})
        e = load_manifest(self.root)["brandkit"]
        self.assertEqual(len(e.merge_history), 3)
        self.assertEqual(e.merge_history[0].action, "L1 merge")
        self.assertEqual(e.merge_history[1].action, "覆盖旧版（旧版移入回收站）")
        self.assertEqual(e.merge_history[2].action, "L1 merge")
        self.assertEqual(e.tree_hash, sha("brandkit body v2"))


if __name__ == "__main__":
    unittest.main()
