
#!/usr/bin/env python3
"""
E2E regression test for the [INVENTORY MOVEMENT] authorization + processing pipeline
(GAS project 1wONDeDwZ_..., script process_movement_telegram_logs.js).

Purpose (per governor Gary Teh, 2026-08-26):
  Prove that a Sophia-Truesight-signed [INVENTORY MOVEMENT] traverses the REAL
  pipeline end-to-end — RSA signature -> Edgar submit_contribution -> Telegram Chat
  Logs -> GAS Phase 1 (status) -> GAS Phase 2 (ledgers) — and that the Inventory
  Movement sheet row's column N reaches PROCESSED (not unauthorized, not stuck at
  NEW). No mocking: signs with Sophia's real registered keypair, POSTs to the real
  Edgar API, triggers the real GAS /exec webhook, and asserts on the real
  Inventory Movement sheet.

  Regression guard for tokenomics PR #364
  ("Replace hardcoded TRUSTED_AGENTS with dynamic sentinel role check"): catches the
  class of gap where an authorized agent's movement falls through to unauthorized.

Modes:
  --mode self-to-self (default)   Manager: Sophia Truesight, Recipient: Sophia
                                  Truesight. Authorizes via the manager-match path
                                  (authNamesMatch_), so it is a full-pipeline smoke
                                  test; passes both pre- and post-#364.
  --mode sentinel-isolation       Manager: Gary Teh, Recipient: Sophia Truesight.
                                  Only the sentinel-by-name path (post-#364) can
                                  authorize this — it FAILS (unauthorized) on the
                                  currently-deployed GAS and turns green only after
                                  the fix deploys. This is the true regression check.

Invocation:
  python3 e2e_inventory_movement_regression.py [--mode self-to-self|sentinel-isolation]
      [--env /opt/truesight_autopilot/.env]
      [--creds /opt/truesight_autopilot/config/google/cypher_defense_gdrive_key.json]
      [--deploy-url https://script.google.com/macros/s/AKfycbzECOd1Y3mH7L0zU8hOC4AxQctYICX0Ws8j2-Md1dWg0k3GFGQx_4Cf7n-CM0usmSJ1/exec]
      [--edgar-url https://edgar.truesight.me/dao/submit_contribution]
      [--timeout 600] [--dry-run]

Exit codes: 0 = PASS (column N == PROCESSED); 1 = FAIL (unauthorized / stuck at NEW /
row not found within timeout); 2 = setup/API error.
"""
import argparse
import base64
import datetime
import json
import os
import sys
import time
import urllib.parse
import urllib.request

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

OPS_SPREADSHEET_ID = "1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ"
IM_SHEET = "Inventory Movement"
COL_A_UPDATE_ID = 0
COL_F_CONTRIBUTION = 5
COL_N_STATUS = 13

# Gary Teh's registered key fingerprint, from the historical Edgar Direct rows
# (e.g. Edgar_20260820231604_105). isGovernorApproved_ only checks the name before
# "|", but we keep the format identical to production submissions.
APPROVED_BY_LINE = "- Approved By: Gary Teh | Key FP: 9932f7a3 | Session: https://github.com/TrueSightDAO/truesight_autopilot_transcript (E2E regression test)"


