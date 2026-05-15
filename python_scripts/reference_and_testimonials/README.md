# Moved — `reference_and_testimonials` → lineage-credentials platform

The DAO-member testimonial generator and its outputs moved out of this repo on **2026-05-14** as part of the credentialing-platform consolidation.

| Was here | Now lives in |
|---|---|
| `tokenomics/python_scripts/reference_and_testimonials/fetch_contributions.py` | [`lineage-engine/scripts/fetch_contributions.py`](https://github.com/TrueSightDAO/lineage-engine/blob/main/scripts/fetch_contributions.py) |
| `tokenomics/python_scripts/reference_and_testimonials/testimonials/fatima_toledo_*` | [`lineage-credentials/_cache/cv/fatima-toledo.*`](https://github.com/TrueSightDAO/lineage-credentials/tree/main/_cache/cv) |
| `tokenomics/python_scripts/reference_and_testimonials/testimonials/emelin_*` | [`lineage-credentials/_cache/cv/emelin-frances-lisboa.*`](https://github.com/TrueSightDAO/lineage-credentials/tree/main/_cache/cv) |

## Why

The tokenomics repo holds **upstream pipelines** (Edgar event handlers, GAS scripts, ledger schemas). Per-person credentialing data (testimonials, CVs, PDFs) accumulates fast and was bloating this repo. The split is:

- **[lineage-credentials](https://github.com/TrueSightDAO/lineage-credentials)** — DATA: per-person folders, `_cache/cv/<slug>.*`, program manifests.
- **[lineage-engine](https://github.com/TrueSightDAO/lineage-engine)** — CODE: Python scripts, Grok prompts, PDF templates.

Full architecture: [`agentic_ai_context/CREDENTIALING_PLATFORM.md`](https://github.com/TrueSightDAO/agentic_ai_context/blob/main/CREDENTIALING_PLATFORM.md).

## What still lives in tokenomics

- `python_scripts/schema_validation/` — the service-account credentials and schema-validation tooling. Still here.
- `google_app_scripts/tdg_credentialing/` (future) — the GAS that processes `[PRACTICE EVENT]` payloads and commits them into lineage-credentials. New, not yet built.

Old links to files under `reference_and_testimonials/` may continue to function via this README; the actual data + script have moved.
