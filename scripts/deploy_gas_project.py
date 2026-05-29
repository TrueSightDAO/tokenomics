#!/usr/bin/env python3
"""Deploy a single GAS project end-to-end: source-sync → clasp push → post-push hooks.

Manifest-driven. The single source of truth for what to deploy and what to fire
afterwards is each `google_app_scripts/<theme>/manifest.json`.

Usage:
    # Dry-run (default) — print everything that would happen, change nothing
    scripts/deploy_gas_project.py <scriptId>

    # Actually push
    scripts/deploy_gas_project.py <scriptId> --push

    # Also fire every entry in `post_push_hooks[]` for this scriptId
    scripts/deploy_gas_project.py <scriptId> --push --with-hooks

    # Push without firing hooks (the safe first-time default)
    scripts/deploy_gas_project.py <scriptId> --push --no-hooks

    # List every scriptId that has a manifest entry
    scripts/deploy_gas_project.py --list

How it works:

1. Walk every `google_app_scripts/<theme>/manifest.json`. Collect every
   project block whose `scriptId` matches the argument. (Some scriptIds
   appear in source files spread across more than one thematic folder —
   the deploy unit is the **scriptId**, not the thematic folder, so we
   pool source_files across every matching manifest.)
2. Resolve every `source_files[]` relative path to its `.gs` source under
   `google_app_scripts/<theme>/<file>`.
3. Sync those source files into `clasp_mirrors/<scriptId>/` so the mirror
   matches what should be deployed. Strip any stale `.gs` from the mirror
   that no manifest claims, to keep the deploy unit honest.
4. `clasp push --force` from the mirror (when `--push`).
5. For each entry in the project's `post_push_hooks[]` (when `--with-hooks`),
   fire the URL+method+body. Skip `candidate_cache_refresh_hooks` — those
   are operator-triage candidates, not promoted hooks.

Safety:

- Dry-run by default. Nothing changes on disk or in GAS unless you pass
  `--push`. Hooks don't fire unless you also pass `--with-hooks`.
- Refuses to push when there are uncommitted changes to source files for
  this scriptId — push the working tree intentionally, don't accidentally
  ship in-progress edits.
- Reads `manifest.json` only; never edits it. To change which sources
  belong to a project, edit the manifest first.

Idempotent: re-running with the same args is a no-op when the mirror is
already in sync with source.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "google_app_scripts"
MIRRORS = ROOT / "clasp_mirrors"


# ── manifest discovery ────────────────────────────────────────────────────


def discover_projects_for_scriptid(target_sid: str) -> list[dict]:
    """Return [{thematic_folder, source_files: [Path], project: dict}] for
    every project block whose scriptId matches `target_sid`."""
    out: list[dict] = []
    for manifest_path in sorted(SRC.glob("*/manifest.json")):
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"  ! skipping unreadable manifest {manifest_path}: {e}", file=sys.stderr)
            continue
        thematic = manifest_path.parent
        for project in data.get("projects", []):
            if project.get("scriptId") != target_sid:
                continue
            source_paths = [thematic / f for f in project.get("source_files", [])]
            out.append({
                "thematic_folder": thematic,
                "source_files": source_paths,
                "project": project,
            })
    return out


def list_all_scriptids() -> list[tuple[str, str]]:
    """Returns [(scriptId, thematic_folder_name), ...] across all manifests."""
    out: list[tuple[str, str]] = []
    for manifest_path in sorted(SRC.glob("*/manifest.json")):
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        for project in data.get("projects", []):
            sid = project.get("scriptId")
            if sid:
                out.append((sid, manifest_path.parent.name))
    return out


# ── sync logic ─────────────────────────────────────────────────────────────


def _file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(64 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def plan_mirror_sync(scriptId: str, source_files: list[Path]) -> dict:
    """Return a dict describing what the sync would do. Does not touch disk."""
    mirror = MIRRORS / scriptId
    plan = {
        "mirror_dir": mirror,
        "mirror_exists": mirror.is_dir(),
        "to_copy": [],     # [(source, mirror_target)]
        "to_skip_identical": [],
        "to_remove_stale": [],  # mirror .gs files not in manifest
        "missing_source": [],
    }
    if not mirror.is_dir():
        return plan

    # Map manifest source basenames → expected mirror filenames.
    expected_basenames: set[str] = set()
    for src in source_files:
        if not src.is_file():
            plan["missing_source"].append(src)
            continue
        basename = src.name  # keep the same .gs filename in the mirror
        expected_basenames.add(basename)
        mirror_target = mirror / basename
        if mirror_target.is_file() and _file_hash(src) == _file_hash(mirror_target):
            plan["to_skip_identical"].append((src, mirror_target))
        else:
            plan["to_copy"].append((src, mirror_target))

    # Stale: any .gs in the mirror NOT in the expected basenames.
    # Leave Version.gs / appsscript.json / Credentials.js / Code.js intact — those
    # are clasp-managed bundles or clasp config. Only prune additional .gs files
    # that the manifest no longer claims.
    PRESERVE = {"Version.gs", "appsscript.json", "Credentials.js", "Code.js"}
    for existing in sorted(mirror.glob("*.gs")):
        if existing.name in PRESERVE:
            continue
        if existing.name not in expected_basenames:
            plan["to_remove_stale"].append(existing)

    return plan


def apply_mirror_sync(plan: dict, dry_run: bool) -> bool:
    """Apply the sync plan; return True on success."""
    if plan["missing_source"]:
        print("  ✗ missing source files (cannot deploy):")
        for p in plan["missing_source"]:
            print(f"      {p}")
        return False
    if not plan["mirror_exists"]:
        print(f"  ✗ mirror directory missing: {plan['mirror_dir']}")
        print(f"      mint it first via:")
        print(f"      mkdir -p {plan['mirror_dir']} && cd {plan['mirror_dir']} && clasp clone <scriptId> --rootDir .")
        return False

    for src, target in plan["to_copy"]:
        rel_src = src.relative_to(ROOT)
        rel_target = target.relative_to(ROOT)
        if dry_run:
            print(f"  [DRY-RUN]  copy  {rel_src}  →  {rel_target}")
        else:
            shutil.copy2(src, target)
            print(f"             copy  {rel_src}  →  {rel_target}")
    for src, target in plan["to_skip_identical"]:
        print(f"  ⏭  unchanged   {src.relative_to(ROOT)}")
    for stale in plan["to_remove_stale"]:
        rel = stale.relative_to(ROOT)
        if dry_run:
            print(f"  [DRY-RUN]  remove stale  {rel}")
        else:
            stale.unlink()
            print(f"             remove stale  {rel}")
    return True


# ── clasp push ─────────────────────────────────────────────────────────────


def run_clasp_push(mirror_dir: Path, dry_run: bool) -> bool:
    if dry_run:
        print(f"  [DRY-RUN]  cd {mirror_dir.relative_to(ROOT)} && clasp push --force")
        return True
    print(f"             cd {mirror_dir.relative_to(ROOT)} && clasp push --force")
    try:
        r = subprocess.run(
            ["clasp", "push", "--force"],
            cwd=mirror_dir,
            capture_output=True, text=True, check=False,
        )
        # clasp 3 prints to stdout; surface both
        if r.stdout:
            for line in r.stdout.splitlines():
                print(f"             | {line}")
        if r.returncode != 0:
            print(f"  ✗ clasp push exited {r.returncode}")
            if r.stderr:
                for line in r.stderr.splitlines():
                    print(f"             ! {line}")
            return False
        return True
    except FileNotFoundError:
        print("  ✗ clasp not installed (or not on PATH)")
        return False


# ── post-push hooks ────────────────────────────────────────────────────────


def run_post_push_hooks(project: dict, dry_run: bool) -> bool:
    hooks = project.get("post_push_hooks") or []
    candidates = project.get("candidate_cache_refresh_hooks") or []
    if candidates and not hooks:
        print(f"  ⚠  {len(candidates)} candidate cache-refresh hook(s) NOT fired — promote them to "
              f"post_push_hooks in manifest.json after operator review (see docs/gas_cache_refresh_hook_audit.md).")
    if not hooks:
        print("  (no post_push_hooks configured for this scriptId)")
        return True

    import urllib.request
    import urllib.error
    ok = True
    for i, hook in enumerate(hooks, 1):
        url = hook.get("url", "")
        method = (hook.get("method") or "GET").upper()
        body = hook.get("body")
        label = hook.get("label") or f"hook #{i}"
        if not url:
            print(f"  ✗ hook '{label}' missing url; skipping")
            ok = False
            continue
        # Resolve $ENV_VAR placeholders inside body values (per the manifest
        # schema doc in TOKENOMICS_GAS_RESTRUCTURE_PLAN.md §3).
        if isinstance(body, dict):
            body = {k: (os.environ.get(v[1:], "") if isinstance(v, str) and v.startswith("$") else v)
                    for k, v in body.items()}
        body_bytes = None
        headers = {"User-Agent": "tokenomics-deploy-gas-project/0.1"}
        if body is not None:
            body_bytes = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if dry_run:
            preview = f"{method} {url}"
            if body is not None:
                preview += f" body={json.dumps(body)[:120]}"
            print(f"  [DRY-RUN]  hook '{label}': {preview}")
            continue
        print(f"             hook '{label}': {method} {url}")
        try:
            req = urllib.request.Request(url, data=body_bytes, method=method, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                print(f"             → HTTP {resp.status}")
        except urllib.error.HTTPError as e:
            print(f"             → HTTP {e.code} {e.reason}")
            ok = False
        except Exception as e:
            print(f"             → error: {e}")
            ok = False
    return ok


# ── working-tree safety ────────────────────────────────────────────────────


def uncommitted_in_paths(paths: list[Path]) -> list[Path]:
    """Return any of `paths` that have uncommitted changes vs HEAD."""
    if not paths:
        return []
    try:
        r = subprocess.run(
            ["git", "-C", str(ROOT), "diff", "--name-only", "HEAD", "--"]
            + [str(p.relative_to(ROOT)) for p in paths],
            capture_output=True, text=True, check=False,
        )
        return [ROOT / line for line in r.stdout.splitlines() if line]
    except FileNotFoundError:
        return []


# ── main ────────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("scriptId", nargs="?", help="GAS scriptId to deploy")
    ap.add_argument("--push", action="store_true", help="actually clasp push (default: dry-run)")
    ap.add_argument("--with-hooks", action="store_true",
                    help="also fire post_push_hooks[] (only with --push; default: skipped)")
    ap.add_argument("--no-hooks", action="store_true",
                    help="explicit: skip hooks even if --with-hooks shows up")
    ap.add_argument("--list", action="store_true", help="list every known scriptId and exit")
    ap.add_argument("--force-uncommitted", action="store_true",
                    help="push even when source has uncommitted git changes (default: refuse)")
    args = ap.parse_args()

    if args.list:
        rows = list_all_scriptids()
        if not rows:
            print("No projects discovered in manifests under google_app_scripts/.")
            return 0
        width = max(len(sid) for sid, _ in rows)
        for sid, theme in rows:
            print(f"  {sid:<{width}}   {theme}")
        return 0

    if not args.scriptId:
        ap.print_help()
        return 2

    target = args.scriptId
    dry_run = not args.push
    fire_hooks = args.push and args.with_hooks and not args.no_hooks

    print(f"=== deploy_gas_project  scriptId={target}  dry_run={dry_run}  fire_hooks={fire_hooks} ===\n")

    projects = discover_projects_for_scriptid(target)
    if not projects:
        print(f"✗ no manifest entry references scriptId {target}")
        print(f"  (run `scripts/deploy_gas_project.py --list` to see known scriptIds)")
        return 1

    # Pool source_files across every thematic folder that references this
    # scriptId. The deploy unit is the scriptId; thematic folder is only a
    # readability convention.
    all_sources: list[Path] = []
    seen_basenames: set[str] = set()
    for entry in projects:
        for src in entry["source_files"]:
            if src.name in seen_basenames:
                continue
            seen_basenames.add(src.name)
            all_sources.append(src)
        print(f"  manifest: {entry['thematic_folder'].relative_to(ROOT)}/manifest.json"
              f"  files: {[s.name for s in entry['source_files']]}")
    if not all_sources:
        print(f"\n✗ scriptId {target} has zero source_files across all manifests — nothing to deploy")
        return 1

    project_block = projects[0]["project"]
    print(f"\n  owner_email:     {project_block.get('owner_email', '?')}")
    print(f"  source_files:    {[s.name for s in all_sources]}")

    # Safety: refuse to push when source has uncommitted changes.
    if args.push and not args.force_uncommitted:
        dirty = uncommitted_in_paths(all_sources)
        if dirty:
            print("\n✗ refusing to push — these source files have uncommitted changes vs HEAD:")
            for p in dirty:
                print(f"    {p.relative_to(ROOT)}")
            print("  commit or stash first, or pass --force-uncommitted to override.")
            return 1

    # Sync
    print("\n--- sync source → mirror ---")
    plan = plan_mirror_sync(target, all_sources)
    if not apply_mirror_sync(plan, dry_run=dry_run):
        return 1

    # Push
    print("\n--- clasp push ---")
    if not run_clasp_push(plan["mirror_dir"], dry_run=dry_run):
        return 1

    # Hooks
    print("\n--- post-push hooks ---")
    if fire_hooks:
        if not run_post_push_hooks(project_block, dry_run=False):
            return 1
    else:
        run_post_push_hooks(project_block, dry_run=True)
        if not args.push:
            print("  (dry-run mode — re-run with --push to actually push, and --with-hooks to fire hooks)")
        elif not args.with_hooks:
            print("  (--with-hooks not passed — skipped firing; safe first-time default)")

    print("\n=== done ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
