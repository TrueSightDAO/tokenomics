# Holistic wellness hit list — Store Interaction History API

Google Apps Script web app backing the **Store Interaction History** DApp page. It reads the spreadsheet
[20251104 - holistic wellness hit list](https://docs.google.com/spreadsheets/d/1eiqZr3LW-qEI6Hmy0Vrur_8flbRwxwA7jXVrbUnHbvc/edit) and returns:

- **Autocomplete** — `Shop Name` / `Store Key` matches from **Hit List**
- **Full context** — the **Hit List** row for the store plus every row from **DApp Remarks**, **Email Agent Follow Up**, and **Email Agent Suggestions** that matches `store_key`, `to_email` ↔ Hit List `Email`, or `shop_name`. Those three arrays are returned **newest-first** (by `created_at_utc`, `Date Sent`, etc., when available; otherwise sheet order is reversed).

## Setup

1. In Google Drive: **Extensions → Apps Script** on the spreadsheet, or create a standalone project and run as an account that can open the spreadsheet.
2. Paste `store_interaction_history_api.gs` into the project (replace default `Code.gs` or add as a file).
3. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** (for `truesight.me` static DApp to call it) — or **Anyone within org** if you only use an internal host.
4. Copy the **Web app URL** (`https://script.google.com/macros/s/.../exec`) into **`dapp/store_interaction_history.html`** as **`API_BASE_URL`**, and into the **Deployment URL** line in `store_interaction_history_api.gs` (keep commits in sync after redeploys).

## Production deployment

| Artifact | Location |
|----------|----------|
| **Web app (exec)** | `https://script.google.com/macros/s/AKfycbwoBqZnDS4JRRdFkxSXdlGt-qIn-RauMcORuDHeWs29oQ2CpJ3L4A10uM8se9anL108/exec` |
| **DApp page (GitHub Pages)** | `https://truesightdao.github.io/dapp/store_interaction_history.html` |

Agentic context: `agentic_ai_context/CONTEXT_UPDATES.md`, `PROJECT_INDEX.md` (dapp + tokenomics), `WORKSPACE_CONTEXT.md` §4.
5. Optional — **Project Settings → Script properties**:
   - `STORE_HISTORY_API_TOKEN` — long random string; if set, all requests must include `&token=...` (must match the value in the HTML constant `API_TOKEN`).

The script runs under your Google account; it only reads the spreadsheet (no writes).

## Endpoints (GET)

| Query | Returns |
|--------|---------|
| `?action=suggestStores&q=partial` | `{ status, data: { suggestions: [{ shop_name, store_key, email, hit_list_row }] } }` — requires `q` length ≥ 2 |
| `?action=getStoreHistory&store_key=...` | Full payload: `hit_list`, `dapp_remarks`, `email_agent_follow_up`, `email_agent_suggestions` |
| `?action=getStoreHistory&shop=...` | Same, if `store_key` omitted (exact normalized match on Hit List `Shop Name`) |
| `?action=listStoresByFilter` | Paginated Hit List rows: `status` and `shop_type` may be repeated (exact cell match). Omit both to return all rows (subject to limit). `limit` (default 200, max 500), `offset` (default 0). Response: `{ rows: [...], total, offset, limit, returned }` where each row includes `store_key`, `shop_name`, `status`, `shop_type`, `city`, `state`, `email`, `status_updated`, `hit_list_row`. |
| `?action=listStatusSummary` | Pipeline-style counts from **Hit List** (one pass): `by_status[]` `{ status, count }`, `by_shop_type[]` `{ shop_type, count }`, plus `total_data_rows`, `blank_status`, `blank_shop_type`. Used by `stores_by_status.html` for the overview chips. |

Always append `&token=...` when `STORE_HISTORY_API_TOKEN` is set.

## Troubleshooting: “CORS” / `Access-Control-Allow-Origin` / `origin 'null'`

The DApp uses **`fetch()`** to this web app (same pattern as `stores_nearby.html` → Hit List API). The script returns JSON via **`ContentService.createTextOutput(...).setMimeType(ContentService.MimeType.JSON)`** — you do **not** need JSONP.

If the browser blocks the response with a **CORS** error:

1. **Deploy → Manage deployments** — set **Who has access** to **Anyone** (or otherwise allow the origin that loads the page). Restricted access often returns an HTML Google sign-in or error page **without** CORS headers; the console then shows CORS, not a helpful HTTP status. This applies to **`file://`** opens too (`origin 'null'`).
2. Confirm **Execute as: Me** and that the account can open the spreadsheet.
3. After edits, create a **New version** deployment; update the **`.../exec`** URL in `dapp/store_interaction_history.html` and in this file’s **Deployment URL** if Google issues a new URL.

## Recording human edits / sent mail (not in this script)

- **Sent mail**: your existing `sync_email_agent_followup.py` (and Gmail sync workflows) already push structured follow-up rows into **Email Agent Follow Up**; that gives future history without this API writing.
- **Draft edits**: Gmail does not fire a webhook when someone edits a draft. Options are a **Chrome extension**, **periodic Apps Script + GmailApp scan** (compare draft body to last logged version — heavy), or a **manual “log final text”** button in the DApp that POSTs to a separate web app with write scope. This read-only API keeps access simple; add a write endpoint later if you automate capture.

## Related

- DApp pages: `/Applications/dapp/store_interaction_history.html`, `/Applications/dapp/stores_by_status.html`
- Conventions: `agentic_ai_context/DAPP_PAGE_CONVENTIONS.md`, `dapp/UX_CONVENTIONS.md`

## Email Agent drafts (optional, same spreadsheet project)

Add **`email_agent_drafts.gs`** to the **container-bound** Apps Script project if you want menu-driven Gmail drafts (mirrors **`market_research/scripts/suggest_*_drafts.py`**):

- **AI: Warm up prospect** — intro + consignment/bulk copy + wholesale PDF (`UrlFetch` to raw GitHub or script property **`BULK_PDF_RAW_URL`**)
- **Manager Follow-up** — no PDF
- **Bulk Info Requested** — PDF only

Save → reload the spreadsheet → **Email Agent drafts** menu. Details: **`market_research/HIT_LIST_CREDENTIALS.md`**.
