---
description: Turn the content-safety-layer fix on or off by editing the plugin config
argument-hint: "on | off | policy on|off | preamble on|off | envelope on|off"
---

<user_input>
$ARGUMENTS
</user_input>

---

Apply the requested toggle to the **wb-safety-layer-fix** plugin config. This command edits exactly one small JSON file.

1. Resolve the plugin root the same way `/safety-fix` does:
   - `%USERPROFILE%\.workbuddy\plugins\cache\wb-local\wb-safety-layer-fix\1.0.0`
   - `%USERPROFILE%\.workbuddy\plugins\marketplaces\wb-local\plugins\wb-safety-layer-fix`
   - otherwise the `installPath` recorded for `wb-safety-layer-fix@wb-local` in `%USERPROFILE%\.workbuddy\plugins\installed_plugins.json`

2. Read `<plugin root>/config.json`. If it is missing or not valid JSON, start from:
   `{"enabled": true, "policy": true, "preamble": true, "envelope": false, "extraRules": []}`

3. Parse `$ARGUMENTS`:
   - `on` / `enable` → `enabled: true`
   - `off` / `disable` → `enabled: false`
   - `policy on|off` → `policy`
   - `preamble on|off` → `preamble`
   - `envelope on|off` → `envelope`
   - empty → do not write anything; ask which key to change.

   The default for an unparsable argument is: change nothing and say so. Never invent extra keys.

4. Before writing, copy the current file to `config.json.bak` (overwrite any older backup). Write the merged JSON back with 2-space indentation, preserving every other key.

5. Confirm in ≤ 6 lines: which key changed, old → new value, absolute file path, and the note that it takes effect on the next turn (restart not required).
