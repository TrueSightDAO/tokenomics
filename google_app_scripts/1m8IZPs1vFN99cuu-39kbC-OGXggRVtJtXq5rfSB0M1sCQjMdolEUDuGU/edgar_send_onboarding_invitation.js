/**
 * File: google_app_scripts/tdg_identity_management/edgar_send_onboarding_invitation.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 *
 * Apps Script project:
 *   https://script.google.com/home/projects/1m8IZPs1vFN99cuu-39kbC-OGXggRVtJtXq5rfSB0M1sCQjMdolEUDuGU/edit
 *
 * owner_email: admin@truesight.me (same Apps Script project + same script
 * properties as edgar_send_email_verification.gs; deploy as Execute as User
 * = admin@truesight.me so GmailApp.sendEmail sends from that account).
 *
 * ---------------------------------------------------------------------------
 * Summary
 * ---------------------------------------------------------------------------
 * Edgar (`sentiment_importer`) calls this handler after a governor uses
 * `dapp/governor_contributor_admin.html` to add a new contributor on someone
 * else's behalf. The handler emails the new contributor a Seth-Godin-voiced
 * invitation that:
 *   - tells them who invited them (the governor's display name),
 *   - gives them ONE primary action — generate their signing key at
 *     create_signature.html (with the email pre-filled),
 *   - links a secondary high-level intro (truesight.me/edgar.html) without
 *     stealing focus from the primary action.
 *
 * This is distinct from the existing email-verification handler:
 *   - VERIFICATION = contributor self-registered, prove email ownership.
 *   - INVITATION   = governor onboarded someone; nudge them to start.
 * Both live in the same Apps Script project (1m8IZPs1) because both run as
 * admin@truesight.me at the From line.
 *
 * ---------------------------------------------------------------------------
 * Transport (Edgar → GAS)
 * ---------------------------------------------------------------------------
 * GET:
 *   /exec?action=sendOnboardingInvitation
 *        &secret=...
 *        &email=<new-contributor@example.com>
 *        &contributor_name=<First Last>     // optional but recommended
 *        &inviter_name=<Governor Display>   // required — Seth-voice copy names them
 *        &inviter_email=<governor@...>      // optional — Reply-To if present
 *        &return_url=<base for create_signature.html>   // optional; GitHub Pages default
 *
 * POST JSON: same fields.
 *
 * Dispatcher: edgar_send_email_verification.gs's doGet/doPost route on
 * action === 'sendOnboardingInvitation'.
 *
 * ---------------------------------------------------------------------------
 * Script property
 * ---------------------------------------------------------------------------
 * - `EMAIL_VERIFICATION_SECRET` — shared with the verification flow; one
 *   secret per project. Edgar passes it as `secret=`.
 *
 * ---------------------------------------------------------------------------
 * Operator / debug (Apps Script editor, not the web URL):
 * ---------------------------------------------------------------------------
 * - `TEST_sendOnboardingInvitation()` — edit the TEST_ constants at top of
 *   that function, then Run. Sends real Gmail (uses script secret).
 * - `editorDryRunOnboardingInvitation()` — prompts for fields, logs the
 *   composed email body, no send.
 */


/**
 * Edgar → GET ?action=sendOnboardingInvitation&secret=...&email=...&contributor_name=...&inviter_name=...&inviter_email=...&return_url=...
 *
 * Or shared with handleEmailVerificationRequest_, called via dispatcher.
 */
