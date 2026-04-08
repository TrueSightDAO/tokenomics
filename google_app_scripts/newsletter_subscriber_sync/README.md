# Newsletter subscriber sync (Agroverse News Letter Subscribers)

Apps Script that appends rows to the ledger tab **Agroverse News Letter Subscribers** from:

| Source | Spreadsheet | Tab | Rule |
|--------|-------------|-----|------|
| Email suggestions | Holistic hit list `1eiqZr3LW-qEI6Hmy0Vrur_8flbRwxwA7jXVrbUnHbvc` | `Email Agent Suggestions` | Uses `to_email` (fallback: `To`, `Email`) |
| QR owners | Ledger `1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU` | `Agroverse QR codes` | Uses `Owner Email` or other email headers; falls back to column L (index 11) |
| Partnered stores | Same holistic workbook | `Hit List` | **Only** rows where **Status** is exactly `Partnered` and **Email** is non-empty |

**Deduping:** `(normalized email) + (Source)`. Normalization is trim + lowercase for matching; the **Email** column keeps the original casing from the source where possible. The same address can appear multiple times if **Source** differs.

New rows get **Status** = `PENDING` (configurable in `newsletter_subscriber_sync.gs` via `DEFAULT_NEW_ROW_STATUS`). **Created Date** and **Imported Date** are set to the sync time when those columns exist.

Optional **Detail** column: if present, the script fills description (e.g. `shop: …`, `qr_code: …`).

**Legacy rows:** Rows with an **Email** but an empty **Source** are ignored for dedupe. After you add the **Source** column, either backfill **Source** for old rows or expect possible overlap between legacy rows and newly appended source-specific rows.

## Sheet setup

On **Agroverse News Letter Subscribers**, row 1 must include at least:

- `Email`
- `Source`

The script will add missing headers among: `Email`, `Source`, `Status`, `Created Date`, `Imported Date` when it can extend row 1 safely. You can add `Detail` manually if you want that field populated.

## Install

1. Open the ledger spreadsheet (or a standalone Apps Script project bound to an account that can read both spreadsheets).
2. **Extensions → Apps Script** (or [script.google.com](https://script.google.com)).
3. Copy `newsletter_subscriber_sync.gs` into the project (or keep this repo as source of truth and paste updates).
4. Save. Authorize when prompted (read/write spreadsheets you access).

## Deployed Apps Script project (this install)

Manage time-driven triggers and view runs from the Apps Script project:

- **Triggers (add / edit daily schedule):** [script.google.com/.../1XIz0hs7lH4DgjamUwQZeO4DwVTG8tqKjGElL9XB2StrkPXbHYeETOWBx/triggers](https://script.google.com/home/projects/1XIz0hs7lH4DgjamUwQZeO4DwVTG8tqKjGElL9XB2StrkPXbHYeETOWBx/triggers)
- **Editor (paste code updates):** [script.google.com/.../1XIz0hs7lH4DgjamUwQZeO4DwVTG8tqKjGElL9XB2StrkPXbHYeETOWBx/edit](https://script.google.com/home/projects/1XIz0hs7lH4DgjamUwQZeO4DwVTG8tqKjGElL9XB2StrkPXbHYeETOWBx/edit)

Sign in with the Google account that owns the project. For background on automations and triggers, see [Apps Script](https://developers.google.com/apps-script).

## Daily sync — which function to trigger

**Set your time-driven trigger on this function only:**

### `runDailyNewsletterSubscriberSync`

1. In the script editor: **Triggers** (clock icon) → **Add trigger**.
2. Function: **`runDailyNewsletterSubscriberSync`**
3. Event source: **Time-driven**
4. Type: **Day timer**, then pick an hour (and minute if offered).

That is the supported production entry point. `testRunNewsletterSubscriberSyncOnce` calls the same logic for manual runs from the editor.

## Manual run

In the editor, select **`runDailyNewsletterSubscriberSync`** or **`testRunNewsletterSubscriberSyncOnce`** and click **Run**. Check **Execution log** for the summary line.

## Constants

IDs and tab names are at the top of `newsletter_subscriber_sync.gs`. Override there (or later via Script Properties) if sheets move.

## Related

- [holistic_hit_list_store_history](../holistic_hit_list_store_history/) — DApp API for hit list + Email Agent Suggestions context
- [agroverse_qr_codes/process_qr_code_updates.gs](../agroverse_qr_codes/process_qr_code_updates.gs) — Owner Email on `Agroverse QR codes` is column L
