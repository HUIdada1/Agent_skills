# 工具适配器自定义方案（v1）

目标：工具适配器从"写死五个内置 agent"升级为"内置注册表 + 自定义适配器 + 电脑扫描自动发现"。用户可为任意 agent 新增适配器（名字 + 候选技能目录），全站各页面的工具显示与联动全部跟随配置，不再硬编码。

## 一、数据模型

### 1. 统一工具条目

每个工具适配器是一个条目，最终都落在 `config.json` 的 `tools` map 里：

```json
{
  "id": "cursor",                      // 引用键，创建后不可改
  "name": "Cursor",                    // 显示名，随时可改（含中文）
  "icon": "ph-command",                // phosphor 图标名
  "enabled": true,                     // 停用 = 不扫描、不发布新挂载
  "paths": ["~/.cursor/skills"]        // 候选路径，按顺序探测取第一个命中
}
```

- **内置工具**：五个（zcode/codex/claude/antigravity/agents）的 id、图标、默认候选路径定义在 `adapter.cjs` 的注册表里；`config.json` 覆盖存储用户可改部分（name/enabled/paths）。
- **自定义工具**：整条目存 `config.json`，`adapter.cjs` 融合时凡注册表里没有的 `tools` 键都按自定义条目解析。
- 合并天然兼容：`mergeDeep` 会把磁盘上多出的 `tools` 键保留，旧配置无迁移成本。

### 2. id 规则（关键不变式）

- 格式 `^[a-z0-9][a-z0-9_-]{0,31}$`，创建时由名称自动生成 slug 或手填，**创建后不可改**。
- 不可改的原因：`id` 是唯一引用键，持久化在 manifest 来源（`sources[].tool`）、挂载记录（`mounts[].tool`）、冲突队列（`toolId`）、历史报告文本（只读存档）四处，改 id 会撕断引用链。
- 显示名、图标、路径、启用开关随时可改，历史记录读到的还是原 id，显示层按最新配置解析名字。

### 3. 图标

自定义工具从固定候选集里选一个 phosphor 图标（`ph-robot` / `ph-command` / `ph-terminal-window` / `ph-sparkle` / `ph-brain` / `ph-cube` / `ph-package` / `ph-code` / `ph-circle-wavy-question` 等），不做图片上传（KISS）。

## 二、电脑扫描自动发现

后端新增 `probeAgents(cfg)`（IPC 白名单 `probe_agents`）：

1. 对内置注册表的默认候选路径做存在性探测，报告"发现/未发现"。
2. 对 `KNOWN_AGENTS` 第三方探测表做目录存在性探测。表内是社区常见路径（`~/.cursor/skills`、`~/.qoder/skills`、`~/.roo/skills`、`~/.kilocode/skills`、`~/.gemini/skills`、`~/.windsurf/skills`、`~/.opencode/skills`、`~/.trae/skills`、`~/.augment/skills` 等，含 `%APPDATA%`、`%LOCALAPPDATA%` 下的已知变体），文件里集中维护，标注"社区常见路径，不保证，仅供一键添加"。
3. 探测**只读**：扫描不写配置、不建目录、不动挂载，只在设置页列出"命中了哪些"，用户点"添加"才落进 `config.json`。
4. 已注册工具（id 已存在或命中路径与现有 entries 相同）在结果里过滤掉，避免重复建议。
5. 一期只做目录探测。PATH/常见安装位置的可执行文件探测（`where codex` 之类）列为可选扩展，不做进一期——没装技能目录的 agent 本来就没有可收纳的东西。

返回结构：

```json
{
  "detected": [
    {
      "suggestId": "cursor",
      "name": "Cursor",
      "icon": "ph-command",
      "hitDirs": ["C:\\Users\\x\\.cursor\\skills"],
      "skillCount": 3          // 命中目录下子目录数（不含 junction），仅供展示
    }
  ]
}
```

## 三、后端改动

