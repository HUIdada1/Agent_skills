# Agent_skills 项目开发规则

权威需求依据是 `方案文档.md`（不进仓库，仅维护者本地持有），冲突处以它为准。

## 技术栈（2026-09-13 定稿，Python 方案已废弃）

- **Electron 35 + Vue3 + TypeScript + Vite + Pinia**（与参考项目「用量记录同步」同架构）
- 主进程 CommonJS（`electron/*.cjs`）+ `preload.cjs` 白名单桥接 + `electron/backend/*.cjs` 模块化后端
- 渲染层不引入 vue-router，页面切换由 Pinia `activePage` 驱动
- 打包：electron-builder（NSIS 安装版 + portable 便携版，win x64）
- 热更新：electron-updater 走 GitHub Releases（安装版）；便携版读 latest.yml 直链比对
- 零第三方运行时依赖（electron-updater 除外）：Junction 用 Node `fs.symlink(target, path, "junction")`，哈希用 `node:crypto`

## 目录约定

```
electron/
├── main.cjs              入口：窗口 / 单实例锁
├── preload.cjs           contextBridge 白名单桥
└── backend/
    ├── ipc.cjs           IPC 命令注册中心
    ├── config.cjs        用户配置（~\.agent_skills\config.json）
    ├── adapter.cjs       工具适配器：多候选路径探测
    ├── scanner.cjs       SKILL.md 解析、体检、内容树哈希
    ├── dedup.cjs         L1/L2/L3 去重、冲突队列
    ├── hub.cjs           中央仓库、manifest.json、.trash 回收站
    ├── mounter.cjs       Junction 建立/校验/摘除/重建、复制模式
    ├── syncer.cjs        同步状态机编排
    ├── report.cjs        MD 同步报告
    └── updater.cjs       热更新（R4）
src/                      Vue3 渲染层（七页：仪表盘/技能库/技能详情/同步中心/去重冲突/设置/更新中心）
tools/                    自测脚本与图标生成（纯 Node，不入打包产物）
build/                    electron-builder 资源（icon.ico/icon.png，入库）
.github/workflows/        release.yml 发布流水线
docs/                     架构与协议文档
```

## 发布规则

任何版本发布必须经 `.github/workflows/release.yml`：推 tag（`v*`）触发 → CI（windows-latest）vue-tsc 门禁 + electron-builder `--publish always` → Release 附 NSIS 安装包 / 便携版 exe / latest.yml / blockmap / checksums.txt。**禁止本地手工发版。**

## 版本号规范

- semver；`package.json` 的 `version` 是全项目唯一来源，其他任何文件禁止硬编码版本号
- 迭代流程：改完代码 → bump version → 打 tag → CI 自动出 Release → 软件内热更新检查的就是这个 Release

## 热更新底线

- `autoDownload=false`（下载必须用户触发）、`autoInstallOnAppQuit=false`（退出安装由 main.cjs `before-quit` 钩子接管静默安装）
- 便携版不支持自动更新，仅提示手动下载——该降级逻辑不可移除
- 任何改动不得绕过 electron-updater 的 SHA-512 校验（blockmap 增量校验）

## 写操作与同步

- 每次同步必须产出 MD 报告，写入中央仓库 `reports/`（固定骨架见 `docs/sync-report-spec.md`）
- sync 默认干跑预览，用户确认后才执行
- 任何删除/覆盖先进 `.trash`，保留 7 天，超期由体检页清理
- 陌生孤儿目录只标记不删除
- 同名异容冲突一律人工裁决，不自动选边（D4a）

## 代码风格

- KISS，禁止过度工程化与不必要的防御性设计
- 含中文的文件一律 UTF-8；所有文件读写显式 `encoding: "utf-8"`
- 自测脚本在系统临时目录造假技能，绝不读写用户真实的 `~/.zcode` `~/.codex` `~/.agent_skills`
- 命名贴业务、简短直接，不要 Manager/Handler/Helper 满天飞

## Git

提交说明一句话人话风格，例如：`修好 sync 把同一个技能收两遍的问题`。
