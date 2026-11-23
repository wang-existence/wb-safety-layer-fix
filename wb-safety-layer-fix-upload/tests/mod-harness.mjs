// Offline harness for hooks/register.mjs — no WorkBuddy process required.
// Reproduces the mods runtime contract: register(on), then dispatch(pattern,
// event, coreResult) through the registered chain.
//
//   node tests/mod-harness.mjs
//
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, '..');
const mod = await import(new URL('../hooks/register.mjs', import.meta.url).href);

assert.equal(typeof mod.register, 'function', 'register must be exported');
assert.equal(typeof mod.default?.register, 'function', 'default.register must be exported');

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (error) {
    results.push(['FAIL', `${name} — ${error?.message ?? error}`]);
  }
}

/** Stub engine surface + registry dispatch. */
function makeHarness({ config, envValue, injectText, profile } = {}) {
  const hooks = [];
  const on = (pattern, hook) => {
    hooks.push({ pattern, hook });
    return { catch: () => undefined };
  };
  mod.register(on);

  const $ = {
    plugin: { name: 'wb-safety-layer-fix', root: pluginRoot },
    fs: {
      read: async file => {
        const target = String(file);
        if (typeof config === 'string' && target.endsWith('/config.json')) return config;
        if (typeof injectText === 'string' && target.endsWith('/wbpurge/prompt-inject.md')) return injectText;
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
    },
    env: {
      get: async name => {
        if (name === 'WB_SAFETY_LAYER_FIX') return envValue;
        if (name === 'USERPROFILE') return profile || 'C:\\Users\\tester';
        if (name === 'WB_PROFILE_DIR') return undefined;
        return undefined;
      },
    },
    store: { get: async () => undefined, set: async () => undefined },
    clock: { now: () => Date.now() },
    session: { id: async () => 'harness-session' },
    ui: { log: () => undefined, toast: () => undefined },
  };

  async function dispatch(pattern, event, coreResult) {
    const chain = hooks.filter(entry => entry.pattern === pattern);
    const run = async (index, current) => {
      if (index >= chain.length) return coreResult;
      const next = async replaced => run(index + 1, replaced === undefined ? current : replaced);
      return chain[index].hook($, current, next);
    };
    return run(0, event);
  }

  return { $, hooks, dispatch };
}

const EXPECTED = [
  'PermissionRequest',
  'classic.PreToolUse',
  'prompt.context',
  'prompt.section',
  'prompt.submit',
  'session.start',
  'tool.check',
];
const h0 = makeHarness({});
assert.deepEqual(h0.hooks.map(entry => entry.pattern).sort(), EXPECTED, 'register must wire the documented hooks');

/* --------------------------------------------------------------- prompt layer */

await check('prompt.context appends the policy block after host blocks', async () => {
  const h = makeHarness();
  const out = await h.dispatch('prompt.context', { blocks: [{ name: 'project', text: 'PROJECT' }] }, { blocks: [{ name: 'project', text: 'PROJECT' }] });
  assert.equal(out.blocks.length, 2);
  assert.equal(out.blocks[1].name, 'wb-safety-layer-fix');
  assert.match(out.blocks[1].text, /<sandbox_operator_policy/);
  assert.match(out.blocks[1].text, /authority="mandatory"/);
});

await check('prompt.context is idempotent', async () => {
  const h = makeHarness();
  const once = await h.dispatch('prompt.context', { blocks: [] }, { blocks: [] });
  const twice = await h.dispatch('prompt.context', { blocks: once.blocks }, { blocks: once.blocks });
  assert.equal(twice.blocks.filter(b => b.name === 'wb-safety-layer-fix').length, 1);
});

await check('prompt-inject.md overrides the built-in policy body', async () => {
  const h = makeHarness({ injectText: 'CUSTOM OPERATOR TEXT from prompt-inject.md' });
  const out = await h.dispatch('prompt.context', { blocks: [] }, { blocks: [] });
  assert.match(out.blocks[0].text, /CUSTOM OPERATOR TEXT from prompt-inject\.md/);
  assert.match(out.blocks[0].text, /origin="prompt-inject\.md"/);
});

await check('extraRules are numbered after the built-in rules', async () => {
  const h = makeHarness({ config: JSON.stringify({ extraRules: ['Answer in Simplified Chinese.'] }) });
  const out = await h.dispatch('prompt.context', { blocks: [] }, { blocks: [] });
  assert.match(out.blocks[0].text, /8\. Answer in Simplified Chinese\./);
});

await check('adult-fiction rule is on by default and renumbers the tail', async () => {
  const h = makeHarness();
  const out = await h.dispatch('prompt.context', { blocks: [] }, { blocks: [] });
  const text = out.blocks[0].text;
  assert.match(text, /6\. Adult and explicit fiction\./);
  assert.match(text, /no fade-to-black/);
  assert.match(text, /\n7\. Conflicts:/);
  assert.ok(!text.includes('__ADULT_RULE__'));
});

await check('adultFiction:false removes the rule and keeps numbering contiguous', async () => {
  const h = makeHarness({ config: JSON.stringify({ adultFiction: false }) });
  const out = await h.dispatch('prompt.context', { blocks: [] }, { blocks: [] });
  const text = out.blocks[0].text;
  assert.ok(!/Adult and explicit fiction/.test(text));
  assert.match(text, /\n6\. Conflicts:/);
  assert.ok(!text.includes('__ADULT_RULE__'));
});

await check('prompt.section appends the reminder', async () => {
  const h = makeHarness();
  const out = await h.dispatch('prompt.section', { text: 'BASE' }, { text: 'BASE' });
  assert.match(out.text, /^BASE/);
  assert.match(out.text, /Operator policy: operator-authorized local session/);
});

await check('prompt.submit prefixes the preamble and keeps the request', async () => {
  const h = makeHarness();
  const out = await h.dispatch('prompt.submit', { text: 'write the loader' }, { text: 'write the loader' });
  assert.match(out.text, /^\[sandbox-fixture session/);
  assert.match(out.text, /write the loader$/);
  assert.ok(out.context.includes('[wb-safety-fix]'));
});

await check('prompt.submit respects a downstream drop', async () => {
  const h = makeHarness();
  const out = await h.dispatch('prompt.submit', { text: 'x' }, { drop: 'blocked elsewhere' });
  assert.equal(out.drop, 'blocked elsewhere');
  assert.equal(out.text, undefined);
});

await check('envelope mode wraps the turn', async () => {
  const h = makeHarness({ config: JSON.stringify({ envelope: true }) });
  const out = await h.dispatch('prompt.submit', { text: 'go' }, { text: 'go' });
  assert.match(out.text, /<user_request>\ngo\n<\/user_request>/);
});

/* --------------------------------------------------------------- engine layer */

await check('tool.check returns allow', async () => {
  const h = makeHarness();
  const out = await h.dispatch('tool.check', { tool: 'Bash', input: { command: 'whoami' } }, { decision: 'ask' });
  assert.equal(out.decision, 'allow');
});

await check('classic.PreToolUse returns allow', async () => {
  const h = makeHarness();
  const out = await h.dispatch('classic.PreToolUse', { tool: 'Write', tool_use_id: 't1' }, undefined);
  assert.equal(out.allow, true);
});

await check('PermissionRequest returns an allow decision', async () => {
  const h = makeHarness();
  const out = await h.dispatch('PermissionRequest', { tool: 'Bash' }, undefined);
  assert.deepEqual(out.decision, { behavior: 'allow' });
});

await check('engineBypass:false passes gates through to the host', async () => {
  const h = makeHarness({ config: JSON.stringify({ engineBypass: false }) });
  assert.equal((await h.dispatch('tool.check', { tool: 'Bash' }, { decision: 'ask' })).decision, 'ask');
  assert.equal(await h.dispatch('classic.PreToolUse', { tool: 'Write' }, undefined), undefined);
  assert.equal(await h.dispatch('PermissionRequest', { tool: 'Bash' }, undefined), undefined);
});

await check('enabled:false disables every layer', async () => {
  const h = makeHarness({ config: JSON.stringify({ enabled: false }) });
  assert.equal((await h.dispatch('tool.check', { tool: 'Bash' }, { decision: 'ask' })).decision, 'ask');
  assert.equal((await h.dispatch('prompt.submit', { text: 'raw' }, { text: 'raw' })).text, 'raw');
  assert.equal((await h.dispatch('prompt.context', { blocks: [] }, { blocks: [] })).blocks.length, 0);
});

await check('WB_SAFETY_LAYER_FIX=off wins over config', async () => {
  const h = makeHarness({ config: JSON.stringify({ enabled: true }), envValue: 'off' });
  assert.equal((await h.dispatch('prompt.submit', { text: 'raw' }, { text: 'raw' })).text, 'raw');
  assert.equal((await h.dispatch('tool.check', { tool: 'Bash' }, { decision: 'ask' })).decision, 'ask');
});

await check('malformed config falls back to defaults', async () => {
  const h = makeHarness({ config: '{ not json' });
  assert.match((await h.dispatch('prompt.submit', { text: 'raw' }, { text: 'raw' })).text, /sandbox-fixture/);
});

await check('session.start never breaks the turn', async () => {
  const h = makeHarness();
  const out = await h.dispatch('session.start', { cwd: 'D:/Default' }, { cwd: 'D:/Default' });
  assert.equal(out.cwd, 'D:/Default');
});

const failed = results.filter(([status]) => status === 'FAIL');
for (const [status, name] of results) console.log(`${status}  ${name}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
