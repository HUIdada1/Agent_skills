# Agent_skills 项目开发规则

权威需求依据是 `方案文档.md`（不进仓库，仅维护者本地持有），冲突处以它为准。

## 技术栈

- Python 3.11+（方案文档原写 3.12，按开发机 3.11 放宽）
- GUI：pywebview + Vue3（M3 起）；打包：PyInstaller 单 exe（M4 起）
- M1 阶段零第三方依赖，只用 Python 标准库

## 目录约定

```
agent_skills/            Python 包
├── __main__.py          入口：无参启动 GUI（M3 接上），带子命令走 CLI
├── models.py            共享数据契约，所有模块只认这里的模型
├── _version.py          版本号唯一来源
├── adapter.py           工具适配器：多候选路径探测、config.json 配置
├── scanner.py           扫描编排、SKILL.md 解析、体检、内容树哈希
├── dedup.py             L1/L2/L3 去重、重复组、冲突
├── hub.py               中央仓库布局、manifest.json 读写、收纳、.trash
├── report.py            MD 同步报告、doctor 报告
├── syncer.py            同步状态机、Junction（M2 新增）
├── updater.py           热更新（M4 新增）
└── webapi.py            pywebview js_api 桥接（M3 新增）
frontend/                Vue3 + Vite（M3 新增，构建产物由 PyInstaller 内嵌）
build/                   PyInstaller spec（M4 新增）
.github/workflows/release.yml   发布流水线（M4 新增）
```

方案 4.1 的子包结构（adapter/、scanner/ 等）等模块长大再拆，不提前。

## 发布规则

任何版本发布必须经 `.github/workflows/release.yml`：打 tag 触发 → CI 用 PyInstaller 构建 windows_amd64 单文件 exe → 附 `checksums.txt`（SHA-256）。禁止本地手工发版。

## 版本号规范

- semver，渠道 stable / beta（pre-release）
- `agent_skills/_version.py` 的 `__version__` 是全项目版本号唯一来源，其他任何文件禁止硬编码版本号；M4 的构建注入直接改写这个文件
- 迭代流程：改完代码 → bump `_version.py` 到新版本号 → 打 tag → CI 自动出 Release → 软件内热更新检查的就是这个 Release

## 热更新底线

`.old` 回滚与 SHA-256 校验逻辑（updater 模块）任何时候不可移除、不可绕过。校验不过必须回滚，不许"先跑起来再说"。

## 写操作与同步

- 每次同步必须产出 MD 报告，写入中央仓库 `reports/`
- sync 默认 dry-run，加 `--execute` 才真正写盘
- 任何删除/覆盖先进 `.trash`，保留 7 天，超期由 `doctor --clean` 清理
- 陌生孤儿目录只标记不删除
- 同名异容冲突一律人工裁决，不自动选边（D4a）

## 代码风格

- KISS，禁止过度工程化与不必要的防御性设计
- 含中文的文件一律 UTF-8；代码里所有 `open()` 显式 `encoding="utf-8"`
- 测试用 unittest 标准库，tempfile 造临时目录，绝不读写用户真实的 `~/.zcode` `~/.codex` `~/.agent_skills`（只读扫描除外）
- 命名贴业务、简短直接，不要 Manager/Handler/Helper 满天飞

## Git

提交说明一句话人话风格，例如：`修好 sync 把同一个技能收两遍的问题`。
