/**
 * File: google_app_scripts/tdg_identity_management/email_verification_from_edgar.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * Apps Script editor:
 * https://script.google.com/home/projects/1m8IZPs1vFN99cuu-39kbC-OGXggRVtJtXq5rfSB0M1sCQjMdolEUDuGU/edit
 *
 * Summary:
 * - Edgar (`sentiment_importer`) calls a **standalone** Apps Script web app after a verified
 *   `[EMAIL REGISTERED EVENT]`. Transport: **GET**
 *   `?action=sendEmailVerification&secret=...&email=...&verification_key=...&return_url=...`
 *   (`doGet`), with **POST JSON** fallback (`doPost`).
 * - The handler emails the contributor a DApp link with `em` + `vk` query params.
 *
 * ---------------------------------------------------------------------------
 * Where the code lives (Edgar default `EMAIL_VERIFICATION_GAS_WEBHOOK_URL`)
 * ---------------------------------------------------------------------------
 * - Source: `edgar_send_email_verification.gs`
 * - Script ID: `1m8IZPs1vFN99cuu-39kbC-OGXggRVtJtXq5rfSB0M1sCQjMdolEUDuGU` (owned by admin@truesight.me;
 *   deploy web app **Execute as** that user so mail sends from admin@truesight.me).
 * - Clasp mirror: `tokenomics/clasp_mirrors/1m8IZPs1vFN99cuu-39kbC-OGXggRVtJtXq5rfSB0M1sCQjMdolEUDuGU/`
 *
 * ---------------------------------------------------------------------------
 * Related projects (not used for this webhook unless you override env)
 * ---------------------------------------------------------------------------
 * - **Telegram log → sheet** — `register_member_digital_signatures_telegram.gs`, script `10NKp8…`,
 *   `doGet` action `processDigitalSignatureEvents` only.
 * - **Gmail ingestion** — `register_member_digital_signatures_email.gs`, script `1zKg…`.
 *
 * Script property on the **1m8IZ** project (Project Settings → Script properties):
 * - `EMAIL_VERIFICATION_SECRET` — must match Edgar `EMAIL_VERIFICATION_GAS_SECRET` /
 *   `EMAIL_VERIFICATION_SECRET`.
 *
 * Deploy (1m8IZ project):
 * - Deploy → New deployment → Web app
 * - Execute as: **User (admin@truesight.me)** (sender for `GmailApp.sendEmail`)
 * - Who has access: **Anyone**
 * - Copy the `/exec` URL into Edgar env `EMAIL_VERIFICATION_GAS_WEBHOOK_URL` (or rely on
 *   `sentiment_importer` default in `config/application.rb` after deploy URL is stable).
 */
