/**
 * File: google_app_scripts/tdg_identity_management/edgar_send_email_verification.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 *
 * Summary:
 * - Standalone web app invoked by Edgar (`sentiment_importer`) after a verified
 *   `[EMAIL REGISTERED EVENT]`. Sends the contributor a DApp link with `em` + `vk`.
 * - Deploy as **Web app**: Execute as **User (admin@truesight.me)** so `GmailApp.sendEmail`
 *   sends from that account; Who has access: **Anyone**.
 *
 * ---------------------------------------------------------------------------
 * Apps Script project (clasp mirror must stay in sync)
 * ---------------------------------------------------------------------------
 * - Script ID: 1m8IZPs1vFN99cuu-39kbC-OGXggRVtJtXq5rfSB0M1sCQjMdolEUDuGU
 * - Editor URL:
 *   https://script.google.com/u/2/home/projects/1m8IZPs1vFN99cuu-39kbC-OGXggRVtJtXq5rfSB0M1sCQjMdolEUDuGU/edit
 * - Web app deployment URL (`/exec`; Edgar `EMAIL_VERIFICATION_GAS_WEBHOOK_URL` default in `sentiment_importer`):
 *   https://script.google.com/macros/s/AKfycbxfngGYBYMe1ATyW0U4lLODyAlhUnSUATAsBrNgIvKH6k9ARifG3arSFkB4hjn2h2ID2A/exec
 * - Clasp mirror: tokenomics/clasp_mirrors/1m8IZPs1vFN99cuu-39kbC-OGXggRVtJtXq5rfSB0M1sCQjMdolEUDuGU/
 *
 * Script property (Project Settings → Script properties):
 * - `EMAIL_VERIFICATION_SECRET` — must match Edgar `EMAIL_VERIFICATION_GAS_SECRET` / `EMAIL_VERIFICATION_SECRET`.
 *
 * This project intentionally does **not** include Telegram log processing; see
 * `register_member_digital_signatures_telegram.gs` (script `10NKp8…`) for `processDigitalSignatureEvents`.
 */

/**
 * Edgar → GET ?action=sendEmailVerification&secret=...&email=...&verification_key=...&return_url=...
 */
function doGet(e) {
  const action = e.parameter?.action;
  if (action === 'sendEmailVerification') {
    return handleEmailVerificationRequest_({
      secret: e.parameter.secret,
      email: e.parameter.email,
      verification_key: e.parameter.verification_key,
      return_url: e.parameter.return_url || '',
    });
  }

  return ContentService.createTextOutput(
    JSON.stringify({
      ok: false,
      error: 'No valid action (use action=sendEmailVerification on GET, or POST JSON for email verification).',
    })
  ).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Shared handler: GET query object or POST JSON body
 * { secret, email, verification_key, return_url }
 */
function handleEmailVerificationRequest_(body) {
  try {
    const expected = PropertiesService.getScriptProperties().getProperty('EMAIL_VERIFICATION_SECRET');
    if (!expected || String(body.secret || '') !== String(expected)) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const email = String(body.email || '').trim().toLowerCase();
    const vk = String(body.verification_key || '').trim();
    const returnUrl = String(body.return_url || 'https://truesightdao.github.io/dapp/create_signature.html').trim();
    if (!email || !vk || !email.includes('@')) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Missing email or verification_key' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const base = returnUrl.split('#')[0];
    const join = base.indexOf('?') >= 0 ? '&' : '?';
    const verifyUrl = `${base}${join}em=${encodeURIComponent(email)}&vk=${encodeURIComponent(vk)}`;

    const subject = 'Verify your TrueSight DAO digital signature';
    const plain =
      'Hello,\n\n' +
      'Click the link below to verify this browser for your digital signature registration:\n\n' +
      verifyUrl +
      '\n\nIf you did not request this, you can ignore this email.\n\nTrueSight DAO';

    GmailApp.sendEmail(email, subject, plain);

    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    Logger.log('handleEmailVerificationRequest_ failed: ' + err);
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Edgar → POST JSON { secret, email, verification_key, return_url }
 */
function doPost(e) {
  try {
    const body = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    return handleEmailVerificationRequest_(body);
  } catch (err) {
    Logger.log('doPost email verification failed: ' + err);
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}
