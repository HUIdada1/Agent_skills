<script setup lang="ts">
// 设置
import { ref, onMounted } from "vue";
import { loadConfig, saveConfig, listTools, browseDir, trashList, trashRestore, trashPurge, openDataDir, getDataDir, type AppConfig, type ToolRow, type TrashRow } from "../api/ipc";
import { fmtTime, fmtSize } from "../utils/format";

const cfg = ref<AppConfig | null>(null);
const tools = ref<ToolRow[]>([]);
const trash = ref<TrashRow[]>([]);
const hubDirLabel = ref("%USERPROFILE%\\.agent_skills");
const actionMsg = ref("");
const saving = ref(false);

async function load() {
  cfg.value = await loadConfig();
  tools.value = (await listTools()) || [];
  trash.value = (await trashList()) || [];
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
  if (!confirm("确定永久删除回收站全部内容吗？此操作不可恢复。")) return;
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
        <button class="btn" @click="openDataDir"><i class="ph ph-folder-open"></i>打开数据目录</button>
        <button class="btn btn-primary" :disabled="saving" @click="save"><i class="ph ph-floppy-disk"></i>{{ saving ? "保存中" : "保存" }}</button>
      </div>
    </div>

    <div class="note mt-8" v-if="actionMsg"><i class="ph ph-info"></i><div>{{ actionMsg }}</div></div>

    <template v-if="cfg">
      <div class="section">
        <h2>工具适配器</h2>
        <p class="desc">每个工具的候选技能目录（按顺序探测，取第一个存在的）。Antigravity 等路径漂移工具可配置多个候选。</p>
        <div class="panel">
          <div class="field" v-for="t in tools" :key="t.id">
            <label class="row-between">
              <span>{{ t.name }}</span>
              <span class="switch">
                <input type="checkbox" v-model="cfg.tools[t.id].enabled" />
                <span class="track"></span>
              </span>
            </label>
            <div class="input-group" v-for="(p, i) in cfg.tools[t.id].paths" :key="i" style="margin-bottom:8px">
              <input class="input mono" v-model="cfg.tools[t.id].paths[i]" placeholder="候选路径（~ 开头或绝对路径）" />
              <button class="btn" @click="browseToolPath(t.id, i)" title="浏览"><i class="ph ph-folder-open"></i></button>
              <button class="btn" @click="cfg.tools[t.id].paths.splice(i, 1)" title="移除" v-if="cfg.tools[t.id].paths.length > 1"><i class="ph ph-x"></i></button>
            </div>
            <div class="row" style="margin-bottom:8px" v-if="t.dir">
              <span class="badge ok"><i class="ph ph-check-circle"></i>命中：{{ t.dir }}</span>
            </div>
            <div class="row" style="margin-bottom:8px" v-else-if="t.enabled">
              <span class="badge warn"><i class="ph ph-warning"></i>候选路径均不存在</span>
            </div>
            <div class="input-group">
              <button class="btn btn-sm" @click="cfg.tools[t.id].paths.push('')"><i class="ph ph-plus"></i>添加候选路径</button>
            </div>
            <div class="help" v-if="t.id === 'antigravity'">Antigravity 各版本全局技能路径有漂移（旧版 .gemini\antigravity\skills，新版 .gemini\config\skills），多候选按顺序取第一个命中项。</div>
          </div>
          <hr class="divider" />
          <div class="field" style="margin-bottom:0">
            <label>自定义目录</label>
            <div class="input-group" v-for="(p, i) in cfg.customDirs" :key="i" style="margin-bottom:8px">
              <input class="input mono" v-model="cfg.customDirs[i]" />
              <button class="btn" @click="browseToolPath('custom', i)" title="浏览"><i class="ph ph-folder-open"></i></button>
              <button class="btn" @click="cfg.customDirs.splice(i, 1)" title="移除"><i class="ph ph-x"></i></button>
            </div>
            <div class="input-group">
              <button class="btn btn-sm" @click="browseCustomAdd"><i class="ph ph-plus"></i>添加自定义目录</button>
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-2 section">
        <div>
          <h2>同步与去重</h2>
          <p class="desc">动作策略。调整只影响之后的同步。</p>
          <div class="panel">
            <div class="field">
              <label>挂载模式</label>
              <label class="radio-row" :class="{ on: cfg.mountMode === 'junction' }">
                <input type="radio" value="junction" v-model="cfg.mountMode" />
                <span><span class="r-title">Junction（推荐）</span><span class="r-desc" style="display:block">按技能粒度建立目录联接，无需管理员权限，中央仓库即时生效。</span></span>
              </label>
              <label class="radio-row" :class="{ on: cfg.mountMode === 'copy' }" style="margin-bottom:0">
                <input type="radio" value="copy" v-model="cfg.mountMode" />
                <span><span class="r-title">复制</span><span class="r-desc" style="display:block">直接复制文件，兼容性最好，但存在漂移风险。</span></span>
              </label>
            </div>
            <div class="row-between">
              <div>
                <div class="small" style="font-weight:500">L3 语义去重提示</div>
                <div class="help" style="margin-top:2px">本地相似度计算，仅提示不动作</div>
              </div>
              <span class="switch">
                <input type="checkbox" v-model="cfg.l3.enabled" />
                <span class="track"></span>
              </span>
            </div>
            <hr class="divider" />
            <div class="field" style="margin-bottom:0">
              <label>回收站保留天数</label>
              <input class="input mono" type="number" min="1" max="90" v-model.number="cfg.trashDays" style="max-width:120px" />
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
              <div class="input-group">
                <input class="input mono" :value="hubDirLabel" disabled />
                <button class="btn" @click="openDataDir" title="打开"><i class="ph ph-folder-open"></i></button>
              </div>
              <div class="help">包含 skills（真身）、manifest.json、reports、.trash 四部分。</div>
            </div>
            <div class="field">
              <label>更新渠道</label>
              <select class="select" v-model="cfg.update.channel">
                <option value="stable">stable（正式版）</option>
                <option value="beta">beta（预发布版）</option>
              </select>
            </div>
            <div class="row-between">
              <div>
                <div class="small" style="font-weight:500">自动检查更新</div>
                <div class="help" style="margin-top:2px">启动后与每 6 小时各检查一次 GitHub Releases</div>
              </div>
              <span class="switch">
                <input type="checkbox" v-model="cfg.update.autoCheck" />
                <span class="track"></span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="section">
        <h2>回收站（{{ trash.length }} 项）</h2>
        <p class="desc">被替换 / 删除的技能目录先进回收站，保留 {{ cfg.trashDays }} 天可还原。</p>
        <div class="panel" style="padding: 6px 18px;" v-if="trash.length">
          <div class="tool-row" v-for="t in trash" :key="t.name">
            <div class="tool-icon"><i class="ph ph-trash"></i></div>
            <div class="t-main">
              <div class="t-name">{{ t.name }}</div>
              <div class="t-path">{{ fmtTime(t.trashedAt) }} · {{ fmtSize(t.sizeBytes) }}</div>
            </div>
            <button class="btn btn-sm" @click="restoreTrash(t.name)"><i class="ph ph-arrow-u-up-left"></i>还原</button>
          </div>
        </div>
        <div class="panel" v-else>
          <div class="empty-state" style="padding:24px"><i class="ph ph-trash"></i><div class="es-title">回收站是空的</div></div>
        </div>
      </div>

      <div class="section">
        <h2>危险区</h2>
        <div class="panel">
          <div class="row-between">
            <div>
              <div class="small" style="font-weight:600; color:var(--danger)">清空回收站</div>
              <div class="muted small">立即永久删除 <span class="mono">.trash\</span> 内的全部历史版本，不可恢复。</div>
            </div>
            <button class="btn btn-danger" @click="purgeAll"><i class="ph ph-trash"></i>清空</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
