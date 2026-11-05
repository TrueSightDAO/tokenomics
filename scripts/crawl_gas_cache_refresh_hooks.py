#!/usr/bin/env python3
"""Crawl cache-refresh hooks — mirror-grounded.

Operates on `clasp_mirrors/<scriptId>/Code.js` (the locally-clasp-pulled,
gitignored, concatenated source of every .gs file in that GAS project)
rather than scanning google_app_scripts/<theme>/*.gs for header-comment
URLs. The mirror IS the authoritative deployment unit — that's the lesson
of the orphan-mirror audit (some .gs sources don't carry the header
convention; some files outside thematic folders DO belong to a scriptId).

For each mirror's Code.js:
1. Find function definitions whose name contains both a "cache" stem AND
   a refresh-class verb (refresh / publish / update / invalidate / rebuild
   / sync / reset). Cache-write internals like `cacheAumBreakdown` are
   filtered out because they lack a refresh-class verb in the name.
2. Find string literals that contain both "refresh" and "cache" (the
   action-enum values a doPost / doGet handler dispatches on).

Also scans consumer repos for any reference to action=refresh_* with a
known /exec URL in the same line, binding the caller back to its scriptId
via the URL→scriptId map.

Output:
- Per-manifest field `candidate_cache_refresh_hooks` carries the discovered
  handler names, action strings, mirror Code.js paths, and consumer
  callers per scriptId.
- docs/gas_cache_refresh_hook_audit.md is the operator-triage table.

Conservative by design: candidates are NOT auto-promoted to post_push_hooks.
Operator confirms per project that firing the hook on every clasp push is
the intended side effect, then moves the entry into post_push_hooks with
a real URL+method+body.
"""
from __future__ import annotations

import json
import re
import subprocess
from datetime import date
from pathlib import Path

TOKENOMICS = Path(__file__).resolve().parent.parent
SRC = TOKENOMICS / "google_app_scripts"
MIRRORS = TOKENOMICS / "clasp_mirrors"
WORKSPACE = TOKENOMICS.parent
CONSUMER_REPOS = [
    "dapp",
    "truesight_autopilot",
    "agentic_ai_context",
    "agroverse_shop",
    "truesight_me",
    "agentic_ai_api_credentials",
    "ecosystem_change_logs",
    "market_research",
    "tokenomics",
]

REFRESH_VERBS = {"refresh", "publish", "update", "invalidate", "rebuild", "sync", "reset"}

FUNC_DEF_RE = re.compile(r"function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(")
STRING_LITERAL_RE = re.compile(r"['\"]([A-Za-z_][A-Za-z0-9_]{4,})['\"]")
EXEC_URL_RE = re.compile(r"https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec")
SCRIPT_ID_RE = re.compile(r"script\.google\.com/home/projects/([A-Za-z0-9_-]+)")
CONSUMER_ACTION_RE = re.compile(
    r"(?:action=|[\"']action[\"']\s*[:=]\s*[\"'])"
    r"([A-Za-z_][A-Za-z0-9_]*)"
)


def is_hook_func(name: str) -> bool:
    n = name.lower()
    return "cache" in n and any(v in n for v in REFRESH_VERBS)


def is_hook_action(literal: str) -> bool:
    n = literal.lower()
    return "refresh" in n and "cache" in n


def scan_mirror(code_js: Path) -> tuple[set[str], set[str]]:
    try:
        text = code_js.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return set(), set()
    funcs = {m for m in FUNC_DEF_RE.findall(text) if is_hook_func(m)}
    actions = {m for m in STRING_LITERAL_RE.findall(text) if is_hook_action(m)}
    return funcs, actions


