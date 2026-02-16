# Inserting new rows into Agroverse Cacao Processing Cost

**Sheet:** [Agroverse Cacao Processing Cost](https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=603759787#gid=603759787)  
**Spreadsheet ID:** `1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU`  
**Sheet name (tab):** `Agroverse Cacao Processing Cost`  
**Sheet gid (for URL):** `603759787`

---

## Column order (row 1 = headers)

| Col | Header | Type | Notes |
|-----|--------|------|--------|
| A | Facility Name | String | Use exact spelling as existing rows (see notes below). |
| B | Process name | String | Descriptive; often "(per kg ...)" or "(per KG ...)"; can include URLs. |
| C | Cost | Number | Numeric only (e.g. 8.7, 100, 145). |
| D | Currency | String | "Brazilian Reis" or "Chinese RMB". |
| E | Status Date | String | YYYYMMDD (e.g. 20250210) or year "2024". |
| F | Contact Information / Whats App | String | Phone +55... or Alibaba message link; can be empty. |
| G | Alibaba | String | Usually empty. |

---

## Where to insert

- **Header:** Row 1 (do not overwrite).
- **Existing data:** Rows 2–24 (as of last snapshot). First **empty** data row is **25**.
- **Insert new rows:** Starting at **row 25**. Paste or type so that each new record occupies one row with values in A–G.

If the sheet has more rows filled since, insert **immediately below the last row that has Facility Name (column A) filled**.

---

## How to insert (options)

### Option 1: Manual paste (recommended)

1. **Prepare rows** (e.g. from extraction script or hand-built):
   - Run:  
     `python3 python_scripts/agroverse_cacao_processing/extract_whatsapp_to_processing_cost.py -o candidates.csv`  
     (from tokenomics repo root).
   - Open `candidates.csv`; **review and clean**:
     - **Process name (B):** Remove leading "Martinus:", "Santos:"; shorten long chat text to a clear process description (e.g. "1kg 100% Cacau bar (price research 20260130)" or "70% cacao bars per kg, 40 gr bars (price research)").
     - **Facility Name (A):** Must match existing spelling (Santos, Martinus, Tais - Fazenda Capela Velha, etc.).
     - **Status Date (E):** YYYYMMDD or year only.
     - **Contact (F):** Add if known (e.g. +55 73 99191 1413 for Martinus).
   - Save CSV (columns in order A–G).

2. **Open the sheet** (link above), go to tab **Agroverse Cacao Processing Cost**.

3. **Select the first cell of the insert area:**  
   Click cell **A25** (or the first empty row if your last data row is different).

4. **Paste:**  
   Copy the **data rows only** (no header) from CSV and Paste (Ctrl+V / Cmd+V).  
   Ensure columns line up: A=Facility, B=Process, C=Cost, D=Currency, E=Status Date, F=Contact, G=Alibaba.

5. **Check:**  
   Verify Cost (C) is numeric and Status Date (E) looks correct (YYYYMMDD or year).

### Option 2: Google Sheets API (append)

Use a script with **Google Sheets API** (e.g. `gspread` + service account, or same credentials as `python_scripts/schema_validation`) to append rows:

- **Spreadsheet ID:** `1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU`
- **Sheet name:** `Agroverse Cacao Processing Cost`
- **Append:** One row per list of 7 values `[A, B, C, D, E, F, G]` in order.

Always **review** the rows (e.g. from CSV/JSON) before appending so Facility and Process names match sheet conventions.

---

## Notes for future reference (existing sheet snapshot)

- **Facility names in use:** Santos, Wesley - CIC, Martinus, Jessie Peng - ShenZhen Source Pack Co Ltd, Oscar Fazenda, Fernando and Carla, Jedelicio - CEPOTX, Orlantidles - COOPERCABRUCA / Povo Da Mata, Tais - Fazenda Capela Velha, Renata - Biofábrica.
- **Status Date:** Most rows use YYYYMMDD (e.g. 20250210, 20241017); some use year only (e.g. 2024).
- **Currency:** "Brazilian Reis" for R$; "Chinese RMB" for Jessie Peng entries.
- **Process name style:** Short description + optional "(per kg ...)" + optional URL; e.g. "Cacao Almonds to Cacao Bars (per kg of bar produced and packed)".
- **Row 24:** Renata - Biofábrica has Process text but no Cost/Currency/Status Date (incomplete row).

---

## Questions to resolve (if any)

- **Duplicate processes:** If chat extraction gives a cost for a process that already exists (same Facility + similar Process), should we add a new row (e.g. with "(price research 20260130)") or update the existing row? Current procedure: **add new row** with cleaned Process name so history is kept.
- **Contact column:** Script leaves Contact (F) empty; fill manually from chat or Contributors sheet if available.
- **R$850 (Martinus min order):** Not extracted by script (price on its own line); add manually if desired: Facility=Martinus, Process e.g. "Minimum order 50 bars 60gr each (price research)", Cost=850, Currency=Brazilian Reis, Status Date=20260130.
