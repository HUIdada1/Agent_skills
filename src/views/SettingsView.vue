<script setup lang="ts">
// 设置：工具适配器 / 同步与去重 / 中央仓库与更新 / 后台与调度 / 回收站 / 危险区
import { ref, onMounted } from "vue";
import { ElMessageBox } from "element-plus";
import { loadConfig, saveConfig, listTools, browseDir, trashList, trashRestore, trashPurge, openDataDir, getDataDir, getIsPortable, type AppConfig, type ToolRow, type TrashRow } from "../api/ipc";
import { fmtTime, fmtSize } from "../utils/format";

const cfg = ref<AppConfig | null>(null);
const tools = ref<ToolRow[]>([]);
const trash = ref<TrashRow[]>([]);
const hubDirLabel = ref("%USERPROFILE%\\.agent_skills");
const actionMsg = ref("");
const saving = ref(false);
const portable = ref(false);

async function load() {
  cfg.value = await loadConfig();
  tools.value = (await listTools()) || [];
  trash.value = (await trashList()) || [];
  portable.value = !!(await getIsPortable());
  const dir = await getDataDir();
  if (dir) hubDirLabel.value = dir;
}

async function save() {
  if (!cfg.value) return;
  saving.value = true;
  try {
    const r = await saveConfig(cfg.value);
    actionMsg.value = r?.ok ? "设置已保存，下次扫描生效" : r?.message || "保存失败";
  } finally {
    saving.value = false;
  }
}

async function browseToolPath(toolId: string, idx: number) {
  const r = await browseDir();
  if (r?.ok && r.path) {
    if (toolId === "custom") cfg.value!.customDirs[idx] = r.path;
    else cfg.value!.tools[toolId].paths[idx] = r.path;
  }
}

async function browseCustomAdd() {
  const r = await browseDir();
  if (r?.ok && r.path) cfg.value!.customDirs.push(r.path);
}

async function restoreTrash(name: string) {
  const r = await trashRestore(name);
  actionMsg.value = r?.ok ? `已还原到 ${r.dest}` : r?.message || "还原失败";
  await load();
}

