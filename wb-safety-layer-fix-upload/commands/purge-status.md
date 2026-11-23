---
description: Show the wb-purge patch state (prompt / code / engine layers) for the installed WorkBuddy
argument-hint: "(no arguments)"
---

<user_input>
$ARGUMENTS
</user_input>

---

Report the live purge state. Do not write anything in this command.

1. Resolve the plugin root (first that exists):
   - `%USERPROFILE%\.workbuddy\plugins\cache\wb-local\wb-safety-layer-fix\<ver>`
   - `%USERPROFILE%\.workbuddy\plugins\marketplaces\wb-local\plugins\wb-safety-layer-fix`
   - the `installPath` of `wb-safety-layer-fix@wb-local` in `%USERPROFILE%\.workbuddy\plugins\installed_plugins.json`

2. Run: `node "<plugin root>\bin\wb-purge.mjs" status`

3. Also run: `node "<plugin root>\bin\wb-purge.mjs" verify`

4. Report:
   - CLI root and plugin root
   - a compact table of patch id / layer / state (applied · pending · conflict · missing)
   - the verify result lines (JSON parses, node --check, coverage, --version)
   - one line on what an unapplied layer means:
     * prompt pending → system prompt still carries the stock templates
     * code pending → sandbox/approval/skill-scan defaults still stock
     * engine pending → in-process review gates still active
     * settings pending → `permissions.defaultMode` / `disableAutoMode` not set
   - the toggle: `{"enabled": false}` in `config.json`, or `WB_SAFETY_LAYER_FIX=off`

Keep it under 25 lines. No code fences around the table.
