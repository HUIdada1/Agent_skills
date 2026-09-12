"""全项目共享的数据结构：scanner / dedup / hub / report 以至将来的 GUI 都只认这里的模型。"""

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class ToolAdapter:
    tool: str
    candidate_paths: list[Path] = field(default_factory=list)
    hit_path: Path | None = None

    def to_dict(self) -> dict:
        return {
            "tool": self.tool,
            "candidatePaths": [str(p) for p in self.candidate_paths],
            "hitPath": str(self.hit_path) if self.hit_path is not None else None,
        }


@dataclass
class SkillFinding:
    tool: str
    dir_path: Path
    name: str = ""
    description: str = ""
    version: str = ""
    tree_hash: str = ""
    issues: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "tool": self.tool,
            "dirPath": str(self.dir_path),
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "treeHash": self.tree_hash,
            "issues": list(self.issues),
        }


# kind 取值：unique 无重复 / l1 内容哈希相同 / l2 名称归一相同 / l3-hint 语义相似仅提示 / conflict 同名异容待人工裁决
@dataclass
class DedupGroup:
    kind: str
    keep: SkillFinding | None = None
    merged: list[SkillFinding] = field(default_factory=list)
    reason: str = ""

    def to_dict(self) -> dict:
        return {
            "kind": self.kind,
            "keep": self.keep.to_dict() if self.keep is not None else None,
            "merged": [m.to_dict() for m in self.merged],
            "reason": self.reason,
        }


@dataclass
class SourceRecord:
    tool: str = ""
    first_seen: str = ""
    original_name: str = ""

    def to_dict(self) -> dict:
        return {
            "tool": self.tool,
            "firstSeen": self.first_seen,
            "originalName": self.original_name,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "SourceRecord":
        return cls(
            tool=data.get("tool", ""),
            first_seen=data.get("firstSeen", ""),
            original_name=data.get("originalName", ""),
        )


@dataclass
class MountRecord:
    tool: str = ""
    path: str = ""
    type: str = "junction"
    enabled: bool = True

    def to_dict(self) -> dict:
        return {
            "tool": self.tool,
            "path": self.path,
            "type": self.type,
            "enabled": self.enabled,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "MountRecord":
        return cls(
            tool=data.get("tool", ""),
            path=data.get("path", ""),
            type=data.get("type", "junction"),
            enabled=bool(data.get("enabled", True)),
        )


@dataclass
class MergeRecord:
    at: str = ""
    action: str = ""
    removed: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "at": self.at,
            "action": self.action,
            "removed": list(self.removed),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "MergeRecord":
        return cls(
            at=data.get("at", ""),
            action=data.get("action", ""),
            removed=list(data.get("removed", [])),
        )


# 字段与方案 4.2 的 manifest.json 条目一一对应（treeHash/mergeHistory 在 JSON 里是驼峰）
@dataclass
class ManifestEntry:
    name: str = ""
    version: str = ""
    description: str = ""
    tree_hash: str = ""
    sources: list[SourceRecord] = field(default_factory=list)
    mounts: list[MountRecord] = field(default_factory=list)
    merge_history: list[MergeRecord] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "treeHash": self.tree_hash,
            "sources": [s.to_dict() for s in self.sources],
            "mounts": [m.to_dict() for m in self.mounts],
            "mergeHistory": [h.to_dict() for h in self.merge_history],
        }

    @classmethod
    def from_dict(cls, data: dict) -> "ManifestEntry":
        return cls(
            name=data.get("name", ""),
            version=data.get("version", ""),
            description=data.get("description", ""),
            tree_hash=data.get("treeHash", ""),
            sources=[SourceRecord.from_dict(s) for s in data.get("sources", [])],
            mounts=[MountRecord.from_dict(m) for m in data.get("mounts", [])],
            merge_history=[MergeRecord.from_dict(h) for h in data.get("mergeHistory", [])],
        )


# 元素格式：普通技能用名字，跨工具场景用 "tool:name"；published 在 M2 Junction 分发落地前恒为空
# hints 只装 l3-hint 的成员名：语义是"疑似重复，仅提示"，与冲突（同名异容待裁决）分开统计
@dataclass
class SyncOutcome:
    imported: list[str] = field(default_factory=list)
    published: list[str] = field(default_factory=list)
    conflicts: list[str] = field(default_factory=list)
    hints: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    trashed: list[str] = field(default_factory=list)
