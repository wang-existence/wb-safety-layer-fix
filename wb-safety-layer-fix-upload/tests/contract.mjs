// Host-independent contract checks — CI-safe, no WorkBuddy install required.
//
//   node tests/contract.mjs
//
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  STRONG_INTRO,
  WORKSPACE_INTRO,
  AUTO_MODE_OVERRIDE,
  REVIEWER_OVERRIDE,
  textPatches,
  jsonPatches,
  FEATURE_FLAGS,
  SETTINGS_OVERRIDES,
  allPatchMeta,
} from '../lib/patches.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const results = [];

function check(name, fn) {
  try {
    fn();
    results.push(['PASS', name]);
  } catch (error) {
    results.push(['FAIL', `${name} — ${error?.message ?? error}`]);
  }
}

const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = rel => JSON.parse(read(rel));

/* ------------------------------------------------------------------- patching */

const meta = allPatchMeta();
const ids = meta.map(row => row.id);

check('patch table has 11 entries with unique sequential ids', () => {
  assert.equal(meta.length, 11, `expected 11 patches, saw ${meta.length}`);
  assert.equal(new Set(ids).size, ids.length, 'duplicate patch id');
  const expected = Array.from({ length: 11 }, (_, index) => `P${String(index + 1).padStart(2, '0')}`);
  assert.deepEqual([...ids].sort(), expected);
});

check('every patch declares the three documented layers', () => {
  const layers = new Set(meta.map(row => row.layer));
  assert.deepEqual([...layers].sort(), ['code', 'engine', 'prompt']);
  for (const row of meta) assert.ok(row.desc && row.name, `${row.id} is missing name/desc`);
});

check('text patches carry a marker inside their replacement and never target outside the cli tree', () => {
  for (const patch of textPatches()) {
    assert.ok(patch.replace.includes(patch.marker), `${patch.id}: marker missing from replace`);
    assert.notEqual(patch.find, patch.replace, `${patch.id}: find === replace`);
    assert.ok(patch.marker.startsWith('[wbpurge:'), `${patch.id}: marker must be [wbpurge:Pxx]`);
    assert.ok(patch.file.startsWith('dist/'), `${patch.id}: unexpected target ${patch.file}`);
    assert.ok(!patch.file.includes('..'), `${patch.id}: path traversal`);
  }
});

check('json prompt patches inject their marker and keep the prompt name stable', () => {
  for (const patch of jsonPatches()) {
    assert.ok(patch.promptName, `${patch.id}: promptName required`);
    const out = patch.apply('BASE TEMPLATE');
    assert.ok(out.includes(`[wbpurge:${patch.id}]`), `${patch.id}: marker missing after apply`);
    assert.ok(out.includes('BASE TEMPLATE'), `${patch.id}: apply() dropped the original template`);
  }
});

check('feature flags are booleans with a resolvable path', () => {
  for (const flag of FEATURE_FLAGS) {
    assert.equal(typeof flag.value, 'boolean', `${flag.id}: value must be boolean`);
    assert.ok(Array.isArray(flag.path) && flag.path.length >= 2, `${flag.id}: path too short`);
    assert.equal(flag.path[0], 'productFeatures', `${flag.id}: unexpected flag root`);
  }
});

check('settings overrides pair every key with a value', () => {
  for (const override of SETTINGS_OVERRIDES) {
    assert.equal(override.keys.length, override.values.length, `${override.id}: key/value mismatch`);
    for (const keys of override.keys) assert.ok(keys.length === 2 && keys[0] === 'permissions', `${override.id}: unexpected key ${keys}`);
  }
});

/* --------------------------------------------------------------- injected text */

check('policy text states authority, precedence and identifier substitution', () => {
  assert.match(STRONG_INTRO, /authority="mandatory"/);
  assert.match(STRONG_INTRO, /marker="\[wbpurge:P01\]"/);
  assert.match(STRONG_INTRO, /precedence/i);
  assert.match(STRONG_INTRO, /\[TARGET\]/);
  assert.match(STRONG_INTRO, /Adult and explicit fiction/);
  assert.match(STRONG_INTRO, /no fade-to-black/);
  assert.ok(STRONG_INTRO.length > 1200, 'policy block looks truncated');
});