def load_env_keys(env_path):
    keys = {}
    with open(env_path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            keys[k.strip()] = v.strip().strip('"').strip("'")
    missing = [k for k in ("PUBLIC_KEY", "PRIVATE_KEY", "EMAIL") if not keys.get(k)]
    if missing:
        raise SystemExit(f"ERROR: missing {missing} in {env_path}")
    return keys


def sign_text(private_key_b64, text):
    pk_bytes = base64.b64decode(private_key_b64)
    private_key = serialization.load_der_private_key(pk_bytes, password=None)
    signature = private_key.sign(text.encode("utf-8"), padding.PKCS1v15(), hashes.SHA256())
    return base64.b64encode(signature).decode("utf-8")


def build_payload(keys, manager, recipient, currency, quantity, mode):
    text = (
        "[INVENTORY MOVEMENT]\n"
        f"- Manager Name: {manager}\n"
        f"- Recipient Name: {recipient}\n"
        f"- Inventory Item: {currency}\n"
        f"- Quantity: {quantity}\n"
        "- Destination Inventory File Location: Main Ledger - offchain asset location\n"
        f"{APPROVED_BY_LINE}\n"
        "--------"
    )
    sig_b64 = sign_text(keys["PRIVATE_KEY"], text)
    full = (
        text
        + "\n\nMy Digital Signature: " + keys["PUBLIC_KEY"]
        + "\n\nRequest Transaction ID: " + sig_b64
        + "\n\nThis submission was generated using https://github.com/TrueSightDAO/truesight_autopilot"
        + "\n\nVerify submission here: https://dapp.truesight.me/verify_request.html"
    )
    return full


def post_to_edgar(edgar_url, full_text, timeout=60):
    data = urllib.parse.urlencode({"text": full_text}).encode("utf-8")
    req = urllib.request.Request(
        edgar_url,
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8")


def trigger_gas(deploy_url, timeout=90):
    url = deploy_url + ("&" if "?" in deploy_url else "?") + "action=processTelegramChatLogs"
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8")


def read_inventory_movement(creds_path, range_a1):
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    creds = service_account.Credentials.from_service_account_file(creds_path, scopes=SCOPES)
    service = build("sheets", "v4", credentials=creds)
    result = (
        service.spreadsheets()
        .values()
        .get(spreadsheetId=OPS_SPREADSHEET_ID, range=range_a1)
        .execute()
    )
    return result.get("values", [])


def find_matching_rows(rows, marker):
    matches = []
    for idx, row in enumerate(rows):
        if len(row) <= COL_N_STATUS:
            continue
        contribution = row[COL_F_CONTRIBUTION] if len(row) > COL_F_CONTRIBUTION else ""
        if marker and marker not in str(contribution):
            continue
        matches.append(
            {
                "sheet_row": idx + 1,
                "update_id": row[COL_A_UPDATE_ID] if len(row) > COL_A_UPDATE_ID else "",
                "status": row[COL_N_STATUS].strip() if isinstance(row[COL_N_STATUS], str) else row[COL_N_STATUS],
                "sender": row[7] if len(row) > 7 else "",
                "recipient": row[8] if len(row) > 8 else "",
                "currency": row[9] if len(row) > 9 else "",
            }
        )
    return matches


def main():
    ap = argparse.ArgumentParser(description="E2E inventory-movement regression test")
    ap.add_argument("--mode", choices=["self-to-self", "sentinel-isolation"], default="self-to-self")
    ap.add_argument("--env", default="/opt/truesight_autopilot/.env")
    ap.add_argument("--creds", default="/opt/truesight_autopilot/config/google/cypher_defense_gdrive_key.json")
    ap.add_argument("--deploy-url", default="https://script.google.com/macros/s/AKfycbzECOd1Y3mH7L0zU8hOC4AxQctYICX0Ws8j2-Md1dWg0k3GFGQx_4Cf7n-CM0usmSJ1/exec")
    ap.add_argument("--edgar-url", default="https://edgar.truesight.me/dao/submit_contribution")
    ap.add_argument("--timeout", type=int, default=600, help="Max seconds to wait for PROCESSED")
    ap.add_argument("--dry-run", action="store_true", help="Build + print payload only; do not submit")
    args = ap.parse_args()

    keys = load_env_keys(args.env)
    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d%H%M%S")
    marker = f"E2E TEST CURRENCY {args.mode} {ts}"
    currency = marker

    if args.mode == "self-to-self":
        manager, recipient = "Sophia Truesight", "Sophia Truesight"
    else:
        manager, recipient = "Gary Teh", "Sophia Truesight"
    quantity = 1

    full_text = build_payload(keys, manager, recipient, currency, quantity, args.mode)
    print(f"[1/5] Mode: {args.mode}")
    print(f"[1/5] Manager: {manager} | Recipient: {recipient} | Currency: {currency} | Qty: {quantity}")

    if args.dry_run:
        print("[dry-run] Payload (signature truncated for readability):")
        shown = full_text.replace(keys["PUBLIC_KEY"], keys["PUBLIC_KEY"][:60] + "...")
        shown = shown.replace(keys["PRIVATE_KEY"], "[REDACTED]")
        print(shown)
        return 0

    print("[2/5] POSTing signed [INVENTORY MOVEMENT] to Edgar ...")
    try:
        resp = post_to_edgar(args.edgar_url, full_text)
    except Exception as exc:
        print(f"ERROR: Edgar POST failed: {exc}")
        return 2
    print(f"[2/5] Edgar response: {resp[:300]}")
    try:
        parsed = json.loads(resp)
        if str(parsed.get("signature_verification", "")).lower() != "success":
            print(f"ERROR: signature_verification != success: {resp[:300]}")
            return 2
    except Exception:
        # Some deployments return non-JSON; require the success marker loosely.
        if "success" not in resp.lower():
            print(f"ERROR: unexpected Edgar response: {resp[:300]}")
            return 2

    # Let Edgar finish writing the Telegram Chat Logs row before triggering GAS.
    print("[3/5] Waiting 5s for Edgar to log the row, then triggering GAS webhook ...")
    time.sleep(5)
    try:
        gas_resp = trigger_gas(args.deploy_url)
        print(f"[3/5] GAS webhook response: {gas_resp[:300]}")
        if "busy" in gas_resp.lower():
            print("[3/5] GAS busy; waiting 30s and retrying once ...")
            time.sleep(30)
            gas_resp = trigger_gas(args.deploy_url)
            print(f"[3/5] GAS retry response: {gas_resp[:300]}")
    except Exception as exc:
        print(f"WARNING: GAS webhook trigger failed ({exc}); relying on Edgar's async trigger.")

    # Poll the Inventory Movement sheet for our row and its column N status.
    print(f"[4/5] Polling Inventory Movement sheet for marker '{marker}' (timeout {args.timeout}s) ...")
    deadline = time.time() + args.timeout
    last_statuses = []
    while time.time() < deadline:
        try:
            rows = read_inventory_movement(args.creds, f"'{IM_SHEET}'!A1:N3000")
        except Exception as exc:
            print(f"WARNING: sheet read failed ({exc}); retrying ...")
            time.sleep(20)
            continue
        matches = find_matching_rows(rows, marker)
        if matches:
            statuses = sorted({m["status"] for m in matches})
            last_statuses = [(m["update_id"], m["status"]) for m in matches]
            if "PROCESSED" in statuses:
                print(f"[5/5] PASS — column N == PROCESSED")
                for m in matches:
                    if m["status"] == "PROCESSED":
                        print(
                            f"      sheet_row={m['sheet_row']} update_id={m['update_id']} "
                            f"sender={m['sender']} recipient={m['recipient']} "
                            f"currency={m['currency']} status={m['status']}"
                        )
                return 0
            if "unauthorized" in statuses:
                print("FAIL — movement came back 'unauthorized' (column N).")
                for m in matches:
                    print(f"      sheet_row={m['sheet_row']} update_id={m['update_id']} status={m['status']}")
                print("      Expected PROCESSED. This is the regression this test guards against —")
                print("      if running after PR #364 deployed, investigate why the sentinel path did not authorize.")
                return 1
        time.sleep(20)

    print(f"FAIL — timed out after {args.timeout}s waiting for PROCESSED.")
    if last_statuses:
        print("      Last observed statuses: " + ", ".join(f"{u}={s}" for u, s in last_statuses))
    else:
        print(f"      No Inventory Movement row matched marker '{marker}' — pipeline may not have ingested the submission.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
