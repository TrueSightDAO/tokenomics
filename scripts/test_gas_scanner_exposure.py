#!/usr/bin/env python3
"""Guard: every Apps Script *scanner* in the QR/web-app project is reachable via `doGet`.

STANDING CONVENTION (see AGENTS.md §1): in any project hosting more than one async
scanner, every scanner MUST
  (1) have a `doGet` `?action=<FunctionName>` branch in the unified router,
  (2) be listed in the router's `scannerFunctions_()` / `scannerTriggerInstallers_()` registry,
  (3) carry an idempotent `newTrigger('<fn>')` hourly self-installer.

A *scanner* is a zero-argument top-level `process<Name>()` function. Private helpers use a
trailing underscore (`processBatchSummary_`) and are deliberately excluded.

Exit 0 = convention holds; exit 1 = a scanner is un-exposed / un-registered / un-installable.

Why (2026-09-24): `processPlotFinancingEvents…` and `processBatch` were unreachable over HTTP,
so when an operator deleted all project triggers they could not be re-armed remotely. This
guard closes that silent-failure class.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "google_app_scripts"

# The project that hosts the Telegram-scanner family (owner: admin@truesight.me).
PROJECT_PREFIX = "1MnAsIQAxcSfZO"

# Zero-arg `process*` functions that are NOT scanners (e.g. a future non-intake helper).
NON_SCANNER_ALLOWLIST: set[str] = set()


def _find_project() -> Path:
    for manifest in sorted(SRC.glob("*/manifest.json")):
        if manifest.parent.name.startswith(PROJECT_PREFIX):
            return manifest.parent
    raise SystemExit(f"FAIL: scanner project {PROJECT_PREFIX}* not found under {SRC}")


def main() -> int:
    proj = _find_project()
    sources = {
        p.name: p.read_text(encoding="utf-8", errors="replace")
        for p in sorted(proj.glob("*.js"))
    }
    blob = "\n".join(sources.values())

    # 1) derive the scanner set from source (zero-arg process<Name>, no trailing underscore)
    scanners: set[str] = set()
    for text in sources.values():
        scanners.update(re.findall(r"^function\s+(process[A-Z][A-Za-z0-9]*)\s*\(\s*\)", text, re.M))
    scanners -= NON_SCANNER_ALLOWLIST

    # 2) the unified router
    router = next(
        (t for t in sources.values() if re.search(r"^function\s+doGet\s*\(", t, re.M)), None
    )
    if not router:
        print("FAIL: no unified doGet router found in project")
        return 1
    branches = set(re.findall(r"actionStr\s*===\s*'([A-Za-z0-9_]+)'", router))

    # 3) registry: scannerFunctions_()
    reg = re.search(r"function scannerFunctions_\(\)\s*\{(.*?)\}", router, re.S)
    if not reg:
        print("FAIL: scannerFunctions_() not found in router")
        return 1
    registered = set(re.findall(r"'([A-Za-z0-9_]+)'", reg.group(1)))

    # 4) registry: scannerTriggerInstallers_()  + the installer fns it points at
    reg2 = re.search(r"function scannerTriggerInstallers_\(\)\s*\{(.*?)\n\}", router, re.S)
    if not reg2:
        print("FAIL: scannerTriggerInstallers_() not found in router")
        return 1
    installer_map = dict(re.findall(r"'([A-Za-z0-9_]+)'\s*:\s*([A-Za-z0-9_]+)", reg2.group(1)))
    defined_installers = set(
        re.findall(r"^function\s+(ensure[A-Za-z0-9_]*HourlyTriggerInstalled_)\s*\(", blob, re.M)
    )

    errors: list[str] = []
    if not scanners:
        errors.append("no scanners detected (regex/paths stale?)")
    for fn in sorted(scanners):
        if fn not in branches:
            errors.append(f"{fn}: no doGet `?action={fn}` branch")
        if fn not in registered:
            errors.append(f"{fn}: not listed in scannerFunctions_()")
        if fn not in installer_map:
            errors.append(f"{fn}: not listed in scannerTriggerInstallers_()")
        elif installer_map[fn] not in defined_installers:
            errors.append(f"{fn}: installer {installer_map[fn]}() is not defined")
        if not any("newTrigger(" in t and f"'{fn}'" in t for t in sources.values()):
            errors.append(f"{fn}: no idempotent newTrigger('{fn}') self-installer found")

    if errors:
        print("FAIL — scanner-exposure convention violated (AGENTS.md §1):")
        for e in errors:
            print(f"  - {e}")
        return 1

    print(f"OK — {len(scanners)} scanners all exposed via doGet, registered, and self-installing:")
    for fn in sorted(scanners):
        print(f"  - {fn}  → {installer_map.get(fn, '?')}()")
    return 0


if __name__ == "__main__":
    sys.exit(main())
