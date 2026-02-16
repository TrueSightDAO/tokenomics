# Agroverse Cacao Processing Cost – WhatsApp extraction

Extract cacao processing cost / price data from WhatsApp chat exports and produce rows for the **Agroverse Cacao Processing Cost** Google Sheet.

## Sheet reference

- **Sheet:** [Agroverse Cacao Processing Cost](https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=603759787#gid=603759787)
- **Spreadsheet:** TrueSight DAO Contribution Ledger (`1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU`)
- **Columns:** Facility Name (A), Process name (B), Cost (C), Currency (D), Status Date (E), Contact Information / Whats App (F), Alibaba (G)

## Input

- **WhatsApp chat export:** a zip containing `_chat.txt`, or a plain `_chat.txt` file.
- Typical path: `~/Downloads/WhatsApp Chat - Agroverse cacao production.zip`

WhatsApp format: `[M/D/YY, H:MM:SS AM/PM] Sender Name: message` (multi-line messages are lines that do not start with `[`).

## Usage

### 1. Extract and get CSV

From the **tokenomics** repo root:

```bash
# Default: reads ~/Downloads/WhatsApp Chat - Agroverse cacao production.zip
python3 python_scripts/agroverse_cacao_processing/extract_whatsapp_to_processing_cost.py

# Or pass path to zip or _chat.txt
python3 python_scripts/agroverse_cacao_processing/extract_whatsapp_to_processing_cost.py "/path/to/WhatsApp Chat - Agroverse cacao production.zip"
```

**Output:** CSV to stdout with columns matching the sheet (Facility Name, Process name, Cost, Currency, Status Date, Contact, Alibaba).

### 2. Write CSV to a file

```bash
python3 python_scripts/agroverse_cacao_processing/extract_whatsapp_to_processing_cost.py -o processing_cost_candidates.csv
```

### 3. Get JSON instead

```bash
python3 python_scripts/agroverse_cacao_processing/extract_whatsapp_to_processing_cost.py --json -o processing_cost_candidates.json
```

## How extraction works

- **Parser:** Splits the chat into messages by the `[date] Sender: ` line pattern; multi-line messages are merged.
- **Cost detection:** Looks for `R$` amounts (with optional `/kg`); normalizes Brazilian format (e.g. `160,00` → 160.0).
- **Facility matching:** Maps chat text to sheet facility names (e.g. "Martinus", "Santos", "MARTINUS Chocolate", "SANTOS", "FAZENDA CAPELA VELHA" → canonical names).
- **Process name:** Uses the surrounding text (with price removed) as the process description, truncated.
- **Status Date:** Message date in `YYYYMMDD` (sheet format).
- **Currency:** Set to "Brazilian Reis" for R$ (sheet convention).

Some prices (e.g. "Price: R$850" in a separate line) may not be tied to a facility by the script; add those manually or extend the script to carry facility context across blocks.

## Updating the Google Sheet

**Full step-by-step (where to paste, column order, conventions):** see **`INSERT_PROCEDURE.md`** in this folder.

**Option A – Manual (recommended first time)**

1. Run the script and save CSV:  
   `python3 ... extract_whatsapp_to_processing_cost.py -o candidates.csv`
2. Open the CSV and review: fix Facility/Process names (match existing sheet spelling), remove duplicates, shorten Process text to sheet style, add Contact/WhatsApp if you have it.
3. Open [Agroverse Cacao Processing Cost](https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=603759787#gid=603759787).
4. Insert at **first empty row** (e.g. row 25 if data ends at row 24). Paste **data rows only** (no header); columns must align A=Facility, B=Process, C=Cost, D=Currency, E=Status Date, F=Contact, G=Alibaba.
5. Check Cost (C) is numeric and Status Date (E) is YYYYMMDD or year.

**Option B – Google Sheets API**

Use the same CSV (or JSON) with a script that uses Google Sheets API (e.g. `gspread` or the script in `schema_validation` with credentials) to append rows to the sheet. See `python_scripts/schema_validation/README.md` for credentials setup. Example (pseudo):

```python
# Append rows to sheet "Agroverse Cacao Processing Cost"
# Sheet ID: 1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU, gid=603759787
```

Keep **manual review** before bulk appending so facility names and process descriptions match existing sheet conventions (e.g. "Santos", "Martinus", "Tais - Fazenda Capela Velha").

## Adding more facilities or patterns

Edit `extract_whatsapp_to_processing_cost.py`:

- **FACILITY_ALIASES:** Add `(regex_pattern, "Canonical Name")` so new facility mentions in chat map to the name used in the sheet.
- **PRICE_R_BRL:** Extend if you need other price formats (e.g. USD, Chinese RMB).

Schema detail for this sheet: **tokenomics** repo `SCHEMA.md` → "Agroverse Cacao Processing Cost".
