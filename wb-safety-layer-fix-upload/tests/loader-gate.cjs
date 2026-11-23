// Replays the preconditions of the WorkBuddy mods loader
// (loadModFromDirectory / isModDirectory / modSourceFingerprint) against every
// installed copy, without starting the CLI.
//
//   node tests/loader-gate.cjs [--root=<plugin dir>]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const explicit = process.argv.find(a => a.startsWith('--root='));
const profile = process.env.WB_PROFILE_DIR || path.join(process.env.USERPROFILE || process.env.HOME || '', '.workbuddy');
const cacheBase = path.join(profile, 'plugins', 'cache', 'wb-local', 'wb-safety-layer-fix');

function versionDirs(base) {
  try {
    return fs
      .readdirSync(base, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(base, entry.name))
      .sort();
  } catch {
    return [];
  }
}

const candidates = explicit
  ? [explicit.slice('--root='.length)]
  : [
      ...versionDirs(cacheBase),
      path.join(profile, 'plugins', 'marketplaces', 'wb-local', 'plugins', 'wb-safety-layer-fix'),
    ];

// Manifest discovery order used by findManifest(): .codebuddy-plugin, .workbuddy-plugin, ...
const MANIFEST_DIRS = ['.codebuddy-plugin', '.workbuddy-plugin'];

let failures = 0;
let checked = 0;
function ok(cond, label) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

if (candidates.length === 0) {
  console.error('no installed copy found. Run install.ps1 first, or pass --root=<plugin dir>.');
  process.exit(1);
}

for (const root of candidates) {
  console.log(`\n--- ${root}`);
  if (!fs.existsSync(root)) {
    ok(false, `plugin directory exists (${root})`);
    continue;
  }
  checked++;
  ok(true, 'plugin directory exists');

  const manifestDir = MANIFEST_DIRS.find(d => fs.existsSync(path.join(root, d, 'plugin.json')));
  ok(Boolean(manifestDir), 'manifest discovered (plugin.json under a known manifest dir)');
  if (!manifestDir) continue;
  const manifest = JSON.parse(fs.readFileSync(path.join(root, manifestDir, 'plugin.json'), 'utf8'));
  ok(typeof manifest.name === 'string' && manifest.name.length > 0, 'manifest declares "name"');
  ok(typeof manifest.hooks === 'string', 'manifest points the hook loader at hooks.json');

  const hooksPath = path.join(root, 'hooks', 'hooks.json');
  ok(fs.existsSync(hooksPath), 'hooks/hooks.json exists');
  const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  ok(Array.isArray(hooks.modules) && hooks.modules.length > 0, 'hooks.json "modules" is a non-empty array (isModDirectory gate)');

  for (const rel of hooks.modules) {
    const resolved = path.resolve(path.join(root, 'hooks'), rel);
    const inside = resolved.startsWith(path.resolve(root) + path.sep);
    ok(inside, `module ${rel} resolves inside the plugin directory`);
    ok(fs.existsSync(resolved), `module ${rel} exists`);
    const source = fs.readFileSync(resolved, 'utf8');
    ok(/export\s+function\s+register|export\s+default/.test(source), `module ${rel} exports register`);
    const events = [...source.matchAll(/\bon\(\s*['"`]([a-z*]+(?:\.[a-z*]+)?)['"`]/g)].map(m => m[1]);
    ok(events.length > 0, `usesOf sees declared events: ${events.join(', ') || '(none)'}`);
    ok(!/^\s*import\s/m.test(source), 'module has no top-level imports (isolated realm safe)');
    ok(!/\brequire\s*\(/.test(source), 'module has no require() calls (isolated realm safe)');
    console.log(`      ${rel} sha256 ${crypto.createHash('sha256').update(source).digest('hex').slice(0, 16)}…`);
  }

  ok(fs.existsSync(path.join(root, 'config.json')), 'config.json shipped');
  ok(fs.existsSync(path.join(root, 'bin', 'wb-purge.mjs')), 'wb-purge CLI shipped');
}

console.log(`\n${failures === 0 ? `ALL LOADER PRECONDITIONS MET (${checked} cop${checked === 1 ? 'y' : 'ies'})` : failures + ' precondition(s) failed'}`);
process.exitCode = failures === 0 ? 0 : 1;
