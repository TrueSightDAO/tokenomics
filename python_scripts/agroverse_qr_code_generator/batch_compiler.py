#!/usr/bin/env python3
"""DEPRECATED — moved to TrueSightDAO/lineage-assets.

Running this file aborts with a redirect message. The old code is
preserved in git history (last working version was at
tokenomics@<sha-before-deprecation>) but invoking it from this path
will silently produce output in the wrong location — the previously-
generated compiled images land in this directory's package_qr_codes/
scratch dir instead of lineage-assets/pngs/, the JSON manifest never
gets written, and truesight.me/qr/?id=<id> can't resolve the QR image.

To regenerate a QR (cacao bag / tree / drum / membership / etc.):

    cd ~/Applications/lineage-assets/scripts/qr_generator
    python3 batch_compiler.py [--limit N]

That version writes three artifacts per mint in one run:
  - operator-local compiled label image (package_qr_codes/)
  - raw QR PNG into lineage-assets/pngs/<qr_id>.png
  - per-QR JSON manifest into lineage-assets/qrs/<qr_id>.json

See agentic_ai_context/LINEAGE_ASSETS.md §"Generator" for the full doc,
or DEPRECATED.md in this directory for the migration breadcrumb.
"""
import sys

MESSAGE = (
    "\n"
    "  ╭───────────────────────────────────────────────────────────────╮\n"
    "  │  This generator has moved.                                    │\n"
    "  │                                                               │\n"
    "  │  Old path (this file):                                        │\n"
    "  │    tokenomics/python_scripts/agroverse_qr_code_generator/     │\n"
    "  │                                                               │\n"
    "  │  New path:                                                    │\n"
    "  │    ~/Applications/lineage-assets/scripts/qr_generator/        │\n"
    "  │                                                               │\n"
    "  │  Run from the new path so output lands in lineage-assets      │\n"
    "  │  (PNG + JSON manifest) and truesight.me/qr/?id=<id> resolves. │\n"
    "  │                                                               │\n"
    "  │  Migration doc: agentic_ai_context/LINEAGE_ASSETS.md          │\n"
    "  ╰───────────────────────────────────────────────────────────────╯\n"
)

if __name__ == "__main__":
    sys.stderr.write(MESSAGE)
    sys.exit(2)