function handleOnboardingInvitationRequest_(body) {
  try {
    logOnboardingInvitation_('handler_enter', {
      email: String((body && body.email) || '').trim().toLowerCase(),
      contributor_name_present: Boolean(body && body.contributor_name),
      inviter_name_present: Boolean(body && body.inviter_name),
      inviter_email_present: Boolean(body && body.inviter_email),
      return_url_len: String((body && body.return_url) || '').length,
      secret_present: Boolean(body && body.secret),
    });

    const expected = PropertiesService.getScriptProperties().getProperty('EMAIL_VERIFICATION_SECRET');
    if (!expected || String(body.secret || '') !== String(expected)) {
      logOnboardingInvitation_('handler_unauthorized', {
        script_secret_configured: Boolean(expected),
        submitted_secret_len: body && body.secret ? String(body.secret).length : 0,
      });
      return jsonOnboardingInvitationResponse_({ ok: false, error: 'Unauthorized' });
    }

    const email = String(body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      logOnboardingInvitation_('handler_missing_email', { email_present: Boolean(email) });
      return jsonOnboardingInvitationResponse_({ ok: false, error: 'Missing or malformed email' });
    }

    const contributorName = String(body.contributor_name || '').trim();
    const inviterName = String(body.inviter_name || '').trim();
    const inviterEmail = String(body.inviter_email || '').trim().toLowerCase();
    if (!inviterName) {
      logOnboardingInvitation_('handler_missing_inviter', { email: email });
      return jsonOnboardingInvitationResponse_({
        ok: false,
        error: 'Missing inviter_name — invitation must name who extended it.',
      });
    }

    const returnUrl = String(body.return_url || 'https://dapp.truesight.me/create_signature.html').trim();
    const signatureUrl = buildOnboardingSignatureUrl_(email, returnUrl);

    const subject = composeOnboardingSubject_({ inviterName: inviterName });
    const plainBody = composeOnboardingBody_({
      contributorName: contributorName,
      inviterName: inviterName,
      signatureUrl: signatureUrl,
    });

    logOnboardingInvitation_('handler_sending_gmail', {
      email: email,
      signature_url_preview: signatureUrl.substring(0, 200) + (signatureUrl.length > 200 ? '…' : ''),
      subject: subject,
      inviter_name: inviterName,
    });

    const mailOpts = { name: 'TrueSight DAO' };
    if (inviterEmail && inviterEmail.includes('@')) {
      mailOpts.replyTo = inviterEmail;
    }
    GmailApp.sendEmail(email, subject, plainBody, mailOpts);

    logOnboardingInvitation_('handler_sent_ok', { email: email, inviter_name: inviterName });
    return jsonOnboardingInvitationResponse_({ ok: true });
  } catch (err) {
    Logger.log('[onboardingInvitation] handler_exception ' + String(err && err.message ? err.message : err));
    if (err && err.stack) Logger.log(err.stack);
    return jsonOnboardingInvitationResponse_({
      ok: false,
      error: String(err && err.message ? err.message : err),
    });
  }
}


/**
 * Compose the Subject line. Short, names the inviter, sets expectation.
 *
 * Seth-Godin lens: the recipient is busy and skeptical; one specific human
 * inviting them is more relevant than a generic "Welcome" subject.
 */
function composeOnboardingSubject_(opts) {
  return opts.inviterName + ' added you to TrueSight DAO';
}


/**
 * Compose the plain-text body.
 *
 * Seth-Godin lens (per agentic_ai_context/CMO_SETH_GODIN.md):
 *   - Smallest viable audience: grassroots contributors who've been burned
 *     by crypto-bro maximalism and want something that respects their time.
 *   - Permission marketing: this email is anticipated (a governor just
 *     onboarded them) — earn the next click by being short.
 *   - Story, not bullet points: open with what just happened, name the
 *     human who did it, then offer the single next step.
 *   - One ask: generate the signing key. The intro link is optional context,
 *     deliberately deprioritised below the primary action.
 *   - Tribe signal: "Not a wallet. Not gas." names the difference from the
 *     crypto status quo most readers expect.
 */
function composeOnboardingBody_(opts) {
  const contributorName = opts.contributorName || 'there';
  const inviterName = opts.inviterName;
  const signatureUrl = opts.signatureUrl;

  return (
    'Hi ' + contributorName + ',\n\n' +
    inviterName + ' added you to TrueSight DAO today.\n\n' +
    'The first thing to know: every action you take in this DAO is signed by a key only you control. Not a wallet. Not gas. Not crypto in the way you have been told it has to be.\n\n' +
    'Generate your signing key (takes 30 seconds, lives in your browser):\n' +
    signatureUrl + '\n\n' +
    'Once that is done, you can submit contributions, propose work, and have your time recorded on the ledger like every other contributor.\n\n' +
    'If you want some context on what you are part of:\n' +
    'https://truesight.me/edgar.html\n' +
    'https://truesight.me/whitepaper\n\n' +
    'Welcome.\n\n' +
    '— TrueSight DAO'
  );
}


/**
 * Build the create_signature.html URL with the contributor's email pre-filled.
 * Mirrors buildSignatureVerificationUrl_ but for the invitation flow (no
 * verification key is involved here — the contributor will generate one
 * client-side and submit via the DApp).
 */
function buildOnboardingSignatureUrl_(email, returnUrl) {
  const base = String(returnUrl || '').split('#')[0];
  const join = base.indexOf('?') >= 0 ? '&' : '?';
  return base + join + 'em=' + encodeURIComponent(email);
}


