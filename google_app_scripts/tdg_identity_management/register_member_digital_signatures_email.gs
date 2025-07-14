/**
 * Gmail-based TDG Identity Management System
 * Processes digital signature events from Gmail emails and maintains a registry
 */

// Load API keys and configuration settings
setApiKeys();
const creds = getCredentials();

// Configuration Constants
const CONFIG = {
  SOURCE: {
    GMAIL_QUERY: 'from:* [DIGITAL SIGNATURE EVENT]', // Query to filter relevant emails
    LABEL: 'Processed', // Optional: Label to mark processed emails
  },
  SIGNATURES: {
    URL: 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=577022511#gid=577022511',
    SHEET_NAME: 'Contributors Digital Signatures',
    COLUMNS: {
      NAME: 0,         // A
      CREATED: 1,      // B
      LAST_ACTIVE: 2,  // C
      STATUS: 3,       // D
      SIGNATURE: 4,    // E
      EMAIL: 5         // F (New column for sender's email)
    }
  },
  CONTRIBUTORS: {
    URL: 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=1460794618#gid=1460794618',
    SHEET_NAME: 'Contributors contact information',
    COLUMNS: {
      FULL_NAME: 0,    // A
      EMAIL: 3         // D (Assuming Column D stores email addresses)
    }
  },
  TELEGRAM: {
    TOKEN: creds.TELEGRAM_API_TOKEN
  },
  GMAIL: {
    SENDER: 'your-email@gmail.com' // Your Gmail address for sending replies
  }
};

/**
 * Main function to process emails (run via time-based trigger)
 */
function processEmailSignatureEvents() {
  try {
    const { signaturesSheet } = loadSheets();
    const existingSignatures = getExistingSignatures(signaturesSheet);
    const threads = GmailApp.search(CONFIG.SOURCE.GMAIL_QUERY + ' is:unread');
    let processedCount = 0;

    threads.forEach(thread => {
      const messages = thread.getMessages();
      messages.forEach(message => {
        if (!message.isUnread()) return;
        const processResult = processEmailMessage(message, existingSignatures);
        if (processResult?.valid) {
          registerSignature(signaturesSheet, processResult);
          sendEmailReply(message, processResult);
          sendTelegramNotification(processResult, message);
          existingSignatures.push(processResult.signature);
          processedCount++;
        }
        message.markRead();
        if (CONFIG.SOURCE.LABEL) {
          GmailApp.getUserLabelByName(CONFIG.SOURCE.LABEL)?.addToThread(thread);
        }
      });
    });

    Logger.log(`Process complete. ${processedCount} new signatures registered.`);
    return processedCount;
  } catch (error) {
    Logger.log(`❌ Process failed: ${error.message}\n${error.stack}`);
    return 0;
  }
}

/**
 * Load required sheets
 */
function loadSheets() {
  const signaturesSheet = SpreadsheetApp
    .openByUrl(CONFIG.SIGNATURES.URL)
    .getSheetByName(CONFIG.SIGNATURES.SHEET_NAME);
  return { signaturesSheet };
}

/**
 * Get existing signatures from registry
 */
function getExistingSignatures(sheet) {
  return sheet.getDataRange()
    .getValues()
    .slice(1) // Skip header
    .map(row => row[CONFIG.SIGNATURES.COLUMNS.SIGNATURE])
    .filter(Boolean);
}

/**
 * Process a single email message
 */
function processEmailMessage(message, existingSignatures) {
  const emailContent = message.getPlainBody();
  const sender = message.getFrom(); // e.g., "John Doe <john.doe@example.com>"
  const signature = extractSignature(emailContent);
  if (!signature) return null;

  // Check for duplicates
  if (existingSignatures.includes(signature)) {
    Logger.log(`⏩ Duplicate signature: ${signature.substring(0, 10)}...`);
    sendEmailReply(message, { signature, isDuplicate: true });
    return null;
  }

  // Resolve contributor name
  const { contributorName, emailAddress } = resolveContributorName(sender);
  if (!contributorName) return null;

  return {
    valid: true,
    signature,
    contributorName,
    emailAddress,
    timestamp: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss")
  };
}

/**
 * Extract signature from email body
 */
function extractSignature(message) {
  const pattern = /\[DIGITAL SIGNATURE EVENT\][\s\S]*?DIGITAL SIGNATURE: ([A-Za-z0-9+/=]+)/i;
  const match = message?.match(pattern);
  return match?.[1] || null;
}

