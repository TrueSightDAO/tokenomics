#!/usr/bin/env python3
"""Read-only GAS drift audit: live @HEAD (clasp pull) vs the git working tree.

Why this exists
---------------
`clasp push --force` makes the LOCAL folder authoritative and DELETES any live
file that has no local counterpart.  So when a project is edited in the Apps
Script editor and never committed, the next push from a clean checkout silently
clobbers it.  This script measures that gap; it NEVER writes to GAS.

Classification (per project)
----------------------------
  IN_SYNC            live == git for every code file
  DRIFT_CODE         a file exists in BOTH but differs  -> unsafe to push
  LIVE_ONLY_CODE     a live file has NO git counterpart -> push would DELETE it
  LIVE_ONLY_SECRETS  ...and that live-only file is a Credentials* file
  UNREACHABLE        scriptId returns "Requested entity was not found"
  NOT_IN_REPO        folder has .clasp.json but no git-tracked dir

Usage
-----
  python3 scripts/audit_gas_drift.py [--repo PATH] [--projects ID ...]
                                     [--json OUT] [--md OUT] [--jobs N]

Exit code 2 if any project is DRIFT_CODE or LIVE_ONLY_CODE (CI-gate friendly).
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import os
import shutil
import subprocess
import sys
import tempfile

# clasp auto-injects Version.js and seeds these; they are not authored source.
IGNORE = {
    ".clasp.json",
    "manifest.json",
    "README.md",
    "Credentials.sample.js",
    "Version.gs",
    "Version.js",
}


def _run(cmd, cwd=None, timeout=60):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)


def git_tree(repo: str, ref: str = "HEAD") -> set[str]:
    """Repo-relative paths under google_app_scripts/ tracked at `ref`."""
    r = _run(
        ["git", "ls-tree", "-r", "--name-only", ref, "google_app_scripts"], cwd=repo
    )
    return {line.strip() for line in r.stdout.splitlines() if line.strip()}


def git_show(repo: str, ref: str, path: str) -> bytes:
    return _run(["git", "show", f"{ref}:{path}"], cwd=repo).stdout.encode()


def audit_one(repo: str, folder: str, tracked: set[str]) -> dict:
    sid = os.path.basename(folder.rstrip("/"))
    out = {
        "script_id": sid,
        "class": "IN_SYNC",
        "drift": [],
        "live_only": [],
        "repo_only": [],
        "secrets": [],
        "note": "",
    }
    work = tempfile.mkdtemp(prefix=f"gasdrift_{sid}_")
    try:
        shutil.copy(os.path.join(folder, ".clasp.json"), work)
        if _run(["clasp", "pull"], cwd=work, timeout=180).returncode != 0:
            out["class"] = "UNREACHABLE"
            out["note"] = "clasp pull failed (deleted / no access)"
            return out
        live = {
            f
            for f in os.listdir(work)
            if f not in IGNORE and os.path.isfile(os.path.join(work, f))
        }
        repo_rel = f"google_app_scripts/{sid}"
        repo_files = {
            os.path.basename(p)
            for p in tracked
            if p.startswith(repo_rel + "/") and os.path.basename(p) not in IGNORE
        }
        for f in sorted(live & repo_files):
            if (
                git_show(repo, "HEAD", f"{repo_rel}/{f}")
                != open(os.path.join(work, f), "rb").read()
            ):
                out["drift"].append(f)
        out["live_only"] = sorted(live - repo_files)
        out["secrets"] = [f for f in out["live_only"] if "credential" in f.lower()]
        out["repo_only"] = sorted(repo_files - live)
        if out["drift"]:
            out["class"] = "DRIFT_CODE"
        if out["live_only"] and out["live_only"] != ["Version.js"]:
            base = "LIVE_ONLY_SECRETS" if out["secrets"] else "LIVE_ONLY_CODE"
            out["class"] = base if not out["drift"] else f"{out['class']}+{base}"
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=".")
    ap.add_argument("--projects", nargs="*")
    ap.add_argument("--json")
    ap.add_argument("--md")
    ap.add_argument("--jobs", type=int, default=8)
    a = ap.parse_args()
    root = os.path.join(a.repo, "google_app_scripts")
    tracked = git_tree(a.repo, "HEAD")
    folders = [
        os.path.join(root, d)
        for d in sorted(os.listdir(root))
        if os.path.isfile(os.path.join(root, d, ".clasp.json"))
    ]
    if a.projects:
        folders = [f for f in folders if os.path.basename(f) in set(a.projects)]
    with cf.ThreadPoolExecutor(max_workers=a.jobs) as ex:
        rows = list(ex.map(lambda f: audit_one(a.repo, f, tracked), folders))
    bad = [r for r in rows if r["class"] not in ("IN_SYNC",)]
    if a.json:
        json.dump(rows, open(a.json, "w"), indent=2)
    if a.md:
        dash = chr(8212)  # em-dash; kept out of f-string expressions (py<3.12)
        with open(a.md, "w") as fh:
            fh.write("| scriptId | class | drift | live-only | repo-only |\n")
            fh.write("|---|---|---|---|---|\n")
            for r in rows:
                fh.write(
                    f"| `{r['script_id'][:12]}...` | {r['class']} | "
                    f"{', '.join(r['drift']) or dash} | "
                    f"{', '.join(r['live_only']) or dash} | "
                    f"{', '.join(r['repo_only']) or dash} |\n"
                )
    for r in rows:
        print(
            f"{r['script_id']}\t{r['class']}\tdrift:{','.join(r['drift'])}\t"
            f"live_only:{','.join(r['live_only'])}"
        )
    print(f"\n{len(rows)} projects, {len(bad)} not clean", file=sys.stderr)
    return (
        2
        if any(
            r["class"].startswith("DRIFT") or "LIVE_ONLY_CODE" in r["class"]
            for r in rows
        )
        else 0
    )


if __name__ == "__main__":
    raise SystemExit(main())
