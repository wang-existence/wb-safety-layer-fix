---
description: Report whether the content-safety-layer fix (wb-safety-layer-fix) is active, and show the injected rule set
argument-hint: "(no arguments)"
---

<user_input>
$ARGUMENTS
</user_input>

---

Report the live status of the **wb-safety-layer-fix** plugin. Do not change anything in this command.

1. Locate the plugin root. Try these paths in order and use the first that exists:
   - `%USERPROFILE%\.workbuddy\plugins\cache\wb-local\wb-safety-layer-fix\1.0.0`
   - `%USERPROFILE%\.workbuddy\plugins\marketplaces\wb-local\plugins\wb-safety-layer-fix`
   If the app resolved the plugin from another path, read `installPath` for `wb-safety-layer-fix@wb-local` in `%USERPROFILE%\.workbuddy\plugins\installed_plugins.json` and use that.

2. Read `<plugin root>/config.json` and `<plugin root>/hooks/hooks.json`.

3. Confirm the environment kill switch: report the value of `WB_SAFETY_LAYER_FIX` (unset is normal).

4. Output a compact table:

```
plugin         wb-safety-layer-fix v1.0.0
root           <path>
enabled        true|false          (config.json)
policy block   on|off              (prompt.context)
preamble       on|off              (prompt.submit)
envelope       on|off              (config.json)
extra rules    <n>
kill switch    <env value or "unset">
hooks          prompt.context, prompt.section, prompt.submit, session.start
```

5. Then one short paragraph: what the fix does on the next turn, and the two ways to turn it off (`{"enabled": false}` in `config.json`, or `WB_SAFETY_LAYER_FIX=off`).

Keep the whole reply under 20 lines. No code fences around the table if plain text reads fine.
