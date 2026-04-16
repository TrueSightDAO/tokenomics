# Edgar digital signature sheet flow (demo)

This folder is a **read-mostly** Python sketch of how **Edgar** (`sentiment_importer`) and the **Google Sheets** tab **Contributors Digital Signatures** interact during DApp **email onboarding**. It mirrors the Ruby constants and helpers in `Gdrive::ContributorsDigitalSignatures` and the row lifecycle described in tokenomics `SCHEMA.md`.

## Flow (high level)

1. A contributor uses the DApp (`create_signature.html`) to generate keys and submit a signed **`[EMAIL REGISTERED EVENT]`** payload to Edgar.
2. After cryptographic verification, Edgar resolves the contributor name from **Contributors contact information** (column **D** email → column **A** name), appends a **`VERIFYING`** row to **Contributors Digital Signatures** (columns **A–G**), and calls the **Google Apps Script** web app `edgar_send_email_verification` to email a link containing `em` and `vk`.
3. The contributor opens the link in the **same browser**, then submits a signed **`[EMAIL VERIFICATION EVENT]`** referencing the verification key.
4. Edgar flips column **D** from **`VERIFYING`** to **`ACTIVE`** when the key and public key match the pending row.

Canonical column layout (header row **1**, 1-based): **A** Contributor Name, **B** Created time stamp, **C** Last Active time stamp, **D** Status, **E** Digital Signature (SPKI base64), **F** Email, **G** Verification Key. See **[SCHEMA.md](../../../SCHEMA.md)** → section **Contributors Digital Signatures**.

## Ruby reference (sentiment_importer / Edgar)

Canonical implementations on **`TrueSightDAO/sentiment_importer`** (`master`):

- [`app/models/gdrive/contributors_digital_signatures.rb`](https://github.com/TrueSightDAO/sentiment_importer/blob/master/app/models/gdrive/contributors_digital_signatures.rb) — sheet constants, `normalize_public_key`, `normalize_verification_key`, `lookup_contributor_name_in_contact_sheet`, `append_pending_row!`, `sheet_rows_matching_email_vk_and_public_key`, `activate_row_verify!`, `activate_pending!`
- [`app/services/dao_email_registration_service.rb`](https://github.com/TrueSightDAO/sentiment_importer/blob/master/app/services/dao_email_registration_service.rb) — `[EMAIL REGISTERED EVENT]` / `[EMAIL VERIFICATION EVENT]` handling and GAS webhook calls

## Google Apps Script

- **Repo file:** [`google_app_scripts/tdg_identity_management/edgar_send_email_verification.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_identity_management/edgar_send_email_verification.gs) (`doGet` / `doPost`, `action=sendEmailVerification`)

## Environment variables

| Variable | Purpose |
|----------|---------|
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to a **service account JSON** key that can read (and optionally append/update) the spreadsheet. |
| `DEMO_SPREADSHEET_ID` | Optional override of the default spreadsheet id (defaults to the production tokenomics workbook id used in Ruby). |
| `DEMO_ALLOW_SHEET_WRITES` | Must be **`1`** for any **mutating** subcommand that uses `--apply` (`append-pending`, `activate-pending`). If unset or not `1`, those commands refuse to write even with `--apply`. |
| `EMAIL_VERIFICATION_GAS_WEBHOOK_URL` | Base `/exec` URL for the verification email web app (same as Edgar). Used by `print-gas` / `print-gas --call`. |
| `EMAIL_VERIFICATION_GAS_SECRET` | Shared secret; must match the Apps Script property `EMAIL_VERIFICATION_SECRET`. Never commit this value. For `print-gas`, the script prints a **redacted** secret by default; set `GAS_PRINT_SECRETS=1` to print the raw secret (discouraged). |

Reads (probe, `print-append`, `matching-rows`, `lookup-name`, `print-gas` without `--call`) only need credentials with **Sheets read** access. Writes need **append** and **range update** on the two tabs.

## Install

```bash
cd python_scripts/examples/dapp_digital_signature_onboarding
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Usage

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
./demo_edgar_digital_signature_sheet_flow.py probe
./demo_edgar_digital_signature_sheet_flow.py lookup-name --email you@example.com
./demo_edgar_digital_signature_sheet_flow.py print-append --email you@example.com --public-key 'MIIB...' --verification-key 'abc...'
./demo_edgar_digital_signature_sheet_flow.py append-pending --email ... --public-key ... --verification-key ... --apply   # requires DEMO_ALLOW_SHEET_WRITES=1
./demo_edgar_digital_signature_sheet_flow.py matching-rows --email ... --verification-key ... --public-key ...
./demo_edgar_digital_signature_sheet_flow.py activate-pending --public-key ... --verification-key ... --email ... --apply
./demo_edgar_digital_signature_sheet_flow.py print-gas --email ... --verification-key ...
```

Run `./demo_edgar_digital_signature_sheet_flow.py -h` for subcommand help.

## DApp

Public entry page: **`https://truesightdao.github.io/dapp/create_signature.html`** (source in the [`TrueSightDAO/dapp`](https://github.com/TrueSightDAO/dapp) repository).
