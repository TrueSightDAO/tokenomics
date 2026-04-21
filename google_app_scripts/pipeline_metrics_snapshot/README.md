# pipeline_metrics_snapshot

Google Apps Script that mirrors the **Pipeline Dashboard** tab of the Holistic
Hit List workbook into `TrueSightDAO/ecosystem_change_logs` as a machine feed
(`metrics/weekly.json`) and human mirror (`metrics/weekly.md`).

## Why this exists

The advisory snapshot generator
(`market_research/scripts/generate_advisory_snapshot.py`) embeds an "Operator
metrics" block into `ADVISORY_SNAPSHOT.md`, which the iChing Oracle GAS fetches
on every `mode=oracle_advice` call. That block used to read from
`agentic_ai_context/METRICS_WEEKLY.md`, which was an operator-curated stub that
never got filled in — so every oracle response flagged "No operator metrics
are populated" as a context gap.

This GAS replaces that manual step: the operator maintains the Pipeline
Dashboard (which they already do for the DApp `stores_by_status.html` view),
and the GAS publishes the funnel snapshot on a schedule.

## Source

Pipeline Dashboard tab (curated funnel order in cols C–E):
<https://docs.google.com/spreadsheets/d/1eiqZr3LW-qEI6Hmy0Vrur_8flbRwxwA7jXVrbUnHbvc/edit#gid=1606881029>

## Outputs

- `metrics/weekly.json` — canonical machine feed. Schema: `generated_at`,
  `source{workbook_id,tab,gid,url}`, `totals{all_stores,partnered}`,
  `funnel[]{order,status,stores}`.
- `metrics/weekly.md` — dropped verbatim under the "## Operator metrics"
  heading in `ADVISORY_SNAPSHOT.md`.

Both land in `TrueSightDAO/ecosystem_change_logs@main` via the GitHub
Contents API (no git push from GAS).

## Setup

1. **Deployed project:** <https://script.google.com/home/projects/11fA8NXSOwKyddXDZmmx3BRCDU1Y38GVidENCj0mujH0pT-AqIoOyaetj/edit>
2. Work locally from the clasp mirror: `clasp_mirrors/11fA8NXSOwKyddXDZmmx3BRCDU1Y38GVidENCj0mujH0pT-AqIoOyaetj/`.
   After editing `google_app_scripts/pipeline_metrics_snapshot/sync_pipeline_metrics.gs`,
   copy into the mirror and `clasp push` from the mirror folder.
3. Project → Script Properties:
   - `ORACLE_ADVISORY_PUSH_TOKEN` — same fine-grained PAT used by the
     `advisory-snapshot-refresh` CI workflow secret (Contents: Read+Write on
     `TrueSightDAO/agentic_ai_context` **and**
     `TrueSightDAO/ecosystem_change_logs`). Reuse the existing token so one
     PAT covers both publishers of the oracle context instead of a new one.
4. From the editor, run `runOneSetup()` once to grant `SpreadsheetApp` +
   `UrlFetchApp` permissions and confirm the push token works. Check the
   execution log — `sheet_read.ok` and `github_ping.ok` should both be true.
5. Run `installDailyTrigger()` once to schedule `syncPipelineMetrics()` daily
   at 06:00 (project timezone).
6. Manually invoke `syncPipelineMetrics()` once to seed both files on the
   first run. After that the daily trigger keeps them fresh.

## Consumers

- `market_research/scripts/generate_advisory_snapshot.py` — reads
  `metrics/weekly.md` from the sibling checkout of `ecosystem_change_logs`
  during the 6-hourly `advisory-snapshot-refresh.yml` CI run.
- `iching_oracle/gas/oracle_advisory_bridge.gs` — downstream of the above
  (reads `ADVISORY_SNAPSHOT.md` raw).

## Relation to other Hit List GAS

`holistic_hit_list_store_history/store_interaction_history_api.gs` already
exposes a `listStatusSummary` action that buckets Hit List rows by status —
but it reads the source tab (`Hit List`), not the operator-curated funnel
order in the Pipeline Dashboard. This GAS uses the Dashboard view precisely
because the ordering is operator-intent, not alphabetical — the oracle wants
stages in sequence (Partnered → Meeting Scheduled → Shortlisted → … →
Rejected), which the source tab alone can't provide.
