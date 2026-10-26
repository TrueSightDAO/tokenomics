# Deployment notes — "TDG - Process Inventory Movements"

Live Apps Script project (scriptId `1wONDeDwZ_fXNapDKpstWrBION3aV3r7NXwq7PCdqbW1LvI5ceaykQNbR`):
- Hourly time-based trigger: `processTelegramChatLogs`
- Webhook: `AKfycbzECOd1Y3mH7L0zU8hOC4AxQctYICX0Ws8j2-Md1dWg0k3GFGQx_4Cf7n-CM0usmSJ1/exec` (versioned deployment)
- Editor: https://script.google.com/home/projects/<scriptId>

## CRITICAL — Credentials.js is gitignored

`Credentials.js` (real keys) is excluded by the repo `.gitignore`
(`google_app_scripts/**/Credentials.js`). It exists only on the live project and in
local deploy folders.

**Before every `clasp push`: copy `Credentials.sample.js` → `Credentials.js` in the
folder you push from.** `clasp push --force` mirrors the folder onto the project —
if `Credentials.js` is absent it is **deleted from the live project**, and the next
trigger run fails with `ReferenceError: setApiKeys is not defined` (top-of-file
`setApiKeys();`). This exact failure hit production 2026-08-24 (see PR #426).

## Version.gs vs Version.js

Live project file is `Version.js` (provides `getClaspMirrorDeployInfo()`). Do NOT add
`Version.gs` — two files defining the same function = duplicate-identifier SyntaxError
(same failure class as the `creds` duplicate).

## Post-push verification checklist

1. `clasp pull` into a scratch dir → expect exactly: `appsscript.json`, `Credentials.js`,
   `process_movement_telegram_logs.js`, `Version.js` (no `Code.js`).
2. GET the webhook URL → expect the "No valid action specified" info message (HTTP 200).
3. Check Gmail for "TDG - Process Inventory Movements" failure emails on the next :35 hourly run.
4. Optionally run `scripts/e2e_inventory_movement_test.py` (truesight_autopilot) to prove a
   movement reaches PROCESSED end-to-end.
