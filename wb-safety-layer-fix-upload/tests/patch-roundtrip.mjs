// Patch-engine round-trip test — proves the patch table is safe to run against
// a real WorkBuddy install without touching it:
//
//   1. copy the installed bundle + product.json into a temp dir
//   2. apply every patch to the copies and assert each one hit exactly once
//   3. node --check the patched bundle copy (syntax survives)
//   4. re-apply and assert idempotency (markers short-circuit)
//   5. feed garbage and assert conflict detection instead of silent corruption
//
//   node tests/patch-roundtrip.mjs
//
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  applyTextPatch,
  applyJsonPatch,
  applyFlagPatch,
  resolveCliRoot,
} from '../lib/engine.mjs';
import { textPatches, jsonPatches, FEATURE_FLAGS } from '../lib/patches.mjs';

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (error) {
    results.push(['FAIL', `${name} — ${error?.message ?? error}`]);
  }
}

const cliRoot = resolveCliRoot();
if (!cliRoot) {
  console.error('WorkBuddy CLI root not found; set WB_PURGE_CLI_ROOT to run this test.');
  process.exitCode = 1;
  process.exit();
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wbpurge-test-'));
// Always test against the pristine copy: when wb-purge is currently applied, the
// live files already carry markers and the `.wbpurge.bak` is the stock build.
const pristineOf = file => (fs.existsSync(file + '.wbpurge.bak') ? file + '.wbpurge.bak' : file);
const bundleSrc = pristineOf(path.join(cliRoot, 'dist', 'codebuddy-lite-wb.mjs'));
const productSrc = pristineOf(path.join(cliRoot, 'product.json'));

await check('patch table covers every layer', async () => {
  const layers = new Set([...textPatches(), ...jsonPatches(), ...FEATURE_FLAGS].map(p => p.layer));
  assert.deepEqual([...layers].sort(), ['code', 'engine', 'prompt']);
});

await check('every text patch hits the installed bundle exactly once', async () => {
  const pristine = fs.readFileSync(bundleSrc, 'utf8');
  let text = pristine;
  for (const patch of textPatches()) {
    const hits = pristine.split(patch.find).length - 1;
    assert.equal(hits, 1, `${patch.id} ${patch.name}: expected 1 hit, saw ${hits}`);
    const step = applyTextPatch(text, patch);
    assert.equal(step.outcome, 'patched', `${patch.id} ${patch.name}: ${step.outcome}`);
    text = step.text;
  }
  const out = path.join(tmp, 'patched-bundle.mjs');
  fs.writeFileSync(out, text, 'utf8');
  fs.writeFileSync(path.join(tmp, 'bundle-length.txt'), String(text.length - pristine.length));
  console.log(`      bundle grew by ${text.length - pristine.length} bytes`);
});

await check('patched bundle copy still parses (node --check)', async () => {
  const out = path.join(tmp, 'patched-bundle.mjs');
  execFileSync(process.execPath, ['--check', out], { stdio: 'pipe' });
});

await check('re-applying text patches is a no-op (idempotent)', async () => {
  let text = fs.readFileSync(path.join(tmp, 'patched-bundle.mjs'), 'utf8');
  for (const patch of textPatches()) {
    const step = applyTextPatch(text, patch);
    assert.equal(step.outcome, 'applied-before', `${patch.id}: ${step.outcome}`);
    assert.equal(step.text, text);
  }
});

await check('every JSON prompt patch applies once and stays valid JSON', async () => {
  const doc = JSON.parse(fs.readFileSync(productSrc, 'utf8'));
  for (const patch of jsonPatches()) {
    const first = applyJsonPatch(doc, patch);
    assert.equal(first.outcome, 'patched', `${patch.id} ${patch.name}: ${first.outcome} ${first.detail || ''}`);
    const second = applyJsonPatch(doc, patch);
    assert.equal(second.outcome, 'applied-before', `${patch.id} second apply: ${second.outcome}`);
  }
  const round = JSON.parse(JSON.stringify(doc));
  assert.equal((round.prompts || []).length, doc.prompts.length, 'prompt count must not change');
  const intro = round.prompts.find(p => p.name === 'cli-agent-prompt');
  assert.match(intro.template, /\[wbpurge:P01\]/);
  fs.writeFileSync(path.join(tmp, 'product.patched.json'), JSON.stringify(round, null, 2), 'utf8');
});

await check('feature flags flip once and report applied on re-run', async () => {
  const doc = JSON.parse(fs.readFileSync(productSrc, 'utf8'));
  for (const flag of FEATURE_FLAGS) {
    const first = applyFlagPatch(doc, flag);
    assert.equal(first.outcome, 'patched', `${flag.id}: ${first.outcome} ${first.detail || ''}`);
    assert.equal(applyFlagPatch(doc, flag).outcome, 'applied-before');
  }
});

await check('conflict detection refuses a string it cannot find', async () => {
  const step = applyTextPatch('console.log("unrelated build")', textPatches()[0]);
  assert.equal(step.outcome, 'conflict');
  assert.match(step.detail, /not found/);
});

await check('multi-hit strings are reported as conflicts, not patched', async () => {
  const patch = textPatches()[0];
  const step = applyTextPatch(`${patch.find}${patch.find}`, patch);
  assert.equal(step.outcome, 'conflict');
  assert.match(step.detail, /2 times/);
});

fs.rmSync(tmp, { recursive: true, force: true });

const failed = results.filter(([status]) => status === 'FAIL');
for (const [status, name] of results) console.log(`${status}  ${name}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
