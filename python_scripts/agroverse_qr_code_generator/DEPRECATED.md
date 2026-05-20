# Moved → lineage-assets

**This directory has moved.** As of 2026-05-20 the QR-code generator
lives at:

> **https://github.com/TrueSightDAO/lineage-assets/tree/main/scripts/qr_generator**

Local checkout (operator-standard layout):
`~/Applications/lineage-assets/scripts/qr_generator/`

## Why it moved

QR-code generation is asset-provenance work, not tokenomics. It was
co-located here for historical reasons. The new home in
[`lineage-assets`](https://github.com/TrueSightDAO/lineage-assets)
mirrors the architecture already established for human credentials in
`lineage-credentials` — one repo that holds the generator + the PNG
output + the per-asset JSON manifests + the schema doc, all together.

## What changed at the new location

- Generator now writes **both** the raw QR PNG (`lineage-assets/pngs/<id>.png`)
  **and** a per-QR JSON manifest (`lineage-assets/qrs/<id>.json`) at mint
  time. PNGs live alongside manifests in one repo for atomicity.
- New `--lineage-assets-dir` / `--pngs-dir` / `--qrs-dir` CLI flags
  (defaults assume sibling-checkout layout).
- Shared manifest-building module at
  `lineage-assets/scripts/lib/manifest.py` keeps the seed importer
  (`seed_from_sheet.py`) and per-mint generator (`batch_compiler.py`)
  in lockstep on schema.

## Why the files here aren't deleted

This directory is preserved (no source code removed) for:

- Git history continuity for anyone tracing the lineage of the generator
- External references / docs that may point at the old path
- Operator scripts / aliases that haven't been updated yet

But **do not modify these files going forward.** Any change should
land in `lineage-assets/scripts/qr_generator/` instead.

## See also

- [`agentic_ai_context/LINEAGE_ASSETS.md`](https://github.com/TrueSightDAO/agentic_ai_context/blob/main/LINEAGE_ASSETS.md)
  — full architecture doc for the new home
- [`agentic_ai_context/CREDENTIALING_PLATFORM.md`](https://github.com/TrueSightDAO/agentic_ai_context/blob/main/CREDENTIALING_PLATFORM.md)
  — parallel architecture for human credentials
- [`qr_codes`](https://github.com/TrueSightDAO/qr_codes) repo — archived
  2026-05-20; old PNGs preserved at their existing raw URLs for any
  historical reference, but new mints land in `lineage-assets/pngs/`
