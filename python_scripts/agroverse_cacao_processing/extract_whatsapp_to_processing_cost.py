#!/usr/bin/env python3
"""
Extract cacao processing cost / price data from WhatsApp chat export and output
rows suitable for the "Agroverse Cacao Processing Cost" Google Sheet.

Sheet: https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=603759787
Columns: Facility Name (A), Process name (B), Cost (C), Currency (D), Status Date (E),
         Contact Information / Whats App (F), Alibaba (G).

Usage:
  python extract_whatsapp_to_processing_cost.py [path_to_zip_or_chat_txt]
  # Default: ~/Downloads/WhatsApp Chat - Agroverse cacao production.zip

Output: CSV to stdout or --output file; optional JSON with --json.
"""

import argparse
import csv
import io
import json
import re
import zipfile
from pathlib import Path
from datetime import datetime


# WhatsApp line format: [M/D/YY, H:MM:SS AM/PM] Sender Name: message
MSG_START = re.compile(r"^\[(\d{1,2}/\d{1,2}/\d{2}),\s*(\d{1,2}:\d{2}:\d{2}\s*[AP]M)\]\s*([^:]+):\s*(.*)$")

# Price patterns: R$ 123,45 or R$123.45 or R$ 130,00/kg
PRICE_R_BRL = re.compile(r"R\$\s*([\d.,]+)(?:\s*/\s*kg)?", re.IGNORECASE)
# Facility names we map to sheet conventions (case-insensitive match, then canonical name)
FACILITY_ALIASES = [
    (r"MARTINUS\s+Chocolate|Martinus|Rodrigo\s*\(Martinus\)", "Martinus"),
    (r"SANTOS|Santos", "Santos"),
    (r"FAZENDA\s+CAPELA\s+VELHA|Fazenda Capela Velha|Taís|Tais", "Tais - Fazenda Capela Velha"),
    (r"FAZENDA\s+SANTA\s+ANA", "Fazenda Santa Ana"),
]


def parse_whatsapp_date(date_str: str, time_str: str) -> str:
    """Parse [M/D/YY, H:MM:SS AM/PM] to YYYYMMDD."""
    try:
        # 1/30/26, 6:08:56 AM
        dt = datetime.strptime(f"{date_str} {time_str}", "%m/%d/%y %I:%M:%S %p")
        return dt.strftime("%Y%m%d")
    except ValueError:
        return ""


def read_chat_from_zip(zip_path: Path) -> str:
    """Unzip and return _chat.txt content."""
    with zipfile.ZipFile(zip_path, "r") as z:
        for name in z.namelist():
            if name.endswith("_chat.txt") or name.endswith("chat.txt"):
                return z.read(name).decode("utf-8", errors="replace")
    raise FileNotFoundError(f"No _chat.txt in {zip_path}")


def read_chat_from_txt(txt_path: Path) -> str:
    return txt_path.read_text(encoding="utf-8", errors="replace")


def parse_messages(text: str) -> list[tuple[str, str, str]]:
    """Return list of (date_yyyymmdd, sender, body)."""
    lines = text.splitlines()
    messages = []
    current_date, current_sender, current_body = "", "", []

    for line in lines:
        m = MSG_START.match(line)
        if m:
            if current_body:
                body = "\n".join(current_body).strip()
                if body and not body.startswith("‎"):  # skip system/empty
                    messages.append((current_date, current_sender, body))
            date_str, time_str, sender = m.group(1), m.group(2), m.group(3)
            current_date = parse_whatsapp_date(date_str, time_str)
            current_sender = sender.strip()
            rest = m.group(4).strip()
            current_body = [rest] if rest else []
        else:
            if current_body is not None:
                current_body.append(line)

    if current_body:
        body = "\n".join(current_body).strip()
        if body and not body.startswith("‎"):
            messages.append((current_date, current_sender, body))

    return messages


def normalize_facility(name: str) -> str | None:
    for pattern, canonical in FACILITY_ALIASES:
        if re.search(pattern, name, re.IGNORECASE):
            return canonical
    return None


