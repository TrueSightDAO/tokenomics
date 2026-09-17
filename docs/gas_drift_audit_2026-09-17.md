# GAS drift audit — local (git) vs live (Apps Script) — 2026-09-17

**Trigger.** Gary (thread 31220): *"do an analysis of all the GAS projects to ensure that the local
files and the remote files are exactly the same"*, in response to the clobbering risk between the
tokenomics repo's `google_app_scripts/<scriptId>/` folders and the deployed Apps Script projects.
Also: **the DAO no longer uses WIX as a system** — dispositions below take that into account.

## Why drift is dangerous (the mechanism)

`clasp push --force` makes the **local folder authoritative**: it *deletes* any live file that has no
local counterpart. So a project edited in the Apps Script editor and never committed is silently
clobbered by the next push from a clean checkout. `scripts/deploy_gas_project.py` documents
"the files in the folder ARE what gets deployed" — which is exactly why the gap must be measured,
not assumed. (Same failure class as `50999ec` (2026-06-16), which rewrote the repo to match the
then-deployed script and dropped the PR-merged per-key emitter — see OPEN_FOLLOWUPS.)

## Method (read-only, reproducible)

`scripts/audit_gas_drift.py` (added in this PR). For each folder with a `.clasp.json`:
`clasp pull` into a temp dir and byte-compare against `git show HEAD:<path>`; never writes to GAS.
`Version.js`/`Version.gs` are ignored (clasp auto-injects them — not authored source).

## Result — 51 projects

| Class | Count | Meaning |
|---|---|---|
| `IN_SYNC` | 8 | live == git |
| `DRIFT_CODE` | 4 | file in both, **differs** → unsafe to push |
| `DRIFT_CODE+LIVE_ONLY` | 3 | drift **and** a live file git lacks |
| `LIVE_ONLY+SECRETS` | 7 | live-only `Credentials.js` (gitignored — see blocker) |
| `LIVE_ONLY_CODE` | 25 | mostly benign `Version.js`-only; 2 are real renames |
| `UNREACHABLE` | 4 | scriptId returns "Requested entity was not found" |

**20 projects need migration** (excluding the 21 that differ only by injected `Version.js`).

### Tier 1 — real code drift (a `clasp push` would clobber it)

Live is newer than git in every case; the fix direction is **live → git** (adopt), which is
reversible and reviewable and never auto-pushes to GAS.

| scriptId | Project | Drifted file | Changed lines |
|---|---|---|---|
| `1Dj3-m_ejx…` | capoeira/practice event processing (truesight_me programs) | `practice_event_processing.js` | **144** |
| `1Dj3-m_ejx…` | ″ | `program_admin_endpoint.js` | 5 |
| `1m8IZPs1vF…` | `tdg_identity_management` — Edgar email verification | `DaoMembersCache.js` | **67** |
| `1QtK-InsHH…` | `tdg_inventory_management/web_app` | `web_app.js` | 68 |
| `1NpHrKJW8Q…` | `market_research/find_nearby_stores` | `Code.js` | 11 |
| `1XIz0hs7lH…` | `newsletter_subscriber_sync` | `Code.js` | 10 |
| `1MnAsIQAxc…` | `agroverse_qr_codes/process_donation_mint` | `qr_code_web_service.js` | 6 |
| `1UrBgqLnnQ…` | `agroverse_qr_codes/process_qr_code_updates` | `process_qr_code_updates.js` | 1 |

Highlights: `1Dj3` adds a **live-only capoeira old-format payload fallback** plus a
`reprocessFailedCapoeiraRows` admin action — none of it in git. `1m8IZPs1` live is
`DaoMembersCache.js` **schema v4** (adds `discord_id`/`telegram_id`/`telegram_handle`), repo is **v3**.

### Tier 2 — live-only code a push would DELETE

