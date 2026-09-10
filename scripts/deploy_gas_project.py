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
import re
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
        data = urllib.parse.urlencode(
            {
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            }
        ).encode("utf-8")
        req = urllib.request.Request(
            "https://oauth2.googleapis.com/token",
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp = json.loads(urllib.request.urlopen(req, timeout=10).read())
        access = resp.get("access_token")
        if not access:
            return None, f"no access_token: {resp}"
        info = json.loads(
            urllib.request.urlopen(
                urllib.request.Request(
                    "https://www.googleapis.com/oauth2/v3/userinfo",
                    headers={"Authorization": f"Bearer {access}"},
                ),
                timeout=10,
            ).read()
        )
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
        r = subprocess.run(
            ["clasp", "push", "--force"],
            cwd=project_dir,
            capture_output=True,
            text=True,
            check=False,
        )
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
        print(
            f"  ! {len(candidates)} candidate hook(s) not fired (promote to post_push_hooks)"
        )
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
            ok = False
            continue
        if isinstance(body, dict):
            body = {
                k: (
                    os.environ.get(v[1:], "")
                    if isinstance(v, str) and v.startswith("$")
                    else v
                )
                for k, v in body.items()
            }
        body_bytes = None
        headers = {"User-Agent": "tokenomics-deploy/1"}
        if body is not None:
            body_bytes = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if dry_run:
            preview = f"{method} {url}"
            if body:
                preview += f" body={json.dumps(body)[:120]}"
            print(f"  [DRY-RUN]  {label}: {preview}")
            continue
        print(f"             {label}: {method} {url}")
        try:
            req = urllib.request.Request(
                url, data=body_bytes, method=method, headers=headers
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                print(f"             -> HTTP {resp.status}")
        except Exception as e:
            print(f"             -> error: {e}")
            ok = False
    return ok


# ── main ────────────────────────────────────────────────────────────────────



def repoint_deployment(
    project_dir: Path, deployment_id: str, description: str, dry_run: bool
) -> tuple[bool, str]:
    """Bump a version and repoint an existing pinned deployment at it.

    Root cause of stale GAS serving: clasp push only updates @HEAD; a
    pinned web-app deployment keeps serving its old captured version. This
    runs `clasp version` then `clasp deploy --deploymentId <id> -V <n>`
    so the live /exec URL follows the freshly pushed code. Returns
    (ok, version); version is the new version number on success.
    """
    if not deployment_id:
        return True, ""
    if dry_run:
        print(
            f"  [DRY-RUN]  clasp version {description!r} && "
            f"clasp deploy --deploymentId {deployment_id} -V <new> -d {description!r}"
        )
        return True, "dry-run"
    try:
        r = subprocess.run(
            ["clasp", "version", description],
            cwd=project_dir,
            capture_output=True,
            text=True,
            check=False,
        )
        for line in (r.stdout or "").splitlines():
            print(f"             | {line}")
        if r.returncode != 0:
            print(f"  X clasp version exited {r.returncode}")
            for line in (r.stderr or "").splitlines():
                print(f"             ! {line}")
            return False, ""
        m = re.search(r"Created version (\d+)", r.stdout or "")
        version = m.group(1) if m else ""
        if not version:
            print("  X could not parse new version from clasp version output")
            return False, ""
        d = subprocess.run(
            [
                "clasp",
                "deploy",
                "--deploymentId",
                deployment_id,
                "-V",
                version,
                "-d",
                description,
            ],
            cwd=project_dir,
            capture_output=True,
            text=True,
            check=False,
        )
        for line in (d.stdout or "").splitlines():
            print(f"             | {line}")
        if d.returncode != 0:
            print(f"  X clasp deploy exited {d.returncode}")
            for line in (d.stderr or "").splitlines():
                print(f"             ! {line}")
            return False, ""
        return True, version
    except FileNotFoundError:
        print("  X clasp not installed (or not on PATH)")
        return False, ""


# ── pre-push validation (2026-08 collision-class guardrail) ─────────────────


def validate_project_files(project_dir: Path, manifest: dict | None) -> list[str]:
    """Return hard errors that must block a GAS push.

    Apps Script compiles every file in a project into ONE global scope, so
    duplicate top-level const/let declarations raise a compile-time
    SyntaxError and every trigger run fails. clasp also refuses folders that
    contain same-basename .js and .gs files ("Conflicting files found").
    Both classes silently broke 20+ projects in Aug 2026; this catches them
    before they reach GAS.
    """
    errors: list[str] = []
    js_files = [
        f
        for f in sorted(project_dir.iterdir())
        if f.is_file()
        and f.suffix in (".js", ".gs")
        and f.name not in (".claspignore",)
    ]
    # 1. duplicate top-level const/let across files -> SyntaxError in GAS.
    # Only declarations at brace depth 0 are true globals: Apps Script
    # compiles all files into ONE global scope, so two files declaring the
    # same top-level const/let raise a compile-time SyntaxError. Block-scoped
    # locals inside functions (depth >= 1) are legal and must NOT count.
    def _top_level_decls(lines: list[str]) -> list[tuple[int, str]]:
        depth = 0
        out: list[tuple[int, str]] = []
        for lineno, line in enumerate(lines, 1):
            stripped = line.strip()
            if not stripped or stripped.startswith("//") or stripped.startswith("*"):
                continue
            depth_before = depth
            depth += stripped.count("{") - stripped.count("}")
            if depth_before == 0:
                m = re.match(
                    r"^(const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)\b", stripped
                )
                if m:
                    out.append((lineno, m.group(2)))
        return out

    decls: dict[str, list[str]] = {}
    for f in js_files:
        try:
            lines = f.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError as e:
            errors.append(f"unreadable {f.name}: {e}")
            continue
        for lineno, name in _top_level_decls(lines):
            decls.setdefault(name, []).append(f"{f.name}:{lineno}")
    for name, locs in decls.items():
        if len(locs) > 1:
            errors.append(
                f"duplicate top-level '{name}' at {' and '.join(locs)} "
                "(Apps Script shares one global scope -> SyntaxError)"
            )
    # 2. same-basename .js + .gs -> clasp 'Conflicting files found'
    by_stem: dict[str, list[str]] = {}
    for f in js_files:
        by_stem.setdefault(f.stem, []).append(f.name)
    for stem, names in by_stem.items():
        if len(names) > 1:
            errors.append(
                f"same-basename clash: {' + '.join(names)} "
                "(clasp refuses: 'Conflicting files found')"
            )
    return errors


# ── pre-push live-accessor guard (2026-09-10 ReferenceError incident) ──────
#
# Some projects keep a secret accessor file (Credentials.gs / Credentials.js)
# in the LIVE project only - it is gitignored AND .claspignore'd so a push
# never deletes it. But nothing guarantees it is actually THERE. A fresh
# checkout pushes a Code.js that calls setApiKeys()/getCredentials() while no
# file in the post-push set defines them, so every entry point dies at load
# with `ReferenceError: setApiKeys is not defined` (incidents 2026-09-06 and
# 2026-09-10, scriptId 19Wag9x...). This guard models the post-push file set
# (local sources + live-only files that survive because .claspignore protects
# them) and refuses the push when a required accessor would be undefined.
# Fail-open on any live-fetch problem so a hiccup never blocks a real deploy.

ACCESSOR_TEMPLATE_NAME = "Credentials.sample.js"


def _top_level_function_names(text: str) -> list[str]:
    """Return names of `function NAME(...)` declared at brace depth 0.

    Apps Script shares one global scope, so only depth-0 declarations are
    true globals; nested helpers must not count.
    """
    depth = 0
    names: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("//") and not stripped.startswith("*"):
            m = re.match(r"^function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(", stripped)
            if depth == 0 and m:
                names.append(m.group(1))
            depth += stripped.count("{") - stripped.count("}")
    return names


def _read_claspignore(project_dir: Path) -> list[str]:
    """Return non-comment lines of the project's .claspignore (if any)."""
    p = project_dir / ".claspignore"
    if not p.is_file():
        return []
    pats: list[str] = []
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            pats.append(line)
    return pats


def _basename_ignored(name: str, patterns: list[str]) -> bool:
    """True if a file/project-item name matches a .claspignore pattern.

    clasp strips extensions in the live project (Credentials.js lives as
    'Credentials'), so compare stems as well as full basenames.
    """
    from fnmatch import fnmatch

    stem = name.rsplit(".", 1)[0]
    for pat in patterns:
        pbase = os.path.basename(pat.rstrip("/"))
        pstem = pbase.rsplit(".", 1)[0]
        if fnmatch(name, pbase) or name == pstem or stem == pstem:
            return True
    return False


def _clasprc_access_token() -> tuple[str | None, str]:
    """Return (access_token, error) from the active clasp refresh token."""
    if not CLASPRC.is_file():
        return None, f"no clasprc at {CLASPRC}"
    try:
        rc = json.loads(CLASPRC.read_text(encoding="utf-8"))
    except Exception as e:
        return None, f"failed to parse {CLASPRC}: {e}"
    tok = (rc.get("tokens") or {}).get("default") or {}
    cid, csec, rt = (
        tok.get("client_id"),
        tok.get("client_secret"),
        tok.get("refresh_token"),
    )
    if not (cid and csec and rt):
        return None, "clasprc missing client_id/secret/refresh_token"
    try:
        data = urllib.parse.urlencode(
            {
                "client_id": cid,
                "client_secret": csec,
                "refresh_token": rt,
                "grant_type": "refresh_token",
            }
        ).encode("utf-8")
        resp = json.loads(
            urllib.request.urlopen(
                urllib.request.Request(
                    "https://oauth2.googleapis.com/token",
                    data=data,
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                ),
                timeout=10,
            ).read()
        )
        access = resp.get("access_token")
        return (access, "") if access else (None, f"no access_token: {resp}")
    except Exception as e:
        return None, str(e)


def fetch_live_project_files(sid: str) -> tuple[list[dict] | None, str]:
    """Fetch the LIVE project's files via the Apps Script API.

    Returns (files, error); files is None on any failure so the caller can
    fail OPEN (never block a legitimate push on a token/scope/network issue).
    """
    access, err = _clasprc_access_token()
    if not access:
        return None, err
    url = f"https://script.googleapis.com/v1/projects/{sid}/content"
    try:
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {access}"})
        content = json.loads(urllib.request.urlopen(req, timeout=20).read())
    except Exception as e:
        return None, f"{type(e).__name__}: {e}"
    return content.get("files", []), ""


def validate_accessor_survivability(
    project_dir: Path, sid: str
) -> tuple[list[str], str]:
    """Block a push that would leave a required secret accessor undefined.

    The accessor contract is whatever the tracked Credentials.sample.js
    declares. Returns (errors, note): non-empty errors must block the push;
    note is informational (e.g. the fail-open path).
    """
    sample = project_dir / ACCESSOR_TEMPLATE_NAME
    if not sample.is_file():
        return [], ""
    try:
        required = _top_level_function_names(
            sample.read_text(encoding="utf-8", errors="replace")
        )
    except OSError:
        return [], ""
    if not required:
        return [], ""

    local_sources = [
        f
        for f in sorted(project_dir.iterdir())
        if f.is_file()
        and f.suffix in (".js", ".gs")
        and f.name != ACCESSOR_TEMPLATE_NAME
    ]
    defined: set[str] = set()
    for f in local_sources:
        defined.update(
            _top_level_function_names(f.read_text(encoding="utf-8", errors="replace"))
        )

    if all(n in defined for n in required):
        return [], ""  # defined locally - no live dependency

    live, err = fetch_live_project_files(sid)
    if live is None:
        return [], f"live accessor check skipped (fail-open): {err}"

    ignore = _read_claspignore(project_dir)
    for lf in live:
        if _basename_ignored(lf.get("name") or "", ignore):
            defined.update(_top_level_function_names(lf.get("source") or ""))

    missing = sorted(n for n in required if n not in defined)
    if missing:
        return (
            [
                f"required accessor(s) {missing} are declared only by "
                f"{ACCESSOR_TEMPLATE_NAME} (gitignored) and are absent from both the "
                f"local sources and the live project's protected files - after this "
                f"push every entry point would fail with 'ReferenceError: "
                f"{missing[0]} is not defined'. Restore the live accessor from "
                f"{ACCESSOR_TEMPLATE_NAME} (Apps Script editor) before pushing."
            ],
            "",
        )
    return [], ""


def warn_if_orphan(project_dir: Path, sid: str) -> None:
    """Soft warning: scriptId absent from the active clasp account's project
    list => push will likely fail with 'Requested entity was not found'."""
    try:
        r = subprocess.run(
            ["clasp", "list"],
            cwd=project_dir,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except Exception:
        return
    if sid in (r.stdout or ""):
        return
    print(
        f"  ! scriptId {sid} not found in active clasp account's project list "
        f"— push may fail with 'Requested entity was not found' "
        f"(orphan/superseded scriptId?)"
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("scriptId", nargs="?", help="GAS scriptId to deploy")
    ap.add_argument("--push", action="store_true", help="actually clasp push")
    ap.add_argument(
        "--with-hooks", action="store_true", help="fire post_push_hooks (with --push)"
    )
    ap.add_argument("--no-hooks", action="store_true", help="skip hooks explicitly")
    ap.add_argument("--list", action="store_true", help="list all projects")
    ap.add_argument(
        "--allow-identity-mismatch",
        action="store_true",
        help="push even when clasp identity != owner_email",
    )
    ap.add_argument(
        "--skip-accessor-guard",
        action="store_true",
        help="push even if the live secret-accessor (Credentials.js) survivability check fails",
    )
    ap.add_argument(
        "--lease-id",
        default="",
        help="upstream DEPLOY_PUSH_SOP lease (skip ledger — tool owns it)",
    )
    ap.add_argument(
        "--deployment-id",
        default="",
        help="repoint this pinned deployment at the new code (clasp version + clasp deploy -i)",
    )
    ap.add_argument(
        "--deploy-description",
        default="",
        help="version/description label for the repoint (default: auto)",
    )
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
    print(
        f"=== deploy_gas_project  scriptId={sid}  dry_run={dry_run}  fire_hooks={fire_hooks} ===\n"
    )

    proj = find_manifest_for(sid)
    owner_email = (proj.get("owner_email") or "").strip().lower() if proj else ""
    files = sorted(
        f.name
        for f in project_dir.iterdir()
        if f.is_file()
        and f.name
        not in (
            ".clasp.json",
            "appsscript.json",
            "Version.gs",
            "manifest.json",
            ".claspignore",
        )
    )
    print(f"  owner_email:  {owner_email or '?'}")
    print(f"  project dir:  {project_dir.relative_to(ROOT)}")
    print(f"  files:        {files}")

    # Pre-push validation (2026-08 incident guardrail): refuse to push folders
    # with collision classes that hard-break GAS deploys.
    v_errors = validate_project_files(project_dir, proj)
    for err in v_errors:
        print(f"  X {err}")
    if v_errors:
        print("\nX refusing to push — fix project files first.")
        return 1

    # Live-accessor survivability guard (2026-09-10 ReferenceError incident):
    # a gitignored, .claspignore'd secret accessor can silently be ABSENT from
    # the live project. Model the post-push file set and refuse a push that
    # would leave a called accessor undefined. Fail-open on live-fetch error.
    if not args.skip_accessor_guard:
        a_errors, a_note = validate_accessor_survivability(project_dir, sid)
        for err in a_errors:
            print(f"  X {err}")
        if a_errors:
            print(
                "\nX refusing to push — accessor guard "
                "(override: --skip-accessor-guard)."
            )
            return 1
        if a_note:
            print(f"  ! {a_note}")

    # Identity check
    active_email, identity_err = resolve_clasp_identity()
    if active_email:
        print(f"  clasp:        {active_email}")
    elif identity_err:
        print(f"  clasp:        (unresolved — {identity_err})")

    if owner_email and active_email and active_email.lower() != owner_email:
        msg = (
            f"\nX identity mismatch — refusing to push.\n"
            f"    owner:  {owner_email}\n    clasp:  {active_email}\n"
            f"  Override with --allow-identity-mismatch."
        )
        if args.push and not args.allow_identity_mismatch:
            print(msg)
            return 1
        elif args.push:
            print(f"\n! --allow-identity-mismatch set; pushing anyway:{msg}")
        else:
            print(f"\n! identity mismatch (dry-run):{msg}")

    if args.push:
        warn_if_orphan(project_dir, sid)

    # DEPLOY_PUSH_SOP Phase 2: soft-lock lease before any real push.
    # The autopilot tool (gas_deploy_project.py) acquires the lease itself and
    # passes --lease-id; when set, upstream owns the ledger and we skip.
    # Without it (direct LLM run), acquire our own lease + record after.
    lease_id = args.lease_id or ""
    ledger = None
    if args.push and not lease_id:
        import deploy_ledger as ledger_mod  # sibling in scripts/

        ledger = ledger_mod
        lease = ledger.check_lease("clasp", sid)
        if lease.get("status") == "blocked":
            me = os.environ.get("DEPLOY_LEDGER_AGENT", "sophia")
            try:
                now = __import__("datetime").datetime.now(
                    __import__("datetime").timezone.utc
                )
                same_agent_fresh = (
                    all(
                        l.get("agent") == me
                        and 0
                        <= (
                            now
                            - __import__("datetime").datetime.fromisoformat(
                                l.get("started_at_utc", "").replace("Z", "+00:00")
                            )
                        ).total_seconds()
                        < 180
                        for l in lease.get("leases", [])
                    )
                    if lease.get("leases")
                    else False
                )
            except Exception:
                same_agent_fresh = False
            if same_agent_fresh:
                print(
                    "  ! live lease owned by this agent's upstream tool — skipping ledger (not closing)"
                )
                ledger = None
            else:
                print(
                    f"X DEPLOY_PUSH_SOP: live lease blocks this push: {lease.get('leases')}"
                )
                print("  (another agent is mid-push on this scriptId — TTL 30 min)")
                return 1
        elif lease.get("status") == "error":
            print(f"  ! deploy ledger unavailable (fail-open): {lease.get('reason')}")
        else:
            acq = ledger.acquire_lease(
                "clasp", sid, f"deploy_gas_project.py {sid} --push"
            )
            if acq.get("status") == "success":
                lease_id = acq.get("lease_id", "")
                print(f"  DEPLOY_PUSH_SOP: acquired lease {lease_id}")
            else:
                print(f"  ! lease acquire failed (fail-open): {acq.get('error')}")

    # Push
    if not run_clasp_push(project_dir, dry_run=dry_run):
        if args.push and lease_id and ledger is not None:
            rec = ledger.append_deploy_record(
                agent=os.environ.get("DEPLOY_LEDGER_AGENT", "sophia"),
                target_type="clasp",
                target_id=sid,
                action=f"deploy_gas_project.py {sid} --push"
            + (f" + repoint {args.deployment_id} @{deploy_version}" if args.deployment_id else ""),
                result="failure",
                evidence_url="",
                lease_id=lease_id,
                notes="clasp push failed (DEPLOY_PUSH_SOP Phase 2)",
            )
            print(f"  deploy_ledger: {rec}")
            ledger.close_lease(lease_id)
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

    # Pinned-deployment repoint (root cause of stale GAS serving): after a
    # successful push, bump a version and repoint the requested deployment.
    deploy_version = ""
    if args.deployment_id:
        print("\n--- pinned deployment repoint ---")
        ok_repoint, deploy_version = repoint_deployment(
            project_dir, args.deployment_id, args.deploy_description or f"deploy_gas_project {sid} push", dry_run
        )
        if not ok_repoint:
            return 1

    # DEPLOY_PUSH_SOP Phase 2: append audit record + close the lease (only
    # when we own it — upstream tool records/closes its own).
    if args.push and lease_id and ledger is not None:
        rec = ledger.append_deploy_record(
            agent=os.environ.get("DEPLOY_LEDGER_AGENT", "sophia"),
            target_type="clasp",
            target_id=sid,
            action=f"deploy_gas_project.py {sid} --push"
            + (f" + repoint {args.deployment_id} @{deploy_version}" if args.deployment_id else ""),
            result="success",
            evidence_url=f"https://github.com/TrueSightDAO/tokenomics/tree/main/google_app_scripts/{sid}",
            lease_id=lease_id,
            notes="direct LLM-run deploy (DEPLOY_PUSH_SOP Phase 2)",
        )
        print(f"  deploy_ledger: {rec}")
        ledger.close_lease(lease_id)
        if rec.get("status") != "success":
            print(f"  ! deploy record append failed (non-fatal): {rec.get('error')}")

    print("\n=== done ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