async function purgeAll() {
  try {
    await ElMessageBox.confirm("立即永久删除 .trash 内的全部历史版本，此操作不可恢复。", "清空回收站", {
      confirmButtonText: "清空",
      cancelButtonText: "取消",
      type: "warning",
    });
  } catch {
    return; // 用户点了取消
  }
  const r = await trashPurge();
  actionMsg.value = `已清理 ${r?.purged ?? 0} 项`;
  await load();
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>设置</h1>
        <p class="sub">所有路径均支持手动修改，改动保存后下次扫描生效。配置持久化在 <span class="mono">config.json</span>。</p>
      </div>
      <div class="head-actions">
        <el-button @click="openDataDir"><i class="ph ph-folder-open"></i>打开数据目录</el-button>
        <el-button type="primary" :loading="saving" @click="save">{{ saving ? "保存中" : "保存" }}</el-button>
      </div>
    </div>

    <div class="note mt-8" v-if="actionMsg"><i class="ph ph-info"></i><div>{{ actionMsg }}</div></div>

    <template v-if="cfg">
      <div class="section">
        <h2>工具适配器</h2>
        <p class="desc">每个工具的候选技能目录（按顺序探测，取第一个存在的）。Antigravity 等路径漂移工具可配置多个候选。</p>
        <div class="panel">
          <div class="tool-block" v-for="t in tools" :key="t.id">
            <div class="tool-head">
              <span class="tool-name">{{ t.name }}</span>
              <el-switch v-model="cfg!.tools[t.id]!.enabled" />
            </div>
            <div class="path-row" v-for="(p, i) in cfg!.tools[t.id]!.paths" :key="i">
              <el-input v-model="cfg!.tools[t.id]!.paths[i]" placeholder="候选路径（~ 开头或绝对路径）" class="mono-in" />
              <el-button @click="browseToolPath(t.id, i)" title="浏览"><i class="ph ph-folder-open"></i></el-button>
              <el-button v-if="cfg!.tools[t.id]!.paths.length > 1" @click="cfg!.tools[t.id]!.paths.splice(i, 1)" title="移除"><i class="ph ph-x"></i></el-button>
            </div>
            <div class="hit-line" v-if="t.dir"><span class="badge ok"><i class="ph ph-check-circle"></i>命中：{{ t.dir }}</span></div>
            <div class="hit-line" v-else-if="t.enabled"><span class="badge warn"><i class="ph ph-warning"></i>候选路径均不存在</span></div>
            <div class="add-line">
              <el-button size="small" @click="cfg!.tools[t.id]!.paths.push('')"><i class="ph ph-plus"></i>添加候选路径</el-button>
            </div>
            <div class="help" v-if="t.id === 'antigravity'">Antigravity 各版本全局技能路径有漂移（旧版 .gemini\antigravity\skills，新版 .gemini\config\skills），多候选按顺序取第一个命中项。</div>
          </div>
          <hr class="divider" />
          <div class="tool-block" style="border-top:none; padding-top:0">
            <div class="tool-head">
              <span class="tool-name">自定义目录</span>
            </div>
            <div class="path-row" v-for="(p, i) in cfg!.customDirs" :key="i">
              <el-input v-model="cfg!.customDirs[i]" class="mono-in" />
              <el-button @click="browseToolPath('custom', i)" title="浏览"><i class="ph ph-folder-open"></i></el-button>
              <el-button @click="cfg!.customDirs.splice(i, 1)" title="移除"><i class="ph ph-x"></i></el-button>
            </div>
            <div class="add-line">
              <el-button size="small" @click="browseCustomAdd"><i class="ph ph-plus"></i>添加自定义目录</el-button>
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-2 section top-grid">
        <div>
          <h2>同步与去重</h2>
          <p class="desc">动作策略。调整只影响之后的同步。</p>
          <div class="panel">
            <div class="field">
              <label>挂载模式</label>
              <el-radio-group v-model="cfg!.mountMode" class="mount-radio">
                <el-radio value="junction" border>
                  <span class="r-wrap">
                    <span class="r-title">Junction（推荐）</span>
                    <span class="r-desc">按技能粒度建立目录联接，无需管理员权限，中央仓库即时生效。</span>
                  </span>
                </el-radio>
                <el-radio value="copy" border>
                  <span class="r-wrap">
                    <span class="r-title">复制</span>
                    <span class="r-desc">直接复制文件，兼容性最好，但存在漂移风险。</span>
                  </span>
                </el-radio>
              </el-radio-group>
            </div>
            <div class="opt-row">
              <div>
                <div class="opt-title">L3 语义去重提示</div>
                <div class="help">本地相似度计算，仅提示不动作</div>
              </div>
              <el-switch v-model="cfg!.l3.enabled" />
            </div>
            <div class="field days-field">
              <label>回收站保留天数</label>
              <el-input-number v-model="cfg!.trashDays" :min="1" :max="90" style="width:150px" />
              <div class="help">超期后由同步与清理动作自动清除；回收站内容见下方。</div>
            </div>
          </div>
        </div>

        <div>
          <h2>中央仓库与更新</h2>
          <p class="desc">真身位置与热更新行为（更新通道由 GitHub Releases 提供）。</p>
          <div class="panel">
            <div class="field">
              <label>中央仓库位置</label>
              <div class="path-row">
                <el-input :model-value="hubDirLabel" disabled class="mono-in" />
                <el-button @click="openDataDir" title="打开"><i class="ph ph-folder-open"></i></el-button>
              </div>
              <div class="help">包含 skills（真身）、manifest.json、reports、.trash 四部分。</div>
            </div>
            <div class="field">
              <label>更新渠道</label>
              <el-select v-model="cfg!.update.channel" style="width:220px">
                <el-option value="stable" label="stable（正式版）" />
                <el-option value="beta" label="beta（预发布版）" />
              </el-select>
            </div>
            <div class="opt-row" style="padding-bottom:2px">
              <div>
                <div class="opt-title">自动检查更新</div>
                <div class="help">启动后与每 6 小时各检查一次 GitHub Releases</div>
              </div>
              <el-switch v-model="cfg!.update.autoCheck" />
            </div>
          </div>
        </div>
      </div>

      <!-- 后台与调度：托盘常驻 / 开机自启 / 定时 WebDAV 同步 -->
      <div class="section">
        <h2>后台与调度</h2>
        <p class="desc">托盘常驻与定时同步。关闭窗口默认缩到托盘，托盘菜单可随时手动同步或暂停调度。</p>
        <div class="panel">
          <div class="opt-row">
            <div>
              <div class="opt-title">关闭窗口时缩到托盘</div>
              <div class="help">关闭后台常驻运行；关掉此项则关闭窗口即退出</div>
            </div>
            <el-switch v-model="cfg!.schedule.minimizeToTray" />
          </div>
          <div class="opt-row">
            <div>
              <div class="opt-title">开机自动启动</div>
              <div class="help">{{ portable ? "便携版不支持（注册的是临时解压路径），此项无效" : "开机后在后台启动并按下面的计划自动同步" }}</div>
            </div>
            <el-switch v-model="cfg!.schedule.autoStart" :disabled="portable" />
          </div>
          <div class="opt-row">
            <div>
              <div class="opt-title">每小时自动同步</div>
              <div class="help">需先在「WebDAV 同步」页配置好服务器</div>
            </div>
            <el-switch v-model="cfg!.schedule.hourly" />
          </div>
          <div class="opt-row">
            <div>
              <div class="opt-title">每天定时同步</div>
              <div class="help">错过时刻（关机 / 睡眠）后当天内会补跑一次</div>
            </div>
            <div class="opt-inline">
              <el-switch v-model="cfg!.schedule.daily" />
              <el-time-picker v-model="cfg!.schedule.dailyTime" value-format="HH:mm" format="HH:mm" style="width:120px" :disabled="!cfg!.schedule.daily" placeholder="选择时间" />
            </div>
          </div>
          <div class="opt-row" style="padding-bottom:2px">
            <div>
              <div class="opt-title">同步成功也弹系统通知</div>
              <div class="help">失败始终会提醒；开启后成功也通知一次</div>
            </div>
            <el-switch v-model="cfg!.schedule.notifyOnSuccess" />
          </div>
        </div>
      </div>

      <div class="section">
        <h2>回收站（{{ trash.length }} 项）</h2>
        <p class="desc">被替换 / 删除的技能目录先进回收站，保留 {{ cfg!.trashDays }} 天可还原。</p>
        <div class="panel" style="padding: 6px 18px;" v-if="trash.length">
          <div class="tool-row" v-for="t in trash" :key="t.name">
            <div class="tool-icon"><i class="ph ph-trash"></i></div>
            <div class="t-main">
              <div class="t-name">{{ t.name }}</div>
              <div class="t-path">{{ fmtTime(t.trashedAt) }} · {{ fmtSize(t.sizeBytes) }}</div>
            </div>
            <el-button size="small" @click="restoreTrash(t.name)"><i class="ph ph-arrow-u-up-left"></i>还原</el-button>
          </div>
        </div>
        <div class="panel" v-else>
          <div class="empty-state" style="padding:24px"><i class="ph ph-trash"></i><div class="es-title">回收站是空的</div></div>
        </div>
      </div>

      <div class="section">
        <h2>危险区</h2>
        <div class="panel">
          <div class="opt-row" style="padding:2px 0">
            <div>
              <div class="opt-title" style="color:var(--danger)">清空回收站</div>
              <div class="help">立即永久删除 <span class="mono">.trash\</span> 内的全部历史版本，不可恢复。</div>
            </div>
            <el-button type="danger" plain @click="purgeAll"><i class="ph ph-trash"></i>清空</el-button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mono-in :deep(.el-input__inner) { font-family: var(--font-mono); font-size: 12px; }

/* 左右两栏内容高度不同，顶对齐即可 */
.top-grid { align-items: start; }

/* 选项行：左标题+描述，右控件；相邻行用分隔线，取代散落的 hr 与内联 margin */
.opt-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 13px 0;
}
.opt-row + .opt-row { border-top: 1px solid var(--border-soft); }
.opt-title { font-size: 13px; font-weight: 500; }
.opt-row .help { margin-top: 2px; }
.opt-inline { display: flex; align-items: center; gap: 10px; }