def _process_label_for_cost(block: str, body: str, cost_val: float) -> str:
    """
    Derive a short Process name (column B) that states what the cost is for.
    Uses chat context so column B is descriptive, not raw snippet.
    """
    block_lower = block.lower()
    body_lower = body.lower()
    # 1kg 100% Cacau bar — Martinus R$160, Santos R$95
    if "1kg 100%" in body_lower or "1kg 100%" in block_lower:
        if "martinus" in block_lower or "santos" in block_lower:
            return "1kg 100% Cacau bar (price research)"
    # 70% cacao bars, R$130/kg, 40 gr bars
    if "70%" in block_lower and ("/kg" in block or "per kg" in block_lower or cost_val == 130):
        if "40 gr" in block_lower or "40gr" in block_lower:
            return "70% cacao bars per kg, 40 gr bars (price research)"
        return "70% cacao bars per kg (price research)"
    # Minimum order 50 bars 60gr — R$850
    if "minimum order" in block_lower and "50 bars" in block_lower and ("60gr" in block_lower or "60 gr" in block_lower):
        return "Minimum order 50 bars 60gr each (price research)"
    # Fallback: strip facility prefix and price, take first meaningful phrase
    process_snippet = re.sub(r"R\$\s*[\d.,]+(?:\s*/\s*kg)?", "", block)
    process_snippet = re.sub(r"^(Martinus|Santos|SANTOS|MARTINUS\s+Chocolate)\s*:\s*", "", process_snippet, flags=re.IGNORECASE)
    process_snippet = " ".join(process_snippet.split())[:120]
    if process_snippet.strip():
        return (process_snippet.strip() + " (price research)")[:200]
    return "Price from chat (price research)"


def extract_costs_from_messages(messages: list[tuple[str, str, str]]) -> list[dict]:
    """
    From parsed messages, extract (facility, process, cost, currency, date).
    Heuristic: look for R$ amounts and nearby facility names; Process name states what the cost is for.
    """
    rows = []
    seen = set()  # (facility, process_key, cost) to avoid dupes

    for date_yyyymmdd, sender, body in messages:
        # Split into logical blocks (bullets or lines)
        blocks = re.split(r"\n\s*[-–]\s*|\n(?=[A-Z][a-z]+:)", body)
        for block in blocks:
            block = block.strip()
            if not block:
                continue
            # Find all R$ amounts in this block
            prices = PRICE_R_BRL.findall(block)
            if not prices:
                continue
            # Normalize cost: "160,00" -> 160.00, "130,00" -> 130.0
            for raw in prices:
                cost_str = raw.replace(",", ".")
                try:
                    cost_val = float(cost_str)
                except ValueError:
                    continue
                # Determine facility from block
                facility = None
                for pattern, canonical in FACILITY_ALIASES:
                    if re.search(pattern, block, re.IGNORECASE):
                        facility = canonical
                        break
                if not facility:
                    first_line = block.split("\n")[0]
                    for pattern, canonical in FACILITY_ALIASES:
                        if re.search(pattern, first_line, re.IGNORECASE):
                            facility = canonical
                            break
                if not facility:
                    continue
                # Process name: what the cost is for (descriptive, from context)
                process_name = _process_label_for_cost(block, body, cost_val)
                key = (facility, process_name[:60], cost_val)
                if key in seen:
                    continue
                seen.add(key)
                rows.append({
                    "Facility Name": facility,
                    "Process name": process_name,
                    "Cost": cost_val,
                    "Currency": "Brazilian Reis",
                    "Status Date": date_yyyymmdd,
                    "Contact Information / Whats App": "",
                    "Alibaba": "",
                })

    return rows


def main():
    ap = argparse.ArgumentParser(description="Extract Agroverse cacao cost data from WhatsApp chat to CSV for the Processing Cost sheet.")
    ap.add_argument("input", nargs="?", default=None, help="Path to .zip or _chat.txt (default: ~/Downloads/WhatsApp Chat - Agroverse cacao production.zip)")
    ap.add_argument("-o", "--output", default=None, help="Write CSV to file (default: stdout)")
    ap.add_argument("--json", action="store_true", help="Output JSON instead of CSV")
    args = ap.parse_args()

    if args.input is None:
        default_zip = Path.home() / "Downloads" / "WhatsApp Chat - Agroverse cacao production.zip"
        if default_zip.exists():
            input_path = default_zip
        else:
            input_path = Path(".") / "_chat.txt"
            if not input_path.exists():
                ap.error("No input path given and default zip/path not found. Pass path to .zip or _chat.txt.")
    else:
        input_path = Path(args.input)

    if not input_path.exists():
        ap.error(f"Input not found: {input_path}")

    if input_path.suffix.lower() == ".zip":
        text = read_chat_from_zip(input_path)
    else:
        text = read_chat_from_txt(input_path)

    messages = parse_messages(text)
    rows = extract_costs_from_messages(messages)

    if args.json:
        out = json.dumps(rows, indent=2)
    else:
        buf = io.StringIO()
        if rows:
            w = csv.DictWriter(buf, fieldnames=list(rows[0].keys()), lineterminator="\n")
            w.writeheader()
            w.writerows(rows)
        out = buf.getvalue()

    if args.output:
        Path(args.output).write_text(out, encoding="utf-8")
        print(f"Wrote {len(rows)} row(s) to {args.output}", file=__import__("sys").stderr)
    else:
        print(out)


if __name__ == "__main__":
    main()
