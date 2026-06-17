#!/usr/bin/env python3
"""Deploy a single GAS project: clasp push from google_app_scripts/<scriptId>/.

Each folder under google_app_scripts/ whose name is a GAS scriptId is a
self-contained project — the files in the folder ARE what gets deployed.
No sync, no mapping, no mirror layer.  ``clasp push --force`` runs directly
from the project folder.

Usage:
    scripts/deploy_gas_project.py <scriptId>                 # dry-run
    scripts/deploy_gas_project.py <scriptId> --push          # clasp push
    scripts/deploy_gas_project.py <scriptId> --push --with-hooks  # + post-push hooks
    scripts/deploy_gas_project.py --list                     # list all project folders"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECTS = ROOT / "google_app_scripts"
CLASPRC = Path(os.environ.get("CLASPRC_PATH") or os.path.expanduser("~/.clasprc.json"))


# ── clasp identity resolution ──────────────────────────────────────────────

def resolve_clasp_identity() -> tuple[str | None, str | None]:
    """Return (email, error) of the active clasp account."""
    if not CLASPRC.is_file():
        return None, f"no clasprc at {CLASPRC}"
    try:
        rc = json.loads(CLASPRC.read_text(encoding="utf-8"))
    except Exception as e:
        return None, f"failed to parse {CLASPRC}: {e}"
    tok = (rc.get("tokens") or {}).get("default") or {}
    client_id = tok.get("client_id") or ""
    client_secret = tok.get("client_secret") or ""
    refresh_token = tok.get("refresh_token") or ""
    if not (client_id and client_secret and refresh_token):
        return None, "clasprc missing client_id/secret/refresh_token"
    try:
        data = urllib.parse.urlencode({
            "client_id": client_id, "client_secret": client_secret,
            "refresh_token": refresh_token, "grant_type": "refresh_token",
        }).encode("utf-8")
        req = urllib.request.Request("https://oauth2.googleapis.com/token", data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"})
        resp = json.loads(urllib.request.urlopen(req, timeout=10).read())
        access = resp.get("access_token")
        if not access:
            return None, f"no access_token: {resp}"
        info = json.loads(urllib.request.urlopen(
            urllib.request.Request("https://www.googleapis.com/oauth2/v3/userinfo",
                headers={"Authorization": f"Bearer {access}"}),
            timeout=10).read())
        return (info.get("email") or None), None
    except Exception as e:
        return None, str(e)


# ── project discovery ──────────────────────────────────────────────────────

def list_projects() -> list[str]:
    """Return sorted list of scriptIds that have a .clasp.json."""
    out = []
    for d in sorted(PROJECTS.iterdir()):
        if d.is_dir() and (d / ".clasp.json").exists():
            out.append(d.name)
    return out


def find_manifest_for(sid: str) -> dict | None:
    """Return the project manifest from google_app_scripts/<sid>/manifest.json, if it exists."""
    mpath = PROJECTS / sid / "manifest.json"
    if mpath.is_file():
        try:
            return json.loads(mpath.read_text(encoding="utf-8"))
        except Exception:
            pass
    return None


# ── clasp push ──────────────────────────────────────────────────────────────

def run_clasp_push(project_dir: Path, dry_run: bool) -> bool:
    if dry_run:
        print(f"  [DRY-RUN]  cd {project_dir.relative_to(ROOT)} && clasp push --force")
        return True
    print(f"             cd {project_dir.relative_to(ROOT)} && clasp push --force")
    try:
        r = subprocess.run(["clasp", "push", "--force"], cwd=project_dir,
            capture_output=True, text=True, check=False)
        for line in (r.stdout or "").splitlines():
            print(f"             | {line}")
        if r.returncode != 0:
            print(f"  X clasp push exited {r.returncode}")
            for line in (r.stderr or "").splitlines():
                print(f"             ! {line}")
            return False
        return True
    except FileNotFoundError:
        print("  X clasp not installed (or not on PATH)")
        return False


# ── post-push hooks ─────────────────────────────────────────────────────────

def run_post_push_hooks(project: dict, dry_run: bool) -> bool:
    hooks = project.get("post_push_hooks") or []
    candidates = project.get("candidate_cache_refresh_hooks") or []
    if candidates and not hooks:
        print(f"  ! {len(candidates)} candidate hook(s) not fired (promote to post_push_hooks)")
    if not hooks:
        print("  (no post_push_hooks)")
        return True
    ok = True
    for i, hook in enumerate(hooks, 1):
        url = hook.get("url", "")
        method = (hook.get("method") or "GET").upper()
        body = hook.get("body")
        label = hook.get("label") or f"hook #{i}"
        if not url:
            print(f"  X hook '{label}' missing url")
            ok = False; continue
        if isinstance(body, dict):
            body = {k: (os.environ.get(v[1:], "") if isinstance(v, str) and v.startswith("$") else v)
                    for k, v in body.items()}
        body_bytes = None
        headers = {"User-Agent": "tokenomics-deploy/1"}
        if body is not None:
            body_bytes = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if dry_run:
            preview = f"{method} {url}"
            if body: preview += f" body={json.dumps(body)[:120]}"
            print(f"  [DRY-RUN]  {label}: {preview}")
            continue
        print(f"             {label}: {method} {url}")
        try:
            req = urllib.request.Request(url, data=body_bytes, method=method, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                print(f"             -> HTTP {resp.status}")
        except Exception as e:
            print(f"             -> error: {e}")
            ok = False
    return ok


# ── main ────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("scriptId", nargs="?", help="GAS scriptId to deploy")
    ap.add_argument("--push", action="store_true", help="actually clasp push")
    ap.add_argument("--with-hooks", action="store_true", help="fire post_push_hooks (with --push)")
    ap.add_argument("--no-hooks", action="store_true", help="skip hooks explicitly")
    ap.add_argument("--list", action="store_true", help="list all projects")
    ap.add_argument("--allow-identity-mismatch", action="store_true",
                    help="push even when clasp identity != owner_email")
    args = ap.parse_args()

    if args.list:
        for sid in list_projects():
            proj = find_manifest_for(sid)
            name = (proj.get("name") or sid) if proj else sid
            print(f"  {sid}   {name}")
        return 0

    if not args.scriptId:
        ap.print_help()
        return 2

    sid = args.scriptId
    project_dir = PROJECTS / sid
    if not project_dir.is_dir() or not (project_dir / ".clasp.json").exists():
        print(f"X no project folder for {sid}")
        print(f"  expected: {project_dir}/.clasp.json")
        return 1

    dry_run = not args.push
    fire_hooks = args.push and args.with_hooks and not args.no_hooks
    print(f"=== deploy_gas_project  scriptId={sid}  dry_run={dry_run}  fire_hooks={fire_hooks} ===\n")

    proj = find_manifest_for(sid)
    owner_email = (proj.get("owner_email") or "").strip().lower() if proj else ""
    files = sorted(f.name for f in project_dir.iterdir() if f.is_file()
                   and f.name not in (".clasp.json", "appsscript.json", "Version.gs", "manifest.json", ".claspignore"))
    print(f"  owner_email:  {owner_email or '?'}")
    print(f"  project dir:  {project_dir.relative_to(ROOT)}")
    print(f"  files:        {files}")

    # Identity check
    active_email, identity_err = resolve_clasp_identity()
    if active_email:
        print(f"  clasp:        {active_email}")
    elif identity_err:
        print(f"  clasp:        (unresolved — {identity_err})")

    if owner_email and active_email and active_email.lower() != owner_email:
        msg = (f"\nX identity mismatch — refusing to push.\n"
               f"    owner:  {owner_email}\n    clasp:  {active_email}\n"
               f"  Override with --allow-identity-mismatch.")
        if args.push and not args.allow_identity_mismatch:
            print(msg); return 1
        elif args.push:
            print(f"\n! --allow-identity-mismatch set; pushing anyway:{msg}")
        else:
            print(f"\n! identity mismatch (dry-run):{msg}")

    # Push
    print("\n--- clasp push ---")
    if not run_clasp_push(project_dir, dry_run=dry_run):
        return 1

    # Hooks
    if proj:
        print("\n--- post-push hooks ---")
        if fire_hooks:
            if not run_post_push_hooks(proj, dry_run=False):
                return 1
        else:
            run_post_push_hooks(proj, dry_run=True)
            if not args.push:
                print("  (dry-run — use --push to deploy)")
            elif not args.with_hooks:
                print("  (--with-hooks not passed)")
    else:
        print("\n  (no manifest entry — hooks skipped)")

    print("\n=== done ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
