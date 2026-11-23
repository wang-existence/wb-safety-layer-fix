# wb-safety-layer-fix

**The dsh-purge equivalent for WorkBuddy.** Takes the host *interception* layer out of the way — prompt
templates, approval gates, risk review, content review — and keeps a session-scoped operator policy in
front of the model. Two independent halves, both reversible.

[![ci](https://github.com/wang-existence/wb-safety-layer-fix/actions/workflows/ci.yml/badge.svg)](https://github.com/wang-existence/wb-safety-layer-fix/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A518.20.8-339933.svg)](package.json)
[![verified](https://img.shields.io/badge/verified-WorkBuddy%205.11.3%20%C2%B7%20CLI%202.176.0-2f7d32.svg)](docs/VERIFY.md)
[![中文](https://img.shields.io/badge/docs-%E4%B8%AD%E6%96%87-lightgrey.svg)](README.zh-CN.md)

> Unofficial. Not affiliated with Tencent / WorkBuddy / CodeBuddy / DeepSeek. Read
> [docs/DISCLAIMER.md](docs/DISCLAIMER.md) before applying the patch layer.

---

## Why this exists

A harness does more than hand your message to a model: it rewrites the system prompt, owns the
approval gate, reviews tool calls, and re-formats the session. When an answer comes back as a policy
template, judging only "did the model refuse" attributes a host interception to the model. This
plugin separates the two layers on your own installation, so you can see which one answered — and
decide whether the default policy is set right.

| Half | Loaded by | Writes files | Reversible by |
| --- | --- | --- | --- |
| **mods** (runtime hooks) | the CLI mods runtime, every session | no | `enabled:false`, `WB_SAFETY_LAYER_FIX=off`, or uninstall |
| **wb-purge** (patch engine) | `node bin/wb-purge.mjs apply` | yes, with `.wbpurge.bak` | `node bin/wb-purge.mjs revert` |

## The four layers

| Layer | ids | Target | Effect |
| --- | --- | --- | --- |
| **prompt** | `P01`–`P04` | `product.json` → `prompts[]` | mandatory `<operator_policy>` in the system prompt and workspace intro; classifier rubric; reviewer scoped to blast radius |
| **code** | `P05`–`P07` | `product.json` flags + `settings.json` | `Sandbox=false`, `SkillSecurityScan=false`, `defaultMode="bypassPermissions"`, `disableAutoMode="disable"` |
| **engine** | `P08`–`P11` | `dist/codebuddy-lite-wb.mjs` | function hooks forced on; tool-risk review, content protection and content review short-circuited |
| **runtime** | — | `hooks/register.mjs` | `tool.check` / `classic.PreToolUse` / `PermissionRequest` answer **allow**; `prompt.context` / `prompt.section` / `prompt.submit` carry the policy |

Full dependency-free reference for each id: [docs/PATCHES.md](docs/PATCHES.md).

## Quick start

```powershell
git clone https://github.com/wang-existence/wb-safety-layer-fix.git
cd wb-safety-layer-fix

# plugin only: mods + slash commands + skill
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1

# plugin + all four layers, verified in one shot
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Purge
```

Close WorkBuddy first — the running daemon holds the plugin registry in memory and rewrites
`settings.json` on exit. Then start it and, in a session:

```
/purge-status      → 11/11 applied, verify output
/safety-fix        → mods config (policy / preamble / engine)
```

Requirements: Node ≥ 18.20.8, Windows (verified), PowerShell 5.1 or 7+. No dependencies.

## Purge CLI

```powershell
node bin\wb-purge.mjs status                 # applied | pending | conflict | missing, per patch
node bin\wb-purge.mjs apply --dry-run        # every assertion, zero writes
node bin\wb-purge.mjs apply                  # write + <file>.wbpurge.bak
node bin\wb-purge.mjs verify                 # JSON · node --check · coverage · --version
node bin\wb-purge.mjs revert                 # restore backups, drop the two settings keys
node bin\wb-purge.mjs layers                 # patch table, no side effects
node bin\wb-doctor.mjs                       # "is it live?" — four layers, one answer
```

Exit code `1` on conflict, missing install or failed verification — safe to gate scripts on.
`--json` on every subcommand, `--cli-root=<path>` to override install detection.

**“Is it actually live?”** — `wb-doctor` prints the plugin registration, the 11 patch states, the
running WorkBuddy / CLI-host processes and any `[wb-safety-fix]` activity marker in the logs, then
names the layer to fix when something is off. Exit code `1` when a file layer is incomplete.

## Verification (measured, not claimed)

```
status     applied=11
verify     product.json parses (131 prompts) · node --check ok · 11/11 applied · --version 2.176.0
revert     restored 3 files → pending=11 → stock bundle still runs 2.176.0        (round trip)
apply      re-applied; bundle grew by −23 bytes (replacements shorter than the guards removed)
suites     contract 17/17 · mods harness 16/16 · loader gate 2/2 copies · patch round-trip 8/8
manifest   plugin validate ✔ · plugin list → wb-safety-layer-fix@wb-local 2.0.0 enabled
```

Raw output and the exact commands: [docs/VERIFY.md](docs/VERIFY.md).

## Configuration

`config.json`, re-read on **every** dispatch:

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | master switch for the runtime layer |
| `policy` | `true` | inject `<sandbox_operator_policy>` (file patches unaffected) |
| `preamble` | `true` | prefix the user turn with the fixture preamble |
| `envelope` | `false` | wrap the turn in `<user_request>…</user_request>` |
| `engineBypass` | `true` | answer allow at `tool.check` / `PreToolUse` / `PermissionRequest` |
| `audit` | `false` | log every allow verdict to the session debug stream |
| `promptInject` | `true` | honour `<profile>/.workbuddy/wbpurge/prompt-inject.md` |
| `adultFiction` | `true` | include the adult/explicit-fiction rule in the policy block |
| `extraRules` | `[]` | appended as rules 8, 9, … in the policy block |

Kill switch: `WB_SAFETY_LAYER_FIX=off` (wins over everything).
Adult content has a hard boundary this repo cannot cross from the host side — see
[docs/NSFW-ROUTING.md](docs/NSFW-ROUTING.md) for what actually unblocks it.
Matrix and workflows: [docs/USAGE.md](docs/USAGE.md).

## How it stays safe

- **Exact hit count of 1** before any text write. 0 or ≥2 hits → `conflict`, nothing written.
- **One backup per file**, created before the first write, restored by `revert`.
- **Key-level settings restore** — unrelated edits to `settings.json` survive a revert.
- **Fail-open runtime** — a missing config, unreadable file or throwing stub falls through to
  `next(event)`; a broken plugin never breaks a turn.
- **No network, no telemetry, no binaries, no vendor code redistributed.**

## Repository layout

```
.codebuddy-plugin/plugin.json   manifest the host validates
hooks/                          hooks.json (modules array) + register.mjs (7 hooks, isolated realm)
lib/patches.mjs                 the 11-entry patch table + injected policy text
lib/engine.mjs                  apply / revert / status / verify, backups, journal, detection
bin/wb-purge.mjs                CLI
commands/                       /purge-status /purge-apply /purge-revert /safety-fix /safety-toggle
skills/safety-layer-fix/        model-facing documentation
tests/                          contract · mods harness · loader gate · patch round-trip
docs/                           architecture · patch reference · usage · verification · FAQ · disclaimer
install.ps1 / uninstall.ps1     registration (and revert on uninstall)
```

## Differences from dsh-purge

| dsh-purge | here |
| --- | --- |
| Cordis sidebar UI (清洗 / 演练台) | CLI + three slash commands — WorkBuddy's plugin system has no host UI extension point |
| red-team preset, `skills/redteam`, paper-autopilot | not bundled (separate assets, not part of the purge mechanism) |
| auto-reapply after `node_modules` upgrade | `status` → `apply`; `install.ps1 -Purge` does it in one step |
| patches inside `@deepseek-ai` packages | patches inside `product.json` + the CLI bundle |

## Contributing · Security · License

Publishing this repo: double-click **`UPLOAD-TO-GITHUB.cmd`** (or run
`.\scripts\push-to-github.ps1`) — it rewrites the `wang-existence` placeholder, creates the repository and
pushes. Details and troubleshooting: [docs/UPLOAD.md](docs/UPLOAD.md).

[docs/FAQ.md](docs/FAQ.md) for "conflict after update", "keys vanished after restart" and similar.
[CONTRIBUTING.md](CONTRIBUTING.md) for the 3-step recipe to add a patch for a new build.
[SECURITY.md](SECURITY.md) for what a reviewer should check and how to report.
MIT — [LICENSE](LICENSE) · [NOTICE](NOTICE) · [CHANGELOG](CHANGELOG.md).
