// 三层去重：L1 内容树哈希（自动合并）→ L2 名称归一（同名异容进冲突队列，D4a）→ L3 语义相似（默认关，仅提示）
"use strict";

/** 名称归一：小写、[_ ] → -、剥离尾部 skill 噪音与 -vN 版本后缀。
 *  例：taste-skill→taste、gpt-tasteskill→gpt-taste、design-taste-frontend 原样。 */
function normalizeName(name) {
  let n = String(name || "").toLowerCase().replace(/[\s_]+/g, "-");
  n = n.replace(/-?skills?$/, "");
  n = n.replace(/-v\d+$/, "");
  return n;
}

/**
 * 对全量扫描结果做去重分组。
 * 返回：
 *   unique      去重后的代表条目（含 sources 来源列表）
 *   duplicates  L1 合并明细 [{kept, removed, rule:"L1"}]
 *   conflicts   L2 冲突队列（同名归一、内容不同）[{key, variants:[entry]}]
 *   hints       L3 疑似相似提示（仅 enabled 时）
 */
function dedupe(scanned, cfg) {
  const unique = [];
  const duplicates = [];
  const conflicts = [];
  const byHash = new Map(); // treeHash → unique entry
  const byNorm = new Map(); // normalizeName → unique entry

  // L1：同哈希直接合并（跨名也算），代表取最早出现的条目（扫描顺序即工具优先级）
  for (const e of scanned.skills) {
    const hit = byHash.get(e.treeHash);
    if (hit) {
      hit.sources.push({ tool: e.tool, name: e.name, dir: e.dir });
      duplicates.push({ kept: { name: hit.name, tool: hit.tool }, removed: { name: e.name, tool: e.tool }, rule: "L1", basis: "内容树哈希一致" });
      continue;
    }
    const entry = { ...e, sources: [{ tool: e.tool, name: e.name, dir: e.dir }] };
    byHash.set(e.treeHash, entry);
    unique.push(entry);
  }

  // L2：归一同名但内容不同 → 冲突队列（不自动合并，D4a）
  for (const e of unique) {
    const key = normalizeName(e.skillName || e.name);
    if (!key) continue;
    if (byNorm.has(key)) {
      conflicts.push({ key, variants: [byNorm.get(key), e], rule: "L2", basis: "名称归一相同、内容不同" });
    } else {
      byNorm.set(key, e);
    }
  }

  // L3：语义相似提示（词频余弦，纯离线；默认关闭）
  const hints = [];
  if (cfg.l3 && cfg.l3.enabled) {
    const th = cfg.l3.threshold || 0.85;
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const sim = cosine(similarText(unique[i]), similarText(unique[j]));
        if (sim >= th) hints.push({ a: unique[i].name, b: unique[j].name, sim: Number(sim.toFixed(3)) });
      }
    }
  }

  return { unique, duplicates, conflicts, hints };
}

function similarText(e) {
  return ((e.skillName || e.name) + " " + (e.description || "")).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ").trim();
}

/** 词频向量余弦相似度 */
function cosine(a, b) {
  const va = new Map(), vb = new Map();
  for (const w of a.split(" ")) if (w) va.set(w, (va.get(w) || 0) + 1);
  for (const w of b.split(" ")) if (w) vb.set(w, (vb.get(w) || 0) + 1);
  let dot = 0, na = 0, nb = 0;
  for (const [w, x] of va) { na += x * x; const y = vb.get(w); if (y) dot += x * y; }
  for (const [, x] of vb) nb += x * x;
  if (!na || !nb) return 0;
  return dot / Math.sqrt(na * nb);
}

module.exports = { normalizeName, dedupe, cosine };
