# DEPRECATED — 2026-11-10

`TDG - update balance in wallets on Ledger`

---

## ⚠ STATUS UPDATE — 2026-11-21: STILL FIRING, ROOT CAUSE IDENTIFIED

**This project is deprecated in the repo but its trigger is still live and still
emailing a failure every day at 00:16 PST.**

Inbox check (25 messages, one per ~day) — most recent
`Sat, 21 Nov 2026 00:16:42 -0800` = **2026-11-21 08:16 UTC**, roughly 11 days after
the deprecation merged. Deprecation stopped deploys; it did not stop the trigger.

### The error changed after #623 — the credential fix worked

| Period | Error |
|---|---|
| Before #623 | `ReferenceError: getCredentials is not defined` |
| After #623 | `Exception: Address unavailable: https://side-clean-replica.solana-mainnet.quiknode.pro//` |

So `Credentials.js` is now present and loading. The fault simply moved to the next
layer — which is why the failure persisted after the earlier fix looked successful.

### Root cause: the QuickNode API key resolves to empty

The failing URL ends in `//`, i.e. the key segment expanded to nothing:

```js
var SOLANA_API_KEY = creds.QUICKNODE_API_KEY;
var SOLANA_RPC_URL = "https://side-clean-replica.solana-mainnet.quiknode.pro/" + SOLANA_API_KEY + "/";
```

`Credentials.js` seeds only a placeholder, and only when the property is unset:

```js
QUICKNODE_API_KEY: 'REPLACE_ME',
...
if (!props.getProperty(k)) { props.setProperty(k, seed[k]); }
```

So either the Script Property was never set on this project, or it holds the literal
string `REPLACE_ME`. Either way the host is unroutable and every run throws.

**Cleared, not the cause:** the same QuickNode host is referenced by `1ZQjgSZvAXL2PB`,
`1rLl94jQ9tDYdR` and `177OJC0tVytZfS`, none of which have a `Credentials.js` in the
repo at all. A host-wide outage or a shared-credential break therefore **cannot** be
inferred from this project's error alone — do not conclude the other three are broken
without checking their own triggers and properties.

This is consistent with the original deprecation rationale: with column **D**
(Solana wallet addresses) empty on every row, the lookup could never have succeeded,
so the script was doomed whether or not the key was set.

- scriptId `1QKqUTyl3_pyDHfVMoRUkzvU75eV6UtizIw5bR5xeDMaLyZGUPzWTz8Et`
- owner `garyjob@agroverse.shop`
- Deprecated by decision of Gov. Gary Teh: *"I think deprecate this"*.

## What it did

`tdg_wallet_balance_check.js` (109 lines, 3 functions) queried Solana RPC for each
contributor's TDG token balance and wrote the result into the sheet
**`Contributors voting weight`**, column **F** (*"Total TDG in registered wallet"*).

| Function | Role |
|---|---|
| `getTdgWalletBalance(walletAddress)` | `UrlFetchApp.fetch(SOLANA_RPC_URL)` — single-wallet lookup |
| `updateTdgWalletBalancesFromSheet()` | iterates the sheet, `targetCell.setValue(bal)` |
| `testGetTdgBalance()` | manual test helper |

## Why it was deprecated

**It had stopped producing anything, and failed on every scheduled run.**

Live sheet read 2026-11-10, rows 4-12:

| Col | Meaning | Observed |
|-----|---------|----------|
| D | Solana Wallet Address | **empty on every row** |
| F | Total TDG in registered wallet (written by this script) | **empty on every row** |
| I | Total TDG controlled | populated (@elvisyong 750, @hawkenzo1 250, ...) |

With no wallet addresses in column D there was nothing to look up, so the refresh was
a no-op. Meanwhile the trigger raised `ReferenceError: getCredentials is not defined`
and emailed a failure summary each time — pure noise.

**Voting weight is unaffected.** Column I, which consumers actually read, is populated
by a different path. The two other projects touching this sheet only *read* it:

- `1m8IZPs1` `DaoMembersCache.js` — `C = name, I = total TDG`
- `1rLl94jQ9t` `web_app.js` — `VOTING_SHEET_NAME`, totals only

Neither calls Solana RPC.

> Honest caveat: column **F** has no other producer in the repo. If a live
> TDG-in-wallet figure is wanted again it must be re-implemented — it is not merely
> dormant behind this trigger.

## How deprecation was implemented

`.clasp.json` was **deleted**. `scripts/deploy_gas_project.py` enumerates projects as
*"folders under `google_app_scripts/` that have a `.clasp.json`"*, so the project is no
longer in the deploy set and cannot be pushed by tooling again.

The source file is **kept** for history and rollback.

## Still to do — not achievable from the repo (CONFIRMED STILL OUTSTANDING 2026-11-21)

**Failure emails continue until the trigger is deleted on Google's side.** Removing
`.clasp.json` stops deploys; it does not touch the Apps Script trigger. GitHub cannot
delete a GAS trigger, and the Scripts API v1 has no `script.triggers` endpoint — the
credential available exposes `script.projects` only. A human must act in the UI.

### Exact click-path (owner `garyjob@agroverse.shop`)

1. Open the project:
   `https://script.google.com/home/projects/1QKqUTyl3_pyDHfVMoRUkzvU75eV6UtizIw5bR5xeDMaLyZGUPzWTz8Et/edit`
   (must be signed in as **garyjob@agroverse.shop** — Sophia's credentials are not the owner)
2. Left sidebar → **Triggers** (clock icon).
3. Find the `time-based` trigger calling **`getTdgWalletBalance`**, running **daily ~00:16**.
4. Right-click the row → **Delete trigger**. (Or three-dot menu → *Delete trigger*.)
5. Confirm the list no longer contains it. Emails stop after the next scheduled window; the
   last one may already be batched — allow one day.

Alternative: **delete the whole project** (three-dot menu → *Remove*). Safe once the source
is preserved here in the repo, which it is.

Verify afterwards: no failure email for this script dated later than the deletion day.

## To revive

1. Restore `.clasp.json` (`git log --follow -- .clasp.json`).
2. Populate column **D** with Solana wallet addresses — without them the script is a no-op.
3. `scripts/deploy_gas_project.py 1QKqUTyl3_pyDHfVMoRUkzvU75eV6UtizIw5bR5xeDMaLyZGUPzWTz8Et --push`

## Note on an earlier misdiagnosis

While investigating this project I twice reported the scriptId as ending `pyDHFVMo`
(capital `F`). The real ID is `pyDHfVMo` (lowercase `f`, position 14). The wrong ID
produced `HTTP 400 INVALID_ARGUMENT` from the Scripts API and a `cd: No such file or
directory` from the shell, which I mistakenly attributed to a deleted project and to a
`*/30` cron resetting the worktree. Neither was true. With the correct ID the remote
reads **200** and holds `Credentials` at sha `a3fc8e1f750b18f6`, byte-identical to local.
