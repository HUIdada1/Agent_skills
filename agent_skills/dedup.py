"""去重：L1 内容树哈希、L2 名称归一、L3 相似度提示（默认关）。同名异容一律人工裁决（D4a）。"""

import re
from difflib import SequenceMatcher

from agent_skills.models import DedupGroup, SkillFinding

_NOISE_SUFFIX = re.compile(r"(?:v\d+|skill)$", re.IGNORECASE)


def normalize_name(name: str) -> str:
    """技能名归一：小写、去掉 -/_/空格、剥掉 v1/skill 噪音后缀，L2 和测试都靠它。"""
    n = re.sub(r"[-_ ]+", "", name.strip().lower())
    while True:
        stripped = _NOISE_SUFFIX.sub("", n)
        # 剥空了说明名字本身就叫 skill/v1，别剥了
        if not stripped or stripped == n:
            return n
        n = stripped


def _text(f: SkillFinding) -> str:
    return f"{f.name}\n{f.description}"


def group(findings: list[SkillFinding], enable_l3: bool = False) -> list[DedupGroup]:
    """把扫描结果分成去重组，每个 finding 恰好出现在一组，单例也成组，sync 才不会漏收。"""
    norms = [normalize_name(f.name) for f in findings]
    taken = [False] * len(findings)
    found: list[tuple[int, DedupGroup]] = []

    # 归一后同名、内容却对不上的：同名异容，整体进裁决队列，绝不替用户挑一个（D4a）
    by_norm: dict[str, list[int]] = {}
    for i, n in enumerate(norms):
        by_norm.setdefault(n, []).append(i)
    for n, idxs in by_norm.items():
        if len({findings[i].tree_hash for i in idxs}) > 1:
            members = [findings[i] for i in idxs]
            found.append((idxs[0], DedupGroup(
                kind="conflict", keep=None, merged=members,
                reason=f"名称归一后同为 {n!r} 但内容不同，等人工裁决，不自动选边")))
            for i in idxs:
                taken[i] = True

    # 剩下的按内容树哈希合并：名字相同是 l1，改名副本是 l2
    by_hash: dict[str, list[int]] = {}
    for i, f in enumerate(findings):
        if not taken[i]:
            by_hash.setdefault(f.tree_hash, []).append(i)
    for h, idxs in by_hash.items():
        if len(idxs) < 2:
            continue
        members = [findings[i] for i in idxs]
        # 无名那份起不了中央目录名，别让它当 keep 拖累同组有名字的副本
        keep = next((m for m in members if m.name), members[0])
        if len({f.name for f in members}) == 1:
            kind = "l1"
            reason = f"内容树哈希一致（{h[:12]}…），保留 {keep.tool}:{keep.name}"
        elif len({norms[i] for i in idxs}) == 1:
            kind = "l2"
            reason = (f"名称归一后同为 {norms[idxs[0]]!r} 且内容一致（{h[:12]}…），"
                      f"按改名副本收纳，保留 {keep.tool}:{keep.name}")
        else:
            # 名字对不上但内容一字不差，哈希说了算
            kind = "l1"
            reason = f"内容树哈希一致（{h[:12]}…），名字不同仍按同一技能收，保留 {keep.tool}:{keep.name}"
        found.append((idxs[0], DedupGroup(kind=kind, keep=keep, merged=members[1:], reason=reason)))
        for i in idxs:
            taken[i] = True

    # 单例先成 unique 组，L3 的比对集合里才有它们的本尊
    for i, f in enumerate(findings):
        if not taken[i]:
            found.append((i, DedupGroup(kind="unique", keep=f, merged=[], reason="")))

    # L3 拿各组代表（unique 本尊 + l1/l2 的 keep）两两比对：改名副本的正主可能已被 L1 收进
    # 组里，只比 singles 会漏掉方案点名的 taste-skill 场景。命中只追加提示组，不动主分组；
    # 同一技能只提示一次，三个互相相似的也不把计数吹成六份。
    if enable_l3:
        reps = [pair[1].keep for pair in found if pair[1].keep is not None]
        hinted: set[int] = set()
        extra = 0
        for a in range(len(reps)):
            if id(reps[a]) in hinted:
                continue
            for b in range(a + 1, len(reps)):
                if id(reps[b]) in hinted:
                    continue
                i, j = reps[a], reps[b]
                ratio = SequenceMatcher(None, _text(i), _text(j)).ratio()
                if ratio >= 0.85:
                    found.append((len(findings) + extra, DedupGroup(
                        kind="l3-hint", keep=None, merged=[i, j],
                        reason=f"名称+描述相似度 {ratio:.2f}，仅提示，不自动合并")))
                    hinted.update((id(i), id(j)))
                    extra += 1
                    break

    found.sort(key=lambda pair: pair[0])
    return [g for _, g in found]
