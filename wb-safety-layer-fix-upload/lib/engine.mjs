/**
 * wb-purge engine — apply / revert / status / verify for the WorkBuddy install.
 *
 * Mirrors dsh-purge's lifecycle:
 *   apply   → back the original up as `<file>.wbpurge.bak`, write the patched
 *             file, record the journal entry
 *   revert  → restore every `.wbpurge.bak`, drop the journal
 *   status  → per-patch: applied | pending | conflict | missing
 *   verify  → hash + JSON validity + `node --check` on the patched bundle
 *
 * Idempotent: markers in the written text make a second apply a no-op.
 * Version-bump safe: a text patch whose `find` no longer matches reports
 * `conflict` and writes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { textPatches, jsonPatches, FEATURE_FLAGS, SETTINGS_OVERRIDES, allPatchMeta } from './patches.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PLUGIN_ROOT = path.resolve(HERE, '..');
const BAK_SUFFIX = '.wbpurge.bak';
const BUNDLE_REL = path.join('dist', 'codebuddy-lite-wb.mjs');
const PRODUCT_REL = 'product.json';

/* ------------------------------------------------------------------ helpers */

export function profileRoot() {
  return process.env.WB_PROFILE_DIR || path.join(os.homedir(), '.workbuddy');
}

export function journalPath() {
  return path.join(PLUGIN_ROOT, 'state', 'applied.json');
}

export function readJournal() {
  try {
    const raw = fs.readFileSync(journalPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyJournal();
    return {
      version: 1,
      cliRoot: typeof parsed.cliRoot === 'string' ? parsed.cliRoot : '',
      patched: parsed.patched && typeof parsed.patched === 'object' ? parsed.patched : {},
      settings: Array.isArray(parsed.settings) ? parsed.settings : [],
    };
  } catch {
    return emptyJournal();
  }
}

function emptyJournal() {
  return { version: 1, cliRoot: '', patched: {}, settings: [] };
}

export function writeJournal(journal) {
  const file = journalPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(journal, null, 2) + '\n', 'utf8');
}

