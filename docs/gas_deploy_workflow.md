# GAS deploy workflow

_Companion to [`scripts/deploy_gas_project.py`](../scripts/deploy_gas_project.py) (PR-final-1)._

The manifest-driven, one-command deploy for a single Google Apps Script project.

## TL;DR

```bash
# See every known scriptId
scripts/deploy_gas_project.py --list

# Dry-run (default) — shows what would happen, changes nothing
scripts/deploy_gas_project.py <scriptId>

# Actually push the source into the GAS project
scripts/deploy_gas_project.py <scriptId> --push

# Push AND fire every operator-promoted post_push_hooks entry
scripts/deploy_gas_project.py <scriptId> --push --with-hooks
```

## What it does, end to end

1. **Pools every source file across every thematic folder that references
   the scriptId.** Some scriptIds appear in more than one folder (e.g.
   `19Wag9x…` lives in both `tdg_asset_management/` and `webhooks/`). The
   deploy unit is the scriptId, not the thematic folder; the script reads
   each `google_app_scripts/<theme>/manifest.json` and collects every
   project block whose `scriptId` matches.
2. **Syncs source `.gs` files into `clasp_mirrors/<scriptId>/`.** Copies
   only changed files; removes any stale `.gs` in the mirror that no
   manifest claims. Leaves `Version.gs` / `appsscript.json` /
   `Credentials.js` / `Code.js` alone.
3. **`clasp push --force`** from the mirror.
4. **For each `post_push_hooks[]` entry**, fires the URL with the
   manifest-declared method + body. `$ENV_VAR` placeholders in body values
   are resolved from the local environment.

## Identity pinning (owner_email vs active clasp account)

Each manifest project block carries an `owner_email` field (PR-1d) that
specifies *which Google account this scriptId is supposed to deploy as.*
The deploy script enforces it:

- Before any push, it resolves the **active clasp identity** by
  exchanging `~/.clasprc.json`'s refresh token for an access token, then
  calling `oauth2/v3/userinfo`.
- If the active identity doesn't equal `owner_email`, the script
  **refuses to push** with a clear "switch accounts" message.
- Override only when intentional: `--allow-identity-mismatch`.

This is the mistake-proofing for the `1zKgMwd6…` class of constraint:
the Gmail digital-signature ingestion project must always deploy as
admin@truesight.me, never as the daily-driver gary@. Even if a tired
operator runs `deploy_gas_project.py 1zKgMwd6…` from the wrong shell at
1am, the push won't go through.

### Switching clasp identity (one-time per session)

```bash
clasp logout
clasp login   # sign in as the right Google account in the browser flow
```

### Multiple clasp identities (recommended if you deploy across accounts)

Store one credentials file per account:

```bash
# As gary@agroverse.shop:
clasp login
cp ~/.clasprc.json ~/.clasprc-gary.json

# As admin@truesight.me:
clasp logout && clasp login   # sign in as admin@
cp ~/.clasprc.json ~/.clasprc-admin.json
```

Then point clasp at the right one per deploy:

```bash
# Deploy a gary@ project:
CLASPRC_PATH=~/.clasprc-gary.json scripts/deploy_gas_project.py <scriptId> --push

# Deploy an admin@ project:
CLASPRC_PATH=~/.clasprc-admin.json scripts/deploy_gas_project.py <scriptId> --push
```

The `CLASPRC_PATH` env var changes which file the deploy script reads
for identity resolution. **It does not currently change which file
`clasp` itself reads** — clasp still looks at `~/.clasprc.json`. So
the per-account-clasprc workflow is: copy the right `~/.clasprc-<account>.json`
to `~/.clasprc.json` before invoking the deploy script. (A future PR
could automate the swap; out of scope for this one.)

## Safety

- **Dry-run by default.** Re-run with `--push` to actually do anything.
- **Hooks don't fire unless you pass `--with-hooks`.** First-time deploys
  for a project should run `--push` alone, confirm the GAS project
  updated correctly, then re-run `--push --with-hooks` for the cache
  refresh.
- **Refuses to push when source files have uncommitted git changes.**
  Pass `--force-uncommitted` to override (don't).
- **Skips firing `candidate_cache_refresh_hooks[]`.** Those are operator
  triage candidates from [PR-1c](gas_cache_refresh_hook_audit.md), not
  promoted hooks. Promotion is a one-line edit to the manifest (move the
  entry from `candidate_cache_refresh_hooks` to `post_push_hooks` and
  add the real URL/method/body).
- **Refuses to push when the mirror is missing.** Mint via
  `mkdir -p clasp_mirrors/<scriptId> && cd $_ && clasp clone <scriptId> --rootDir .`
  first.

## Operator promotion path for cache-refresh hooks

Today, every `candidate_cache_refresh_hooks` entry in every manifest is a
discovery from [`scripts/crawl_gas_cache_refresh_hooks.py`](../scripts/crawl_gas_cache_refresh_hooks.py)
(PR-1c). They are NOT auto-fired on push.

When you want to promote one to a real hook:

1. Open `google_app_scripts/<theme>/manifest.json`.
2. Find the project block for the scriptId.
3. Copy the entry from `candidate_cache_refresh_hooks` and add a new
   block under `post_push_hooks[]` with full `url`, `method`, `body`,
   and a human-readable `label`:
   ```json
   {
     "label": "refresh dao_members cache",
     "url": "https://script.google.com/macros/s/AKfyc.../exec",
     "method": "POST",
     "body": {
       "action": "refresh_dao_members_cache",
       "secret": "$DAO_MEMBERS_CACHE_SECRET",
       "force": true
     }
   }
   ```
4. Optionally leave the `candidate_cache_refresh_hooks` entry in place as
   a discovery breadcrumb — the deploy script doesn't fire candidates so
   it's harmless.
5. Run `scripts/deploy_gas_project.py <scriptId> --push --with-hooks` for
   the first real-world test.

## When you'd use this vs `clasp_mirrors/.../clasp push` directly

Direct `cd clasp_mirrors/<scriptId> && clasp push` works fine if you've
already manually synced source files. But you have to remember which
`.gs` files belong in this mirror (the manifest tells you — but only if
you read it) and you have to remember every cache to refresh
afterwards. The deploy script does both for you.

## Future

- **PR-2…PR-N** restructures each multi-scriptId thematic folder into
  one folder per scriptId. After that lands, the deploy script could
  accept a folder path instead of a scriptId — but the underlying logic
  doesn't change.
- **PR-final-2** wraps this script as a `gas_deploy_project` tool in
  the `truesight_autopilot` capability manifest, so Telegram
  message → GAS deploy + cache refresh end-to-end.