### adapter.cjs

- `BUILTIN_TOOLS` 拆成两个注册表：
  - `TOOL_REGISTRY`：内置五个的 `{ id, name, icon, defaultPaths }`。
  - `KNOWN_AGENTS`：第三方探测表（suggestId/name/icon/hitPaths），仅供 `probeAgents` 用。
- `resolveToolDir`：元信息融合顺序为 `注册表默认 → config.json 覆盖`；自定义条目全部字段来自 config。
- `resolveScanTargets` / `listTools`：遍历 `注册表 id ∪ cfg.tools 的多余键`，自定义条目原样进入扫描目标。`listTools` 增补 `builtin` 与 `deletable` 标记。
- 新增 `probeAgents(cfg)`。

### config.cjs

- `DEFAULT_CONFIG.tools` 保持五个内置键不变，零结构迁移。
- `saveConfig` 前增加工具条目校验：
  - id 格式合法；`name` 非空；`paths` 里每个条目若是绝对路径/`~` 开头则检查真实存在性由探测层负责，这里只挡明显非法值。
  - **路径防护**：`paths` 与 `customDirs` 不允许落在中央仓库目录（`hubDir()`）内部，防止"中央仓库扫自己"的闭环。
  - 指向另一工具相同目录只提示不阻止（用户可能有意的）。

### syncer.cjs / hub.cjs / mounter.cjs

- 零改动：扫描目标、挂载动作、孤儿判定全部经 `adapter.resolveScanTargets` 走，自定义 toolId 天然贯通。`doMount` 里 `a.toolId || "custom"` 的兜底保留。
- 系统技能目录（`.xxx-system-skills.marker`）判定是 scanner 层的通用逻辑，自定义工具目录下自动生效，无需额外处理。

### ipc.cjs / preload.cjs

- 新增 `probe_agents` 命令，preload 白名单同步加。
- 新增 `remove_tool { id, confirm?, detachMounts? }`：见第六节删除流程。
- `list_tools` 返回带 `builtin` / `deletable`。

## 四、前端改动

### 1. 干掉三处硬编码工具名

- `src/utils/format.ts` 的 `TOOL_NAMES`/`toolName()`、`src/views/SkillDetailView.vue` 里的第二份 `toolNames` 全部删除。
- Pinia `app` store 增加 `toolMeta`（`listTools()` 拉取，设置页保存成功后刷新）+ `toolName(id)` 查询，找不到映射回退显示 id 原文。
- 全站使用点替换：
  - `SkillDetailView.vue`：挂载状态表工具列、来源列表工具名。
  - `DashboardView.vue`：孤儿条目"存在于 xxx"。
  - `SyncView.vue`：孤儿表"所在工具"列、预览行 source（`s.tool` 拼接改显示名）。
  - `DedupView.vue`：冲突头部与"保留 xx 版"按钮的工具显示。
  - `LibraryView.vue`：卡片上的来源徽章 `{{ src.tool }}` 改显示名。
  - `SettingsView.vue`：本身从 `listTools` 取，跟随。

### 2. 设置页「工具适配器」改造

- 区块顶部增加两个入口：「扫描电脑发现」按钮 +「新增适配器」按钮。
- 发现向导（dialog）：列出 `probeAgents` 结果（图标、建议名、命中目录、技能数），每条一个「添加」；底部「手动新增」表单（名称 + id 自动生成可手改 + 图标选择 + 首个路径）。
- 每个工具一张卡片（内置与自定义同构）：
  - 工具名可编辑；自定义工具显示灰色小字 `id`（不可编辑）。
  - 图标可换（下拉候选集）。
  - 启用开关、候选路径增删改浏览（沿用现有 path-row）。
  - 命中/未命中徽章沿用现有逻辑。
  - 内置工具卡片只有"停用"，无删除；自定义工具卡片多一个「删除」，走删除流程。