def build_url_to_scriptid_map() -> dict[str, str]:
    """Mirror-grounded: read each mirror's Code.js for /exec URLs (most
    accurate source — the script knows its own deployment URL)."""
    out: dict[str, str] = {}
    if not MIRRORS.is_dir():
        return out
    for mdir in sorted(MIRRORS.iterdir()):
        if not mdir.is_dir():
            continue
        sid = mdir.name
        code = mdir / "Code.js"
        if not code.is_file():
            continue
        try:
            text = code.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for url in EXEC_URL_RE.findall(text):
            out[url] = sid

    # Augment with whatever the .gs source comments reveal (some .gs files
    # carry the URL in a doc comment that the bundled Code.js may not).
    for gs in SRC.rglob("*.gs"):
        try:
            text = gs.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        sids = set(SCRIPT_ID_RE.findall(text))
        if len(sids) != 1:
            continue
        sid = next(iter(sids))
        for url in EXEC_URL_RE.findall(text):
            out.setdefault(url, sid)
    return out


def consumer_grep_actions() -> list[tuple[str, str, str]]:
    """Return [(repo/path, action, line)] for any line referencing
    action=<something> in a consumer repo."""
    hits: list[tuple[str, str, str]] = []
    for repo in CONSUMER_REPOS:
        root = WORKSPACE / repo
        if not root.is_dir():
            continue
        try:
            r = subprocess.run(
                ["git", "-C", str(root), "grep", "-n", "-E",
                 r"(action=[A-Za-z_][A-Za-z0-9_]*|[\"']action[\"'][^,}]{0,40}[\"'][A-Za-z_][A-Za-z0-9_]*[\"'])"],
                capture_output=True, text=True, check=False,
            )
            for line in r.stdout.splitlines():
                parts = line.split(":", 2)
                if len(parts) != 3:
                    continue
                path, _ln, content = parts
                m = CONSUMER_ACTION_RE.search(content)
                if not m:
                    continue
                action = m.group(1)
                if not is_hook_action(action) and "refresh" not in action.lower():
                    continue
                hits.append((f"{repo}/{path}", action, content.strip()[:240]))
        except FileNotFoundError:
            continue
    return hits


