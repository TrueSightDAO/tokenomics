# Agroverse QR codes — the `ledger` column (col C) contract

**Status:** guard shipped 2026-11-27 · **JIRA:** KAN-100 · **Epic:** KAN-98

## The column contract

`Agroverse QR codes` (spreadsheet `1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU`,
tab `Agroverse QR codes`) has three adjacent URL-ish columns that are easy to
conflate:

| Col | Header | Meaning |
|---|---|---|
| **A** | `qr_code` | the QR identifier, e.g. `2025_20261025_41` |
| **B** | `landing_page` | customer-facing page for the item (may be a **farm page**) |
| **C** | `ledger` | **must** be a shipment ledger URL that exists in `Shipment Ledger Listing` col L |
| **D** | `status` | `MINTED` / `SOLD` / … |

**B and C are not the same value.** A farm page is a perfectly valid
landing page and a completely invalid ledger.

## The defect (fixed)

`process_qr_code_generation_telegram_logs.js` read the correct ledger from the
`Currencies` tab (col F) and then threw it away at every write site:

```js
currencyData.landing_page, // Column B: Landing page
currencyData.landing_page, // Column C: Ledger     <-- wrong source
```

So col C was *always* a copy of col B. It looked correct only for currencies
whose landing page happened to be the ledger URL (e.g. `…/shipments/agl4`),
and looked correct-by-accident often enough to hide the bug.

### Blast radius

Swept all **1,232 MINTED** rows against the **17** valid ids in
`Shipment Ledger Listing` col L (`AGL1`, `AGL2`, `AGL3`, `AGL4`, `AGL5`,
`AGL6`, `AGL7`, `AGL8`, `AGL10`, `AGL13`, `AGL14`, `AGL15`, `BEC`, `EDIT`,
`MAIN`, `PP1`, `SEF1`): **27** bad rows in three buckets.

| Count | Rows | Bad col C | Resolution |
|---|---|---|---|
| 21 | `2024_20260622_1…_21` | `https://agroverse.shop/farms/oscar-bahia/index.html` | **repaired** → `…/shipments/agl4` (adjacent `_22` already read `shipments/agl4`) |
| 1 | `2024_20260913_1` | `https://truesight.me/shop/test` | **deleted** (Sophia's own test row) |
| 5 | `2025BF_20250521_PROPANE_1…_5` | `https://agroverse.shop/agl9` | **left untouched** — `AGL9` is absent from the ledger listing. These are PROPANE (Beer Hall fuel), not cacao. Needs a governor decision on whether AGL9 is a real ledger that was never registered. |

## The guard

Before writing any QR row, `createQRCodeRecordsInAgroverse()` validates
`currencyData.ledger` via `validateLedgerUrl_()` against the id set from
`loadValidLedgerIdsFromShipmentLedger_()`.

A bad ledger now **throws** with an actionable message instead of minting
1..N corrupt rows:

> Refusing to mint "<currency>": Currencies col F (ledger) is invalid - "<url>"
> resolves to ledger "<id>", which is not listed in Shipment Ledger Listing col L.
> Point that Currencies row at a ledger listed in Shipment Ledger Listing col L
> before generating QR codes.

`handleRegisterSingleQRCode()` accepts optional `params.ledger` (validated), else
resolves the ledger from the `Currencies` row for `params.currency`, and returns
HTTP 400 when neither yields a valid ledger. It no longer copies `landingPage`
into col C.

### Deliberate fail-open

The guard fails open **only** when the `Shipment Ledger Listing` tab itself
cannot be read (logs a warning, returns `null` => validation skipped). Blocking
every QR mint because a reference tab is missing would be a worse failure than
the defect being guarded. Every other case — blank, unparseable, or
not-in-col-L — is a hard refusal.

## Rules for future changes

1. **Never** derive col C from col B. Read the ledger from `Currencies` col F or
   from an explicit validated parameter.
2. Adding a QR write path? Route it through `validateLedgerUrl_()`.
3. Minting a currency whose landing page is a farm page without setting a
   ledger will now **fail loudly**. That is the intended behaviour — fix the
   `Currencies` row (col F), do not relax the guard.

## Not fixed by this change

- **`AGL9` rows** (5) — pending a decision on whether to register AGL9.
- **Missing `offchain transactions` legs on existing sales.** A 5-bar cash sale
  on 2026-11-27 produced no inventory/USD/SunMint ledger rows. Those 5 QR rows
  already had *valid* ledger URLs, so the col-C defect was **not** the cause —
  it is a separate dispatch defect (`SALES_PROCESSING → SALES_AGL4 /
  SALES_NON_AGL4`). Tracked separately under KAN-98.
