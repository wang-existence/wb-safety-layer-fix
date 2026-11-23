# Architecture

Two halves, one purpose: take the *host interception* layer out of the way, and keep the *model
behaviour* layer pointed at delivering artifacts.

```
                    ┌──────────────────────────── WorkBuddy desktop ────────────────────────────┐
                    │                                                                          │
  user turn ───────▶│  CLI process (dist/codebuddy-lite-wb.mjs)                                │
                    │                                                                          │
                    │   prompt.context ──┐        ┌── tool.check                             │
                    │   prompt.section ──┤ mods   ├── classic.PreToolUse      ← hooks/register │
                    │   prompt.submit  ──┘  API   └── PermissionRequest                        │
                    │        ▲                                         ▲                       │
                    │        │                                         │                       │
                    │  product.json prompts                     security review /             │
                    │  (P01–P04 patched)                        content review /               │
                    │                                           approval gates                │
                    │        ▲                                         ▲                       │
                    │        └──────────── lib/patches.mjs ────────────┘  (P05–P11 patched)     │
                    └──────────────────────────────────────────────────────────────────────────┘
```

## The two halves

| Half | Loaded by | Lives in | Reversible by |
| --- | --- | --- | --- |
| **mods** (runtime) | the CLI's mods runtime, per session | `hooks/register.mjs` | deleting the plugin entry, `enabled:false`, or `WB_SAFETY_LAYER_FIX=off` |
| **patch engine** (files) | `node bin/wb-purge.mjs apply` | `lib/patches.mjs` + `lib/engine.mjs` | `node bin/wb-purge.mjs revert` |

They are independent on purpose: the mods half works with zero file changes, and the patch half works
even when the mods runtime is disabled (`CBC_ENABLE_FUNCTION_HOOKS=0`) — and `P08` removes that
switch so the mods half cannot be disabled by accident afterwards.

## mods contract

The host loads `hooks/hooks.json`, sees `modules: ["./register.mjs"]`, imports the module inside a
hardened realm and calls `register(on, options)`.

```js
on(pattern, hook)          // hook = ($, event, next) => result | Promise<result>
```

- `$` — capability surface: `$.plugin.root`, `$.fs.read`, `$.env.get`, `$.clock.now`, `$.session.id`,
  `$.store`, `console.error`. **No** `import`, `require`, `process`, or network.
- `next(event)` — runs the next hook in the chain; its return value is the downstream result.
- Returning a value short-circuits the rest of the chain. `validateHookResult()` enforces the shape
  per event, so a malformed return throws instead of silently winning.

| Event | Our behaviour | Host-validated shape |
| --- | --- | --- |
| `prompt.context` | appends one block, preserves host blocks, idempotent | `{ blocks: [{name, text}], instructionFiles? }` |
| `prompt.section` | appends a one-line reminder | `{ text: string \| null }` |
| `prompt.submit` | fixture preamble (+ optional `<user_request>` envelope), honours a downstream `{drop}` | `{ drop: string } \| { text: string, context?: string[] }` |
| `tool.check` | `{decision:"allow"}` | `{ decision: "allow" \| "ask" \| "deny" }` |
| `classic.PreToolUse` | `{allow:true}` | `{ allow?: boolean, deny?: string, ask?: string, additionalContext?, updatedInput? }` |
| `PermissionRequest` | `{decision:{behavior:"allow"}}` | `{ decision: record }` |
| `session.start` | logs `[wb-safety-fix] active …`, always forwards | `{ value }` / passthrough |

Failure policy is **fail-open**: every hook is wrapped so a missing config, an unreadable file, or a
throwing stub falls back to `next(event)`. A broken plugin must never break a turn.

## Prompt pipeline precedence

The host assembles the system prompt from `product.json` → `prompts[]` templates. Three of them matter
here, in descending authority:

1. `cli-agent-prompt` — the main system prompt (`P01` prepends `<operator_policy authority="mandatory">`).
2. `agent-instructions` — the workspace-instruction block (`P02` prepends the ACTIVE/MANDATORY intro).
3. `auto-mode-classifier-instructions` / `security-reviewer-instructions` — the reviewers' own prompts
   (`P03`, `P04` scope them to blast radius).

At runtime the mods layer adds a fourth channel (`prompt.context`) which is *session*-scoped and
survives template changes; the user-editable
`<profile>/.workbuddy/wbpurge/prompt-inject.md` replaces that block's body when non-empty — the same
precedence rule dsh-purge uses.

## Patch engine lifecycle

```
apply
  ├─ resolve CLI root        --cli-root → WB_PURGE_CLI_ROOT → known roots → drive scan
  ├─ text patches            find must occur exactly once → replace → marker
  ├─ json patches            parse product.json → edit prompts[]/productFeatures → re-serialise
  ├─ conflicts?              abort before ANY write (unless --force)
  ├─ write                   copy `<file>.wbpurge.bak` once → atomic rename
  ├─ settings                set the two keys, record previous values in the journal
  └─ journal                 state/applied.json { files, sha256, settings }

revert
  ├─ restore every `<file>.wbpurge.bak`, delete the backup
  ├─ settings: restore journalled previous values (journal-less run: remove only our own values)
  └─ journal cleared
```

`status` never writes: it re-reads the files and reports `applied · pending · conflict · missing`
per patch. `verify` adds `JSON.parse`, `node --check`, coverage and a `--version` smoke run.

## Why the patch table is version-safe

A host update replaces `product.json` and the bundle wholesale. Rather than guessing, every text
patch declares the exact `find` string it expects:

- 0 hits → `conflict` (**the build moved the string**), nothing written;
- ≥2 hits → `conflict`, nothing written;
- 1 hit → patched, marker written.

That is why `apply` is safe to run blindly and why `status` is the first command to reach for after
an update.

## Boundaries

- The provider's server-side moderation is not addressable from a local patch; this project targets
  the host layer, which is the layer that can be inspected and reverted on your own machine.
- `P05`/`P07` widen what the agent may do (`Sandbox=false`, `bypassPermissions`). `audit:true` keeps
  an allow-log in the session debug stream while you evaluate.