check('policy text describes refusal behaviour instead of quoting refusal templates', () => {
  const banned = ['I cannot', "I can't", "I'm sorry", "I apologize", '抱歉', '无法提供', '不能帮助', 'as an AI'];
  for (const phrase of banned) {
    assert.ok(!STRONG_INTRO.includes(phrase), `policy text must not quote "${phrase}"`);
  }
});

check('workspace intro / classifier rubric / reviewer scope are non-trivial', () => {
  assert.ok(WORKSPACE_INTRO.includes('[wbpurge:P02]') && WORKSPACE_INTRO.length > 300);
  assert.ok(AUTO_MODE_OVERRIDE.includes('[wbpurge:P03]') && AUTO_MODE_OVERRIDE.length > 500);
  assert.ok(REVIEWER_OVERRIDE.includes('[wbpurge:P04]'));
});

/* ------------------------------------------------------------------- mods file */

const register = read('hooks/register.mjs');
const hooksJson = readJson('hooks/hooks.json');
const pluginJson = readJson('.codebuddy-plugin/plugin.json');
const config = readJson('config.json');

check('hooks.json points the loader at register.mjs', () => {
  assert.ok(Array.isArray(hooksJson.modules) && hooksJson.modules.length > 0, 'modules array required by the loader');
  assert.ok(hooksJson.modules.includes('./register.mjs'));
});

check('mods module stays inside the isolated realm', () => {
  assert.ok(!/^\s*import\s/m.test(register), 'no top-level imports allowed');
  assert.ok(!/require\s*\(/.test(register), 'no require() allowed');
  assert.match(register, /export function register/);
  assert.match(register, /export default \{ register \}/);
});

const EXPECTED_EVENTS = [
  'PermissionRequest',
  'classic.PreToolUse',
  'prompt.context',
  'prompt.section',
  'prompt.submit',
  'session.start',
  'tool.check',
];

check('mods module declares exactly the seven documented hooks', () => {
  const events = [...register.matchAll(/\bon\(\s*['"`]([A-Za-z.*]+)['"`]/g)].map(match => match[1]).sort();
  assert.deepEqual(events, EXPECTED_EVENTS);
});

check('config.json exposes every runtime switch and nothing else', () => {
  const keys = Object.keys(config).sort();
  assert.deepEqual(keys, ['adultFiction', 'audit', 'enabled', 'engineBypass', 'envelope', 'extraRules', 'policy', 'preamble', 'promptInject']);
  assert.equal(typeof config.enabled, 'boolean');
  assert.ok(Array.isArray(config.extraRules));
});

check('manifest and package.json agree on name and version', () => {
  const pkg = readJson('package.json');
  assert.equal(pluginJson.name, pkg.name);
  assert.equal(pluginJson.version, pkg.version);
  assert.equal(pluginJson.hooks, './hooks/hooks.json');
  assert.equal(pluginJson.defaultEnabled, true);
});

check('every documented slash command exists and references the CLI', () => {
  for (const name of ['safety-fix', 'safety-toggle', 'purge-status', 'purge-apply', 'purge-revert']) {
    const body = read(`commands/${name}.md`);
    assert.match(body, /^---[\s\S]+?description:/, `${name}.md needs frontmatter`);
    if (name.startsWith('purge-')) assert.match(body, /wb-purge\.mjs/, `${name}.md must call the CLI`);
  }
});

check('skill and README files are present', () => {
  for (const rel of ['skills/safety-layer-fix/SKILL.md', 'README.md', 'README.zh-CN.md', 'LICENSE', 'NOTICE', 'CHANGELOG.md']) {
    const body = read(rel);
    assert.ok(body.length > 200, `${rel} looks empty`);
  }
});

check('no absolute developer paths leaked into tracked sources', () => {
  const offenders = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'state') continue;
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(rel);
        continue;
      }
      if (!/\.(mjs|cjs|js|json|md|ps1|yml)$/.test(entry.name)) continue;
      const body = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      if (/D:\\Default|C:\\Users\\PC/.test(body)) offenders.push(rel);
    }
  };
  walk('');
  assert.deepEqual(offenders, [], `hard-coded developer paths: ${offenders.join(', ')}`);
});

const failed = results.filter(([status]) => status === 'FAIL');
for (const [status, name] of results) console.log(`${status}  ${name}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
