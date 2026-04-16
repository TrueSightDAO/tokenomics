# SeaCoast freight quotation ingest (Google Apps Script)

This Apps Script scans Gmail for Omega / SeaCoast quotation emails, logs every message to the
Google Sheet tab **`SeaCoast Logistic Email Message Log`**, uses **xAI Grok** to classify and
extract structured JSON, then opens a **GitHub pull request** against `TrueSightDAO/agroverse-freight-audit`.

**Apps Script editor:** https://script.google.com/home/projects/1gi4YKh2ikLWmp6qEL1A6N3dfF6gQP-jwRPf_hc0N0EvaVU0-1tWu0nxo/edit

## Script properties

Set these in **Project Settings → Script properties**:

- `AGROVERSE_FREIGHT_QUOTATIONS_UPDATE_GITHUB_PAT`
- `XAI_API_KEY`
- `FREIGHT_QUOTE_LOG_SPREADSHEET_ID` (optional; defaults to the DAO spreadsheet id embedded in `Code.gs`)
- `FREIGHT_QUOTE_LOG_SHEET_NAME` (optional; default `SeaCoast Logistic Email Message Log`)
- `GITHUB_OWNER` (optional; default `TrueSightDAO`)
- `GITHUB_REPO` (optional; default `agroverse-freight-audit`)
- `GMAIL_QUOTE_QUERY` (optional; default Graziela + `newer_than:180d`)
- `GROK_MODEL` (optional; default `grok-3`; set explicitly if xAI returns “Model not found” for your account)
- `GITHUB_AUTO_MERGE` (optional; default `false`)
- `MAX_MESSAGES_PER_RUN` (optional; default `20`)

## OAuth scopes

Declared in `appsscript.json`:

- Spreadsheets
- Gmail modify (labeling)
- External requests (GitHub + xAI)

After changing `appsscript.json`, re-authorize the project once in the Apps Script editor.

## clasp

From this directory:

```bash
clasp push
```

## Triggers

Create a time-driven trigger for `processSeacoastFreightQuoteInbox` (hourly/daily).

## Manual run

In the Apps Script editor, run `runOnce_processSeacoastFreightQuoteInbox`.