/**
 * Register new signature in sheet
 */
function registerSignature(sheet, { contributorName, timestamp, signature, emailAddress }) {
  const rowData = [
    contributorName, // A: Contributor Name
    timestamp,       // B: Created Date
    timestamp,       // C: Last Active
    "ACTIVE",        // D: Status
    signature,       // E: Signature
    emailAddress     // F: Sender's Email
  ];

  sheet.getRange(sheet.getLastRow() + 1, 1, 1, rowData.length)
    .setValues([rowData]);
}

/**
 * Send email reply to sender
 */
function sendEmailReply(message, { signature, contributorName, isDuplicate = false }) {
  const recipient = message.getFrom();
  const subject = isDuplicate
    ? "Digital Signature Registration Failed"
    : "Digital Signature Registered";
  const messageText = isDuplicate
    ? `Dear Contributor,\n\nThe digital signature (${signature.substring(0, 20)}...) you submitted already exists in our registry.\n\nPlease submit a unique signature.\n\nBest regards,\nTDG Identity Management`
    : `Dear ${contributorName},\n\nYour digital signature has been registered successfully.\n\nDetails:\nContributor: ${contributorName}\nSignature: ${signature.substring(0, 20)}...\n\nBest regards,\nTDG Identity Management`;

  try {
    GmailApp.sendEmail(recipient, subject, messageText, {
      from: CONFIG.GMAIL.SENDER
    });
    Logger.log(`Email sent to ${recipient}: ${subject}`);
  } catch (error) {
    Logger.log(`❌ Email send failed: ${error.message}`);
  }
}

/**
 * Send Telegram notification
 */
function sendTelegramNotification(result, message) {
  const chatId = '-1002190388985'; // Replace with actual chat ID
  if (!CONFIG.TELEGRAM.TOKEN || !chatId) {
    Logger.log(`⏩ Skipping notification - ${!CONFIG.TELEGRAM.TOKEN ? 'Missing token' : 'Missing chat ID'}`);
    return false;
  }

  const messageText = `✅ Digital signature registered\n\n` +
    `Contributor: ${result.contributorName}\n` +
    `Signature: ${result.signature.substring(0, 20)}...\n` +
    `Registered via: ${result.emailAddress}`;

  const payload = {
    method: "sendMessage",
    chat_id: chatId,
    text: messageText,
    parse_mode: "HTML"
  };

  try {
    const response = UrlFetchApp.fetch(
      `https://api.telegram.org/bot${CONFIG.TELEGRAM.TOKEN}/sendMessage`,
      {
        method: "post",
        payload,
        muteHttpExceptions: true
      }
    );

    const responseData = JSON.parse(response.getContentText());
    if (!responseData.ok) {
      Logger.log(`❌ Telegram error: ${responseData.description}`);
      return false;
    }
    return true;
  } catch (error) {
    Logger.log(`❌ Telegram send failed: ${error.message}`);
    return false;
  }
}

/**
 * Resolve email to contributor name
 */
function resolveContributorName(sender) {
  try {
    const sheet = SpreadsheetApp
      .openByUrl(CONFIG.CONTRIBUTORS.URL)
      .getSheetByName(CONFIG.CONTRIBUTORS.SHEET_NAME);
    const data = sheet.getDataRange().getValues();

    // Extract email address from sender (e.g., "John Doe <john.doe@example.com>")
    const emailMatch = sender.match(/<(.+?)>/);
    const emailAddress = emailMatch ? emailMatch[1] : sender;
    const displayName = sender.replace(/<(.+?)>/, '').trim() || emailAddress;

    for (let i = 1; i < data.length; i++) {
      const contributorEmail = data[i][CONFIG.CONTRIBUTORS.COLUMNS.EMAIL];
      if (contributorEmail?.toLowerCase() === emailAddress.toLowerCase()) {
        return {
          contributorName: data[i][CONFIG.CONTRIBUTORS.COLUMNS.FULL_NAME],
          emailAddress
        };
      }
    }

    Logger.log(`🔍 Contributor not found for email: ${emailAddress}`);
    return { contributorName: displayName, emailAddress };
  } catch (error) {
    Logger.log(`❌ Contributor resolution failed: ${error.message}`);
    return { contributorName: null, emailAddress: null };
  }
}

/**
 * Set up time-based trigger
 */
function setupTrigger() {
  ScriptApp.newTrigger('processEmailSignatureEvents')
    .timeBased()
    .everyMinutes(5) // Adjust as needed
    .create();
}