function jsonOnboardingInvitationResponse_(obj) {
  const text = JSON.stringify(obj);
  Logger.log('[onboardingInvitation] response_json=' + text);
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}


function logOnboardingInvitation_(stage, fields) {
  let extra = '';
  try {
    extra = JSON.stringify(fields || {});
  } catch (e) {
    extra = String(fields);
  }
  Logger.log('[onboardingInvitation] stage=' + stage + ' ' + extra);
}


// ---------------------------------------------------------------------------
// Editor-only test / dry-run helpers
// ---------------------------------------------------------------------------

/**
 * Edit these, then Run → TEST_sendOnboardingInvitation in the Apps Script
 * editor. Sends a real invitation email using EMAIL_VERIFICATION_SECRET from
 * Script properties. NOTE: the editor runs as Session.getActiveUser(), not
 * the deployed "Execute as" owner; the From line for editor-runs is the
 * editor account, not necessarily admin@truesight.me. To test production
 * sending behaviour, call the deployed /exec URL.
 */
function TEST_sendOnboardingInvitation() {
  const TEST_EMAIL = 'you@example.com';
  const TEST_CONTRIBUTOR_NAME = 'Alex';
  const TEST_INVITER_NAME = 'Gary Teh';
  const TEST_INVITER_EMAIL = 'garyjob@agroverse.shop';
  const TEST_RETURN_URL = 'https://dapp.truesight.me/create_signature.html';

  const secret = PropertiesService.getScriptProperties().getProperty('EMAIL_VERIFICATION_SECRET');
  if (!secret) throw new Error('Script property EMAIL_VERIFICATION_SECRET is not set');

  Logger.log(
    '[onboardingInvitation] NOTE: editor Run uses Session.getActiveUser().getEmail()=' +
      Session.getActiveUser().getEmail() +
      ' — GmailApp.sendEmail sends as this user, not necessarily the web app "Execute as" owner.'
  );

  const out = handleOnboardingInvitationRequest_({
    secret: secret,
    email: TEST_EMAIL,
    contributor_name: TEST_CONTRIBUTOR_NAME,
    inviter_name: TEST_INVITER_NAME,
    inviter_email: TEST_INVITER_EMAIL,
    return_url: TEST_RETURN_URL,
  });
  Logger.log('[onboardingInvitation] TEST_sendOnboardingInvitation raw response: ' + out.getContent());
}


/**
 * Run from editor: prompts for fields; logs what would be sent. No mail.
 */
function editorDryRunOnboardingInvitation() {
  const emailRaw = Browser.inputBox(
    'Dry run — onboarding invitation',
    'New contributor email:',
    Browser.Buttons.OK_CANCEL
  );
  if (emailRaw === 'cancel' || !emailRaw) return;

  const contribName = Browser.inputBox(
    'Dry run — onboarding invitation',
    'Contributor name (optional, blank ok):',
    Browser.Buttons.OK_CANCEL
  );
  if (contribName === 'cancel') return;

  const inviterName = Browser.inputBox(
    'Dry run — onboarding invitation',
    'Inviter name (the governor who onboarded them):',
    Browser.Buttons.OK_CANCEL
  );
  if (inviterName === 'cancel' || !inviterName) return;

  const inviterEmail = Browser.inputBox(
    'Dry run — onboarding invitation',
    'Inviter email (optional Reply-To, blank ok):',
    Browser.Buttons.OK_CANCEL
  );
  if (inviterEmail === 'cancel') return;

  const retRaw = Browser.inputBox(
    'Dry run — onboarding invitation',
    'Return URL (blank = DApp default):',
    Browser.Buttons.OK_CANCEL
  );
  if (retRaw === 'cancel') return;

  const email = String(emailRaw).trim().toLowerCase();
  const returnUrl = String(retRaw || '').trim() || 'https://dapp.truesight.me/create_signature.html';
  const signatureUrl = buildOnboardingSignatureUrl_(email, returnUrl);

  const subject = composeOnboardingSubject_({ inviterName: String(inviterName).trim() });
  const body = composeOnboardingBody_({
    contributorName: String(contribName || '').trim(),
    inviterName: String(inviterName).trim(),
    signatureUrl: signatureUrl,
  });

  Logger.log('[onboardingInvitation] DRY RUN email=' + email);
  Logger.log('[onboardingInvitation] DRY RUN subject=' + subject);
  Logger.log('[onboardingInvitation] DRY RUN body=\n' + body);
}
