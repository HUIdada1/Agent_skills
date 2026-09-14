// 自测：WebDAV 跨设备同步。内存版 WebDAV server + 两个临时 hub 模拟两台电脑
// 覆盖：首传/拉取/单边更新/双边修改冲突+三种裁决/墓碑删除传播/连接测试
// 跑法：npm run selftest:remote
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "agent-skills-webdav-selftest-"));
const HOME_A = path.join(TMP, "hub-a");
const HOME_B = path.join(TMP, "hub-b");

let passed = 0;
function check(name, cond) {
  if (!cond) {
    console.error(`✗ ${name}`);
    process.exitCode = 1;
    assert.fail(name);
  }
  passed++;
  console.log(`✓ ${name}`);
}

// ---- 内存版 WebDAV server：PUT/GET/PROPFIND/MKCOL/DELETE，Map 存文件 ----
function startMockWebdav() {
  const store = new Map(); // 规范化路径 -> { isDir, data }
  const norm = (p) => {
    let s = decodeURIComponent(p.split("?")[0]).replace(/\/+$/, "");
    return s || "/";
  };
  const server = http.createServer((req, res) => {
    const p = norm(req.url);
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const reply = (code, data) => {
        res.writeHead(code, { "Content-Type": "application/xml; charset=utf-8" });
        res.end(data || "");
      };
      if (req.method === "PUT") {
        store.set(p, { isDir: false, data: body });
        reply(201);
      } else if (req.method === "GET") {
        const e = store.get(p);
        if (!e || e.isDir) return reply(404);
        res.writeHead(200);
        res.end(e.data);
      } else if (req.method === "MKCOL") {
        if (store.has(p)) return reply(405);
        store.set(p, { isDir: true });
        reply(201);
      } else if (req.method === "DELETE") {
        let hit = false;
        for (const k of [...store.keys()]) {
          if (k === p || k.startsWith(p + "/")) { store.delete(k); hit = true; }
        }
        reply(hit ? 204 : 404);
      } else if (req.method === "PROPFIND") {
        const depth = req.headers.depth === "0" ? 0 : 1;
        const self = store.get(p);
        if (!self) return reply(404);
        const xmlEntry = (href, isDir) =>
          `<d:response><d:href>${href}${isDir ? "/" : ""}</d:href><d:propstat><d:prop><d:resourcetype>${isDir ? "<d:collection/>" : ""}</d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
        let xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">`;
        xml += xmlEntry(p, self.isDir);
        if (depth === 1) {
          for (const [k, v] of store) {
            const parent = k.slice(0, k.lastIndexOf("/")) || "/";
            if (parent === p && k !== p) xml += xmlEntry(k, v.isDir);
          }
        }
        xml += `</d:multistatus>`;
        reply(207, xml);
      } else {
        reply(405);
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

// ---- 主进程模块在设置 HOME 之后加载 ----
let config, remotesync, hub, scanner, syncer, webdav;
function setHome(home) {
  process.env.AGENT_SKILLS_HOME = home;
  // 环境变量是运行时读的，模块无需重载；这里统一拿一次配置
  config = require("../electron/backend/config.cjs");
  remotesync = require("../electron/backend/remotesync.cjs");
  hub = require("../electron/backend/hub.cjs");
  scanner = require("../electron/backend/scanner.cjs");
  syncer = require("../electron/backend/syncer.cjs");
  webdav = require("../electron/backend/webdav.cjs");
}

function mkSkill(home, name, bodyExtra) {
  const d = path.join(home, "skills", name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(
    path.join(d, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} 测试技能\nmetadata:\n  version: 1.0.0\n---\n\n# ${name}\n${bodyExtra || ""}\n`,
    "utf-8"
  );
  fs.writeFileSync(path.join(d, "extra.txt"), bodyExtra || "base", "utf-8");
  fs.writeFileSync(path.join(d, "img.bin"), Buffer.from([0, 1, 2, 0, 255])); // 二进制文件
  return d;
}

async function main() {
  const { server, port } = await startMockWebdav();
  const WEBDAV = { endpoint: `http://127.0.0.1:${port}`, username: "tester", password: "secret", root: "/as-selftest" };
  // 同步失败时把原因打出来，方便定位
  const runOrThrow = async (c) => {
    const r = await remotesync.run(c);
    if (!r.ok) console.error(`  [同步失败] ${r.message}\n  日志: ${remotesync.recentLogs().slice(-5).map((l) => l.text).join(" | ")}`);
    return r;
  };

  // ---- 场景 1：设备 A 首次同步，上传 2 个技能 ----
  setHome(HOME_A);
  mkSkill(HOME_A, "skill-a", "A 版初始内容");
  mkSkill(HOME_A, "skill-b", "B 技能初始内容");
  let cfg = config.loadConfig();
  cfg.webdav = { ...cfg.webdav, ...WEBDAV };
  config.saveConfig(cfg);
  let r = await runOrThrow(config.loadConfig());
  check("A 首次同步成功", r.ok);
  check("A 上传了 2 个技能", r.summary.uploaded === 2);
  check("远端有 manifest.json", fs.existsSync(HOME_A)); // 真身在 mock store，间接验证：
  const manifestText = await webdav.getText(webdav.joinUrl(WEBDAV.endpoint, WEBDAV.root, "manifest.json"), WEBDAV);
  const remoteManifest = JSON.parse(manifestText);
  check("远端台账收录 2 个技能", Object.keys(remoteManifest.skills).length === 2);
  check("远端技能已打包成 tar.gz", (await webdav.get(webdav.joinUrl(WEBDAV.endpoint, WEBDAV.root, "skills/skill-a.tar.gz"), WEBDAV)).length > 0);
  check("远端设备注册存在", (await webdav.get(webdav.joinUrl(WEBDAV.endpoint, WEBDAV.root, `devices/${cfg.webdav.deviceId}.json`), WEBDAV)) != null);
  const hashA1 = scanner.treeHash(path.join(HOME_A, "skills", "skill-a"));

  // ---- 场景 2：设备 B 首次同步，下载 2 个技能 ----
  setHome(HOME_B);
  cfg = config.loadConfig();
  cfg.webdav = { ...cfg.webdav, ...WEBDAV };
  config.saveConfig(cfg);
  r = await runOrThrow(config.loadConfig());
  check("B 首次同步成功", r.ok);
  check("B 下载了 2 个技能", r.summary.downloaded === 2);
  check("B 本机 skill-a 与 A 哈希一致", scanner.treeHash(path.join(HOME_B, "skills", "skill-a")) === hashA1);
  check("B 台账收录 2 个技能", Object.keys(hub.loadManifest().skills).length === 2);
  check("B 下载导入后快照对齐", Object.keys(remotesync.loadRemoteState().base).length === 2);

  // ---- 场景 3：A 改 skill-a → A 同步 → B 同步收到更新 ----
  setHome(HOME_A);
  fs.writeFileSync(path.join(HOME_A, "skills", "skill-a", "extra.txt"), "A 修改过的内容", "utf-8");
  r = await runOrThrow(config.loadConfig());
  check("A 二次同步只上传 1 个", r.summary.uploaded === 1);
  const hashA2 = scanner.treeHash(path.join(HOME_A, "skills", "skill-a"));

  setHome(HOME_B);
  r = await runOrThrow(config.loadConfig());
  check("B 拉到 A 的更新", r.summary.downloaded === 1);
  check("B 的 skill-a 已是新版", scanner.treeHash(path.join(HOME_B, "skills", "skill-a")) === hashA2);

  // ---- 场景 4：两边都改 skill-a → 冲突 → keepLocal 裁决 ----
  fs.writeFileSync(path.join(HOME_B, "skills", "skill-a", "extra.txt"), "B 本地修改", "utf-8");
  setHome(HOME_A);
  fs.writeFileSync(path.join(HOME_A, "skills", "skill-a", "extra.txt"), "A 又改了别的", "utf-8");
  await runOrThrow(config.loadConfig()); // A 先推走
  setHome(HOME_B);
  r = await runOrThrow(config.loadConfig());
  check("B 检出跨设备冲突", r.summary.conflicts === 1);
  const items = syncer.loadConflicts().items.filter((x) => x.id === "remote:skill-a" && !x.resolved);
  check("冲突已入队 conflicts.json", items.length === 1);
  check("远端版已暂存", fs.existsSync(path.join(HOME_B, ".remote-staging", "skill-a", "SKILL.md")));
  const resolveMod = require("../electron/backend/remotesync.cjs").resolveRemoteConflict;
  // ipc.cjs 的 resolve_conflict 在裁决成功后给条目标 resolved，这里模拟同样语义
  const resolveViaIpc = (item, choice) => {
    const r = resolveMod(item, choice, config.loadConfig());
    if (r.ok) {
      const store = syncer.loadConflicts();
      const it = store.items.find((x) => x.id === item.id && !x.resolved);
      if (it) {
        it.resolved = { at: new Date().toISOString(), choice };
        syncer.saveConflicts(store);
      }
    }
    return r;
  };
  let rr = resolveViaIpc(items[0], "keepLocal", config.loadConfig());
  check("keepLocal 裁决成功", rr.ok);
  check("暂存已清理", !fs.existsSync(path.join(HOME_B, ".remote-staging", "skill-a")));
  r = await runOrThrow(config.loadConfig());
  check("裁决后 B 把本机版推上远端", r.summary.uploaded === 1);
  const hashB = scanner.treeHash(path.join(HOME_B, "skills", "skill-a"));
  setHome(HOME_A);
  r = await runOrThrow(config.loadConfig());
  check("A 拉到 B 的裁决结果", scanner.treeHash(path.join(HOME_A, "skills", "skill-a")) === hashB);

  // ---- 场景 5：A 删 skill-b → 墓碑传播 → B 跟随删除 ----
  setHome(HOME_A);
  hub.removeSkill("skill-b");
  await runOrThrow(config.loadConfig());
  const mRemote = JSON.parse(await webdav.getText(webdav.joinUrl(WEBDAV.endpoint, WEBDAV.root, "manifest.json"), WEBDAV));
  check("远端台账记了墓碑", !!mRemote.deleted["skill-b"]);
  check("远端 skill-b 压缩包已删", (await webdav.get(webdav.joinUrl(WEBDAV.endpoint, WEBDAV.root, "skills/skill-b.tar.gz"), WEBDAV)) == null);

  setHome(HOME_B);
  r = await runOrThrow(config.loadConfig());
  check("B 跟随删除（本机进回收站）", r.summary.deletedLocal === 1);
  check("B 本机 skill-b 已不在", !fs.existsSync(path.join(HOME_B, "skills", "skill-b")));
  check("B 回收站里有 skill-b", hub.listTrash().some((t) => t.name.includes("skill-b")));
  check("B 台账无 skill-b", !hub.loadManifest().skills["skill-b"]);
  check("B 墓碑已记", !!hub.loadManifest().deleted["skill-b"]);

  // ---- 场景 6：keepBoth 双保留 ----
  fs.writeFileSync(path.join(HOME_B, "skills", "skill-a", "extra.txt"), "B 第三次修改", "utf-8");
  setHome(HOME_A);
  fs.writeFileSync(path.join(HOME_A, "skills", "skill-a", "extra.txt"), "A 第三次修改", "utf-8");
  await runOrThrow(config.loadConfig());
  setHome(HOME_B);
  await runOrThrow(config.loadConfig());
  const item2 = syncer.loadConflicts().items.filter((x) => x.id === "remote:skill-a" && !x.resolved).pop();
  check("再次检出冲突", !!item2);
  rr = resolveViaIpc(item2, "keepBoth", config.loadConfig());
  check("keepBoth 裁决成功", rr.ok);
  check("远端版收纳为 skill-a-remote", fs.existsSync(path.join(HOME_B, "skills", "skill-a-remote")));
  r = await runOrThrow(config.loadConfig());
  check("B 推送本机版 + 新技能", r.summary.uploaded === 2);
  const mAfterBoth = JSON.parse(await webdav.getText(webdav.joinUrl(WEBDAV.endpoint, WEBDAV.root, "manifest.json"), WEBDAV));
  check("远端同时有 skill-a 与 skill-a-remote", !!mAfterBoth.skills["skill-a"] && !!mAfterBoth.skills["skill-a-remote"]);
  setHome(HOME_A);
  r = await runOrThrow(config.loadConfig());
  check("A 拉到 skill-a-remote 与 B 版 skill-a", r.summary.downloaded === 2);

  // ---- 场景 7：keepRemote 裁决 ----
  fs.writeFileSync(path.join(HOME_A, "skills", "skill-a", "extra.txt"), "A 第四次修改", "utf-8");
  await runOrThrow(config.loadConfig());
  setHome(HOME_B);
  fs.writeFileSync(path.join(HOME_B, "skills", "skill-a", "extra.txt"), "B 第四次修改", "utf-8");
  await runOrThrow(config.loadConfig());
  const item3 = syncer.loadConflicts().items.filter((x) => x.id === "remote:skill-a" && !x.resolved).pop();
  rr = resolveViaIpc(item3, "keepRemote", config.loadConfig());
  check("keepRemote 裁决成功", rr.ok);
  const mNow = JSON.parse(await webdav.getText(webdav.joinUrl(WEBDAV.endpoint, WEBDAV.root, "manifest.json"), WEBDAV));
  check("B 本机已换成远端版", scanner.treeHash(path.join(HOME_B, "skills", "skill-a")) === mNow.skills["skill-a"].treeHash);
  r = await runOrThrow(config.loadConfig());
  check("裁决后 B 再同步无冲突", r.summary.conflicts === 0);

  // ---- 场景 8：连接测试 + 空跑幂等 ----
  const t = await webdav.test(WEBDAV);
  check("连接测试通过", t.ok);
  r = await runOrThrow(config.loadConfig());
  check("稳态同步无事可做", r.ok && r.summary.uploaded === 0 && r.summary.downloaded === 0 && r.summary.conflicts === 0);

  // ---- 场景 9：取消接口在空闲时安全 ----
  const c = remotesync.cancel();
  check("空闲取消不报错", c.ok);

  // ---- 场景 10：旧版散目录兼容（散传能收，改动重传后收敛成包） ----
  // 绕过客户端直接往 mock store 散 PUT 文件并手工上账，等价于旧版客户端推上来的布局
  mkSkill(TMP, "legacy-skill", "旧版散目录技能");
  const legacyDir = path.join(TMP, "skills", "legacy-skill");
  const legacyHash = scanner.treeHash(legacyDir);
  const legacyBase = webdav.joinUrl(WEBDAV.endpoint, WEBDAV.root, "skills/legacy-skill");
  await webdav.ensureDir(legacyBase, WEBDAV);
  for (const name of fs.readdirSync(legacyDir)) {
    await webdav.put(`${legacyBase}/${name}`, WEBDAV, fs.readFileSync(path.join(legacyDir, name)));
  }
  const mWithLegacy = JSON.parse(await webdav.getText(webdav.joinUrl(WEBDAV.endpoint, WEBDAV.root, "manifest.json"), WEBDAV));
  mWithLegacy.skills["legacy-skill"] = {
    name: "legacy-skill",
    treeHash: legacyHash,
    skillName: "legacy-skill",
    sources: [{ tool: "webdav", originalName: "legacy-skill", firstSeen: new Date().toISOString() }],
    mergeHistory: [],
  };
  await webdav.put(webdav.joinUrl(WEBDAV.endpoint, WEBDAV.root, "manifest.json"), WEBDAV, JSON.stringify(mWithLegacy, null, 2));

  setHome(HOME_A);
  r = await runOrThrow(config.loadConfig());
  check("A 收下旧版散目录技能", r.summary.downloaded === 1);
  check("散目录内容与旧版一致", scanner.treeHash(path.join(HOME_A, "skills", "legacy-skill")) === legacyHash);

  fs.writeFileSync(path.join(HOME_A, "skills", "legacy-skill", "extra.txt"), "A 改过的 legacy 内容", "utf-8");
  r = await runOrThrow(config.loadConfig());
  check("A 的改动重传成包", r.summary.uploaded === 1);
  check("远端新增 legacy 压缩包", (await webdav.get(webdav.joinUrl(WEBDAV.endpoint, WEBDAV.root, "skills/legacy-skill.tar.gz"), WEBDAV)) != null);
  const looseLeft = await webdav.list(legacyBase, WEBDAV);
  check("远端旧散目录已清理", looseLeft.length === 0);

  // 再散一份旧内容的假目录（模拟服务器删不动的残渣），B 下载时应凭台账哈希识破、改走压缩包拿新内容
  await webdav.ensureDir(legacyBase, WEBDAV);
  for (const name of fs.readdirSync(legacyDir)) {
    await webdav.put(`${legacyBase}/${name}`, WEBDAV, fs.readFileSync(path.join(legacyDir, name)));
  }

  setHome(HOME_B);
  r = await runOrThrow(config.loadConfig());
  check("B 识破残渣散目录、从压缩包拉到 legacy 更新", r.summary.downloaded === 1);
  check("B 的 legacy 是 A 的新版而非残渣", scanner.treeHash(path.join(HOME_B, "skills", "legacy-skill")) === scanner.treeHash(path.join(HOME_A, "skills", "legacy-skill")));

  server.close();
  console.log(`\n通过 ${passed} 项检查${process.exitCode ? "（有失败项）" : ""}`);
  if (!process.exitCode) {
    fs.rmSync(TMP, { recursive: true, force: true });
    console.log("临时目录已清理");
  }
}

main().catch((e) => {
  console.error("自测异常：", e);
  process.exitCode = 1;
});
