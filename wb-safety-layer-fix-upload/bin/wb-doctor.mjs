#!/usr/bin/env node
/**
 * wb-doctor — “插件到底生效了吗”一条命令回答。
 *
 *   node bin/wb-doctor.mjs [--json]
 *
 * 四层证据，从静态到运行时：
 *   1. 注册层   marketplace / installed_plugins / enabledPlugins / payload 文件
 *   2. 补丁层   product.json · bundle · settings 的 11 条补丁状态
 *   3. 进程层   WorkBuddy 与 CLI host 是否在跑、启动时间
 *   4. 日志层   最近日志里有没有 [wb-safety-fix] 活动标记
 *
 * 退出码：0 = 文件层与补丁层都就绪；1 = 有缺口（结论里会指出是哪一层）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { status, verify, resolveCliRoot, profileRoot, readJournal, PLUGIN_ROOT } from '../lib/engine.mjs';

const asJson = process.argv.includes('--json');
const profile = profileRoot();
const cliRoot = resolveCliRoot();

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function exists(file) {
  try {
    fs.statSync(file);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------- 1. 注册层 */

function registration() {
  const pluginsRoot = path.join(profile, 'plugins');
  const known = readJson(path.join(pluginsRoot, 'known_marketplaces.json'));
  const installed = readJson(path.join(pluginsRoot, 'installed_plugins.json'));
  const settings = readJson(path.join(profile, 'settings.json'));

  const id = 'wb-safety-layer-fix@wb-local';
  const rawEntry = installed?.plugins?.[id] ?? null;
  // The host normalises this map to an array of installs (the shape its built-in plugins
  // use), so accept both forms before reading the fields.
  const entry = Array.isArray(rawEntry) ? rawEntry[0] ?? null : rawEntry;
  const installPath = typeof entry?.installPath === 'string' ? entry.installPath : '';
  const payload = installPath
    ? {
        root: exists(installPath),
        manifest: exists(path.join(installPath, '.codebuddy-plugin', 'plugin.json')),
        hooksJson: exists(path.join(installPath, 'hooks', 'hooks.json')),
        mod: exists(path.join(installPath, 'hooks', 'register.mjs')),
        cli: exists(path.join(installPath, 'bin', 'wb-purge.mjs')),
      }
    : {};

  return {
    marketplace: Boolean(known && known['wb-local']),
    entry: Boolean(entry),
    enabled: settings?.enabledPlugins?.[id] === true,
    version: typeof entry?.version === 'string' ? entry.version : '',
    installPath,
    payload,
    settingsPermissions: settings?.permissions ?? null,
  };
}

/* ------------------------------------------------------------- 2. 补丁层 */

function patches() {
  const report = status({ cliRoot });
  const counts = report.rows.reduce((acc, row) => ({ ...acc, [row.state]: (acc[row.state] || 0) + 1 }), {});
  let verified = null;
  try {
    const result = verify({ cliRoot });
    verified = { ok: result.ok, checks: result.checks };
  } catch (error) {
    verified = { ok: false, checks: [{ name: 'verify', ok: false, detail: error.message }] };
  }
  return { counts, rows: report.rows, verified, journal: Object.keys(readJournal().patched).length };
}

/* ------------------------------------------------------------- 3. 进程层 */

function processes() {
  const out = { workbuddy: [], cliHost: [], supported: true };
  try {
    if (process.platform === 'win32') {
      const raw = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { stdio: 'pipe', encoding: 'utf8' });
      for (const line of raw.split(/\r?\n/)) {
        if (!line.includes('WorkBuddy') && !line.includes('node.exe')) continue;
        const cells = line.split('","').map(cell => cell.replace(/^"|"$/g, ''));
        if (cells[0] === 'WorkBuddy.exe') out.workbuddy.push({ pid: cells[1] });
      }
      const wmic = execFileSync(
        'powershell',
        ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='WorkBuddy.exe' or Name='node.exe'\" | ForEach-Object { \"{0}|{1}\" -f $_.ProcessId,$_.CommandLine }"],
        { stdio: 'pipe', encoding: 'utf8' },
      ).trim();
      for (const line of wmic.split(/\r?\n/)) {
        const [pid, cmd] = line.split('|');
        if (!cmd) continue;
        if (/codebuddy\b/.test(cmd) && /(\bcli\b|cli\\bin)/i.test(cmd)) out.cliHost.push({ pid, cmd: cmd.slice(0, 180) });
      }
    } else {
      const raw = execFileSync('ps', ['-Ao', 'pid=,lstart=,command='], { stdio: 'pipe', encoding: 'utf8' });
      for (const line of raw.split('\n')) {
        if (/WorkBuddy/i.test(line)) out.workbuddy.push({ pid: line.trim().split(/\s+/)[0] });
        if (/codebuddy/i.test(line) && /cli/i.test(line)) out.cliHost.push({ pid: line.trim().split(/\s+/)[0], cmd: line.trim().slice(0, 180) });
      }
    }
  } catch {
    out.supported = false;
  }
  out.cliHost = out.cliHost.slice(0, 4);
  return out;
}

/* ------------------------------------------------------------- 4. 日志层 */

