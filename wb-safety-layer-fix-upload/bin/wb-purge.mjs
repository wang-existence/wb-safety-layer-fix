#!/usr/bin/env node
/**
 * wb-purge — CLI for the WorkBuddy instruction-authority purge.
 *
 *   node bin/wb-purge.mjs status  [--json] [--cli-root=…]
 *   node bin/wb-purge.mjs apply   [--dry-run] [--force] [--json] [--cli-root=…]
 *   node bin/wb-purge.mjs revert  [--json] [--cli-root=…]
 *   node bin/wb-purge.mjs verify  [--json] [--cli-root=…]
 *   node bin/wb-purge.mjs layers            # what each layer changes, no writes
 *
 * Exit codes: 0 ok · 1 failure (conflict, missing install, verify failed).
 */
import { status, apply, revert, verify, resolveCliRoot, readJournal, PLUGIN_ROOT } from '../lib/engine.mjs';
import { allPatchMeta } from '../lib/patches.mjs';

const argv = process.argv.slice(2);
const command = (argv[0] || 'status').toLowerCase();
const flags = new Set(argv.filter(a => a.startsWith('--') && !a.includes('=')));
const opts = Object.fromEntries(
  argv
    .filter(a => a.startsWith('--') && a.includes('='))
    .map(a => {
      const index = a.indexOf('=');
      return [a.slice(2, index), a.slice(index + 1)];
    }),
);

const asJson = flags.has('--json');
const cliRoot = opts['cli-root'] || undefined;

function paint(text, color) {
  if (asJson || process.env.NO_COLOR) return text;
  const codes = { green: 32, red: 31, yellow: 33, dim: 90, bold: 1 };
  return `\u001b[${codes[color] || 0}m${text}\u001b[0m`;
}

function icon(state) {
  switch (state) {
    case 'applied':
      return paint('applied ', 'green');
    case 'pending':
      return paint('pending ', 'yellow');
    case 'conflict':
      return paint('conflict', 'red');
    case 'missing':
    case 'no-install':
      return paint('missing ', 'red');
    default:
      return paint(String(state).padEnd(8), 'dim');
  }
}

function printRows(rows) {
  const byLayer = new Map();
  for (const row of rows) {
    if (!byLayer.has(row.layer)) byLayer.set(row.layer, []);
    byLayer.get(row.layer).push(row);
  }
  for (const [layer, group] of [...byLayer.entries()].sort()) {
    console.log(`\n${paint(`── ${layer} (${group.length})`, 'bold')}`);
    for (const row of group) {
      const detail = row.detail ? paint(`  ${row.detail}`, 'dim') : '';
      console.log(`  ${row.id}  ${icon(row.state)}  ${row.name}${detail}`);
      console.log(`        ${paint(row.desc, 'dim')}`);
    }
  }
}

try {
  if (command === 'status') {
    const report = status({ cliRoot });
    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`cli root   ${report.cliRoot || paint('(not found)', 'red')}`);
      console.log(`plugin     ${PLUGIN_ROOT}`);
      console.log(`journal    ${Object.keys(readJournal().patched).length > 0 ? 'present' : 'empty'}`);
      printRows(report.rows);
      const counts = report.rows.reduce((acc, row) => ({ ...acc, [row.state]: (acc[row.state] || 0) + 1 }), {});
      console.log(`\nsummary    ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    }
  } else if (command === 'apply') {
    const report = apply({ cliRoot, dryRun: flags.has('--dry-run'), force: flags.has('--force') });
    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`cli root   ${report.cliRoot}${report.dryRun ? paint('  (dry run: nothing written)', 'yellow') : ''}`);
      for (const patch of report.patches) {
        console.log(`  ${patch.id}  ${patch.outcome.padEnd(14)} ${patch.name}${patch.detail ? paint(`  ${patch.detail}`, 'dim') : ''}`);
      }
      for (const setting of report.settings) {
        console.log(`  ${setting.id}  ${String(setting.outcome).padEnd(14)} ${setting.key || setting.detail}${setting.key ? paint(`  ${JSON.stringify(setting.previous)} → ${JSON.stringify(setting.value)}`, 'dim') : ''}`);
      }
      if (!report.dryRun) {
        console.log(`\nfiles      ${report.files.length ? report.files.join('\n           ') : '(none changed)'}`);
        console.log(paint('\nRestart WorkBuddy so the desktop respawns the CLI with the patched bundle.', 'green'));
      }
    }
  } else if (command === 'revert') {
    const report = revert({ cliRoot });
    if (asJson) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`restored   ${report.restored.length}`);
      for (const file of report.restored) console.log(`  ${file}`);
      console.log(`settings   ${report.settingsRestored.length ? report.settingsRestored.join(', ') : '(none)'}`);
      if (report.skipped.length) {
        console.log(paint(`skipped    ${report.skipped.map(s => `${s.file} (${s.reason})`).join('; ')}`, 'yellow'));
      }
      console.log(paint('\nRestart WorkBuddy to come back to stock behaviour.', 'green'));
    }
  } else if (command === 'verify') {
    const report = verify({ cliRoot });
    if (asJson) console.log(JSON.stringify(report, null, 2));
    else {
      for (const check of report.checks) {
        console.log(`  ${check.ok ? paint('ok  ', 'green') : paint('FAIL', 'red')}  ${check.name}  ${paint(check.detail || '', 'dim')}`);
      }
      console.log(`\n${report.ok ? paint('verify: ok', 'green') : paint('verify: failed', 'red')}`);
    }
    if (!report.ok) process.exitCode = 1;
  } else if (command === 'layers') {
    const meta = allPatchMeta();
    if (asJson) console.log(JSON.stringify(meta, null, 2));
    else {
      for (const row of meta) console.log(`${row.id}  ${row.layer.padEnd(8)} ${row.kind.padEnd(9)} ${row.name}\n      ${row.desc}`);
    }
  } else {
    console.log(`wb-purge — WorkBuddy instruction-authority purge

  status   [--json]                 per-patch state (applied / pending / conflict / missing)
  apply    [--dry-run] [--force]    write the patches (dry-run keeps the hit-count assertions)
  revert   [--json]                 restore every .wbpurge.bak and drop the settings overrides
  verify   [--json]                 JSON validity + node --check + coverage + --version smoke
  layers                            list the patch table

  --cli-root=<install>/resources/app.asar.unpacked/cli   override install detection
  env: WB_PURGE_CLI_ROOT, WB_PROFILE_DIR`);
    process.exitCode = command === 'help' ? 0 : 1;
  }
} catch (error) {
  if (asJson) console.log(JSON.stringify({ ok: false, error: error.message }, null, 2));
  else console.error(paint(`error: ${error.message}`, 'red'));
  process.exitCode = 1;
}
