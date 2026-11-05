#!/usr/bin/env python3
"""Assign owner_email per scriptId based on the rule confirmed by Gary 2026-05-28:

- admin@truesight.me — projects that send the email-registration verification
  email AND the QR-code-tree-planted notification.
- garyjob@agroverse.shop — every other GAS project.

Today's audit-derived assignments:

  admin@truesight.me  (sender:)
    1m8IZPs1vFN99cuu-39kbC-OGXggRVtJtXq5rfSB0M1sCQjMdolEUDuGU
      → Edgar email-verification webhook
        (google_app_scripts/tdg_identity_management/edgar_send_email_verification.gs).
    1zKgMwd6KJFjoWkRH6OobgFvtVzrXVuEKfxVbgixgnfcp4TZTjrsfNKq0
      → Gmail-based digital-signature ingestion (the source file's
        own comment says: "Runs as admin@truesight.me in its own Apps
        Script project").
    1MnAsIQAxcSfZO_hALOtMFJ4y1k4OnqeXKMwYs6xev600rPNUYepqcXsT
      → QR-code web service + SunMint tree-planting pledge notification
        (sendEmailForQRCode / sendEmailNotification in qr_code_web_service.gs).

Anything else → garyjob@agroverse.shop.

Idempotent: re-run any time. If new senders are discovered later, edit
ADMIN_SCRIPT_IDS below and re-run.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "google_app_scripts"

ADMIN_SCRIPT_IDS = {
    "1m8IZPs1vFN99cuu-39kbC-OGXggRVtJtXq5rfSB0M1sCQjMdolEUDuGU",  # Edgar email verification
    "1zKgMwd6KJFjoWkRH6OobgFvtVzrXVuEKfxVbgixgnfcp4TZTjrsfNKq0",  # Gmail digital-signature ingestion
    "1MnAsIQAxcSfZO_hALOtMFJ4y1k4OnqeXKMwYs6xev600rPNUYepqcXsT",  # QR web service + tree pledge
}
ADMIN_EMAIL = "admin@truesight.me"
DEFAULT_EMAIL = "garyjob@agroverse.shop"


def main() -> None:
    updated = 0
    admin_hits = 0
    default_hits = 0
    for manifest_path in sorted(SRC.glob("*/manifest.json")):
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        changed = False
        for project in manifest.get("projects", []):
            sid = project.get("scriptId")
            if not sid:
                continue
            target = ADMIN_EMAIL if sid in ADMIN_SCRIPT_IDS else DEFAULT_EMAIL
            if project.get("owner_email") != target:
                project["owner_email"] = target
                changed = True
            if target == ADMIN_EMAIL:
                admin_hits += 1
            else:
                default_hits += 1
        if changed:
            manifest_path.write_text(
                json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            updated += 1
            print(f"  updated {manifest_path.relative_to(ROOT)}")
    print(f"\nManifests updated: {updated}")
    print(f"Projects assigned admin@truesight.me: {admin_hits}")
    print(f"Projects assigned garyjob@agroverse.shop: {default_hits}")


if __name__ == "__main__":
    main()
