/**
 * Gmail-based TDG Identity Management System
 * Processes digital signature events from Gmail emails received in the last 24 hours
 */

// Load API keys and configuration settings
setApiKeys();
const creds = getCredentials();

// Configuration Constants
const CONFIG = {
  SOURCE: {
    GMAIL_QUERY: '[DIGITAL SIGNATURE EVENT]', // Filter emails with this marker
    LABEL: 'Processed', // Optional: Label to mark processed emails
    TIME_WINDOW_HOURS: 24 // Process emails from the last 24 hours
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
    SENDER: 'admin@truesight.me' // Your Gmail address for sending replies
  }
};

/**
 * Main function to process emails (run via time-based trigger)
 */
function processEmailSignatureEvents() {
  try {
    const { signaturesSheet } = loadSheets();
    const existingSignatures = getExistingSignatures(signaturesSheet);
    
    // Calculate timestamp for TIME_WINDOW_HOURS ago
    const timeWindowAgo = new Date(Date.now() - CONFIG.SOURCE.TIME_WINDOW_HOURS * 60 * 60 * 1000);
    const formattedDate = Utilities.formatDate(timeWindowAgo, Session.getScriptTimeZone(), 'yyyy/MM/dd');
    const timeFilter = `after:${formattedDate}`;
    const searchQuery = `${CONFIG.SOURCE.GMAIL_QUERY} ${timeFilter}`;
    Logger.log(`Search query: ${searchQuery}`);
    
    const threads = GmailApp.search(searchQuery);
    Logger.log(`Found ${threads.length} threads`);
    
    let processedCount = 0;
    threads.forEach(thread => {
      const messages = thread.getMessages();
      Logger.log(`Thread ID: ${thread.getId()}, Messages: ${messages.length}`);
      messages.forEach(message => {
        Logger.log(`Processing message ID: ${message.getId()}, From: ${message.getFrom()}, Date: ${message.getDate()}`);
        
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
  Logger.log(`Email content: ${emailContent.substring(0, 100)}...`);
  const sender = message.getFrom();
  const signature = extractSignature(emailContent);
  if (!signature) {
    Logger.log(`No signature found in message ID: ${message.getId()}`);
    return null;
  }

  // Check for duplicates
  if (existingSignatures.includes(signature)) {
    Logger.log(`⏩ Duplicate signature: ${signature.substring(0, 10)}...`);
    // sendEmailReply(message, { signature, isDuplicate: true });
    return null;
  }

  // Resolve contributor name
  const { contributorName, emailAddress } = resolveContributorName(sender);
  if (!contributorName) {
    Logger.log(`No contributor name resolved for sender: ${sender}`);
    return null;
  }

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
  const pattern = /\[DIGITAL SIGNATURE EVENT\][\s\S]*?DIGITAL SIGNATURE:\s*([A-Za-z0-9+/=]+)/i;
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
    ? `Dear Contributor,\n\nThe digital signature (${signature.substring(0, 20)}...) you submitted already exists in our registry.\nDigital Signature Registry: http://truesight.me/digital-signatures\n\nPlease submit a unique signature.\n\nBest regards,\nTrueSight DAO`
    : `Dear ${contributorName},\n\nYour digital signature has been registered successfully.\n\nDetails:\nContributor: ${contributorName}\nSignature: ${signature}\n\nDigital Signature Registry:  https://truesight.me/digital-signatures\n\nBest regards,\nTrueSight DAO`;

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
    `Registered via: ${result.emailAddress}\n\n` + 
    `Digital Signature Registry: https://truesight.me/digital-signatures` ;

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
    .everyMinutes(5)
    .create();
}

/**
 * Debug function to test email retrieval
 */
function debugEmailSearch() {
  try {
    const timeWindowAgo = new Date(Date.now() - CONFIG.SOURCE.TIME_WINDOW_HOURS * 60 * 60 * 1000);
    const formattedDate = Utilities.formatDate(timeWindowAgo, Session.getScriptTimeZone(), 'yyyy/MM/dd');
    const searchQuery = `${CONFIG.SOURCE.GMAIL_QUERY} after:${formattedDate}`;
    Logger.log(`Debug search query: ${searchQuery}`);
    
    const threads = GmailApp.search(searchQuery);
    Logger.log(`Found ${threads.length} threads`);
    
    threads.forEach(thread => {
      Logger.log(`Thread ID: ${thread.getId()}`);
      const messages = thread.getMessages();
      messages.forEach(message => {
        Logger.log(`Message ID: ${message.getId()}`);
        Logger.log(`From: ${message.getFrom()}`);
        Logger.log(`Subject: ${message.getSubject()}`);
        Logger.log(`Date: ${message.getDate()}`);
        Logger.log(`Is Unread: ${message.isUnread()}`);
        Logger.log(`Content: ${message.getPlainBody().substring(0, 100)}...`);
      });
    });
  } catch (error) {
    Logger.log(`❌ Debug failed: ${error.message}\n${error.stack}`);
  }
}

/**
 * Test function to process a specific email by message ID
 */
function testSpecificEmail() {
  const messageId = '1980b36cb60d4aa7'; // Specific message ID to test
  try {
    // Retrieve the specific message
    const message = GmailApp.getMessageById(messageId);
    if (!message) {
      Logger.log(`❌ Message ID ${messageId} not found`);
      return;
    }

    Logger.log(`Testing message ID: ${message.getId()}`);
    Logger.log(`From: ${message.getFrom()}`);
    Logger.log(`Subject: ${message.getSubject()}`);
    Logger.log(`Date: ${message.getDate()}`);
    Logger.log(`Is Unread: ${message.isUnread()}`);
    const emailContent = message.getPlainBody();
    Logger.log(`Full email content:\n${emailContent}`);

    // Test signature extraction
    const signature = extractSignature(emailContent);
    if (!signature) {
      Logger.log(`❌ No signature extracted from message ID: ${messageId}`);
      const pattern = /\[DIGITAL SIGNATURE EVENT\][\s\S]*?DIGITAL SIGNATURE:\s*([A-Za-z0-9+/=]+)/i;
      const match = emailContent?.match(pattern);
      Logger.log(`Regex match result: ${JSON.stringify(match)}`);
    } else {
      Logger.log(`✅ Signature extracted: ${signature}`);
    }

    // Load existing signatures for duplicate check
    const { signaturesSheet } = loadSheets();
    const existingSignatures = getExistingSignatures(signaturesSheet);

    // Process the message
    const processResult = processEmailMessage(message, existingSignatures);
    if (processResult?.valid) {
      Logger.log(`✅ Message processed successfully`);
      Logger.log(`Contributor: ${processResult.contributorName}`);
      Logger.log(`Signature: ${processResult.signature}`);
      Logger.log(`Email Address: ${processResult.emailAddress}`);
      Logger.log(`Timestamp: ${processResult.timestamp}`);
      // Optionally register and send notifications for testing
      // registerSignature(signaturesSheet, processResult);
      // sendEmailReply(message, processResult);
      // sendTelegramNotification(processResult, message);
    } else {
      Logger.log(`❌ Message processing failed for message ID: ${messageId}`);
    }
  } catch (error) {
    Logger.log(`❌ Test failed for message ID ${messageId}: ${error.message}\n${error.stack}`);
  }
}