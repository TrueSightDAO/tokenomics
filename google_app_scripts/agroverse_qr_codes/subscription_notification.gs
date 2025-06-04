/* Configurable Variables */
const SPREADSHEET_URL = "https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit"; // Google Sheet URL
const SHEET_NAME = "Agroverse QR codes"; // Sheet name
const GOOGLE_DOC_ID = "1VDPblYlWIpirqH9o3eoiL8pKHv8E3oea99c6DJQGA3k"; // Replace with your Google Doc ID
const TEST_QR_CODE = "2025BF_20250521_PROPANE_1"; // QR code for testing
const TRACKING_LINK_BASE = "https://www.agroverse.shop/shipments/agl9?qr_code="; // Base URL for tracking link
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
        const trackingLink = `${TRACKING_LINK_BASE}${encodeURIComponent(qrCode)}`;
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

/**
 * Trigger for onEdit to detect email changes in column L
 */
function onEdit(e) {
  const sheet = e.source.getSheetByName(SHEET_NAME);
  const range = e.range;
  const row = range.getRow();
  const column = range.getColumn();

  // Check if edit is in email column and row > 1 (skip header)
  if (column === EMAIL_COLUMN && row > 1) {
    const qrCode = sheet.getRange(row, QR_CODE_COLUMN).getValue();
    if (qrCode) {
      sendEmailForQRCode(qrCode);
    }
  }
}