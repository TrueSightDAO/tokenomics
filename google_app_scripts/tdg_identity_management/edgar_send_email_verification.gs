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
 * - `EMAIL_VERIFICATION_LOG_FULL_VK` (optional) — set to `true` to log the **entire** verification key in
 *   `Logger` / Executions (use only while debugging; disable afterward).
 *
 * **Operator / debug (run from the Apps Script editor, not the web URL):**
 * - `TEST_sendVerificationEmail()` — edit `TEST_*` constants at the top of that function, then **Run**. Sends
 *   the same Gmail as production (uses script secret from properties).
 * - `editorResendVerificationEmailWithPrompts()` — prompts for email, `verification_key`, and return URL; then sends.
 * - `editorDryRunVerificationEmail()` — same prompts but only **logs** the verify link (no email).
 *
 * After a run, open **Executions** (clock icon) → select the run → expand logs to read `[emailVerification] …` lines.
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
    logEmailVerification_('doGet', {
      transport: 'GET',
      action: 'sendEmailVerification',
      secret_present: Boolean(e.parameter && e.parameter.secret),
      email_present: Boolean(e.parameter && e.parameter.email),
      vk_len: e.parameter && e.parameter.verification_key ? String(e.parameter.verification_key).length : 0,
      return_url_present: Boolean(e.parameter && e.parameter.return_url),
    });
    return handleEmailVerificationRequest_({
      secret: e.parameter.secret,
      email: e.parameter.email,
      verification_key: e.parameter.verification_key,
      return_url: e.parameter.return_url || '',
    });
  }

  if (action === 'refresh_dao_members_cache') {
    // Edgar → GET ?action=refresh_dao_members_cache&secret=...&force=1
    // Implementation lives in DaoMembersCache.js.
    return handleDaoMembersCacheRefreshRequest_({
      secret: e.parameter.secret,
      force: e.parameter.force || '',
    });
  }

  return ContentService.createTextOutput(
    JSON.stringify({
      ok: false,
      error: 'No valid action (use action=sendEmailVerification or action=refresh_dao_members_cache on GET, or POST JSON for email verification).',
    })
  ).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Shared handler: GET query object or POST JSON body
 * { secret, email, verification_key, return_url }
 */
function handleEmailVerificationRequest_(body) {
  try {
    logEmailVerification_('handler_enter', {
      email: String((body && body.email) || '').trim().toLowerCase(),
      vk_for_log: formatVkForLog_(String((body && body.verification_key) || '').trim()),
      return_url_len: String((body && body.return_url) || '').length,
      secret_present: Boolean(body && body.secret),
    });

    const expected = PropertiesService.getScriptProperties().getProperty('EMAIL_VERIFICATION_SECRET');
    if (!expected || String(body.secret || '') !== String(expected)) {
      logEmailVerification_('handler_unauthorized', {
        script_secret_configured: Boolean(expected),
        submitted_secret_len: body && body.secret ? String(body.secret).length : 0,
      });
      return jsonEmailVerificationResponse_({ ok: false, error: 'Unauthorized' });
    }

    const email = String(body.email || '').trim().toLowerCase();
    const vk = String(body.verification_key || '').trim();
    const returnUrl = String(body.return_url || 'https://truesightdao.github.io/dapp/create_signature.html').trim();
    if (!email || !vk || !email.includes('@')) {
      logEmailVerification_('handler_missing_fields', {
        email_present: Boolean(email),
        email_has_at: email.indexOf('@') >= 0,
        vk_present: Boolean(vk),
        vk_len: vk.length,
      });
      return jsonEmailVerificationResponse_({ ok: false, error: 'Missing email or verification_key' });
    }

    const verifyUrl = buildSignatureVerificationUrl_(email, vk, returnUrl);
    logEmailVerification_('handler_sending_gmail', {
      email: email,
      vk_for_log: formatVkForLog_(vk),
      verify_url_preview: verifyUrl.substring(0, 200) + (verifyUrl.length > 200 ? '…' : ''),
    });

    const subject = 'Verify your TrueSight DAO digital signature';
    const plain =
      'Hello,\n\n' +
      'Click the link below to verify this browser for your digital signature registration:\n\n' +
      verifyUrl +
      '\n\nIf you did not request this, you can ignore this email.\n\nTrueSight DAO';

    GmailApp.sendEmail(email, subject, plain);

    logEmailVerification_('handler_sent_ok', { email: email, vk_for_log: formatVkForLog_(vk) });
    return jsonEmailVerificationResponse_({ ok: true });
  } catch (err) {
    Logger.log('[emailVerification] handler_exception ' + String(err && err.message ? err.message : err));
    if (err && err.stack) Logger.log(err.stack);
    return jsonEmailVerificationResponse_({
      ok: false,
      error: String(err && err.message ? err.message : err),
    });
  }
}