- 「自定义目录」区块保留（兼容已有 `tool:"custom"` 历史记录），文案引导："若是某个 agent 的技能目录，建议新增为工具适配器，来源归属与挂载状态会更清楚。"

### 3. 联动规则

- 保存配置成功后 store 的 `toolMeta` 立即刷新 + 文案提示「已保存，同步中心重新扫描后生效」。
- 停用某工具：不扫描、不出现在孤儿/发布计划里；其已有挂载保留不摘（与现状一致），详情页仍可见可手动停用。
- 修改/删除路径导致挂载悬空：`verifyAll` 现有校验已覆盖，仪表盘挂载健康照常报"无效"，用户可点修复。

## 五、删除自定义适配器的引用处理

删除前由后端 `remove_tool`（dryRun 先行）检查引用面：

1. `conflicts.json` 里存在该 toolId 未裁决冲突 → 拒绝删除，提示先去冲突页裁决。
2. `manifest` 里有该工具的挂载 → 返回影响清单（技能数、挂载路径列表），前端确认后二选一：
   - **摘除并删除**（推荐）：逐个 `unmount`（只删 junction，绝不动真实目录与中央真身），挂载条目从 manifest 移除，`mergeHistory` 记一笔"工具 xxx 已删除，挂载 N 处摘除"。
   - **只禁用不删除**：不删条目，避免撕断引用。
3. `manifest.sources` 里的历史来源**保留不动**（历史档案），显示层对查不到映射的 tool 回退显示 id 原文；`mergeHistory` 记一笔作为交代。
4. 删除后释放的 id 允许被新工具复用；历史来源会显示新名字，歧义由 mergeHistory 记录兜底（取舍已接受，不做快照迁移）。

## 六、跨设备与历史数据边界

- `config.json` 不参与 WebDAV 同步（现状不变），自定义工具是**设备本地配置**。
- 远端同步来的 manifest 可能带本机没有的 toolId：显示回退 id 原文；挂载校验按记录里的绝对路径走，跨机路径必然报"无效"，属预期，不自动修复、不误挂载。
- remotesync 的虚拟来源 `tool: "local"` / `"webdav"` 不在工具注册表里，继续按现状处理。
- 历史报告文本里裸 id 不迁移（报告是只读存档）。
- `src/api/mock-preview.ts` 补一个自定义工具条目示例，保证开发预览不误导。

## 七、边界情况清单

- id 冲突（建议 id 已存在）→ 自动加数字后缀 `cursor-2`。
- 同一显示名、不同 id → 允许（显示上下文足以区分）。
- 自定义工具路径命中中央仓库 → 保存时拒绝（闭环防护）。
- 路径是文件、`~` 展开、相对路径 → 沿用 `resolveToolDir` 现有规则。
- 自定义工具目录里带系统技能标记目录 → 自动按系统技能处理（隐藏、不收纳、不挂载）。
- 新工具目录所在盘符不支持 junction → 挂载自动按 `mountMode` 逻辑，已有 copy 兜底机制。
- 旧版本 config.json（无自定义工具）→ 零迁移兼容。
- 便携版/多设备共用 config → 无新增状态，无影响。

## 八、实施任务分解（按轮提交）

1. `adapter.cjs`：注册表 + 自定义条目融合 + `listTools` 标记（后端先行，行为不变）。
2. `probeAgents` + IPC 命令 + preload 白名单 + 配置校验（id 格式 / 中央仓库闭环防护）。
3. 前端 store `toolMeta`/`toolName`，删除两处硬编码，替换五个页面使用点。
4. 设置页 UI：工具卡片编辑能力（改名/换图标/删除入口）+ 发现向导 + 手动新增。
5. `remove_tool` 删除流程（dryRun 检查 → 确认摘除）与前端交互。
6. `mock-preview.ts` 示例、`tools/` 自测脚本（临时目录验证探测/添加/删除引用链/闭环防护）。
7. 回归自测 + bump 版本 + 发版走 CI。