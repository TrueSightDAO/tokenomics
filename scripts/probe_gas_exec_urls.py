#!/usr/bin/env python3
"""GET each /exec URL known to the audit, capture HTTP probe results, and
write them back into the manifests' deployments map.

For each URL we know belongs to a scriptId (per the URL→scriptId map built
from .gs sources), GET it with a short timeout and record:
- HTTP status
- final URL after redirects (Apps Script /exec redirects through
  googleusercontent.com)
- content-type
- first ~200 chars of body (useful for distinguishing "looks like an Apps
  Script error page" from "responds with JSON")

Written into manifest's `deployments` map keyed by a stable label
("probe_<short_id>") so subsequent runs replace prior probe results rather
than duplicate.

Also produces docs/gas_exec_probe_audit.md as a flat audit table.

Idempotent. Re-run any time.
"""
from __future__ import annotations

import json
import re
import socket
import ssl
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

TOKENOMICS = Path(__file__).resolve().parent.parent
SRC = TOKENOMICS / "google_app_scripts"
TIMEOUT = 15.0
MAX_BODY_PEEK = 240
SCRIPT_ID_RE = re.compile(r"script\.google\.com/home/projects/([A-Za-z0-9_-]+)")
EXEC_URL_RE  = re.compile(r"https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec")
PLACEHOLDER = {"AKfycbxyz1234567890", "YOUR_SCRIPT_ID"}


def build_url_to_scriptid_map() -> dict[str, str]:
    out: dict[str, str] = {}
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
            if any(p in url for p in PLACEHOLDER):
                continue
            out[url] = sid
    return out


def probe(url: str) -> dict:
    req = Request(url, headers={"User-Agent": "tokenomics-gas-audit/0.1"})
    ctx = ssl.create_default_context()
    started = datetime.now(timezone.utc).isoformat()
    try:
        with urlopen(req, timeout=TIMEOUT, context=ctx) as resp:
            body_bytes = resp.read(MAX_BODY_PEEK * 4)
            try:
                body_text = body_bytes.decode("utf-8", errors="replace")
            except Exception:
                body_text = repr(body_bytes[:MAX_BODY_PEEK])
            return {
                "status_code": resp.status,
                "final_url": resp.url,
                "content_type": resp.headers.get("Content-Type", ""),
                "body_peek": body_text[:MAX_BODY_PEEK],
                "probed_at": started,
            }
    except HTTPError as e:
        return {
            "status_code": e.code,
            "final_url": e.url,
            "content_type": e.headers.get("Content-Type", "") if e.headers else "",
            "body_peek": (e.reason or "")[:MAX_BODY_PEEK],
            "probed_at": started,
            "error": "HTTPError",
        }
    except (URLError, socket.timeout, ssl.SSLError) as e:
        return {
            "status_code": None,
            "final_url": url,
            "content_type": "",
            "body_peek": "",
            "probed_at": started,
            "error": f"network: {e}",
        }


def main() -> None:
    url_to_sid = build_url_to_scriptid_map()
    print(f"  url→scriptId map: {len(url_to_sid)} entries")

    results: dict[str, dict] = {}  # url → probe result
    for i, url in enumerate(sorted(url_to_sid.keys()), 1):
        print(f"  [{i}/{len(url_to_sid)}] probing {url[-32:]}", end=" ", flush=True)
        r = probe(url)
        results[url] = r
        print(f"-> HTTP {r.get('status_code', '?')}")

    # Group results by scriptId.
    sid_to_probes: dict[str, dict[str, dict]] = {}
    for url, r in results.items():
        sid = url_to_sid[url]
        # Stable label: use last 8 chars of the deployment ID for short
        # key. Multiple deployments per scriptId get distinct labels.
        dep_id = url.split("/macros/s/")[1].split("/exec")[0]
        label = f"probe_{dep_id[-8:]}"
        sid_to_probes.setdefault(sid, {})[label] = {"url": url, **r}

    # Update each manifest's deployments map with probe blocks.
    updated = 0
    for manifest_path in sorted(SRC.glob("*/manifest.json")):
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        changed = False
        for project in manifest.get("projects", []):
            sid = project.get("scriptId")
            probes = sid_to_probes.get(sid)
            if not probes:
                continue
            deployments = project.setdefault("deployments", {})
            # Drop any prior probe_* entries so re-runs don't accumulate.
            for k in list(deployments.keys()):
                if k.startswith("probe_"):
                    deployments.pop(k)
            for label, body in probes.items():
                deployments[label] = body
            changed = True
        if changed:
            manifest_path.write_text(
                json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            updated += 1
            print(f"  updated {manifest_path.relative_to(TOKENOMICS)}")

    # Also write a flat audit table.
    md = [
        "# GAS /exec probe audit",
        "",
        f"_Generated: {datetime.now(timezone.utc).isoformat()} by `scripts/probe_gas_exec_urls.py`._",
        "",
        "Lightweight GET probe of every `/exec` URL the source-comment audit "
        "captured. Each URL is hit unauthenticated with a 15-second timeout; "
        "the body peek (first ~240 chars) is enough to distinguish a healthy "
        "Apps Script web app from an auth-gated endpoint vs a 404.",
        "",
        "Probe results are also written into each "
        "`google_app_scripts/<theme>/manifest.json` under each project's "
        "`deployments` map (label `probe_<short>`).",
        "",
        "## Results",
        "",
        "| scriptId | deployment | HTTP | content-type | body peek |",
        "|---|---|---|---|---|",
    ]
    for url in sorted(results):
        sid = url_to_sid[url]
        r = results[url]
        dep = url.split("/macros/s/")[1].split("/exec")[0][:14] + "…"
        body = (r.get("body_peek") or "").replace("\n", " ").replace("|", "\\|")[:120]
        ct = (r.get("content_type") or "").split(";")[0]
        md.append(f"| `{sid[:14]}…` | `{dep}` | {r.get('status_code', '?')} | {ct} | {body} |")
    md.append("")
    out_path = TOKENOMICS / "docs" / "gas_exec_probe_audit.md"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(md), encoding="utf-8")
    print(f"\nWrote {out_path.relative_to(TOKENOMICS)}.")
    print(f"Manifests updated with probe blocks: {updated}")


if __name__ == "__main__":
    main()
