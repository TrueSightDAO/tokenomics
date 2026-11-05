# GAS /exec probe audit

_Generated: 2026-05-28T21:48:21.305127+00:00 by `scripts/probe_gas_exec_urls.py`._

Lightweight GET probe of every `/exec` URL the source-comment audit captured. Each URL is hit unauthenticated with a 15-second timeout; the body peek (first ~240 chars) is enough to distinguish a healthy Apps Script web app from an auth-gated endpoint vs a 404.

Probe results are also written into each `google_app_scripts/<theme>/manifest.json` under each project's `deployments` map (label `probe_<short>`).

## Results

| scriptId | deployment | HTTP | content-type | body peek |
|---|---|---|---|---|
| `1Q5HfGR_AcSYmr…` | `AKfycbw6Pgl5a1…` | 200 | text/plain | ℹ️ No valid action specified |
| `19Wag9x-sjbLVg…` | `AKfycbwYBlFigS…` | 200 | text/plain | ℹ️ No valid action specified. Expected: ?action=parseAndProcessTelegramLogs |
| `15qbfLN3ZCk-Ee…` | `AKfycbwauCMu-3…` | 200 | application/json | {"status":"ok","message":"Stripe sync completed"} |
| `1zKgMwd6KJFjoW…` | `AKfycbwbtBlxkK…` | 200 | text/html | <!DOCTYPE html><html><head><link rel="shortcut icon" href="//ssl.gstatic.com/docs/script/images/favicon.ico"><title>Erro |
| `10NKp8uLMGyfgD…` | `AKfycbwlh2u-Sk…` | 200 | application/json | {"ok":false,"error":"No valid action (use action=sendEmailVerification or action=processDigitalSignatureEvents on GET, o |
| `1BHAGZd_T1I5mQ…` | `AKfycbwnCn80es…` | 200 | text/plain | ℹ️ No valid action specified |
| `14gKJ0VW49RsSn…` | `AKfycbwoBqZnDS…` | 200 | application/json | {"status":"error","message":"Unknown action. Use suggestStores, getStoreHistory, listStoresByFilter, listStatusSummary,  |
| `1MnAsIQAxcSfZO…` | `AKfycbxigq4-J0…` | 200 | application/json | {"status":"error","message":"Missing required parameters: qr_code and email_address","example":"https://script.google.co |
| `1wmgYPwfRDxpib…` | `AKfycbyBmjwmFh…` | 200 | application/json | {"ok":true,"service":"treasury-cache-publisher","schema_version":1,"hint":"GET ?action=publish&token=<secret>&trigger=mo |
| `1MnAsIQAxcSfZO…` | `AKfycbySJ86OcV…` | 200 | application/json | {"status":"error","message":"Missing required parameter: product_name for generate action"} |
| `1wmgYPwfRDxpib…` | `AKfycbyVeNZdBn…` | 200 | text/plain | ℹ️ No valid action specified |
| `1MnAsIQAxcSfZO…` | `AKfycbygmwRbyq…` | 200 | application/json | {"error":"Signature parameter missing"} |
| `1Og2g8Q0_SdM9A…` | `AKfycbz5Tt_vz1…` | 200 | application/json | {"status":"error","message":"Invalid or missing action parameter. Available actions: list_managers, get_inventory, get_p |
| `1wONDeDwZ_fXNa…` | `AKfycbzECOd1Y3…` | 200 | text/plain | ℹ️ No valid action specified. Use ?action=processTelegramChatLogs or ?action=processInventoryMovementToLedgers |
| `1Y8sJ22lZuqQYS…` | `AKfycbzHDqxI4l…` | 200 | application/json | {"timestamp":"2026-05-28T21:48:13.444Z","soldBagsCount":337,"status":"success"} |
| `1dsWecVwbN0dOv…` | `AKfycbzc15gptN…` | 200 | text/plain | ℹ️ No valid action specified |
| `1Dh_QQUn8hGGo7…` | `AKfycbzgNstwRX…` | 200 | application/json | {"success":false,"error":"Invalid mode. Use: list_open_proposals, fetch_proposal, or provide signature parameter"} |
| `1QtK-InsHH6SBt…` | `AKfycbztpV3TUI…` | 200 | application/json | {"error":"Please specify ?list=true to list managers, ?manager=<key> to get assets, ?recipients=true to list recipients, |