function hash(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function exists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Locate the CLI root of the running WorkBuddy install:
 * `<install>/resources/app.asar.unpacked/cli`, which holds product.json and the
 * dist bundle the desktop spawns.
 */
export function resolveCliRoot(explicit) {
  const candidates = [];
  const push = p => {
    if (typeof p === 'string' && p.trim() !== '') candidates.push(path.resolve(p.trim()));
  };
  push(explicit);
  push(process.env.WB_PURGE_CLI_ROOT);
  push(process.env.WB_CLI_ROOT);

  const bases = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'WorkBuddy'),
    path.join(process.env.PROGRAMFILES || '', 'WorkBuddy'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'WorkBuddy'),
    'D:\\work buddy\\WorkBuddy',
    'D:\\WorkBuddy',
    'C:\\work buddy\\WorkBuddy',
  ];
  for (const base of bases) {
    push(path.join(base, 'resources', 'app.asar.unpacked', 'cli'));
    push(path.join(base, 'resources', 'cli'));
  }
  // Last resort: shallow scan of fixed drives for a WorkBuddy install dir.
  for (const drive of ['C:', 'D:', 'E:']) {
    let entries = [];
    try {
      entries = fs.readdirSync(drive + path.sep, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!/work\s*buddy/i.test(entry.name)) continue;
      push(path.join(drive + path.sep, entry.name, 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli'));
      push(path.join(drive + path.sep, entry.name, 'resources', 'app.asar.unpacked', 'cli'));
    }
  }

  for (const candidate of candidates) {
    if (exists(path.join(candidate, BUNDLE_REL)) && exists(path.join(candidate, PRODUCT_REL))) return candidate;
  }
  return '';
}

/* ------------------------------------------------------- in-memory patching */

/** Apply one text patch to `text`. Returns { text, outcome }. */
export function applyTextPatch(text, patch) {
  if (text.includes(patch.marker)) return { text, outcome: 'applied-before' };
  const hits = text.split(patch.find).length - 1;
  if (hits === 0) return { text, outcome: 'conflict', detail: 'pattern not found (build moved?)' };
  if (hits > 1) return { text, outcome: 'conflict', detail: `pattern matched ${hits} times` };
  return { text: text.replace(patch.find, patch.replace), outcome: 'patched' };
}

/** Apply a JSON prompt/feature patch to a parsed product.json document. */
export function applyJsonPatch(doc, patch) {
  if (patch.promptName) {
    const prompts = Array.isArray(doc.prompts) ? doc.prompts : [];
    const target = prompts.find(entry => entry && entry.name === patch.promptName);
    if (!target) return { outcome: 'missing', detail: `prompt "${patch.promptName}" not in product.json` };
    if (typeof target.template !== 'string') return { outcome: 'missing', detail: `prompt "${patch.promptName}" has no template` };
    const marker = `[wbpurge:${patch.id}]`;
    if (target.template.includes(marker)) return { outcome: 'applied-before' };
    target.template = patch.apply(target.template);
    return { outcome: 'patched' };
  }
  return { outcome: 'missing', detail: 'unknown json patch shape' };
}

/** Apply a feature-flag patch (product.json productFeatures.*). */
export function applyFlagPatch(doc, flag) {
  let node = doc;
  for (const key of flag.path.slice(0, -1)) {
    if (!node[key] || typeof node[key] !== 'object') return { outcome: 'missing', detail: `${flag.path.join('.')} path absent` };
    node = node[key];
  }
  const leaf = flag.path[flag.path.length - 1];
  if (!(leaf in node)) return { outcome: 'missing', detail: `${flag.path.join('.')} absent` };
  if (node[leaf] === flag.value) return { outcome: 'applied-before' };
  node[leaf] = flag.value;
  return { outcome: 'patched' };
}

/* -------------------------------------------------------------- public API */

export function status(options = {}) {
  const cliRoot = options.cliRoot || resolveCliRoot();
  const journal = readJournal();
  const rows = [];
  if (!cliRoot) {
    for (const meta of allPatchMeta()) rows.push({ ...meta, state: 'no-install', detail: 'CLI root not found' });
    return { cliRoot: '', rows, journalPresent: Object.keys(journal.patched).length > 0 };
  }

  const bundlePath = path.join(cliRoot, BUNDLE_REL);
  const productPath = path.join(cliRoot, PRODUCT_REL);
  const bundle = exists(bundlePath) ? safeRead(bundlePath) : '';
  const productRaw = exists(productPath) ? safeRead(productPath) : '';
  const product = productRaw ? safeParse(productRaw) : null;

  for (const patch of textPatches()) {
    const present = bundle.includes(patch.marker);
    const findable = bundle.includes(patch.find) || (bundle.split(patch.find).length - 1) > 0;
    rows.push({
      id: patch.id, layer: patch.layer, name: patch.name, desc: patch.desc, kind: 'text',
      state: present ? 'applied' : findable ? 'pending' : 'conflict',
    });
  }
  for (const patch of jsonPatches()) {
    const target = product && Array.isArray(product.prompts) ? product.prompts.find(p => p && p.name === patch.promptName) : undefined;
    const marker = `[wbpurge:${patch.id}]`;
    const template = typeof target?.template === 'string' ? target.template : '';
    rows.push({
      id: patch.id, layer: patch.layer, name: patch.name, desc: patch.desc, kind: 'json',
      state: !target ? 'missing' : template.includes(marker) ? 'applied' : 'pending',
    });
  }
  for (const flag of FEATURE_FLAGS) {
    const node = product && flag.path.reduce((acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), product);
    rows.push({
      id: flag.id, layer: flag.layer, name: flag.name, desc: flag.desc, kind: 'json',
      state: node === undefined ? 'missing' : node === flag.value ? 'applied' : 'pending',
    });
  }
  for (const override of SETTINGS_OVERRIDES) {
    const settingsFile = path.join(profileRoot(), 'settings.json');
    const settings = exists(settingsFile) ? safeParse(safeRead(settingsFile)) : null;
    const current = override.keys.map((keys, index) => {
      const node = keys.reduce((acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), settings);
      return { key: keys.join('.'), want: override.values[index], have: node };
    });
    const done = current.every(item => item.have === item.want);
    rows.push({
      id: override.id, layer: override.layer, name: override.name, desc: override.desc, kind: 'settings',
      state: done ? 'applied' : settings ? 'pending' : 'missing',
      detail: current.map(item => `${item.key}=${JSON.stringify(item.have)}`).join(' '),
    });
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return { cliRoot, rows, journalPresent: Object.keys(journal.patched).length > 0 };
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Apply every patch. `dryRun` writes nothing and reports what would change;
 * it still performs all hit-count assertions, so a broken build surfaces here.
 */
export function apply(options = {}) {
  const cliRoot = options.cliRoot || resolveCliRoot();
  if (!cliRoot) throw new Error('WorkBuddy CLI root not found. Pass --cli-root=<install>/resources/app.asar.unpacked/cli or set WB_PURGE_CLI_ROOT.');
  const dryRun = Boolean(options.dryRun);
  const journal = dryRun ? emptyJournal() : readJournal();
  journal.cliRoot = cliRoot;

  const report = { cliRoot, dryRun, patches: [], files: [], settings: [] };
  const bundlePath = path.join(cliRoot, BUNDLE_REL);
  const productPath = path.join(cliRoot, PRODUCT_REL);

  // ---- text layer
  let bundle = safeRead(bundlePath);
  if (!bundle) throw new Error(`missing CLI bundle: ${bundlePath}`);
  let bundleChanged = false;
  for (const patch of textPatches()) {
    const { text, outcome, detail } = applyTextPatch(bundle, patch);
    report.patches.push({ id: patch.id, layer: patch.layer, name: patch.name, outcome, detail });
    if (outcome === 'patched') {
      bundle = text;
      bundleChanged = true;
    }
  }

  // ---- json layer (two passes over the same document)
  const productRaw = safeRead(productPath);
  const productDoc = safeParse(productRaw);
  if (!productDoc) throw new Error(`product.json is not valid JSON: ${productPath}`);
  let productChanged = false;
  for (const patch of jsonPatches()) {
    const { outcome, detail } = applyJsonPatch(productDoc, patch);
    report.patches.push({ id: patch.id, layer: patch.layer, name: patch.name, outcome, detail });
    if (outcome === 'patched') productChanged = true;
  }
  for (const flag of FEATURE_FLAGS) {
    const { outcome, detail } = applyFlagPatch(productDoc, flag);
    report.patches.push({ id: flag.id, layer: flag.layer, name: flag.name, outcome, detail });
    if (outcome === 'patched') productChanged = true;
  }

  const conflicts = report.patches.filter(p => p.outcome === 'conflict');
  if (conflicts.length && !options.force) {
    throw new Error(
      'refusing to write: ' +
        conflicts.map(c => `${c.id} ${c.name} (${c.detail})`).join('; ') +
        ' — the installed build moved these strings. Re-run with --force to write the patches that still match.',
    );
  }

  // ---- settings layer
  const settingsFile = path.join(profileRoot(), 'settings.json');
  const settingsRaw = safeRead(settingsFile);
  const settingsDoc = settingsRaw ? safeParse(settingsRaw) : null;
  if (settingsDoc) {
    for (const override of SETTINGS_OVERRIDES) {
      override.keys.forEach((keys, index) => {
        const want = override.values[index];
        let node = settingsDoc;
        for (const key of keys.slice(0, -1)) {
          if (!node[key] || typeof node[key] !== 'object') node[key] = {};
          node = node[key];
        }
        const leaf = keys[keys.length - 1];
        const previous = node[leaf];
        const already = previous === want;
        report.settings.push({
          id: override.id,
          key: keys.join('.'),
          previous: previous === undefined ? null : previous,
          value: want,
          outcome: already ? 'applied-before' : 'patched',
        });
        if (!already && !dryRun) {
          node[leaf] = want;
          if (!journal.settings.some(entry => entry.key === keys.join('.'))) {
            journal.settings.push({ file: settingsFile, key: keys.join('.'), previous: previous === undefined ? null : previous });
          }
        }
      });
    }
  } else {
    report.settings.push({ id: 'P07', outcome: 'missing', detail: `settings.json not readable: ${settingsFile}` });
  }

  if (dryRun) return report;

  // ---- write
  if (bundleChanged) {
    writePatched(bundlePath, bundle, journal, 'P08-P11');
    report.files.push(bundlePath);
  }
  if (productChanged) {
    writePatched(productPath, JSON.stringify(productDoc, null, 2) + '\n', journal, 'P01-P06');
    report.files.push(productPath);
  }
  if (report.settings.some(item => item.outcome === 'patched')) {
    // settings.json is user-owned: no whole-file backup, no .bak restore. Only the
    // keys this plugin touched are journalled, so revert leaves unrelated edits alone.
    const tmp = settingsFile + '.wbpurge.tmp';
    fs.writeFileSync(tmp, JSON.stringify(settingsDoc, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, settingsFile);
    report.files.push(settingsFile);
  }
  writeJournal(journal);
  return report;
}

function writePatched(file, text, journal, patchIds) {
  if (!exists(file + BAK_SUFFIX)) {
    fs.copyFileSync(file, file + BAK_SUFFIX);
  }
  const tmp = file + '.wbpurge.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
  const entry = journal.patched[file] || { backup: file + BAK_SUFFIX, patches: [] };
  if (!entry.patches.includes(patchIds)) entry.patches.push(patchIds);
  entry.hashAfter = hash(text);
  journal.patched[file] = entry;
}

/** Restore every backed-up file; then remove the settings keys this plugin set. */
export function revert(options = {}) {
  const journal = readJournal();
  const restored = [];
  const skipped = [];

  const files = new Set(Object.keys(journal.patched));
  const settingsFile = path.join(profileRoot(), 'settings.json');
  const cliRoot = options.cliRoot || journal.cliRoot || resolveCliRoot();
  if (cliRoot) {
    files.add(path.join(cliRoot, BUNDLE_REL));
    files.add(path.join(cliRoot, PRODUCT_REL));
  }
  files.delete(settingsFile);
  for (const file of files) {
    const bak = file + BAK_SUFFIX;
    if (!exists(bak)) {
      if (exists(file)) skipped.push({ file, reason: 'no backup' });
      continue;
    }
    fs.copyFileSync(bak, file);
    fs.rmSync(bak, { force: true });
    restored.push(file);
  }

  const settingsRestored = [];
  const settingsDoc = exists(settingsFile) ? safeParse(safeRead(settingsFile)) : null;
  if (settingsDoc) {
    let touched = false;
    // Journal first (exact previous values). When a fresh copy of the plugin runs
    // revert without a journal, fall back to "our value is still there → remove it".
    const entries = journal.settings.length
      ? journal.settings
      : SETTINGS_OVERRIDES.flatMap(override =>
          override.keys.map((keys, index) => ({ file: settingsFile, key: keys.join('.'), previous: null, value: override.values[index] })),
        );
    for (const entry of entries) {
      const keys = entry.key.split('.');
      let node = settingsDoc;
      let ok = true;
      for (const key of keys.slice(0, -1)) {
        if (!node || typeof node !== 'object' || !node[key]) {
          ok = false;
          break;
        }
        node = node[key];
      }
      if (!ok) continue;
      const leaf = keys[keys.length - 1];
      // Without a journal we only remove a value this plugin itself wrote.
      if (entry.previous === null && entry.value !== undefined && node[leaf] !== entry.value) continue;
      if (entry.previous === null) delete node[leaf];
      else node[leaf] = entry.previous;
      touched = true;
      settingsRestored.push(entry.key);
    }
    if (touched) {
      const tmp = settingsFile + '.wbpurge.tmp';
      fs.writeFileSync(tmp, JSON.stringify(settingsDoc, null, 2) + '\n', 'utf8');
      fs.renameSync(tmp, settingsFile);
    }
  }
  writeJournal(emptyJournal());
  return { restored, skipped, settingsRestored, settingsFile };
}

/** Post-apply integrity checks: JSON validity, bundle syntax, marker presence. */
export function verify(options = {}) {
  const cliRoot = options.cliRoot || resolveCliRoot();
  const checks = [];
  if (!cliRoot) {
    checks.push({ name: 'cli-root', ok: false, detail: 'not found' });
    return { ok: false, checks };
  }
  const productPath = path.join(cliRoot, PRODUCT_REL);
  const bundlePath = path.join(cliRoot, BUNDLE_REL);

  try {
    const doc = JSON.parse(fs.readFileSync(productPath, 'utf8'));
    checks.push({ name: 'product.json parses', ok: true, detail: `${(doc.prompts || []).length} prompts` });
  } catch (error) {
    checks.push({ name: 'product.json parses', ok: false, detail: error.message });
  }

  try {
    execFileSync(process.execPath, ['--check', bundlePath], { stdio: 'pipe' });
    checks.push({ name: 'bundle syntax (node --check)', ok: true, detail: path.basename(bundlePath) });
  } catch (error) {
    checks.push({ name: 'bundle syntax (node --check)', ok: false, detail: String(error.stderr || error.message).slice(0, 300) });
  }

  const statusReport = status({ cliRoot });
  const pending = statusReport.rows.filter(row => row.state === 'pending');
  const conflicts = statusReport.rows.filter(row => row.state === 'conflict');
  const missing = statusReport.rows.filter(row => row.state === 'missing');
  checks.push({
    name: 'patch coverage',
    ok: pending.length === 0 && conflicts.length === 0 && missing.length === 0,
    detail: `${statusReport.rows.length - pending.length - conflicts.length - missing.length}/${statusReport.rows.length} applied` +
      (pending.length ? ` pending=${pending.map(p => p.id).join(',')}` : '') +
      (conflicts.length ? ` conflict=${conflicts.map(p => p.id).join(',')}` : '') +
      (missing.length ? ` missing=${missing.map(p => p.id).join(',')}` : ''),
  });

  const tools = execFileSync(process.execPath, [bundlePath, '--version'], { stdio: 'pipe' }).toString().trim();
  checks.push({ name: 'bundle runs (--version)', ok: tools.length > 0, detail: tools.split('\n').pop() });

  return { ok: checks.every(check => check.ok), checks, cliRoot };
}
