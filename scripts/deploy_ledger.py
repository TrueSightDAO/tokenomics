#!/usr/bin/env python3
"""DEPLOY_PUSH_SOP Phase 2 — lease + audit helpers for deploy_gas_project.py.

Self-contained (stdlib only) so ANY LLM checkout of tokenomics can enforce the
deploy-push SOP without depending on the autopilot runtime. All writes go to
TrueSightDAO/ecosystem_change_logs via the GitHub Contents API (append-only).

Fail-open by design: a PAT/network error logs a warning and lets the push
proceed — a ledger hiccup never blocks a deploy. Only a PROVEN LIVE LEASE
blocks (hard-block, TTL 30 min).

PAT resolution: $DEPLOY_LEDGER_PAT, else $GITHUB_TOKEN, else
$TRUESIGHT_DAO_AUTOPILOT. If none is set, the ledger is skipped with a warning.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone

API = "https://api.github.com/repos/TrueSightDAO/ecosystem_change_logs"
TTL_SECONDS = 30 * 60
KNOWN_AGENTS = {
    "sophia",
    "bionpact",
    "envoy",
    "deep seek",
    "deepseek",
    "kimi",
    "claude",
}


def _pat() -> str | None:
    return (
        os.environ.get("DEPLOY_LEDGER_PAT")
        or os.environ.get("GITHUB_TOKEN")
        or os.environ.get("TRUESIGHT_DAO_AUTOPILOT")
        or None
    )


def _gh(method: str, url: str, body: dict | None = None) -> dict | None:
    pat = _pat()
    if not pat:
        return None
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {pat}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "tokenomics-deploy-ledger/1",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            return {"_http_error": e.code, "_detail": e.read().decode()[:300]}
        except Exception:
            return {"_http_error": e.code}
    except Exception as e:
        return {"_error": str(e)}


def _b64(data: str) -> str:
    import base64

    return base64.b64encode(data.encode("utf-8")).decode("ascii")


def _utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _slugify(s: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "-", s.lower()).strip("-")
    return s[:40] or "record"


def _lease_age_seconds(lease: dict) -> float:
    try:
        started = datetime.fromisoformat(
            lease.get("started_at_utc", "").replace("Z", "+00:00")
        )
        return (datetime.now(timezone.utc) - started).total_seconds()
    except Exception:
        return float("inf")


def check_lease(target_type: str, target_id: str) -> dict:
    """Return {'status': 'clear'|'blocked'|'error', ...}."""
    listing = _gh("GET", f"{API}/contents/deploys/leases")
    if listing is None:
        return {
            "status": "error",
            "reason": "no PAT available — ledger skipped (fail-open)",
        }
    if isinstance(listing, dict) and (
        listing.get("_http_error") or listing.get("_error")
    ):
        return {
            "status": "error",
            "reason": f"lease dir read failed: {listing}",
        }
    if not isinstance(listing, list):
        return {"status": "clear", "leases": []}
    live = []
    for item in listing:
        if not item.get("name", "").endswith(".json"):
            continue
        content = _gh("GET", item["url"])
        if not isinstance(content, dict) or "content" not in content:
            continue
        import base64

        try:
            lease = json.loads(base64.b64decode(content["content"]).decode("utf-8"))
        except Exception:
            continue
        if (
            lease.get("target_type") == target_type
            and lease.get("target_id") == target_id
            and _lease_age_seconds(lease) <= TTL_SECONDS
        ):
            live.append(lease)
    if live:
        return {"status": "blocked", "leases": live}
    return {"status": "clear", "leases": []}


def acquire_lease(target_type: str, target_id: str, action: str) -> dict:
    """Create a lease file. Returns {'status','lease_id','error'}."""
    if not _pat():
        return {"status": "error", "error": "no PAT — lease skipped (fail-open)"}
    lease_id = f"L-{_utcnow()[:8]}-{_utcnow()[9:15]}"
    body = {
        "id": lease_id,
        "agent": os.environ.get("DEPLOY_LEDGER_AGENT", "sophia"),
        "target_type": target_type,
        "target_id": target_id,
        "action": action,
        "started_at_utc": datetime.now(timezone.utc).isoformat(),
        "ttl_seconds": TTL_SECONDS,
    }
    path = f"deploys/leases/{lease_id}.json"
    res = _gh(
        "PUT",
        f"{API}/contents/{path}",
        {
            "message": f"DEPLOY_PUSH_SOP lease {lease_id} (acquire)",
            "content": _b64(json.dumps(body, indent=2) + "\n"),
        },
    )
    if isinstance(res, dict) and res.get("content"):
        return {"status": "success", "lease_id": lease_id}
    return {"status": "error", "error": f"lease write failed: {res}"}


def close_lease(lease_id: str) -> dict:
    """Delete the lease file (lease file present == in progress)."""
    path = f"deploys/leases/{lease_id}.json"
    listing = _gh("GET", f"{API}/contents/deploys/leases")
    if not isinstance(listing, list):
        return {"status": "error", "error": f"could not list leases: {listing}"}
    sha = None
    for item in listing:
        if item.get("name") == f"{lease_id}.json":
            sha = item.get("sha")
            break
    if not sha:
        return {"status": "error", "error": f"lease {lease_id} not found"}
    res = _gh(
        "DELETE",
        f"{API}/contents/{path}",
        {"message": f"DEPLOY_PUSH_SOP lease {lease_id} (close)", "sha": sha},
    )
    return (
        {"status": "success"}
        if isinstance(res, dict) and "content" not in res
        else {"status": "error", "error": f"close failed: {res}"}
    )


def append_deploy_record(
    agent: str,
    target_type: str,
    target_id: str,
    action: str,
    result: str,
    evidence_url: str = "",
    lease_id: str = "",
    notes: str = "",
) -> dict:
    """Append one entry (md + json) and rebuild the feed. Append-only."""
    if not _pat():
        return {"status": "error", "error": "no PAT — record skipped (fail-open)"}
    if agent.lower() not in KNOWN_AGENTS:
        return {
            "status": "error",
            "error": f"agent '{agent}' not registered: {sorted(KNOWN_AGENTS)}",
        }
    if result not in {"success", "failure", "rolled-back", "aborted", "in-progress"}:
        return {"status": "error", "error": f"bad result '{result}'"}
    if target_type not in {"clasp", "gas", "repo", "ec2", "prod-sync", "other"}:
        return {"status": "error", "error": f"bad target_type '{target_type}'"}
    if result == "success" and not evidence_url:
        return {"status": "error", "error": "result=success requires evidence_url"}
    rec_id = f"deploy_{_utcnow()}_{_slugify(target_id)}"
    ts = datetime.now(timezone.utc).isoformat()
    rec = {
        "id": rec_id,
        "agent": agent,
        "timestamp_utc": ts,
        "target_type": target_type,
        "target_id": target_id,
        "action": action,
        "git_ref": "",
        "result": result,
        "lease_id": lease_id,
        "evidence_url": evidence_url,
        "notes": notes,
    }
    md = (
        f"---\nid: {rec_id}\nagent: {agent}\ntimestamp_utc: {ts}\n"
        f"target_type: {target_type}\ntarget_id: {target_id}\naction: {action}\n"
        f"git_ref: \nresult: {result}\nlease_id: {lease_id}\n"
        f"evidence_url: {evidence_url}\n---\n\n## Record\n\n"
        f"- **Agent:** {agent}\n- **Time (UTC):** {ts}\n"
        f"- **Target:** {target_type} `{target_id}`\n- **Action:** {action}\n"
        f"- **Result:** {result}\n- **Evidence:** {evidence_url or 'n/a'}\n\n{notes}\n"
    )
    r1 = _gh(
        "PUT",
        f"{API}/contents/deploys/entries/{rec_id}.md",
        {"message": f"DEPLOY_PUSH_SOP record {rec_id}", "content": _b64(md)},
    )
    r2 = _gh(
        "PUT",
        f"{API}/contents/deploys/entries/{rec_id}.json",
        {
            "message": f"DEPLOY_PUSH_SOP record {rec_id} (json)",
            "content": _b64(json.dumps(rec, indent=2) + "\n"),
        },
    )
    if not (
        isinstance(r1, dict)
        and r1.get("content")
        and isinstance(r2, dict)
        and r2.get("content")
    ):
        return {"status": "error", "error": f"record write failed: {r1} / {r2}"}
    _rebuild_feed()
    return {"status": "success", "record_id": rec_id}


def _rebuild_feed() -> None:
    listing = _gh("GET", f"{API}/contents/deploys/entries")
    if not isinstance(listing, list):
        return
    import base64

    rows = []
    for item in listing:
        if not item.get("name", "").endswith(".json"):
            continue
        content = _gh("GET", item["url"])
        if not isinstance(content, dict) or "content" not in content:
            continue
        try:
            rows.append(
                json.loads(base64.b64decode(content["content"]).decode("utf-8"))
            )
        except Exception:
            continue
    rows.sort(key=lambda r: r.get("timestamp_utc", ""), reverse=True)
    manifest = {"total": len(rows), "updated_utc": _utcnow(), "entries": rows[:200]}
    _gh(
        "PUT",
        f"{API}/contents/deploys/feed/manifest.json",
        {
            "message": "DEPLOY_PUSH_SOP feed rebuild",
            "content": _b64(json.dumps(manifest, indent=2) + "\n"),
        },
    )


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "check":
        tt = sys.argv[2] if len(sys.argv) > 2 else "clasp"
        ti = sys.argv[3] if len(sys.argv) > 3 else ""
        print(json.dumps(check_lease(tt, ti), indent=2))
    else:
        print("usage: deploy_ledger.py check <target_type> <target_id>")
