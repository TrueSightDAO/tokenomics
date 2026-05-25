#!/usr/bin/env python3
"""Compatibility forwarder — the QR generator MOVED to TrueSightDAO/lineage-assets.

This used to be the generator. It now **transparently forwards** to:

    ~/Applications/lineage-assets/scripts/qr_generator/batch_compiler.py

so the historical command (and muscle memory) still works when run from this
directory, instead of hard-aborting. Relative path args (--credentials,
--output-dir, --pngs-dir, --qrs-dir, --template, logos) are resolved against
your current working directory before forwarding, so e.g.
`--credentials gdrive_key.json` keeps pointing at the file next to where you
invoked this.

PREFERRED entry point (params already locked — box-size 12, logo-ratio 0.25,
Helvetica):

    cd ~/Applications/lineage-assets/scripts/qr_generator && ./generate_qr_batch.sh

Docs: agentic_ai_context/LINEAGE_ASSETS.md  ·  DEPRECATED.md (this dir)
"""
import os
import subprocess
import sys

TARGET_DIR = os.path.expanduser("~/Applications/lineage-assets/scripts/qr_generator")
TARGET = os.path.join(TARGET_DIR, "batch_compiler.py")

# Flags whose values are filesystem paths — resolve to absolute before we cd.
PATH_FLAGS = {
    "--credentials", "--template", "--output-dir",
    "--pngs-dir", "--qrs-dir", "--cacao-logo", "--non-cacao-logo",
}


def _resolve_paths(argv):
    out, i = [], 0
    while i < len(argv):
        a = argv[i]
        if a in PATH_FLAGS and i + 1 < len(argv):
            v = argv[i + 1]
            if v and not os.path.isabs(v):
                v = os.path.abspath(v)
            out += [a, v]
            i += 2
            continue
        if "=" in a and a.split("=", 1)[0] in PATH_FLAGS:
            flag, val = a.split("=", 1)
            if val and not os.path.isabs(val):
                val = os.path.abspath(val)
            out.append(f"{flag}={val}")
            i += 1
            continue
        out.append(a)
        i += 1
    return out


def main():
    if not os.path.exists(TARGET):
        sys.stderr.write(
            f"[error] QR generator not found at {TARGET}\n"
            f"        Clone it:  git clone https://github.com/TrueSightDAO/lineage-assets.git "
            f"~/Applications/lineage-assets\n"
        )
        return 2
    sys.stderr.write(
        "[note] batch_compiler moved to lineage-assets — forwarding there "
        "(relative paths resolved).\n"
        "       Canonical wrapper: lineage-assets/scripts/qr_generator/generate_qr_batch.sh\n"
    )
    args = _resolve_paths(sys.argv[1:])
    return subprocess.call([sys.executable, "batch_compiler.py"] + args, cwd=TARGET_DIR)


if __name__ == "__main__":
    sys.exit(main())