/**
 * Edgar → POST JSON { secret, email, verification_key, return_url }
 */
function doPost(e) {
  try {
    const body = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    logEmailVerification_('doPost', {
      transport: 'POST_JSON',
      secret_present: Boolean(body && body.secret),
      email_present: Boolean(body && body.email),
      vk_len: body && body.verification_key ? String(body.verification_key).length : 0,
      return_url_present: Boolean(body && body.return_url),
    });
    return handleEmailVerificationRequest_(body);
  } catch (err) {
    Logger.log('[emailVerification] doPost JSON parse or handler failed: ' + err);
    if (err && err.stack) Logger.log(err.stack);
    return jsonEmailVerificationResponse_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

// ---------------------------------------------------------------------------
// Logging + editor-only test / resend helpers
// ---------------------------------------------------------------------------

/**
 * Edit these, then choose **Run → TEST_sendVerificationEmail** in the Apps Script editor.
 * Sends a real verification email using `EMAIL_VERIFICATION_SECRET` from Script properties.
 */
function TEST_sendVerificationEmail() {
  const TEST_EMAIL = 'you@example.com';
  const TEST_VERIFICATION_KEY = 'PASTE_VERIFICATION_KEY_FROM_SHEET_COLUMN_G';
  const TEST_RETURN_URL = 'http://localhost:8081/create_signature.html';

  const secret = PropertiesService.getScriptProperties().getProperty('EMAIL_VERIFICATION_SECRET');
  if (!secret) throw new Error('Script property EMAIL_VERIFICATION_SECRET is not set');

  logEmailVerification_('TEST_sendVerificationEmail', { note: 'editor test send starting', email: TEST_EMAIL, vk_len: String(TEST_VERIFICATION_KEY).length });
  const out = handleEmailVerificationRequest_({
    secret: secret,
    email: TEST_EMAIL,
    verification_key: TEST_VERIFICATION_KEY,
    return_url: TEST_RETURN_URL,
  });
  Logger.log('[emailVerification] TEST_sendVerificationEmail raw response: ' + out.getContent());
}

/**
 * Run from editor: prompts for email, verification key, and return URL; sends the email.
 * Cancel any dialog to abort without sending.
 */
function editorResendVerificationEmailWithPrompts() {
  const secret = PropertiesService.getScriptProperties().getProperty('EMAIL_VERIFICATION_SECRET');
  if (!secret) throw new Error('Script property EMAIL_VERIFICATION_SECRET is not set');

  const email = Browser.inputBox(
    'Resend verification email',
    'Contributor email (lowercase ok):',
    Browser.Buttons.OK_CANCEL
  );
  if (email === 'cancel' || !email) {
    Logger.log('[emailVerification] editorResend: cancelled at email');
    return;
  }

  const vk = Browser.inputBox(
    'Resend verification email',
    'Paste verification_key (Contributors Digital Signatures, column G):',
    Browser.Buttons.OK_CANCEL
  );
  if (vk === 'cancel' || !vk) {
    Logger.log('[emailVerification] editorResend: cancelled at verification_key');
    return;
  }

  const ret = Browser.inputBox(
    'Resend verification email',
    'Return URL (generation source), e.g. http://localhost:8081/create_signature.html\n(leave blank for GitHub Pages default)',
    Browser.Buttons.OK_CANCEL
  );
  if (ret === 'cancel') {
    Logger.log('[emailVerification] editorResend: cancelled at return_url');
    return;
  }

  const returnUrl = String(ret || '').trim() || 'https://truesightdao.github.io/dapp/create_signature.html';
  logEmailVerification_('editorResendVerificationEmailWithPrompts', { email: String(email).trim().toLowerCase(), vk_len: String(vk).trim().length, return_url: returnUrl });

  const out = handleEmailVerificationRequest_({
    secret: secret,
    email: String(email).trim(),
    verification_key: String(vk).trim(),
    return_url: returnUrl,
  });
  Logger.log('[emailVerification] editorResend raw response: ' + out.getContent());
}

/**
 * Run from editor: prompts only; logs the verify URL and JSON body that would be sent — **does not** call GmailApp.
 */
function editorDryRunVerificationEmail() {
  const emailRaw = Browser.inputBox(
    'Dry run — verification email',
    'Contributor email:',
    Browser.Buttons.OK_CANCEL
  );
  if (emailRaw === 'cancel' || !emailRaw) return;

  const vkRaw = Browser.inputBox(
    'Dry run — verification email',
    'Paste verification_key:',
    Browser.Buttons.OK_CANCEL
  );
  if (vkRaw === 'cancel' || !vkRaw) return;

  const retRaw = Browser.inputBox(
    'Dry run — verification email',
    'Return URL (blank = GitHub Pages default):',
    Browser.Buttons.OK_CANCEL
  );
  if (retRaw === 'cancel') return;

  const email = String(emailRaw).trim().toLowerCase();
  const vk = String(vkRaw).trim();
  const returnUrl = String(retRaw || '').trim() || 'https://truesightdao.github.io/dapp/create_signature.html';
  const verifyUrl = buildSignatureVerificationUrl_(email, vk, returnUrl);

  Logger.log('[emailVerification] DRY RUN email=' + email + ' vk_len=' + vk.length);
  Logger.log('[emailVerification] DRY RUN verifyUrl=' + verifyUrl);
}

function jsonEmailVerificationResponse_(obj) {
  const text = JSON.stringify(obj);
  Logger.log('[emailVerification] response_json=' + text);
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

/**
 * @param {string} stage short label, e.g. `doGet`, `unauthorized`, `sent`
 * @param {Object} fields safe metadata (never pass raw shared secret here)
 */
function logEmailVerification_(stage, fields) {
  let extra = '';
  try {
    extra = JSON.stringify(fields || {});
  } catch (e) {
    extra = String(fields);
  }
  Logger.log('[emailVerification] stage=' + stage + ' ' + extra);
}

function shouldLogFullVk_() {
  const v = PropertiesService.getScriptProperties().getProperty('EMAIL_VERIFICATION_LOG_FULL_VK');
  return String(v || '').toLowerCase() === 'true' || String(v || '') === '1';
}

function formatVkForLog_(vk) {
  if (!vk) return '(empty)';
  if (shouldLogFullVk_()) return vk;
  const s = String(vk);
  if (s.length <= 12) return s + ' (len=' + s.length + ')';
  return 'prefix=' + s.substring(0, 4) + '… tail=' + s.slice(-10) + ' len=' + s.length;
}

function buildSignatureVerificationUrl_(email, vk, returnUrl) {
  const base = String(returnUrl || '').split('#')[0];
  const join = base.indexOf('?') >= 0 ? '&' : '?';
  return base + join + 'em=' + encodeURIComponent(email) + '&vk=' + encodeURIComponent(vk);
}
