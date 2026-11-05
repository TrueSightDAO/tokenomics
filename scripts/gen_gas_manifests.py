#!/usr/bin/env python3
"""Generate manifest.json for each thematic folder under tokenomics/google_app_scripts/.

Audit-derived: parses each .gs file for the standard header comment
``https://script.google.com/home/projects/<scriptId>/edit`` and the standard
deployment URL ``https://script.google.com/macros/s/<deploymentId>/exec``.
Produces one manifest per thematic folder listing every scriptId it covers
and which .gs files belong to each.

Per TOKENOMICS_GAS_RESTRUCTURE_PLAN.md, this is PR-1: discoverability win,
no file moves. The pre-flight checklist (roadmap §4) resolves the
remaining unknowns (project display name, full deployments list, post-push
hooks).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path("/Users/garyjob/Applications/tokenomics/google_app_scripts")
SCRIPT_ID_RE = re.compile(r"script\.google\.com/home/projects/([A-Za-z0-9_-]+)")
EXEC_URL_RE = re.compile(r"https://script\.google\.com/macros/s/([A-Za-z0-9_-]+)/exec")
PLACEHOLDER_DEPLOYS = {"YOUR_SCRIPT_ID", "AKfycbxyz1234567890"}  # known dummies

# Map each .gs file → its referenced scriptIds + /exec URLs.
def scan_gs(path: Path) -> tuple[set[str], set[str]]:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return set(), set()
    sids = set(SCRIPT_ID_RE.findall(text))
    exec_ids = {m for m in EXEC_URL_RE.findall(text) if m not in PLACEHOLDER_DEPLOYS}
    return sids, exec_ids


def emit_manifest(folder: Path) -> dict | None:
    gs_files = sorted(folder.rglob("*.gs"))
    if not gs_files:
        return None

    # Per-file scriptId set
    file_to_sids: dict[str, set[str]] = {}
    folder_exec_urls: set[str] = set()
    for f in gs_files:
        sids, exec_ids = scan_gs(f)
        file_to_sids[str(f.relative_to(folder))] = sids
        for eid in exec_ids:
            folder_exec_urls.add(f"https://script.google.com/macros/s/{eid}/exec")

    # All scriptIds referenced in this thematic folder.
    all_sids: set[str] = set()
    for s in file_to_sids.values():
        all_sids.update(s)

    # Files that DON'T have a scriptId comment — they may be shared helpers
    # OR genuinely unrouted scripts. Surface them explicitly.
    files_without_scriptid = sorted(f for f, s in file_to_sids.items() if not s)

    # Preserve any per-project fields a prior pass or companion script wrote
    # (probe results, consumer_callers, operator-edited name / deployments).
    # source_files and scriptId are re-derived every run; everything else is
    # merge-friendly.
    existing_projects: dict[str, dict] = {}
    existing_path = folder / "manifest.json"
    if existing_path.is_file():
        try:
            existing = json.loads(existing_path.read_text(encoding="utf-8"))
            for p in existing.get("projects", []):
                if p.get("scriptId"):
                    existing_projects[p["scriptId"]] = p
        except Exception:
            pass

    projects: list[dict] = []
    for sid in sorted(all_sids):
        owned = sorted(f for f, s in file_to_sids.items() if sid in s)
        prior = existing_projects.get(sid, {})
        projects.append({
            "name": prior.get("name") or f"TBC — confirm display name in GAS UI for {sid[:12]}…",
            "scriptId": sid,
            # Default for newly-discovered scriptIds is garyjob@agroverse.shop
            # per Gary's rule (2026-05-28). Known admin@truesight.me senders
            # are pinned via scripts/assign_gas_owner_emails.py — run that
            # after gen to apply the override.
            "owner_email": prior.get("owner_email") or "garyjob@agroverse.shop",
            "deployments": prior.get("deployments") or {
                "head": "TBC — list every /exec URL for this scriptId in pre-flight"
            },
            "post_push_hooks": prior.get("post_push_hooks") or [],
            "consumer_callers": prior.get("consumer_callers") or [],
            "candidate_cache_refresh_hooks": prior.get("candidate_cache_refresh_hooks") or [],
            "source_files": owned,  # always re-derived
            "notes": prior.get("notes") or (
                "Audit-derived from in-source header-comment scriptIds on 2026-05-28. "
                "Pre-flight checklist (TOKENOMICS_GAS_RESTRUCTURE_PLAN.md §4) must "
                "resolve: full deployments list, post-push cache-refresh hooks, "
                "confirmed owner_email, consumer callers."
            ),
        })

    manifest = {
        "thematic_folder": folder.name,
        "audit_metadata": {
            "generated_at": "2026-05-28",
            "generated_by": "PR-1 manifest-convention sweep",
            "completeness": (
                "audit-derived; PR-1 captures only what is in source comments. "
                "Pre-flight checklist (roadmap §4) must be resolved before "
                "promoting to v1."
            ),
            "schema_version": "v0-audit",
        },
        "project_count": len(projects),
        "projects": projects,
        "files_without_scriptid": files_without_scriptid,
        "exec_urls_seen_in_folder_sources": sorted(folder_exec_urls),
        "see_also": "agentic_ai_context/TOKENOMICS_GAS_RESTRUCTURE_PLAN.md",
    }
    return manifest


def main() -> None:
    total = 0
    for folder in sorted(p for p in ROOT.iterdir() if p.is_dir() and not p.name.startswith(".")):
        manifest = emit_manifest(folder)
        if manifest is None:
            print(f"  skip (no .gs files): {folder.name}")
            continue
        out_path = folder / "manifest.json"
        out_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"  wrote {out_path.relative_to(ROOT.parent)} — {manifest['project_count']} project(s)")
        total += 1
    print(f"\nTotal manifests written: {total}")


if __name__ == "__main__":
    main()