/* 工具块：标题行 + 路径行 + 命中/添加，间距统一 */
.tool-block { padding: 16px 0; }
.tool-block + .tool-block { border-top: 1px solid var(--border-soft); }
.tool-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.tool-name { font-weight: 600; font-size: 13.5px; }
.path-row { display: flex; gap: 8px; margin-bottom: 8px; }
.path-row :deep(.el-input) { flex: 1; }
.hit-line { margin: 8px 0; }
.add-line { margin-top: 4px; }

/* 挂载模式：两张可选卡片 */
.mount-radio {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  width: 100%;
}
.mount-radio :deep(.el-radio) {
  height: auto;
  align-items: flex-start;
  padding: 12px 14px;
  margin: 0;
  width: 100%;
  border-radius: var(--radius-ctl);
}
.mount-radio :deep(.el-radio__input) { margin-top: 3px; }
.mount-radio :deep(.el-radio__label) { white-space: normal; line-height: 1.55; padding-left: 8px; }
.r-wrap { display: block; }
.r-title { display: block; font-size: 13px; font-weight: 500; }
.r-desc { display: block; font-size: 11.5px; color: var(--text-3); margin-top: 2px; }

/* 回收站天数：最后一行不留大空隙 */
.days-field { margin-bottom: 0; padding-top: 13px; }
.days-field + .opt-row { border-top: 1px solid var(--border-soft); }
</style>
