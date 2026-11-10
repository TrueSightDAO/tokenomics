# DEPRECATED — 2026-11-10

`TDG - update balance in wallets on Ledger`

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

## Still to do — not achievable from the repo

**Failure emails continue until the trigger is deleted on Google's side.** Removing
`.clasp.json` stops deploys; it does not touch the Apps Script trigger.

- Delete the trigger in the GAS UI → *Triggers* panel, or delete the project.
- The Scripts API exposes no trigger-deletion endpoint on the credentials available here.

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
