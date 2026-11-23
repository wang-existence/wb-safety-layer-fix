---
description: Revert the wb-purge patches and restore every .wbpurge.bak file
argument-hint: "(no arguments)"
---

<user_input>
$ARGUMENTS
</user_input>

---

Roll the installation back to stock.

1. Resolve the plugin root as in `/purge-status`.

2. Run: `node "<plugin root>\bin\wb-purge.mjs" revert`
   It restores `product.json`, `dist/codebuddy-lite-wb.mjs` (and any other recorded file) from `<file>.wbpurge.bak`, deletes the backups, and removes only the settings keys this plugin set (`permissions.defaultMode`, `permissions.disableAutoMode`) — unrelated settings edits are preserved.

3. Run: `node "<plugin root>\bin\wb-purge.mjs" status --json` and confirm every layer reads `pending`.
   A `missing` row means the install moved; report it rather than guessing.

4. Report: files restored, settings keys removed, and that a WorkBuddy restart is required. Note that the plugin itself stays installed — `enabledPlugins` and the `wb-local` marketplace are untouched; only the file patches and settings overrides were rolled back.
