// Load API keys and configuration settings from Credentials.gs
// - setApiKeys(): Stores sensitive API keys in Google Apps Script’s Script Properties for security.
// - getCredentials(): Retrieves all configuration details (API keys, URLs, IDs) as an object.
// - These steps ensure keys and settings are centralized and not hardcoded here.
setApiKeys();
const creds = getCredentials();

// ------------------------ Telegram Webhook Listener ------------------------

// Set this after publishing the Web App (e.g., "https://script.google.com/macros/s/AKfycbxyz1234567890/exec")
const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbw6VF7SeOR7nEjQro7u64m1bJmrJFmsMNxmqYWp64rVJjsqLR5uVxHwdTvqPcgdidW1/exec'; // <-- Set this after deployment

function doPost(e) {
  try {
    const json = JSON.parse(e.postData.contents);
    const message = json.message;
    if (!message) return ContentService.createTextOutput("No message");

    const chatId = message.chat.id;
    const messageId = message.message_id;
    const text = message.text;

    Logger.log(`Received message: ${text} from chat ID: ${chatId}`);

    // Send response
    // sendTelegramMessage(chatId, `✅ Message received: "${text}" (ID: ${messageId})`);
    importTelegramChatLogs();
    processDigitalSignatureEvents();
    scoreTelegramChatLogsToAwardTDG();
    processVaultExpenses();
    parseQrCodes();
    processTokenizedTransactions();
    processNonAgl4Transactions();

    return ContentService.createTextOutput("Message processed");
  } catch (err) {
    Logger.log(`Webhook handler error: ${err.message}`);
    return ContentService.createTextOutput("Error");
  }
}

// Sends a message to a Telegram chat
function sendTelegramMessage(chatId, text) {
  const token = creds.TELEGRAM_API_TOKEN;
  if (!token) {
    Logger.log("TELEGRAM_API_TOKEN is missing");
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: text,
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const res = UrlFetchApp.fetch(url, options);
    Logger.log(`Telegram sendMessage status: ${res.getResponseCode()}`);
  } catch (err) {
    Logger.log(`sendTelegramMessage error: ${err.message}`);
  }
}

// ------------------------ Register Webhook Method ------------------------

function registerTelegramWebhook() {
  const token = creds.TELEGRAM_API_TOKEN;
  if (!token) {
    Logger.log("TELEGRAM_API_TOKEN is missing");
    return;
  }

  if (!WEBHOOK_URL) {
    Logger.log("Set WEBHOOK_URL before running registerTelegramWebhook");
    return;
  }

  const apiUrl = `https://api.telegram.org/bot${token}/setWebhook`;
  const payload = {
    url: WEBHOOK_URL
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(apiUrl, options);
    Logger.log(`Webhook set response: ${response.getContentText()}`);
  } catch (err) {
    Logger.log(`registerTelegramWebhook error: ${err.message}`);
  }
}

// ------------------------ Disable Webhook Method ------------------------

function disableTelegramWebhook() {
  const token = creds.TELEGRAM_API_TOKEN;
  if (!token) {
    Logger.log("TELEGRAM_API_TOKEN is missing");
    return;
  }

  const apiUrl = `https://api.telegram.org/bot${token}/deleteWebhook`;

  const options = {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(apiUrl, options);
    Logger.log(`Webhook delete response: ${response.getContentText()}`);
  } catch (err) {
    Logger.log(`disableTelegramWebhook error: ${err.message}`);
  }
}

// ------------------------ Micro-service calls ------------------------

// Script Location: https://script.google.com/home/projects/1Q5HfGR_AcSYmrKCy5bs-Jo8pdtV-vZJ6Zhv2VCY0HGo2haVoeWMjOCGC/edit
function importTelegramChatLogs() {
  const processingServiceUrl = 'https://script.google.com/macros/s/AKfycbw6Pgl5a1FqX58EWyCEIi1rG_NuI4P34R6SBtdsCP-0INjcSE8HH8apvTCZlCVrM1ft/exec?action=processTelegramLogs';
  try {
    const response = UrlFetchApp.fetch(processingServiceUrl);
    Logger.log("Log processor response: " + response.getContentText());
  } catch (err) {
    Logger.log("Error calling log processor: " + err.message);
  }
}