function logEvidence() {
  const needles = ['[wb-safety-fix]', '[wbpurge'];
  const roots = [path.join(profile, 'logs'), path.join(profile, 'debug')];
  const cutoff = Date.now() - 3 * 24 * 3600 * 1000;
  const files = [];
  for (const root of roots) {
    if (!exists(root)) continue;
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop();
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (!/\.(log|txt|jsonl)$/i.test(entry.name)) continue;
        try {
          const stat = fs.statSync(full);
          if (stat.mtimeMs < cutoff) continue;
          files.push({ file: full, size: stat.size, mtime: stat.mtimeMs });
        } catch {
          /* ignore */
        }
      }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const hits = [];
  for (const item of files.slice(0, 24)) {
    let text = '';
    try {
      const fd = fs.openSync(item.file, 'r');
      const start = Math.max(0, item.size - 256 * 1024);
      const length = Math.min(256 * 1024, item.size - start);
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);
      fs.closeSync(fd);
      text = buffer.toString('utf8');
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/).filter(line => needles.some(needle => line.includes(needle)));
    if (lines.length) hits.push({ file: item.file, count: lines.length, last: lines.slice(-2) });
  }
  return { scanned: Math.min(files.length, 24), total: files.length, hits };
}

/* ------------------------------------------------------------------ 报告 */

const reg = registration();
const patch = patches();
const proc = processes();
const logs = logEvidence();

const registrationOk = reg.marketplace && reg.entry && reg.enabled && reg.payload.root && reg.payload.mod && reg.payload.hooksJson;
const patchesOk = (patch.counts.applied || 0) === 11;
const runtimeEvidence = logs.hits.length > 0;

const verdict = [];
verdict.push({
  layer: '注册层 / registration',
  ok: registrationOk,
  text: registrationOk
    ? `wb-safety-layer-fix@wb-local ${reg.version} 已启用，payload 完整（manifest + hooks.json + register.mjs）`
    : '注册不完整：marketplace / installed_plugins / enabledPlugins / payload 有一项缺失',
});
verdict.push({
  layer: '补丁层 / patches',
  ok: patchesOk,
  text: patchesOk
    ? `11/11 applied${patch.verified?.ok ? '，verify 通过' : '，但 verify 有失败项'}`
    : `applied=${patch.counts.applied || 0}/11（pending=${patch.counts.pending || 0} conflict=${patch.counts.conflict || 0} missing=${patch.counts.missing || 0}）`,
});
verdict.push({
  layer: '进程层 / process',
  ok: proc.workbuddy.length > 0,
  text: proc.workbuddy.length
    ? `WorkBuddy ${proc.workbuddy.length} 个进程${proc.cliHost.length ? `，CLI host ${proc.cliHost.map(item => item.pid).join(', ')}` : '，暂未发现 CLI host（发一条消息后会起）'}`
    : 'WorkBuddy 没在运行：插件只在应用启动后才加载',
});
verdict.push({
  layer: '运行时证据 / runtime',
  ok: runtimeEvidence,
  text: runtimeEvidence
    ? `日志中出现 ${logs.hits.reduce((sum, hit) => sum + hit.count, 0)} 行活动标记（最近：${path.basename(logs.hits[0].file)}）`
    : `最近 ${logs.scanned} 个日志里没有活动标记 —— 只说明还没抓到，不等于没生效；用下面的命令层/行为层确认`,
});

const okAll = registrationOk && patchesOk;

if (asJson) {
  console.log(JSON.stringify({ profile, cliRoot, registration: reg, patches: { counts: patch.counts, rows: patch.rows, verified: patch.verified }, processes: proc, logs, verdict, ok: okAll }, null, 2));
} else {
  console.log(`profile   ${profile}`);
  console.log(`cli root  ${cliRoot || '(未找到)'}`);
  console.log('');
  for (const item of verdict) {
    const mark = item.ok ? '\u2714' : (item.layer.startsWith('运行时') ? '\u2022' : '\u2716');
    console.log(`${mark} ${item.layer.padEnd(22)} ${item.text}`);
  }

  console.log('');
  console.log('补丁明细');
  const byLayer = new Map();
  for (const row of patch.rows) {
    if (!byLayer.has(row.layer)) byLayer.set(row.layer, []);
    byLayer.get(row.layer).push(row);
  }
  for (const [layer, rows] of [...byLayer.entries()].sort()) {
    const line = rows.map(row => `${row.id}:${row.state === 'applied' ? 'on' : row.state}`).join('  ');
    console.log(`  ${layer.padEnd(8)} ${line}`);
  }

  if (logs.hits.length) {
    console.log('');
    console.log('活动标记');
    for (const hit of logs.hits.slice(0, 2)) {
      console.log(`  ${path.basename(hit.file)} ×${hit.count}`);
      for (const line of hit.last) console.log(`    ${line.slice(0, 200)}`);
    }
  }

  console.log('');
  if (okAll) {
    console.log('结论  文件层就绪。要确认「这一轮真的走到了模型」，在会话里跑：');
    console.log('        /purge-status      → 11/11 applied（命令能出现本身就说明插件已加载）');
    console.log('        /safety-fix        → mods 配置');
    console.log('      行为层 A/B：同一句话，/safety-toggle off 前后各问一次。');
    console.log('      想拿到日志证据：关掉 WorkBuddy，加环境变量 CODEBUDDY_DISABLE_FILE_LOGS=0 启动，');
    console.log('      再发一条消息，然后重新跑本命令。');
  } else {
    console.log('结论  有缺口。依次执行：');
    console.log('        powershell -File install.ps1 -Force        # 重新注册');
    console.log('        node bin/wb-purge.mjs apply                # 补齐补丁');
    console.log('        node bin/wb-doctor.mjs                     # 再检查');
  }
}

if (!okAll) process.exitCode = 1;
