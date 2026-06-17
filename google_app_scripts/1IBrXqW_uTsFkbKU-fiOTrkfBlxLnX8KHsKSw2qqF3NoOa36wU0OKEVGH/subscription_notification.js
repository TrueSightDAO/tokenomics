/**
 * File: google_app_scripts/agroverse_qr_codes/subscription_notification.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 *
 * Apps Script project:
 *   https://script.google.com/home/projects/1IBrXqW_uTsFkbKU-fiOTrkfBlxLnX8KHsKSw2qqF3NoOa36wU0OKEVGH/edit
 *
 * Description: Background batch processor for the **Agroverse QR codes** sheet.
 * For each row with a valid email in column L and no timestamp in column M,
 * opens the Google Doc named GOOGLE_DOC_ID, uses its title as the email
 * subject, fills the body with the row's tracking link, and sends an HTML
 * email via MailApp. Stamps column M with the send timestamp so each row is
 * processed once.
 *
 * **Owner_email note (operator confirm, 2026-05-29):** this script sends
 * QR-code-related notifications and likely overlaps with the tree-planting
 * pledge flow handled by scriptId
 * `1MnAsIQAxcSfZO_hALOtMFJ4y1k4OnqeXKMwYs6xev600rPNUYepqcXsT` (which is
 * already assigned `admin@truesight.me` per Gary's rule). If Gary confirms
 * this script also runs under `admin@truesight.me`, add its scriptId to
 * `scripts/assign_gas_owner_emails.py` `ADMIN_SCRIPT_IDS` and re-run.
 *
 * Source extracted 2026-05-29 from
 * `clasp_mirrors/1IBrXqW_uTsFkbKU-fiOTrkfBlxLnX8KHsKSw2qqF3NoOa36wU0OKEVGH/Code.js`
 * (orphan mirror #6) — the Code.js header pointed at this exact path but the
 * source file was missing. See `docs/gas_orphan_mirror_dispositions.md`.
 */

/* Configurable Variables */
const SPREADSHEET_URL = "https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit"; // Google Sheet URL
const SHEET_NAME = "Agroverse QR codes"; // Sheet name
const GOOGLE_DOC_ID = "1VDPblYlWIpirqH9o3eoiL8pKHv8E3oea99c6DJQGA3k"; // Replace with your Google Doc ID
const TEST_QR_CODE = "2025BF_20250521_PROPANE_1"; // QR code for testing
const EMAIL_COLUMN = 12; // Column L (1-based index)
const TIMESTAMP_COLUMN = 13; // Column M (1-based index)
const QR_CODE_COLUMN = 1; // Column A (1-based index)

/**
 * Tester method to manually test email sending with a sample QR code
 */
function testSendEmail() {
  sendEmailForQRCode(TEST_QR_CODE);
}

/**
 * Processes all records with valid email in column L and no sent date in column M
 */
function processBatch() {
  const sheet = SpreadsheetApp.openByUrl(SPREADSHEET_URL).getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Iterate through rows, starting at 1 to skip header
  for (let i = 1; i < data.length; i++) {
    const email = data[i][EMAIL_COLUMN - 1]; // Column L
    const notificationDate = data[i][TIMESTAMP_COLUMN - 1]; // Column M
    const qrCode = data[i][QR_CODE_COLUMN - 1]; // Column A

    // Check if email is valid and no notification date exists
    if (emailRegex.test(email) && !notificationDate) {
      sendEmailForQRCode(qrCode);
    }
  }
}

/**
 * Sends an email for a given QR code if conditions are met
 * @param {string} qrCode - The QR code to match in column A
 */
function sendEmailForQRCode(qrCode) {
  const sheet = SpreadsheetApp.openByUrl(SPREADSHEET_URL).getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Find row where QR code matches column A
  for (let i = 1; i < data.length; i++) { // Start at 1 to skip header
    if (data[i][QR_CODE_COLUMN - 1] === qrCode) { // Column A (0-based index)
      const email = data[i][EMAIL_COLUMN - 1]; // Column L
      const notificationDate = data[i][TIMESTAMP_COLUMN - 1]; // Column M

      if (emailRegex.test(email) && !notificationDate) {
        const doc = DocumentApp.openById(GOOGLE_DOC_ID);
        const subject = doc.getName(); // Get document title as email subject
        let body = doc.getBody().getText();
        const trackingLink = `${data[i][1]}?qr_code=${encodeURIComponent(qrCode)}`; // Use column B (index 1) for base URL
        body = body.replace("{{TRACKING_LINK}}", trackingLink);

        // Convert plain text to HTML to preserve formatting
        const htmlBody = HtmlService.createHtmlOutput(body.replace(/\n/g, "<br>")).getContent();

        // Send email with HTML content
        MailApp.sendEmail({
          to: email,
          subject: subject,
          htmlBody: htmlBody
        });

        // Update column M with timestamp
        sheet.getRange(i + 1, TIMESTAMP_COLUMN).setValue(new Date());
        break; // Exit loop after processing
      }
    }
  }
}
