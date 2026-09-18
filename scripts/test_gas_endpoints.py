#!/usr/bin/env python3
"""Endpoint smoke-test for every registered GAS /exec URL + the DAO API.

Builds the test list straight from google_app_scripts/*/manifest.json (the
`deployments` map) so it never goes stale when a deployment is repointed.

For each /exec URL the tool classifies the unauthenticated GET into:
  HEALTHY      -> 200 + JSON body, or the canonical "No valid action" text/plain
  SLOW         -> 200 but took longer than --slow-secs (no action param invoked)
  POST-ONLY    -> 200 text/html "Script function not found: doGet" (POST-only web app; expected)
  AUTH-WALL    -> 200 text/html served by Google's sign-in (deployment not PUBLIC)
  HTML-ERROR   -> 200 text/html with <title>Error</title> (GAS runtime/load error)
  NOT-FOUND    -> 404/410 (deployment deleted or wrong URL)
  TIMEOUT/ERR  -> network failure

Exit code 1 if any endpoint is AUTH-WALL / HTML-ERROR / NOT-FOUND.

Deliberately invokes NO action parameter (no side effects): a bare GET only
exercises the web-app router.

Usage:
    scripts/test_gas_endpoints.py                 # test all registered /exec
    scripts/test_gas_endpoints.py --json          # machine-readable
    scripts/test_gas_endpoints.py --slow-secs 10
    scripts/test_gas_endpoints.py --include-api   # also ping edgar /ping
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "google_app_scripts"
EXEC_RE = re.compile(r"https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec")
API_DEFAULT = "https://edgar.truesight.me/ping"


def registered_exec_urls() -> list[tuple[str, str, str]]:
    """Return [(scriptId, deploymentId, url)] from every manifest's deployments map."""
    out, seen = [], set()
    for m in sorted(glob.glob(str(SRC / "*" / "manifest.json"))):
        sid = os.path.basename(os.path.dirname(m))
        try:
            txt = Path(m).read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for u in sorted(set(EXEC_RE.findall(txt))):
            if u in seen:
                continue
            seen.add(u)
            out.append((sid, u.split("/s/")[1].split("/")[0], u))
    return out


def classify(url: str, slow_secs: float) -> tuple[str, str, float]:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(
        url, method="GET", headers={"User-Agent": "sophia-endpoint-check/1"}
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=45, context=ctx) as r:
            body = r.read(16384).decode("utf-8", "replace")
            ct = (r.headers.get("Content-Type") or "").lower()
            dt = time.time() - t0
    except urllib.error.HTTPError as e:
        return (
            "NOT-FOUND" if e.code in (404, 410) else "HTTP-ERROR",
            f"HTTP {e.code}",
            time.time() - t0,
        )
    except Exception as e:  # noqa: BLE001
        return ("TIMEOUT/ERR", f"{type(e).__name__}", time.time() - t0)

    low = body.lower()
    if "text/html" in ct:
        if "accounts.google" in low or "sign in" in low or "servicelogin" in low:
            return "AUTH-WALL", "<Google sign-in page>", dt
        if "script function not found" in low:
            # POST-only web app: an unauthenticated GET has no doGet to dispatch.
            return "POST-ONLY", "GET unsupported (POST-only web app)", dt
        if "<title>error</title>" in low:
            return "HTML-ERROR", "<title>Error</title>", dt
        return "HTML-ERROR", body[:60].replace("\n", " "), dt
    if dt > slow_secs:
        return "SLOW", f"{dt:.1f}s :: {body[:50]}".replace("\n", " "), dt
    return "HEALTHY", body[:60].replace("\n", " "), dt


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--slow-secs", type=float, default=15.0)
    ap.add_argument("--include-api", action="store_true")
    ap.add_argument("--api-url", default=API_DEFAULT)
    args = ap.parse_args()

    results = []
    for sid, did, url in registered_exec_urls():
        status, detail, dt = classify(url, args.slow_secs)
        results.append(
            {
                "scriptId": sid,
                "deploymentId": did,
                "url": url,
                "status": status,
                "detail": detail,
                "seconds": round(dt, 1),
            }
        )
    if args.include_api:
        try:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            with urllib.request.urlopen(
                urllib.request.Request(args.api_url, method="GET"),
                timeout=20,
                context=ctx,
            ) as r:
                results.append(
                    {
                        "scriptId": "(dao api)",
                        "deploymentId": "-",
                        "url": args.api_url,
                        "status": "HEALTHY" if r.status == 200 else "HTTP-ERROR",
                        "detail": r.read(120)
                        .decode("utf-8", "replace")
                        .replace("\n", " "),
                        "seconds": 0,
                    }
                )
        except Exception as e:  # noqa: BLE001
            results.append(
                {
                    "scriptId": "(dao api)",
                    "deploymentId": "-",
                    "url": args.api_url,
                    "status": "TIMEOUT/ERR",
                    "detail": type(e).__name__,
                    "seconds": 0,
                }
            )

    if args.json:
        print(json.dumps(results, indent=2))
    else:
        bad_order = {
            "AUTH-WALL": 0,
            "HTML-ERROR": 1,
            "NOT-FOUND": 2,
            "TIMEOUT/ERR": 3,
            "HTTP-ERROR": 4,
        }
        for r in sorted(
            results, key=lambda x: (bad_order.get(x["status"], 9), x["scriptId"])
        ):
            print(
                f"{r['status']:<11}{r['seconds']:>6.1f}s  {r['scriptId'][:26]:<27}{r['deploymentId'][:22]:<23}{r['detail']}"
            )
        n = len(results)
        bad = [r for r in results if r["status"] in bad_order]
        print(f"\n{n} endpoint(s): {n - len(bad)} healthy, {len(bad)} need attention")
    return (
        1
        if any(r["status"] in ("AUTH-WALL", "HTML-ERROR", "NOT-FOUND") for r in results)
        else 0
    )


if __name__ == "__main__":
    sys.exit(main())
