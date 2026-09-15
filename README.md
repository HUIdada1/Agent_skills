# Agent_skills

**AI Agent 技能中央仓库** —— 把散落在各个 AI 编码工具里的 Agent Skills（`SKILL.md` 文件夹格式）去重、收纳到一个中央文件夹，再让所有工具通过 Windows Junction 共用同一份。装一次，全工具生效。

> Electron 35 + Vue3 + TypeScript + Vite + Pinia · 单 exe 分发 · GitHub Releases 热更新

## 解决什么问题

各 AI Agent 工具各自维护一套技能目录，导致：

1. **重复存储**：同一个技能被复制到多个工具目录，内容漂移后无人知晓（实测本机 ZCode + Codex 共 37 份副本，去重后 24 个技能）。
2. **不同步**：在 ZCode 安装的技能，Codex / Claude Code / Antigravity 看不到。
3. **不可见**：全机器装了多少技能、哪些重复、哪些过时，没有汇总视图。

## 工作原理

```
                ┌─────────────────────────────┐
                │      中央技能仓库              │
                │  %USERPROFILE%\.agent_skills  │
                │  ├── skills/    ← 唯一真身     │
                │  ├── manifest.json            │
                │  ├── reports/   ← 同步MD报告   │
                │  └── .trash/    ← 回收站       │
                └──────────────┬──────────────┘
           Junction（按技能粒度）│
     ┌──────────┬──────────┼──────────┬──────────┐
     ▼          ▼          ▼          ▼          ▼
  ~/.zcode   ~/.codex   ~/.claude  ~/.gemini   自定义目录
   /skills    /skills    /skills    /.../skills
```

- **中央仓库是唯一真身（Source of Truth）**，各工具目录只是它的视图（Junction，无需管理员权限）。
- **三层去重**：L1 内容树哈希精确去重 → L2 名称归一去重 → L3 语义相似度提示（默认关闭）。
- **同步状态机**：收纳 / 发布 / 冲突裁决 / 回收站兜底，全程产出 MD 报告。
- **安全红线**：删除/覆盖先进 `.trash`（7 天可回滚）；同名异容冲突一律人工裁决；孤儿目录只标记不动。

## 功能

- 五个内置工具适配器（ZCode / Codex CLI / Claude Code / Antigravity 新旧路径 / 通用 `~/.agents/skills`）+ 自定义目录
- `SKILL.md` frontmatter 解析与体检（缺描述、空目录、坏结构）
- 手动同步：干跑预览 → 确认执行；每次同步生成 `reports/sync-<时间戳>.md`
- 自动感知（默认开）：后台每 15 秒扫一遍各工具技能目录，AI 原位新增的技能零冲突自动收纳分发，有冲突只提醒；技能库页可手动立即刷新
- 中央巡检：`skills\` 里躺着但 manifest 未登记的目录（被绕过软件直接放入的）标"中央未登记"，一键「纳管」只补账不动文件
- 冲突裁决：双栏 diff 对比 + 人工选择保留哪一份
- Junction 挂载 / 摘除 / 一键重建；复制模式兜底
- 明亮 / 黑暗双主题，默认深色
- 热更新：安装版应用内检查 → 下载 → 校验 → 退出时静默安装（GitHub Releases）；便携版提示手动下载

## 开发

```bash
npm install        # Node >= 18
npm run dev        # Vite + Electron 开发模式
npm run build      # vue-tsc 类型门禁 + 前端构建
npm run selftest:core   # 核心引擎自测（临时目录，不碰真实数据）
npm run electron:pack   # 打包（仅目录，验证用）
npm run electron:build  # 打包 NSIS + 便携版
```

## 发布

推 tag 触发 CI 自动发版（禁止本地手工发版）：

```bash
npm version patch     # 0.1.0 → 0.1.1
git push --follow-tags
```

CI（windows-latest）自动构建并发布 Release，附安装包 / 便携版 / latest.yml / checksums。客户端通过 GitHub Releases 热更新。

## License

MIT
