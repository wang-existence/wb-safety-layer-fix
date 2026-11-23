# Contributing

Thanks for looking. This project has one unusual property worth stating up front: it patches a
**third-party host at runtime**, so every change must be reversible, observable and version-safe.

## Ground rules

1. **No host code in the repo.** Quote at most the short string a patch targets. Never paste a
   bundle, an asset, or a key.
2. **Every patch is declarative.** Add entries to `lib/patches.mjs`; do not add ad-hoc `sed`-style
   code in `engine.mjs`.
3. **Markers are mandatory.** The replacement text of a text patch, or the injected text of a JSON
   patch, must contain `[wbpurge:Pxx]`. Idempotency depends on it.
4. **Exact hit count of 1.** If a pattern can match twice, split it. `applyTextPatch` reports
   `conflict` on a multi-hit string by design.
5. **Backup and journal.** Any file you write goes through `writePatched()`; anything you set in
   `settings.json` goes through the journal so `revert` can undo it key-by-key.
6. **No network, no telemetry, no binaries.**

## Adding a patch for a new WorkBuddy build

```bash
# 1. find the current string in the installed bundle
node -e "const s=require('fs').readFileSync(process.argv[1],'utf8'); console.log(s.includes('YOUR CANDIDATE'))" \
  "<install>/resources/app.asar.unpacked/cli/dist/codebuddy-lite-wb.mjs"

# 2. add the entry
#    { id:'P12', layer:'engine', name:'SHORT_NAME', desc:'中文 / english',
#      file:'dist/codebuddy-lite-wb.mjs', find:'…', replace:'…/*[wbpurge:P12]*/', marker:'[wbpurge:P12]' }

# 3. prove it before touching anything
node bin/wb-purge.mjs apply --dry-run
node tests/patch-roundtrip.mjs
```

For a prompt/template patch, add a `jsonPatches()` entry keyed by the prompt `name` from
`product.json` — never by array index, the list order changes between builds.

## Tests

```bash
npm test              # contract + mods harness (host-independent, CI-safe)
npm run test:loader   # replays the mods loader preconditions on installed copies
npm run test:patches  # hit counts, idempotency, node --check, conflict detection
npm run test:all
```

`test:patches` needs a real WorkBuddy install and is skipped in CI; it reads the pristine copy
(`.wbpurge.bak` when present), so it works whether or not the purge is currently applied.

## Style

- Runtime (mods) code runs in an isolated realm: **no** `import`, no `require`, no `process`.
  Reach the host only through the `$` surface.
- `bin/` and `lib/` are plain ESM, Node ≥ 18.20, zero dependencies.
- PowerShell scripts must run on both Windows PowerShell 5.1 and PowerShell 7+.
- Keep comments about *why*, not *what*.

## Reporting a broken build

Open an issue with:

```
WorkBuddy version      (Help → About, or the `installChannel` block)
CLI bundle version     node <install>/…/dist/codebuddy-lite-wb.mjs --version
node bin/wb-purge.mjs status --json
node bin/wb-purge.mjs apply --dry-run --json
```

The `conflict` rows carry the patch id and the reason; that is usually enough to write a new entry.
