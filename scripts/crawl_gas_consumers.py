#!/usr/bin/env python3
"""Crawl ~/Applications consumer repos for /exec URLs and write each scriptId's
callers into google_app_scripts/<thematic>/manifest.json's consumer_callers.

How it works:
1. Build a URL → scriptId map by scanning every .gs file under
   google_app_scripts/: each .gs that references a deployment URL AND a
   scriptId in its header comment teaches us "this URL belongs to this
   scriptId."
2. Grep every consumer repo for every URL we know.
3. Aggregate: scriptId → set of files outside tokenomics that reference one
   of its URLs.
4. Update the consumer_callers array of every project block in every
   thematic-folder manifest.json.

Idempotent. Re-run any time consumer code or .gs sources change.
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

TOKENOMICS = Path(__file__).resolve().parent.parent
SRC = TOKENOMICS / "google_app_scripts"
WORKSPACE = TOKENOMICS.parent  # ~/Applications
CONSUMER_REPOS = [
    "dapp",
    "truesight_autopilot",
    "agentic_ai_context",
    "agroverse_shop",
    "truesight_me",
    "agentic_ai_api_credentials",
    "ecosystem_change_logs",
    "market_research",
]
SCRIPT_ID_RE = re.compile(r"script\.google\.com/home/projects/([A-Za-z0-9_-]+)")
EXEC_URL_RE  = re.compile(r"https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec")
PLACEHOLDER = {"AKfycbxyz1234567890", "YOUR_SCRIPT_ID"}


def build_url_to_scriptid_map() -> dict[str, str]:
    """url → scriptId. Built from .gs files that carry both."""
    out: dict[str, str] = {}
    for gs in SRC.rglob("*.gs"):
        try:
            text = gs.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        sids = set(SCRIPT_ID_RE.findall(text))
        if len(sids) != 1:
            # Files referencing zero or multiple scriptIds don't teach us a
            # 1:1 mapping. Skip.
            continue
        sid = next(iter(sids))
        for url in EXEC_URL_RE.findall(text):
            if any(p in url for p in PLACEHOLDER):
                continue
            # Last-write-wins is fine — multiple .gs in the same project
            # may all mention the same URL.
            out[url] = sid
    return out


def grep_consumer_callers(url: str) -> list[str]:
    """Return list of "<repo>/<relative path>" strings that reference url."""
    hits: list[str] = []
    for repo in CONSUMER_REPOS:
        root = WORKSPACE / repo
        if not root.is_dir():
            continue
        try:
            # Use git ls-files so we only catch tracked files (skips .venv,
            # node_modules, build artifacts).
            tracked = subprocess.run(
                ["git", "-C", str(root), "grep", "-l", "--fixed-strings", url],
                capture_output=True, text=True, check=False,
            )
            for line in tracked.stdout.splitlines():
                if line:
                    hits.append(f"{repo}/{line}")
        except FileNotFoundError:
            continue
    return sorted(set(hits))


def main() -> None:
    url_to_sid = build_url_to_scriptid_map()
    print(f"  url→scriptId map: {len(url_to_sid)} entries")

    # scriptId → set of consumer-caller strings
    sid_to_callers: dict[str, set[str]] = {}
    for url, sid in url_to_sid.items():
        callers = grep_consumer_callers(url)
        if callers:
            sid_to_callers.setdefault(sid, set()).update(callers)

    print(f"  scriptIds with at least one consumer found: {len(sid_to_callers)}")

    # Update each manifest in place.
    updated = 0
    for manifest_path in sorted(SRC.glob("*/manifest.json")):
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        changed = False
        for project in manifest.get("projects", []):
            sid = project.get("scriptId")
            callers = sorted(sid_to_callers.get(sid, []))
            if project.get("consumer_callers") != callers:
                project["consumer_callers"] = callers
                changed = True
        if changed:
            manifest_path.write_text(
                json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            updated += 1
            print(f"  updated {manifest_path.relative_to(TOKENOMICS)}")
    print(f"\nManifests with new consumer_callers: {updated}")


if __name__ == "__main__":
    main()
