# 热更新机制

## 双通道

| 形态 | 通道 | 机制 |
|---|---|---|
| NSIS 安装版 | electron-updater（应用内更新） | 检查 → 下载 → 校验 → 退出时静默安装 → 自动重启 |
| portable 便携版 | latest.yml 直链比对 | 读 GitHub `releases/latest/download/latest.yml`，semver 大于本地即提示手动下载（不支持自动更新） |

## 安装版流程

1. **版本检查**：启动后 60 秒首次检查，之后每 6 小时；设置页可关闭自动检查。手动检查带 30 秒防抖。
2. **下载**：由用户在更新中心点击触发（`autoDownload = false`），按 blockmap 增量下载，进度实时广播到渲染进程（`app:event` 通道）。
3. **校验**：electron-updater 按 latest.yml 中的 sha512 与 blockmap 自动校验，失败走 error 收口并提示手动更新。
4. **安装**：下载完成后两种方式生效——
   - 更新中心点「立即重启安装」；
   - 不点则退出应用时由 `before-quit` 钩子拦截并静默安装（`quitAndInstall(true, true)`，不弹向导、装完自动重启）。
5. **通知**：自动检查发现新版本弹系统通知（同一版本跨会话只提醒一次，记录在 `config.json` 的 `update.notifiedVersion`）；手动检查不弹。

## 发布侧（版本三要素必须一致）

1. `package.json` 的 `version` 是唯一来源。
2. 打 tag `v{version}`（tag 与 version 不一致时 CI 直接失败）。
3. CI（windows-latest）执行：`npm ci` → vue-tsc 门禁 → 核心自测 → `electron-builder --publish always` → 上传 `checksums.txt` → 校验 `latest.yml` 可下载且版本匹配。

发布后客户端立即可见；**禁止本地手工发版**。

## 不可移除的底线

- `autoDownload = false`：下载必须用户触发。
- `autoInstallOnAppQuit = false` + `before-quit` 接管：默认实现会弹安装向导，必须静默。
- `installTriggered` 防重入与 10 秒兜底：防止 quitAndInstall 内部再次 quit 造成死循环、安装器被杀软拦截后应用无法退出。
- 便携版 latest.yml 比对降级逻辑：便携版目录是临时解压副本，注册自动更新会指向被删除的路径。
- 渠道 stable / beta（pre-release）：`update.channel` 配置保留，当前构建均走 stable Release。
