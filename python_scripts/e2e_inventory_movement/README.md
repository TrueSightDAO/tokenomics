# E2E regression test — [INVENTORY MOVEMENT] authorization + processing pipeline

**Repo/path:** `TrueSightDAO/tokenomics` → `python_scripts/e2e_inventory_movement/e2e_inventory_movement_regression.py`

**What it guards:** tokenomics **PR #364** ("Replace hardcoded TRUSTED_AGENTS with dynamic
sentinel role check in inventory movement auth") and the general class of gap where an
authorized agent's `[INVENTORY MOVEMENT]` submission falls through to `unauthorized` because
authorization only checked a raw Telegram-row stamp instead of a live role lookup.

## What it does (real pipeline, no mocking)

1. Signs a real `[INVENTORY MOVEMENT]` with Sophia Truesight's registered RSA keypair
   (from `/opt/truesight_autopilot/.env` — `PUBLIC_KEY` / `PRIVATE_KEY` / `EMAIL`).
2. POSTs the signed payload to Edgar (`https://edgar.truesight.me/dao/submit_contribution`).
3. Triggers the real GAS webhook (deployment URL + `?action=processTelegramChatLogs`,
   which runs Phase 1 → Inventory Movement sheet, then Phase 2 → ledgers).
4. Polls the **Inventory Movement** sheet (Ops spreadsheet `1qbZZhf-…`, sheet
   `Inventory Movement`) for the row whose col F contains the unique `E2E TEST CURRENCY`
   marker, and asserts **column N reaches `PROCESSED`** (the final post-Phase-2 state).
5. Fails loudly (exit 1) if the row comes back `unauthorized` or stays stuck at `NEW`
   until timeout; exit 2 on setup/API errors; exit 0 on PASS.

## Two modes

| Mode | Manager Name | Recipient Name | Authorizes via | Meaning |
|---|---|---|---|---|
| `--mode self-to-self` (default) | Sophia Truesight | Sophia Truesight | `authNamesMatch_` (signer == manager) | Full-pipeline smoke test. Passes on current deployed GAS **and** post-fix. No custody change (self-to-self). |
| `--mode sentinel-isolation` | Gary Teh | Sophia Truesight | `isSentinelByName_` (Contributors col W) + governor approval | **True regression check for #364.** Manager ≠ signer, so manager-match cannot authorize; signer is a Sentinel but not a Governor. **Red (unauthorized) on the currently-deployed GAS, goes green only after #364 deploys.** |

## Invocation (from the autopilot box, `~/tokenomics` checkout)

```bash
# Safe check — builds + prints the signed payload, submits nothing:
python3 python_scripts/e2e_inventory_movement/e2e_inventory_movement_regression.py --mode sentinel-isolation --dry-run

# Real run (submits + processes + asserts PROCESSED):
python3 python_scripts/e2e_inventory_movement/e2e_inventory_movement_regression.py --mode self-to-self
python3 python_scripts/e2e_inventory_movement/e2e_inventory_movement_regression.py --mode sentinel-isolation

# Optional overrides:
#   --env /path/to/.env              (signing keypair; default /opt/truesight_autopilot/.env)
#   --creds /path/to/sa_key.json     (sheet-read SA; default cypher_defense gdrive key)
#   --deploy-url <GAS /exec URL>     (default = current inventory-movement GAS deployment)
#   --edgar-url <edgar endpoint>     (default https://edgar.truesight.me/dao/submit_contribution)
#   --timeout 600                    (max seconds to wait for PROCESSED)
```

## Prerequisites on the run host

- `python3` with `cryptography`, `google-auth`, `google-api-python-client`, `requests`
  (verified present on the autopilot box).
- Sophia's signing keypair in the env file (`PUBLIC_KEY`, `PRIVATE_KEY`, `EMAIL`).
- A service-account key with **read** access to the Ops spreadsheet `1qbZZhf-…`
  (default: `cypher_defense_gdrive_key.json`).

## What the test leaves behind

- One `[INVENTORY MOVEMENT]` row in `Telegram Chat Logs` (col G) and one row in
  `Inventory Movement` (status PROCESSED on pass / unauthorized on pre-fix fail),
  identified by the unique `E2E TEST CURRENCY <mode> <utc-ts>` marker.
- Self-to-self mode: quantity 1 of a dedicated test currency, no real inventory touched.
- Sentinel-isolation mode: manager Gary Teh → recipient Sophia Truesight, quantity 1 of the
  dedicated test currency — a bookkeeping-only movement with a test currency, no real
  custody/value change.

## Re-run cadence

Run both modes whenever `process_movement_telegram_logs.js` (GAS project
`1wONDeDwZ_fXNapDKpstWrBION3aV3r7NXwq7PCdqbW1LvI5ceaykQNbR`) changes, and after any deploy.
`sentinel-isolation` is the one that catches the #364 regression; `self-to-self` is the
pipeline smoke test.
