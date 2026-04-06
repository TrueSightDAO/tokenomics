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

Always append `&token=...` when `STORE_HISTORY_API_TOKEN` is set.

## Troubleshooting: “CORS” / `Access-Control-Allow-Origin` / `origin 'null'`

The DApp uses **`fetch()`** to this web app (same pattern as `stores_nearby.html` → Hit List API). The script returns JSON via **`ContentService.createTextOutput(...).setMimeType(ContentService.MimeType.JSON)`** — you do **not** need JSONP.

If the browser blocks the response with a **CORS** error:

1. **Deploy → Manage deployments** — set **Who has access** to **Anyone** (or otherwise allow the origin that loads the page). Restricted access often returns an HTML Google sign-in or error page **without** CORS headers; the console then shows CORS, not a helpful HTTP status. This applies to **`file://`** opens too (`origin 'null'`).
2. Confirm **Execute as: Me** and that the account can open the spreadsheet.
3. After edits, create a **New version** deployment; update the **`.../exec`** URL in `dapp/store_interaction_history.html` and in this file’s **Deployment URL** if Google issues a new URL.

## Hit List status: **Bulk Info Requested**

The DApp status **Bulk Info Requested** means the buyer asked for wholesale / bulk pricing. It is separate from **Manager Follow-up** (field-visit → manager email). Python automation:

- Drafts with PDF: `market_research/scripts/suggest_bulk_info_drafts.py` (after `generate_retailer_wholesale_attachment_pdf.py`).
- Sent-mail log: `sync_email_agent_followup.py` includes both **Manager Follow-up** and **Bulk Info Requested** rows when syncing to **Email Agent Follow Up**.

If your **Stores Nearby** `update_status` Apps Script validates allowed statuses, add the exact string `Bulk Info Requested` to that whitelist (same spelling as `dapp/stores_nearby.html` and the **States** sheet).

### Making the wholesale PDF available to **Google Apps Script**

Apps Script cannot read your laptop path. Pick one:

1. **Google Drive file ID (recommended for private PDFs)** — Upload `agroverse_wholesale_retail_overview_2026.pdf` (or current export) to Drive. Copy the file ID from the URL. In the script project: **Project Settings → Script properties**, set e.g. `BULK_PDF_DRIVE_FILE_ID`. In code: `DriveApp.getFileById(id).getBlob()` and attach to `GmailApp.createDraft(...)` or the advanced Gmail API (multipart message). The executing user must have access to the file.
2. **GitHub `raw.githubusercontent.com` (version with your site repo)** — The wholesale PDF is committed under **`agroverse_shop_beta`** at  
   `assets/documents/wholesale/agroverse_wholesale_retail_overview_2026.pdf`.  
   After you merge to **`main`**, Apps Script can pull the bytes with `UrlFetchApp` (no Git client in Apps Script—HTTP only):

   ```javascript
   var PDF_URL =
     'https://raw.githubusercontent.com/TrueSightDAO/agroverse_shop_beta/main/assets/documents/wholesale/agroverse_wholesale_retail_overview_2026.pdf';
   var resp = UrlFetchApp.fetch(PDF_URL, { muteHttpExceptions: true });
   if (resp.getResponseCode() !== 200) throw new Error('PDF fetch failed: ' + resp.getResponseCode());
   var blob = resp.getBlob().setName('Agroverse_wholesale_retail_overview_2026.pdf');
   ```

   **Requirements:** the repository (or file path) must be **world-readable** on GitHub, or you must send a **personal access token** in the `Authorization` header (store the token in **Script properties**, never in source). **Caching:** `raw.githubusercontent.com` can cache aggressively; after replacing the PDF, either change the filename (e.g. `_2026-04.pdf`) or add a dummy query string (`?v=2`) in the URL the script uses.

3. **Public HTTPS on agroverse.shop** — Host the same file under your static site if you prefer your own CDN/cache rules. Use `UrlFetchApp.fetch(url).getBlob()` the same way.
4. **Inside the spreadsheet** — Not ideal for binary PDFs; prefer Drive, GitHub raw, or HTTPS.

A time-driven trigger can run a “create drafts for rows with Status = Bulk Info Requested” function; mirror the Python cadence (pending drafts, min days since last send) or keep Apps Script as a manual menu until you need full parity.

## Recording human edits / sent mail (not in this script)

- **Sent mail**: your existing `sync_email_agent_followup.py` (and Gmail sync workflows) already push structured follow-up rows into **Email Agent Follow Up**; that gives future history without this API writing.
- **Draft edits**: Gmail does not fire a webhook when someone edits a draft. Options are a **Chrome extension**, **periodic Apps Script + GmailApp scan** (compare draft body to last logged version — heavy), or a **manual “log final text”** button in the DApp that POSTs to a separate web app with write scope. This read-only API keeps access simple; add a write endpoint later if you automate capture.

## Related

- DApp page: `/Applications/dapp/store_interaction_history.html`
- Conventions: `agentic_ai_context/DAPP_PAGE_CONVENTIONS.md`, `dapp/UX_CONVENTIONS.md`