| scriptId | Project | Live-only | Git-only | Disposition |
|---|---|---|---|---|
| `1_jTHZZI033…` | oracle advisory bridge | `oracle_advisory_bridge.js` | `Code.js` | live→git (rename; contents differ) |
| `1o2lzpdTZ…` | (inventory) | `Code.js` | `Code.gs` | content-identical; normalize to `.js` |
| `14gKJ0VW49…` | holistic hit-list store history | 5× `*.js` | 5× `*.gs` (identical) | normalize to `.js` |
| `1UrBgqLnnQ…` | agroverse qr codes | 4× `*.js` | 4× `*.gs` (identical) | normalize to `.js` |
| 21 others | — | `Version.js` only | — | benign (clasp-injected) |

`.gs` vs `.js` was verified **content-identical** in every case → cosmetic, not drift.

### Tier 3 — security (secrets in source)

**Tracked in `origin/main` (must scrub):**

| Location | Secret | Note |
|---|---|---|
| `1zAXSdLe…/Code.js:1` | Wix access token `IST.…` (fp `2aaefd55359b`) | project **UNREACHABLE** — Latoken→Wix rate sync |
| `1E6XFs1X7…/Code.js:3` | same Wix token (fp `2aaefd55359b`) | marked `// DEPRECATED`; project UNREACHABLE |
| `1XmwyzzauOoL…/Code.js:3` | **Telegram bot token** fallback `creds.TELEGRAM_API_TOKEN || '<token>'` (fp `8facd7a349`) | **distinct, real-looking** — remove fallback |
| 4 files: `1BHAGZd…`, `1dsWec…`, `1duQFf…`, `1wmgYPw…` | token-shaped string in an `// - Example: "<token>"` comment (all fp `4f1992a884`) | identical ⇒ likely a pasted doc example; verify |

**Live-only, gitignored (no git exposure; retire with Wix):** `1_3D4o2RdHdP…`, `1wONDeDwZ_fX…`,
`1y6JVYwqdrFD…` each hold a `WIX_API_KEY` in `Credentials.js`.

### Tier 4 — unreachable projectIds (folders to remove)

`10NKp8uLMGyf…`, `1E6XFs1X7GMq…`, `1IBrXqW_uTsF…`, `1zAXSdLe_vig…` — all return
"Requested entity was not found" (deleted projects whose folders still ship source, one with the Wix token).

### Tier 5 — the `.gitignore` blocker (root cause of the drift being invisible)

`.gitignore` L25 blocks `google_app_scripts/**/Credentials.js`, un-ignored only for `1dsWec…`.
So the secret-free pointer file **cannot be tracked** for the other 48 projects ⇒ their live-only
`Credentials.js` copies can never be mirrored ⇒ those projects can never be "identical".
Convention already exists: `docs/GAS_SCRIPT_PROPERTIES.md` §1 (secrets in Script Properties;
commit a `REPLACE_ME` seeder). `1Jp8qNIBCZ…` and `1dsWec…` are already compliant.

### WIX retirement sweep

15 project folders reference Wix. With Wix retired, dispositions become **retire/repurpose**:
`agroverse_wix_site_updates.js`, `tdg_wix_dashboard.js` (×3 projects, already renamed
"Performance Statistics" — Wix label stale), `populate_wix_event.gs`, `agroverse_shop_checkout.js`,
`stripe_sales_sync.js`, `qr_code_web_service.js`, plus the 2 token-bearing `Code.js`.

## Recommended migration order

1. **Tier 3a** — scrub the tracked Telegram token fallback + the Wix tokens (rotate first).
2. **Tier 1** — adopt live→git for the 7 drift files (highest: `1Dj3` 144 lines, `1m8IZPs1` 67).
3. **Tier 5** — un-ignore + add secret-free `Credentials.js` pointers (unblocks org-wide mirroring).
4. **Tier 2** — normalize `.gs`→`.js`, adopt the `1_jTHZZI` rename.
5. **Tier 4** — delete dead folders; **Wix sweep** — retire the remaining Wix code.
6. Add `audit_gas_drift.py` to CI so drift can never re-accumulate silently.
