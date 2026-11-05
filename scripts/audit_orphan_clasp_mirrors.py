#!/usr/bin/env python3
"""Audit clasp_mirrors/ vs scriptIds in google_app_scripts/ source comments.

Resolves the 51-vs-36 delta noted in TOKENOMICS_GAS_RESTRUCTURE_PLAN.md §2:
- ORPHAN MIRRORS: clasp_mirrors/<scriptId>/ folders with NO source file
  in google_app_scripts/ referencing them. Probably deprecated or historical
  clones — the restructure roadmap will resolve case-by-case.
- UNMIRRORED SOURCES: scriptIds referenced in source but with no
  corresponding clasp_mirrors/<scriptId>/ folder. These would fail at
  `clasp push` time. Should be cloned via scripts/clone_clasp_mirrors.mjs.
- HEALTHY: scriptIds appearing in both sets.

Writes findings to docs/gas_orphan_mirror_audit.md so the restructure
PRs can pick them up without redoing this discovery.
"""
from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "google_app_scripts"
MIRRORS = ROOT / "clasp_mirrors"
SCRIPT_ID_RE = re.compile(r"script\.google\.com/home/projects/([A-Za-z0-9_-]+)")


def scriptids_in_sources() -> dict[str, list[str]]:
    """scriptId → list of source-file paths (relative to ROOT) that reference it."""
    out: dict[str, list[str]] = {}
    for gs in SRC.rglob("*.gs"):
        try:
            text = gs.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for sid in set(SCRIPT_ID_RE.findall(text)):
            out.setdefault(sid, []).append(str(gs.relative_to(ROOT)))
    return out


def scriptids_in_mirrors() -> set[str]:
    if not MIRRORS.is_dir():
        return set()
    return {p.name for p in MIRRORS.iterdir() if p.is_dir() and not p.name.startswith(".")}


def main() -> None:
    in_src = scriptids_in_sources()
    in_mir = scriptids_in_mirrors()

    src_ids = set(in_src.keys())
    healthy = sorted(src_ids & in_mir)
    orphan_mirrors = sorted(in_mir - src_ids)
    unmirrored_sources = sorted(src_ids - in_mir)

    md = [
        "# GAS clasp_mirrors orphan audit",
        "",
        f"_Generated: {date.today().isoformat()} by `scripts/audit_orphan_clasp_mirrors.py`. "
        f"Re-run any time `google_app_scripts/` or `clasp_mirrors/` change._",
        "",
        "Resolves the 51-vs-36 delta noted in "
        "[`agentic_ai_context/TOKENOMICS_GAS_RESTRUCTURE_PLAN.md` §2]"
        "(https://github.com/TrueSightDAO/agentic_ai_context/blob/main/TOKENOMICS_GAS_RESTRUCTURE_PLAN.md).",
        "",
        "## Summary",
        "",
        f"- **{len(in_src)}** distinct scriptIds referenced in `google_app_scripts/**/*.gs` "
        "source-comment URLs.",
        f"- **{len(in_mir)}** clasp_mirror folders.",
        f"- **{len(healthy)}** healthy (in both).",
        f"- **{len(orphan_mirrors)}** orphan mirrors (mirror exists; no source references it).",
        f"- **{len(unmirrored_sources)}** unmirrored sources (source references; no mirror folder — "
        "`clasp push` would fail without one).",
        "",
        "## Orphan mirrors (no source file references this scriptId)",
        "",
        "These mirrors have no `.gs` source under `google_app_scripts/` carrying the standard "
        "`script.google.com/home/projects/<scriptId>` header URL. Most likely deprecated or "
        "historical clones. **Restructure roadmap PR-2…PR-N resolves case-by-case** — don't "
        "auto-delete; some may be live GAS projects that just never had the source-comment "
        "convention applied.",
        "",
    ]
    if not orphan_mirrors:
        md.append("_(none — every mirror is referenced by at least one source.)_")
    else:
        for sid in orphan_mirrors:
            md.append(f"- `clasp_mirrors/{sid}/`")
    md.append("")
    md.append("## Unmirrored sources (source references scriptId; no mirror folder)")
    md.append("")
    md.append(
        "These would fail at `clasp push` time because there is no local clasp project to push "
        "to. Mint the mirror via `scripts/clone_clasp_mirrors.mjs` (or whatever the workspace "
        "convention is) **before** the restructure PR for that scriptId lands."
    )
    md.append("")
    if not unmirrored_sources:
        md.append("_(none — every referenced scriptId has a corresponding mirror folder.)_")
    else:
        for sid in unmirrored_sources:
            files = "\n".join(f"    - `{f}`" for f in sorted(in_src[sid]))
            md.append(f"- `{sid}` — referenced by:\n{files}")
    md.append("")
    md.append("## Healthy")
    md.append("")
    md.append(f"_{len(healthy)} scriptIds appear in both `google_app_scripts/` and `clasp_mirrors/`._")
    if healthy:
        md.append("")
        md.append("<details><summary>Show full list</summary>\n")
        for sid in healthy:
            md.append(f"- `{sid}`")
        md.append("\n</details>")
    md.append("")

    out_path = ROOT / "docs" / "gas_orphan_mirror_audit.md"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(md), encoding="utf-8")
    print(f"wrote {out_path.relative_to(ROOT)}: "
          f"{len(healthy)} healthy, {len(orphan_mirrors)} orphans, "
          f"{len(unmirrored_sources)} unmirrored")


if __name__ == "__main__":
    main()
