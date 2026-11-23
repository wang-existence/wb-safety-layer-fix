---
description: Apply the wb-purge patches to the installed WorkBuddy (prompt, code and engine layers)
argument-hint: "[--dry-run] [--force]"
---

<user_input>
$ARGUMENTS
</user_input>

---

Apply the purge. Do this in order and report each step.

1. Resolve the plugin root exactly as `/purge-status` does.

2. Dry run first — this performs every hit-count assertion without writing:
   `node "<plugin root>\bin\wb-purge.mjs" apply --dry-run`
   If any patch reports `conflict`, STOP and print the conflict ids plus their detail. A conflict means the installed WorkBuddy build moved that string; only continue with `--force` if the user explicitly asked for it.

3. Apply for real: `node "<plugin root>\bin\wb-purge.mjs" apply`
   Arguments supplied by the user (`$ARGUMENTS`) are forwarded verbatim.

4. Verify: `node "<plugin root>\bin\wb-purge.mjs" verify`
   Report the four checks. If `bundle syntax` or `bundle runs` fails, run `revert` immediately and report the failure instead of leaving a broken install.

5. Tell the user, in two lines: which files were written, and that WorkBuddy must be restarted so the desktop respawns the CLI with the patched bundle. Mention `revert` as the rollback and that `.wbpurge.bak` files sit next to each patched file.
