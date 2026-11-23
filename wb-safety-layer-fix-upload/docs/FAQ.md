# FAQ

### Is this the same thing as dsh-purge?

Same architecture, different host. dsh-purge targets DeepSeek Harness (Cordis host, sidebar UI,
`node_modules` patching); this targets WorkBuddy (CodeBuddy core, mods function hooks + product.json
and bundle patching). The four layers map 1:1 — see the table in the README.

### Answer still looks like a policy template. Which layer is failing?

Work down the stack:

1. `/purge-status` — is `P01` applied? If `pending`, the system prompt is still stock.
2. Session debug log — is there a `[wb-safety-fix] active …` line? If not, the mods runtime never
   loaded the plugin (plugin disabled, `CBC_ENABLE_FUNCTION_HOOKS=0` before `P08`, or the desktop
   cached an old plugin list → restart).
3. Still refusing with both active → the text is coming from the provider, not the host. A local
   patch cannot unsend a rejected request.

### `status` shows `conflict`. What now?

The installed build moved that string. Read the `detail` (it says "pattern not found" or "matched N
times"). Then either add a new table entry for your build (CONTRIBUTING has the 3-step recipe) or run
`apply --force` to write the patches that still match, leaving the mover pending. Never treat a
conflict as cosmetic: a blindly forced patch is how you corrupt a bundle.

### Do I have to reinstall anything after a WorkBuddy update?

No reinstall, but re-apply:

```powershell
node bin\wb-purge.mjs status
node bin\wb-purge.mjs apply
node bin\wb-purge.mjs verify
```

Updates replace `product.json` and the bundle wholesale, so every marker disappears at once.

### Why did my `permissions` keys vanish after restarting WorkBuddy?

The desktop holds `settings.json` in memory and rewrites it on exit. If you applied while it was
running, the rewrite can drop the two keys. Close the app → `apply` (idempotent) → start it. The
plugin's own `enabledPlugins` entry has the same exposure; `install.ps1 -Force` re-asserts it.

### Is `Sandbox=false` + `bypassPermissions` really necessary?

For a full purge, yes — that is what dsh-purge's "code default" layer does. If you only want the
refusal behaviour gone, run with `-Purge` **not** being necessary: install the plugin without
`-Purge` and set `{"engineBypass": false}` in `config.json`. You keep the prompt layer and hand the
gates back to the host.

### Can I keep the review gates but drop the classifier?

`apply` is all-or-nothing per layer. Write a small script that calls `applyJsonPatch`/`applyTextPatch`
from `lib/engine.mjs` with a filtered patch list — both are exported precisely for that.

### Does it phone home?

No. Zero network calls, no telemetry, no update check. `lib/patches.mjs` and `lib/engine.mjs` only
touch the files listed in SECURITY.md.

### Does it work on macOS/Linux WorkBuddy builds?

The mods half is platform-independent. The patch table's strings are version-specific, not
platform-specific, so it should work if the desktop bundle matches — but only Windows has been
verified. `status` will report `conflict` rather than guessing.

### Where is the state?

| Path | Meaning |
| --- | --- |
| `<file>.wbpurge.bak` | pristine copy of a patched file (created once) |
| `state/applied.json` | journal: patched files, sha256 after apply, settings keys + previous values |
| `~/.workbuddy/wbpurge/prompt-inject.md` | optional user policy body — never deleted by this project |

`state/` is git-ignored; the backups live next to the host files they came from.

### How do I get the original files back by hand?

```powershell
cd "<install>\resources\app.asar.unpacked\cli"
Copy-Item product.json.wbpurge.bak product.json -Force
Copy-Item dist\codebuddy-lite-wb.mjs.wbpurge.bak dist\codebuddy-lite-wb.mjs -Force
```

Then remove `permissions.defaultMode` and `permissions.disableAutoMode` from `settings.json`, and
delete `state/applied.json` so the journal matches reality.

### Why "wb-safety-layer-fix" and not "wb-purge"?

The plugin started life as the prompt-layer repair (v1). The purge engine was added in v2 under the
same plugin identity so existing installs upgrade in place; `bin/wb-purge.mjs` is the purge CLI.
