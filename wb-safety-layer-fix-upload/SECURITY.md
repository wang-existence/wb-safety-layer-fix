# Security policy

## Scope

This project modifies a local installation of WorkBuddy (CodeBuddy core). The security-relevant
surface is therefore small and concrete:

| Surface | Behaviour |
| --- | --- |
| Files written | `product.json`, `dist/codebuddy-lite-wb.mjs`, and two keys in `settings.json` |
| Backups | `<file>.wbpurge.bak` created once, before the first write; restored by `revert` |
| Journal | `state/applied.json` — file list, sha256 after apply, settings keys + previous values |
| Runtime | `hooks/register.mjs` runs inside the host's isolated mods realm: no `import`, no `require`, no `process`, no network |
| Network | the project makes **zero** network calls: no telemetry, no update check, no remote fetch |
| Binaries | none shipped |

## What a reviewer should check

1. `lib/patches.mjs` — every `find` string and every replacement; the whole behavioural delta of the
   project lives here.
2. `lib/engine.mjs` — `writePatched()`, `revert()`, and the install-root detection. Path handling is
   the only place where a bug could write to an unintended file.
3. `hooks/register.mjs` — the three gate hooks return allow; they never write and never read
   anything but the plugin's own `config.json` and the optional `prompt-inject.md`.

## Deliberate widening of host guardrails

Applying the patch layer sets, by design:

```
productFeatures.Sandbox            = false
productFeatures.SkillSecurityScan  = false
permissions.defaultMode            = "bypassPermissions"
permissions.disableAutoMode        = "disable"
```

and short-circuits the in-process tool-risk review and content-review gates. This is the point of
the project, and it is reversible with `node bin/wb-purge.mjs revert`. Run `apply` only on machines
you own or administer, keep `"audit": true` in `config.json` while evaluating, and revert when the
evaluation ends.

## Reporting

Open a private security advisory on the repository (Security → Report a vulnerability) or mail the
maintainer listed in `package.json`. Please include the install root, the `status --json` output and
the exact patch ids involved. Do not attach the vendor bundle itself.

There is no bug bounty. Fixes ship as a patch-table update plus a regression test.