// AGL Parse imported Telegram Chat Logs for Agroverse QR code submissions
//     Script Location: https://script.google.com/home/projects/1dsWecVwbN0dOvilIz9r8DNt7LD3Ay13V8G9qliow4tZtF5LHsvQOFpF7/edit
function parseQrCodes() {
  const processingServiceUrl = 'https://script.google.com/macros/s/AKfycbzc15gptNmn8Pm726cfeXDnBxbxZ1L31MN6bkfBH7ziiz4gxl87vJXEhAAJJhZ5uAxq/exec?action=parseTelegramChatLogs';
  try {
    const response = UrlFetchApp.fetch(processingServiceUrl);
    Logger.log("Log processor response: " + response.getContentText());
  } catch (err) {
    Logger.log("Error calling log processor: " + err.message);
  }
}

// AGL - process sales transactions for our on our main ledger
//     Script Location: https://script.google.com/home/projects/1wmgYPwfRDxpiboa8OH-C6Ndovklf8HaJY305n7dhRzs7BmUBQg7fL_sZ/edit
function processTokenizedTransactions() {
  const processingServiceUrl = 'https://script.google.com/macros/s/AKfycbzc15gptNmn8Pm726cfeXDnBxbxZ1L31MN6bkfBH7ziiz4gxl87vJXEhAAJJhZ5uAxq/exec?action=processTokenizedTransactions';
  try {
    const response = UrlFetchApp.fetch(processingServiceUrl);
    Logger.log("Log processor response: " + response.getContentText());
  } catch (err) {
    Logger.log("Error calling log processor: " + err.message);
  }
}

// AGL - Update sales records entry to the various AGL ledgers
//     Script Location: https://script.google.com/home/projects/1duQFfTO0Pj0lC4tPVNmMOhNOS1GvJgzqVxXbsEDu-eqt_64DwxvrOVyl/edit
function processNonAgl4Transactions() {
  const processingServiceUrl = 'https://script.google.com/a/macros/agroverse.shop/s/AKfycbwh35n5hOLCTPFseDqfnbV93vCpdnCqdlQ2iHFZWw9YenJN0cPpc-EIoIDOnoqtdGUohg/exec?action=processNonAgl4Transactions';
  try {
    const response = UrlFetchApp.fetch(processingServiceUrl);
    Logger.log("Log processor response: " + response.getContentText());
  } catch (err) {
    Logger.log("Error calling log processor: " + err.message);
  }
}

// TDG - scores contribution submissions via Telegram and notifies
//       Script Location: https://script.google.com/home/projects/1BHAGZd_T1I5mQnqnAFqUJKX2x_N8Uv05n1O2OohRA908Ja8wVwVxaR7K/edit
function scoreTelegramChatLogsToAwardTDG() {
  const processingServiceUrl = 'https://script.google.com/a/macros/agroverse.shop/s/AKfycbwnCn80es4Jd1pS9oKghpIvJ9pPYSXLonsWztrfXP6YYVVHy8lymMDEk2iRYWlNmjRT/exec?action=processTelegramChatLogs';
  try {
    const response = UrlFetchApp.fetch(processingServiceUrl);
    Logger.log("Log processor response: " + response.getContentText());
  } catch (err) {
    Logger.log("Error calling log processor: " + err.message);
  }
}

// TDG - updates our Off Chain transactions to account for expenses reported by DAO members
//       https://script.google.com/home/projects/19Wag9x-sjbLVgIsPh2vj90ZG7Rgq2iGaVOomAeAvtg6CdZKJHLZ9AJrC/edit
function processVaultExpenses() {
  const processingServiceUrl = 'https://script.google.com/macros/s/AKfycbwYBlFigSSPJKkI-F2T3dSsdLnvvBi2SCGF1z2y1k95YzA5HBrJVyMo6InTA9Fud2bOEw/exec?action=parseAndProcessTelegramLogs';
  try {
    const response = UrlFetchApp.fetch(processingServiceUrl);
    Logger.log("Log processor response: " + response.getContentText());
  } catch (err) {
    Logger.log("Error calling log processor: " + err.message);
  }
}

// TDG - updates our registry with new digital signatures submitted by DAO members via Telegram
//       https://script.google.com/home/projects/10NKp8uLMGyfgDv0ByakHVGioOYzvDV7NbHMSBigB2TCVcY7aqYXhbywv/edit
function processDigitalSignatureEvents() {
  const processingServiceUrl = 'https://script.google.com/a/macros/agroverse.shop/s/AKfycbwlh2u-SktykzL6S_qamE2rQVd-G_3uSd3GhJ_8KI5b2e8oVuMYxXA5UfJ-NaigOk60/exec?action=processDigitalSignatureEvents';
  try {
    const response = UrlFetchApp.fetch(processingServiceUrl);
    Logger.log("Log processor response: " + response.getContentText());
  } catch (err) {
    Logger.log("Error calling log processor: " + err.message);
  }
}