def main() -> None:
    # Pass A — mirror-grounded discovery.
    per_sid: dict[str, dict] = {}
    if not MIRRORS.is_dir():
        print("  no clasp_mirrors/ directory — aborting")
        return
    for mdir in sorted(MIRRORS.iterdir()):
        if not mdir.is_dir() or mdir.name.startswith("."):
            continue
        sid = mdir.name
        code = mdir / "Code.js"
        if not code.is_file():
            continue
        funcs, actions = scan_mirror(code)
        if not funcs and not actions:
            continue
        per_sid[sid] = {
            "handler_functions": sorted(funcs),
            "action_strings": sorted(actions),
            "mirror_code_path": str(code.relative_to(TOKENOMICS)),
        }

    # Pass B — consumer-side bindings.
    url_to_sid = build_url_to_scriptid_map()
    consumer_hits = consumer_grep_actions()
    callers_by_sid: dict[str, list[dict]] = {}
    for path, action, line in consumer_hits:
        bound_sid = None
        for url, sid in url_to_sid.items():
            if url in line or url.split("/exec")[0] in line:
                bound_sid = sid
                break
        callers_by_sid.setdefault(bound_sid or "UNBOUND", []).append({
            "path": path, "action": action, "line": line,
        })

    # Build per-project candidate block.
    sid_to_block: dict[str, dict] = {}
    for sid, e in per_sid.items():
        callers = sorted({c["path"] for c in callers_by_sid.get(sid, [])})
        sid_to_block[sid] = {
            "handler_functions": e["handler_functions"],
            "action_strings": e["action_strings"],
            "mirror_code_path": e["mirror_code_path"],
            "consumer_callers_with_known_url": callers,
        }

    # Write into manifests.
    updated = 0
    for manifest_path in sorted(SRC.glob("*/manifest.json")):
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        changed = False
        for project in manifest.get("projects", []):
            sid = project.get("scriptId")
            block = sid_to_block.get(sid)
            if block is not None:
                new_list = [block]
            else:
                new_list = []
            if project.get("candidate_cache_refresh_hooks") != new_list:
                project["candidate_cache_refresh_hooks"] = new_list
                changed = True
        if changed:
            manifest_path.write_text(
                json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            updated += 1
            print(f"  updated {manifest_path.relative_to(TOKENOMICS)}")

    # Write audit doc.
    md = [
        "# GAS cache-refresh hook audit (mirror-grounded)",
        "",
        f"_Generated: {date.today().isoformat()} by `scripts/crawl_gas_cache_refresh_hooks.py`._",
        "",
        "Closes the cache-refresh-hooks pre-flight item in "
        "[`agentic_ai_context/TOKENOMICS_GAS_RESTRUCTURE_PLAN.md` §4]"
        "(https://github.com/TrueSightDAO/agentic_ai_context/blob/main/TOKENOMICS_GAS_RESTRUCTURE_PLAN.md).",
        "",
        "**Grounding shift (Gary, 2026-05-28):** earlier passes used `.gs` "
        "header-comment URLs in `google_app_scripts/<theme>/` as the source "
        "of which scriptId owns which file. That proxy missed real handlers "
        "(many `.gs` files don't carry the convention). This pass operates "
        "directly on `clasp_mirrors/<scriptId>/Code.js` — the bundled JS "
        "clasp actually pushes — which is authoritative.",
        "",
        "Approach is conservative: every match below is a **candidate** "
        "hook, not an auto-promoted `post_push_hooks` entry. Operator "
        "confirms per project that firing the hook on every `clasp push` "
        "is the intended side effect, then moves the entry into "
        "`post_push_hooks` with a real URL + method + body shape.",
        "",
        "## Candidates per scriptId",
        "",
    ]
    if not per_sid:
        md.append("_No cache-refresh handler patterns found in any mirror's `Code.js`._")
        md.append("")
    for sid in sorted(per_sid.keys()):
        e = per_sid[sid]
        md.append(f"### `{sid}`")
        md.append("")
        md.append(f"_Source: `{e['mirror_code_path']}`._")
        md.append("")
        if e["handler_functions"]:
            md.append("**Handler functions** (name contains both 'cache' and a refresh-class verb):")
            md.append("")
            for fn in e["handler_functions"]:
                md.append(f"- `{fn}`")
            md.append("")
        if e["action_strings"]:
            md.append("**Action-string literals** (dispatch values that mention both 'refresh' and 'cache'):")
            md.append("")
            for s in e["action_strings"]:
                md.append(f"- `'{s}'`")
            md.append("")
        callers = callers_by_sid.get(sid, [])
        if callers:
            md.append("**Consumer callers (URL-bound):**")
            md.append("")
            for c in callers:
                md.append(f"- `{c['path']}` — action `{c['action']}`")
            md.append("")
        md.append("")

    unbound = callers_by_sid.get("UNBOUND", [])
    if unbound:
        md.append("## Consumer callers using a refresh-style action but no resolvable scriptId binding")
        md.append("")
        for c in unbound:
            md.append(f"- `{c['path']}` — action `{c['action']}`")
        md.append("")

    md.append("## Summary")
    md.append("")
    total_handlers = sum(len(e["handler_functions"]) for e in per_sid.values())
    total_actions = sum(len(e["action_strings"]) for e in per_sid.values())
    consumer_total = sum(len(v) for v in callers_by_sid.values())
    md.append(f"- scriptIds with at least one candidate hook: **{len(per_sid)}**")
    md.append(f"- distinct handler functions discovered: **{total_handlers}**")
    md.append(f"- distinct refresh+cache action strings: **{total_actions}**")
    md.append(f"- consumer-side action references found: **{consumer_total}**")
    md.append("")
    md.append("Operator promotion path: confirm the candidate in the GAS UI, "
              "then move it from `candidate_cache_refresh_hooks` into the "
              "manifest's `post_push_hooks[]` with the full URL + method + body.")
    md.append("")

    out_path = TOKENOMICS / "docs" / "gas_cache_refresh_hook_audit.md"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(md), encoding="utf-8")
    print(f"wrote {out_path.relative_to(TOKENOMICS)}: "
          f"{len(per_sid)} scriptIds, {total_handlers} handlers, "
          f"{total_actions} action strings.")
    print(f"Manifests updated: {updated}")


if __name__ == "__main__":
    main()
