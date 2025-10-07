/**
 * File: google_app_scripts/tdg_scoring/grok_scoring_for_telegram_and_whatsapp_logs.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * 
 * Description: AI-powered scoring of chat contributions from Telegram and WhatsApp using OpenAI/xAI APIs.
 */

// Deployment URL: https://script.google.com/macros/s/AKfycbwnCn80es4Jd1pS9oKghpIvJ9pPYSXLonsWztrfXP6YYVVHy8lymMDEk2iRYWlNmjRT/exec

// Flag to ignore chatlogs before this date (YYYYMMDD format)
// - Messages with dates earlier than this will be skipped during processing.
// - Format: "YYYYMMDD" (e.g., "20241213" means December 13, 2024).
// - Adjust this to filter out old data you don’t want to process.
const IGNORE_BEFORE_DATE = "20250316";

// List of DAO-specific event strings to skip during message processing
// - Messages containing these strings will be ignored to avoid errors in TDG scoring
// - Add or remove strings as needed to filter out specific event types
const SKIP_MESSAGE_STRINGS = [
  '[DIGITAL SIGNATURE EVENT]',
  '[VOTING RIGHTS WITHDRAWAL REQUEST]',
  '[QR CODE EVENT]',
  '[SALES EVENT]',
  '[DAO Inventory Expense Event]',
  '[INVENTORY MOVEMENT]',
  '[FARM REGISTRATION]',
  '[TREE PLANTING EVENT]',
  '[NOTARIZATION EVENT]'
];

// Load API keys and configuration settings from Credentials.gs
// - setApiKeys(): Stores sensitive API keys in Google Apps Script’s Script Properties for security.
// - getCredentials(): Retrieves all configuration details (API keys, URLs, IDs) as an object.
// - These steps ensure keys and settings are centralized and not hardcoded here.
setApiKeys();
const creds = getCredentials();

// API key for xAI’s API (e.g., for Grok model access)
// - Used to authenticate requests to xAI’s services.
// - Replace the default in Credentials.gs or Script Properties with your own key.
const XAI_API_KEY = creds.XAI_API_KEY;

// API key for OpenAI’s API (e.g., for GPT models)
// - Authenticates requests to OpenAI’s services.
// - Set your own key in Credentials.gs or Script Properties.
const OPENAI_API_KEY = creds.OPENAI_API_KEY;

// URL of the Google Sheet containing Telegram chat logs
// - Points to the spreadsheet with raw Telegram data to process.
// - Example: "https://docs.google.com/spreadsheets/d/[your-sheet-id]/edit".
// - Update this in Credentials.gs if your Telegram data is in a different sheet.
const TELEGRAM_SHEET_URL = creds.TELEGRAM_SHEET_URL;

// Telegram Bot API token for sending notifications
// - Used to authenticate requests to the Telegram Bot API for sending messages.
// - Example: "7095843169:AAFscsdjnj-AOCV1fhmUp5RN5SliLbQpZaU".
// - Set your own token in Credentials.gs or Script Properties to enable notifications.
// - Obtain this from BotFather on Telegram (https://t.me/BotFather).
const TELEGRAM_TOKEN = creds.TELEGRAM_TOKEN;

// Google Drive folder ID where WhatsApp chat log files (.txt) are stored
// - Identifies the folder containing WhatsApp text files to process.
// - Find this ID in the URL of your Google Drive folder (e.g., "1X8fGb-kzf5WIjrsd1uO8seXnHZZkiitk").
// - Change this in Credentials.gs to point to your WhatsApp folder.
const WHATSAPP_FOLDER_ID = creds.WHATSAPP_FOLDER_ID;

// URL of the Google Sheet where processed chat log data is output
// - Stores the final scored results (e.g., contributors, TDG scores).
// - Example: "https://docs.google.com/spreadsheets/d/[your-sheet-id]/edit".
// - Modify in Credentials.gs if you want output in a different sheet.
const OUTPUT_SHEET_URL = creds.OUTPUT_SHEET_URL;

// URL of the Google Sheet with existing contributor data
// - Contains historical data (e.g., ledger history, contributor info) to check for duplicates.
// - Update in Credentials.gs if your existing data is stored elsewhere.
const EXISTING_SHEET_URL = creds.EXISTING_SHEET_URL;

// URL of the Google Sheet tracking WhatsApp file processing status
// - Logs the status of each WhatsApp file (e.g., "processed", "processing", "error").
// - Includes details like last processed line and total lines.
// - Adjust in Credentials.gs if you use a different sheet for status tracking.
const FILE_LOG_SHEET_URL = creds.FILE_LOG_SHEET_URL;

// Endpoint URL for xAI’s API service
// - The web address where xAI API requests are sent (e.g., for scoring contributions).
// - Default: "https://api.x.ai/v1/chat/completions". Change only if xAI updates their API endpoint.
const XAI_API_URL = creds.XAI_API_URL;

// Endpoint URL for OpenAI’s API service
// - The web address for OpenAI API requests (e.g.for equinox/solstice calculations).
// - Default: "https://api.openai.com/v1/chat/completions". Update if OpenAI changes their endpoint.
const OPENAI_API_URL = creds.OPENAI_API_URL;

// Google Drive folder ID for storing intermediate parsed data sheets
// - Holds temporary Google Sheets (e.g., "[fileName] Parsed Records") during WhatsApp processing.
// - Find this ID in your Google Drive folder URL (e.g., "1UxxDWh5yOeLIUDyTcCgAiMZztp5_8PLU").
// - Change in Credentials.gs if you want intermediate files in a different folder.
const INTERMEDIATE_FOLDER_ID = creds.INTERMEDIATE_FOLDER_ID;

function processChatLogEntry({ message, username, statusDate, platform, projectName, rowIndex = null, telegramSheet = null }) {
  const logPrefix = platform === "Telegram" ? `Telegram Chat Logs${rowIndex !== null ? ` (Row ${rowIndex + 1})` : ''}` : `WhatsApp Chat Log (${projectName})`;
  Logger.log(`processChatLogEntry: Processing ${logPrefix}: ${message}`);

  if (!message) {
    Logger.log(`processChatLogEntry: Skipping invalid record: ${statusDate} - ${username} - ${message} (Reason: Missing contribution message)`);
    return { records: [], count: 0 };
  }

  if (shouldSkipMessage(message)) {
    Logger.log(`processChatLogEntry: Skipping DAO-specific event: ${statusDate} - ${username} - ${message}`);
    return { records: [], count: 0 };
  }

  const dateNum = statusDate * 1;
  if (isNaN(dateNum) || !/^\d{8}$/.test(statusDate)) {
    Logger.log(`processChatLogEntry: Skipping invalid record: ${statusDate} - ${username} - ${message} (Reason: Invalid date format)`);
    return { records: [], count: 0 };
  }
  if (dateNum < IGNORE_BEFORE_DATE * 1) {
    Logger.log(`processChatLogEntry: Skipping old record: ${statusDate} - ${username} - ${message} (Reason: Date ${statusDate} is before ${IGNORE_BEFORE_DATE})`);
    return { records: [], count: 0 };
  }

  const messageKey = `${username}|${message}`;
  if (isExistingRecord(messageKey)) {
    Logger.log(`processChatLogEntry: Skipping duplicate message: ${message} by ${username} (No hash generated)`);
    return { records: [], count: 0 };
  }

  const usernameWithoutAt = username.startsWith('@') ? username.slice(1) : username;
  const actualName = platform === "Telegram" ? (getTelegramActualName(usernameWithoutAt).actualName || username) : username;
  const messageHash = generateUniqueHash(username, message, statusDate);
  Logger.log(`processChatLogEntry: Initial hash check: ${messageHash} for ${username} - ${message} - ${statusDate}`);

  if (isOutputRecord(messageHash)) {
    Logger.log(`processChatLogEntry: Skipping duplicate message: ${message} by ${username} (Hash: ${messageHash})`);
    if (platform === "Telegram" && telegramSheet && rowIndex !== null) {
      telegramSheet.getRange(rowIndex + 1, 14).setValue(messageHash); // Column N (1-based index 14)
      Logger.log(`processChatLogEntry: Inserted hash ${messageHash} into Telegram sheet at row ${rowIndex + 1}`);
    }
    return { records: [], count: 0 };
  }

  const scoringResult = checkTdgIssued(message, actualName, platform);
  Logger.log(`processChatLogEntry: Scoring result for ${message} by ${actualName}: ${scoringResult.classification}; ${scoringResult.tdgIssued}`);
  
  // Check for [CONTRIBUTION EVENT] and extract file details
  const contributionDetails = platform === "Telegram" ? extractContributionDetails(message) : null;
  let fileIds = [];

  Logger.log("contributionDetails: ");
  Logger.log(contributionDetails);

  // Use explicit contributors from contributionDetails if available, otherwise fall back to getContributorsFromMessage
  let contributors = [];
  if (platform === "Telegram" && contributionDetails && contributionDetails.contributors) {
    contributors = contributionDetails.contributors.split(',').map(c => c.trim()).filter(c => c);
    Logger.log(`processChatLogEntry: Using explicit contributors from contributionDetails: ${contributors.join(', ') || 'none'}`);
  } else {
    contributors = getContributorsFromMessage(message, username, platform).split(';').filter(c => c);
    Logger.log(`processChatLogEntry: Contributors identified via getContributorsFromMessage: ${contributors.join(', ') || 'none'}`);
  }

  if (platform === "Telegram" && contributionDetails && contributionDetails.attachedFilename && contributionDetails.destinationFileLocation && telegramSheet && rowIndex !== null) {
    Logger.log("file processing check condition passed");
    // Retrieve file IDs from Column O (1-based index 15)
    const fileIdsString = telegramSheet.getRange(rowIndex, 15).getValue().toString().trim();

    fileIds = fileIdsString ? fileIdsString.split(',').map(id => id.trim()).filter(id => id) : [];
    Logger.log(`processChatLogEntry: Found ${fileIds.length} file IDs for row ${rowIndex - 1}: ${fileIds.join(', ')}`);
  }

  const newRecords = [];
  if (scoringResult.classification !== "Unknown" && scoringResult.classification !== "Unexpected response format" && scoringResult.classification !== "Grok API error") {
    contributors.forEach(contributor => {
      if (contributor) {
        // Translate contributor handle to actual name if available
        const contributorWithoutAt = contributor.startsWith('@') ? contributor.slice(1) : contributor;
        const contributorActualName = platform === "Telegram" ? (getTelegramActualName(contributorWithoutAt).actualName || contributor) : contributor;
        
        const foundInContributors = isContributorFound(contributor, platform);

        let tdgPerContributor = 0.00; // Default value to prevent undefined error

        if (platform === "Telegram" && contributionDetails && contributionDetails.tdgIssued) {
          Logger.log("Using explicit TDG amount specified");
          tdgPerContributor = parseFloat(contributionDetails.tdgIssued) || 0.00; // Fallback to 0 if parsing fails
        } else if (scoringResult && scoringResult.tdgIssued && !isNaN(parseFloat(scoringResult.tdgIssued))) {
          Logger.log("Using TDG amount suggested by Grok");
          tdgPerContributor = parseFloat(scoringResult.tdgIssued).toFixed(2);
        } else {
          Logger.log("No valid TDG amount available, defaulting to 0.00");
        }

        newRecords.push({
          contributor: contributorActualName, // Actual name for output sheet
          telegramHandle: contributor,       // Original handle for notifications
          project: projectName,
          contribution: message,
          rubric: scoringResult.classification,
          tdgProvisioned: tdgPerContributor,
          status: "Pending Review",
          tdgIssued: "0.00",
          statusDate: statusDate,
          foundInContributors: foundInContributors,
          reportedBy: actualName,
          uniqueHash: messageHash
        });
      }
    });

    // Process file uploads for [CONTRIBUTION EVENT] messages
    Logger.log("Processing file ids");
    if (fileIds.length > 0 && contributionDetails && contributionDetails.attachedFilename && contributionDetails.destinationFileLocation) {
      const processedFileIds = [];
      fileIds.forEach((fileId, index) => {
        Logger.log("Processing file id " + fileId);
        if (!processedFileIds.includes(fileId)) {
          let destinationUrl = index === 0 ? contributionDetails.destinationFileLocation : generateUniqueGitHubFilename(contributionDetails.destinationFileLocation, index);
          // Override with default GitHub location if not provided
          if (!destinationUrl || destinationUrl === "No file attached") {
            const filename = contributionDetails.attachedFilename || `file_${fileId}.bin`;
            destinationUrl = `https://github.com/TrueSightDAO/.github/tree/main/assets/${filename}`;
          }
          if (!checkFileExistsInGitHub(destinationUrl)) {
            const uploaded = uploadFileToGitHub(fileId, destinationUrl, message);
            if (uploaded) {
              Logger.log(`processChatLogEntry: Successfully uploaded file ${fileId} for contribution event to ${destinationUrl}`);
            } else {
              Logger.log(`processChatLogEntry: Failed to upload file ${fileId} for contribution event to ${destinationUrl}`);
            }
          } else {
            Logger.log(`processChatLogEntry: File already exists at ${destinationUrl}, skipping upload`);
          }
          processedFileIds.push(fileId);
        }
      });
    }
  }

  return { records: newRecords, count: newRecords.length };
}

function doGet(e) {
  const action = e.parameter?.action;
  if (action === 'processTelegramChatLogs') {
    try {
      Logger.log("Webhook triggered: processing Telegram logs");
      processTelegramChatLogs();
      return ContentService.createTextOutput("✅ Telegram logs processed");
    } catch (err) {
      Logger.log("Error in processTelegramLogs: " + err.message);
      return ContentService.createTextOutput("❌ Error: " + err.message);
    }
  }

  return ContentService.createTextOutput("ℹ️ No valid action specified");
}

// Modified to send notification once per chatId
function processTelegramChatLogs() {
  if (!XAI_API_KEY) {
    Logger.log(`processTelegramChatLogs: Error: Please set XAI_API_KEY in Script Properties.`);
    return;
  }

  const telegramSpreadsheet = SpreadsheetApp.openByUrl(TELEGRAM_SHEET_URL);
  const telegramSheet = telegramSpreadsheet.getSheetByName("Telegram Chat Logs");

  if (!telegramSheet) {
    Logger.log(`processTelegramChatLogs: Error: Sheet "Telegram Chat Logs" not found in ${TELEGRAM_SHEET_URL}`);
    return;
  }

  const data = telegramSheet.getDataRange().getValues();
  let totalMessages = 0;
  const chatPackets = {}; // Tracks chatId -> contributor Telegram handles

  Logger.log(`processTelegramChatLogs: Processing Telegram Chat Logs: Found ${data.length - 1} records`);

  for (let i = 1; i < data.length; i++) {
    Logger.log("\n\n\n");
    const row = data[i];
    const dateStr = row[11] ? row[11].toString().trim() : "";
    const username = row[4] ? row[4].toString() : "Unknown";
    const message = row[6] ? row[6].toString().trim() : "";
    const existingHash = row[13] ? row[13].toString().trim() : "";
    Logger.log(`processTelegramChatLogs: row ${i + 1}: Hash ${existingHash}`);

    if (existingHash) {
      Logger.log(`processTelegramChatLogs: Skipping already processed row ${i + 1}: Hash ${existingHash} found in Telegram Chat Logs`);
      continue;
    }

    const { records, count } = processChatLogEntry({
      message,
      username,
      statusDate: dateStr,
      platform: "Telegram",
      projectName: "telegram_chatlog",
      rowIndex: i,
      telegramSheet: telegramSheet
    });

    if (records.length > 0) {
      writeToGoogleSheet(records, "Telegram");
      totalMessages += count;
      Logger.log(`processTelegramChatLogs: Updated row ${i + 1} Column N with hash after processing`);
      const messageHash = generateUniqueHash(username, message, dateStr);
      telegramSheet.getRange(i + 1, 14).setValue(messageHash);

      // Collect Telegram handles for notification
      const chatId = getChatIdForRow(row, telegramSheet, i);
      if (chatId) {
        if (!chatPackets[chatId]) {
          chatPackets[chatId] = new Set();
        }
        records.forEach(record => {
          const telegramHandleWithoutAt = record.telegramHandle.startsWith('@') ? record.telegramHandle.slice(1) : record.telegramHandle;
          chatPackets[chatId].add(telegramHandleWithoutAt);
        });
      }
    } else {
      Logger.log(`processTelegramChatLogs: Updated row ${i + 1} Column N with hash even though no contributors were found`);
      telegramSheet.getRange(i + 1, 14).setValue(generateUniqueHash(username, message, dateStr));
    }
  }

  // Send notifications for each chatId
  Logger.log(`processTelegramChatLogs: Chat packets to notify: ${JSON.stringify(chatPackets)}`);
  Object.keys(chatPackets).forEach(chatId => {
    const contributorUsernames = Array.from(chatPackets[chatId]);
    sendTelegramNotification(chatId, contributorUsernames);
  });

  Logger.log(`processTelegramChatLogs: Processed ${totalMessages} new messages from Telegram Chat Logs`);
}

function processWhatsappChatlogs() {
  if (!XAI_API_KEY) {
    Logger.log(`processWhatsappChatlogs: Error: Please set XAI_API_KEY in Script Properties.`);
    return;
  }

  const folder = DriveApp.getFolderById(WHATSAPP_FOLDER_ID);
  const files = folder.getFilesByType(MimeType.PLAIN_TEXT);
  const chatlogFiles = [];
  while (files.hasNext()) {
    chatlogFiles.push(files.next());
  }
  Logger.log(`processWhatsappChatlogs: Found ${chatlogFiles.length} chatlog files: ${chatlogFiles.map(f => f.getName())}`);

  chatlogFiles.forEach(file => {
    const fileUrl = file.getUrl();
    const fileName = file.getName();
    if (isChatlogProcessed(fileName)) {
      Logger.log(`processWhatsappChatlogs: Skipping ${fileName}: Already marked as processed`);
      return; // Explicitly skip if already processed
    }
    processSingleWhatsappChatlog(fileUrl);
  });

  Logger.log(`processWhatsappChatlogs: Completed processing ${chatlogFiles.length} chatlog files`);
}

function processSingleWhatsappChatlog(fileUrl) {
  if (!XAI_API_KEY) {
    Logger.log(`processSingleWhatsappChatlog: Error: Please set XAI_API_KEY in Script Properties.`);
    return;
  }

  const fileIdMatch = fileUrl.match(/[-\w]{25,}/);
  if (!fileIdMatch) {
    Logger.log(`processSingleWhatsappChatlog: Invalid file URL: ${fileUrl}`);
    return;
  }
  const fileId = fileIdMatch[0];
  const file = DriveApp.getFileById(fileId);
  const fileName = file.getName();
  const projectName = fileName.replace('.txt', '');
  const content = file.getBlob().getDataAsString();
  const totalLines = content.split('\n').length;
  Logger.log(`processSingleWhatsappChatlog: Starting ${fileName}: Total lines in file = ${totalLines}`);

  if (isChatlogProcessed(fileName)) {
    Logger.log(`processSingleWhatsappChatlog: Skipping ${fileName}: Already marked as processed`);
    return; // Explicitly skip if already processed
  }

  const lastProcessedLine = getLastProcessedLine(fileName);
  const startLine = lastProcessedLine ? parseInt(lastProcessedLine, 10) + 1 : 0;
  Logger.log(`processSingleWhatsappChatlog: Retrieved last processed line from Column E: ${lastProcessedLine || 'none'}, setting startLine = ${startLine}`);

  // Log initial status
  logFileStatus(fileName, fileUrl, "processing", lastProcessedLine || "", totalLines);
  Logger.log(`processSingleWhatsappChatlog: Logged initial status for ${fileName} as 'processing' with last processed line ${lastProcessedLine || 'none'} and total lines ${totalLines}`);

  // Create or get intermediate sheet
  const intermediateSheet = createOrGetIntermediateSheet(fileName);
  if (!intermediateSheet) {
    Logger.log(`processSingleWhatsappChatlog: Failed to create or retrieve intermediate sheet for ${fileName}`);
    logFileStatus(fileName, fileUrl, "error", lastProcessedLine || "", totalLines);
    return;
  }

  // Populate intermediate sheet with parsed records
  const messagesLF = parseWhatsappChatlog(content, startLine);
  Logger.log(`processSingleWhatsappChatlog: Parsed ${messagesLF.length} messages from line ${startLine + 1} to ${startLine + messagesLF.length} out of ${totalLines} total lines`);
  
  if (messagesLF.length > 0) {
    populateIntermediateSheet(intermediateSheet, messagesLF, fileName, projectName);
  } else {
    Logger.log(`processSingleWhatsappChatlog: No new messages to process in ${fileName} from line ${startLine + 1} out of ${totalLines} total lines`);
    logFileStatus(fileName, fileUrl, "processed", startLine - 1, totalLines);
    return;
  }

  // Process records from intermediate sheet
  processIntermediateSheet(intermediateSheet, fileName, fileUrl, projectName, totalLines, startLine);
}

function createOrGetIntermediateSheet(fileName) {
  const folder = DriveApp.getFolderById(INTERMEDIATE_FOLDER_ID);
  const sheetName = `${fileName} Parsed Records`;
  const files = folder.getFilesByName(sheetName);

  let spreadsheet;
  if (files.hasNext()) {
    spreadsheet = SpreadsheetApp.open(files.next());
    Logger.log(`createOrGetIntermediateSheet: Found existing sheet ${sheetName}`);
  } else {
    spreadsheet = SpreadsheetApp.create(sheetName);
    const file = DriveApp.getFileById(spreadsheet.getId());
    file.moveTo(folder);
    Logger.log(`createOrGetIntermediateSheet: Created new sheet ${sheetName} in folder ${INTERMEDIATE_FOLDER_ID}`);
  }

  const sheet = spreadsheet.getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Date", "Username", "Message", "IsSystemMessage", "Hash"]);
    Logger.log(`createOrGetIntermediateSheet: Added headers to ${sheetName}`);
  }
  return sheet;
}

function populateIntermediateSheet(sheet, messagesLF, fileName, projectName) {
  const existingData = sheet.getDataRange().getValues();
  const existingMessages = new Set(existingData.slice(1).map(row => `${row[0]}|${row[1]}|${row[2]}`));

  const newRecords = messagesLF
    .filter(msg => !existingMessages.has(`${msg.date.toISOString()}|${msg.username}|${msg.message}`))
    .map(msg => [
      msg.date.toISOString(),
      msg.username,
      msg.message,
      msg.isSystemMessage,
      "" // Hash column, initially empty
    ]);

  if (newRecords.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRecords.length, 5).setValues(newRecords);
    Logger.log(`populateIntermediateSheet: Added ${newRecords.length} new records to ${fileName} Parsed Records`);
  } else {
    Logger.log(`populateIntermediateSheet: No new records to add to ${fileName} Parsed Records`);
  }
}

function processIntermediateSheet(sheet, fileName, fileUrl, projectName, totalLines, startLine) {
  const data = sheet.getDataRange().getValues();
  let totalMessages = 0;
  let newLastProcessedLine = startLine - 1;

  try {
    for (let i = 1; i < data.length; i++) { // Skip header
      const [dateStr, username, message, isSystemMessageStr, hash] = data[i];
      
      // Generate hash for every row, even if already present, to ensure consistency
      const date = new Date(dateStr);
      const statusDate = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
      const messageHash = generateUniqueHash(username, message, statusDate);

      if (hash) {
        Logger.log(`processIntermediateSheet: Skipping row ${i + 1} in ${fileName} Parsed Records: Already processed (hash: ${hash})`);
        newLastProcessedLine = i - 1 + startLine; // Update based on row index
        sheet.getRange(i + 1, 5).setValue(messageHash); // Ensure hash is set, even if already present
        continue;
      }

      const isSystemMessage = isSystemMessageStr === "true" || isSystemMessageStr === true;
      newLastProcessedLine = i - 1 + startLine; // Zero-based index relative to startLine

      if (!isSystemMessage) {
        Logger.log(`processIntermediateSheet: Processing row ${i + 1} in ${fileName}: Date ${statusDate}, User ${username}`);

        const { records, count } = processChatLogEntry({
          message,
          username,
          statusDate,
          platform: "WhatsApp",
          projectName
        });

        if (records.length > 0) {
          writeToGoogleSheet(records, "WhatsApp");
          totalMessages += count;
          Logger.log(`processIntermediateSheet: Row ${i + 1}: Added ${count} records (total: ${totalMessages}), hash ${messageHash} inserted`);
        } else {
          Logger.log(`processIntermediateSheet: Row ${i + 1}: No new records added, hash ${messageHash} inserted`);
        }
      } else {
        Logger.log(`processIntermediateSheet: Row ${i + 1}: Skipped system message, hash ${messageHash} inserted`);
      }

      // Always set the hash in Column E of the intermediate sheet for every row processed
      sheet.getRange(i + 1, 5).setValue(messageHash);

      // Update "WhatsApp Chatlog status" Column E (Last Processed Line) at the final iteration
      if (i === data.length - 1) {
        logFileStatus(fileName, fileUrl, "processing", newLastProcessedLine, totalLines);
        Logger.log(`processIntermediateSheet: Final row ${i + 1}: Updated WhatsApp Chatlog status Column E with last processed line = ${newLastProcessedLine} before loop ends`);
      } else if ((i - 1) % 10 === 0) {
        // Regular checkpoint updates every 10 rows, excluding the final iteration
        logFileStatus(fileName, fileUrl, "processing", newLastProcessedLine, totalLines);
        Logger.log(`processIntermediateSheet: Checkpoint at row ${i + 1}: Updated status to 'processing', last processed line = ${newLastProcessedLine}`);
      }
    }

    Logger.log(`processIntermediateSheet: Finished ${fileName}: Processed ${totalMessages} messages, final line = ${newLastProcessedLine}`);
    logFileStatus(fileName, fileUrl, "processed", newLastProcessedLine, totalLines);
    Logger.log(`processIntermediateSheet: Logged final status as 'processed' with last line ${newLastProcessedLine} and total lines ${totalLines}`);

  } catch (e) {
    Logger.log(`processIntermediateSheet: Error at row ${newLastProcessedLine - startLine + 2} in ${fileName}: ${e.message}`);
    logFileStatus(fileName, fileUrl, "error", newLastProcessedLine, totalLines);
    Logger.log(`processIntermediateSheet: Logged error status with last processed line ${newLastProcessedLine} and total lines ${totalLines}`);
  }
}

function getLastProcessedLine(fileName) {
  const spreadsheet = SpreadsheetApp.openByUrl(FILE_LOG_SHEET_URL);
  const sheet = spreadsheet.getSheetByName("WhatsApp Chatlog status") || spreadsheet.getSheets()[2];

  if (!sheet) {
    Logger.log(`getLastProcessedLine: Error: Sheet 'WhatsApp Chatlog status' not found in ${FILE_LOG_SHEET_URL}. Starting from top.`);
    return null;
  }

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const loggedFileName = data[i][0];
    const lastProcessedLine = data[i][4];
    if (loggedFileName === fileName && lastProcessedLine !== "") {
      Logger.log(`getLastProcessedLine: Found ${fileName} with last processed line ${lastProcessedLine}`);
      return lastProcessedLine.toString();
    }
  }
  Logger.log(`getLastProcessedLine: No last processed line found for ${fileName}`);
  return null;
}

function checkTdgIssued(message, sender, platform) {
  const payload = `We issue 100TDG for every 1 hour of contribution and 1TDG for every 1 USD of contribution. Based on the ${platform} message from ${sender}: "${message}", determine the classification and TDG tokens to award. Options are: '100TDG For every 1 hour of human effort', '1TDG For every 1 USD of liquidity injected', or 'Unknown'. Return ONLY this format: "classification; TDGs Issued" (e.g., "100TDG For every 1 hour of human effort; 25.00"). TDG must be proportional to time (e.g., 15 minutes = 25.00 TDG, calculated as 100 * 15/60) or match USD spent (e.g., $607 = 607.00 TDG). No extra text, explanations, or labels. Example: for "I spent $607 for flight tickets," return "1TDG For every 1 USD of liquidity injected; 607.00".`;

  const headers = {
    "Authorization": `Bearer ${XAI_API_KEY}`,
    "Content-Type": "application/json",
    "muteHttpExceptions": true
  };

  const requestData = {
    "model": "grok-2-latest",
    "messages": [{ "role": "user", "content": payload }],
    "stream": false,
    "temperature": 0
  };

  const options = {
    "method": "post",
    "headers": headers,
    "payload": JSON.stringify(requestData)
  };

  const response = UrlFetchApp.fetch(XAI_API_URL, options);
  const status = response.getResponseCode();
  const result = response.getContentText();

  if (status === 200) {
    const json = JSON.parse(result);
    const content = json.choices[0].message.content.trim();
    const parts = content.split(';');
    if (parts.length === 2) {
      const [classification, tdgIssued] = parts.map(part => part.trim().replace(/\n/g, ''));
      Logger.log(`checkTdgIssued: Successful response: ${classification}; ${tdgIssued}`);
      return { classification, tdgIssued: parseFloat(tdgIssued).toFixed(2) };
    }
    Logger.log(`checkTdgIssued: Unexpected response format: ${content}`);
    return { classification: "Unexpected response format", tdgIssued: "0.00" };
  } else {
    Logger.log(`checkTdgIssued: Grok API error: ${status} - ${result}`);
    return { classification: "Grok API error", tdgIssued: "0.00" };
  }
}

function getContributorsFromMessage(message, reporter, platform) {
  const payload = `From the following ${platform} message by ${reporter}: "${message}", identify all individuals explicitly mentioned as contributors. Treat the reporter (${reporter}) as a Telegram handle and include it as a contributor only if the message explicitly states they performed an action contributing to the work (e.g., "I worked", "I spent time", "I created", "I spent $607"), using the exact handle "${reporter}" as provided. Exclude the reporter if the message only indicates reporting on behalf of others (e.g., "Reporting on behalf of John") without their own contribution. Extract Telegram handles (with or without @, e.g., "@user123" or "user123") or single-word names (e.g., "June") from phrases like "I worked with June and @kirsten" or "Me and @557391090002 spent 12 minutes". Exclude full names with spaces (e.g., "Gary Teh" unless it’s a valid handle), generic terms like "team", "group", and URLs. Return ONLY a semicolon-separated list of handles or single-word names (e.g., "${reporter};June;@557391090002") or an empty string ('') if no valid contributors are found. Do not include any explanatory text, backticks, or additional formatting.`;

  const headers = {
    "Authorization": `Bearer ${XAI_API_KEY}`,
    "Content-Type": "application/json",
    "muteHttpExceptions": true
  };

  const requestData = {
    "model": "grok-2-latest",
    "messages": [{ "role": "user", "content": payload }],
    "stream": false,
    "temperature": 0
  };

  const options = {
    "method": "post",
    "headers": headers,
    "payload": JSON.stringify(requestData)
  };

  const response = UrlFetchApp.fetch(XAI_API_URL, options);
  const status = response.getResponseCode();
  const result = response.getContentText();

  if (status === 200) {
    const json = JSON.parse(result);
    const content = json.choices[0].message.content.trim();
    const validPattern = platform === "Telegram" 
      ? /^([@a-zA-Z0-9]+|[a-zA-Z0-9]+)(;([@a-zA-Z0-9]+|[a-zA-Z0-9]+))*$/ 
      : /^([@0-9a-zA-Z]+|[a-zA-Z0-9]+)(;([@0-9a-zA-Z]+|[a-zA-Z0-9]+))*$/;
    
    if (content === '' || content.match(validPattern)) {
      Logger.log(`getContributorsFromMessage: Successful response: ${content}`);
      return content;
    } else {
      Logger.log(`getContributorsFromMessage: Unexpected contributor response format: ${content}`);
      const parts = content.split(';').map(part => part.trim());
      const salvaged = parts.filter(part => part.match(/^[@a-zA-Z0-9]+$|^[a-zA-Z0-9]+$/)).join(';');
      if (salvaged) {
        Logger.log(`getContributorsFromMessage: Salvaged valid contributors: ${salvaged}`);
        return salvaged;
      }
      return '';
    }
  } else {
    Logger.log(`getContributorsFromMessage: Grok API error for contributors: ${status} - ${result}`);
    return '';
  }
}

function generateUniqueHash(contributor, contribution, statusDate) {
  const cleanContributor = contributor ? contributor.toString().replace(/\s/g, '') : '';
  const cleanContribution = contribution ? contribution.toString().replace(/\s/g, '') : '';
  const cleanStatusDate = statusDate ? statusDate.toString().replace(/\s/g, '') : '';
  const concatString = `${cleanContributor}${cleanContribution}${cleanStatusDate}`;
  const hashBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, concatString);
  const hash = Utilities.base64Encode(hashBytes).substring(0, 20);
  Logger.log(`generateUniqueHash: Generated hash ${hash} for ${contributor} - ${contribution} - ${statusDate}`);
  return hash;
}

function isExistingRecord(key) {
  const spreadsheet = SpreadsheetApp.openByUrl(EXISTING_SHEET_URL);
  const sheet = spreadsheet.getSheetByName("Ledger history");
  if (!sheet) {
    Logger.log(`isExistingRecord: Error: Sheet "Ledger history" not found in ${EXISTING_SHEET_URL}. Assuming no match.`);
    return false;
  }
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    const contributor = data[i][0] ? data[i][0].toString() : "";
    const contribution = data[i][2] ? data[i][2].toString() : "";
    if (contributor && contribution && `${contributor}|${contribution}` === key) {
      Logger.log(`isExistingRecord: Found existing record for key ${key}`);
      return true;
    }
  }
  Logger.log(`isExistingRecord: No existing record found for key ${key}`);
  return false;
}

function isOutputRecord(uniqueHash) {
  const spreadsheet = SpreadsheetApp.openByUrl(OUTPUT_SHEET_URL);
  const sheet = spreadsheet.getSheetByName("Scored Chatlogs");
  if (!sheet) {
    Logger.log(`isOutputRecord: Error: Sheet "Scored Chatlogs" not found in ${OUTPUT_SHEET_URL}. Assuming no match.`);
    return false;
  }
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    Logger.log(`isOutputRecord: No data in Scored Chatlogs sheet for hash ${uniqueHash}`);
    return false;
  }

  const hashColumn = sheet.getRange(2, 11, lastRow - 1, 1).getValues();
  const exists = hashColumn.some(row => row[0] === uniqueHash);
  Logger.log(`isOutputRecord: Hash ${uniqueHash} ${exists ? 'found' : 'not found'} in Scored Chatlogs`);
  return exists;
}

function writeToGoogleSheet(records, platform) {
  const spreadsheet = SpreadsheetApp.openByUrl(OUTPUT_SHEET_URL);
  const sheet = spreadsheet.getSheetByName("Scored Chatlogs");
  if (!sheet) {
    Logger.log(`writeToGoogleSheet: Error: Sheet "Scored Chatlogs" not found in ${OUTPUT_SHEET_URL}`);
    return;
  }
  
  const headers = platform === "Telegram" 
    ? ["Contributor Name", "Project Name", "Contribution Made", "Rubric classification", 
       "TDGs Provisioned", "Status", "TDGs Issued", "Status date", "Found in Contributors", 
       "Reported By", "Unique Hash"]
    : ["Contributor Name", "Project Name", "Contribution Made", "Rubric classification", 
       "TDGs Provisioned", "Status", "TDGs Issued", "Status date", "Existing Contributor", 
       "Reported By", "Unique Hash"];
  
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    Logger.log(`writeToGoogleSheet: Added headers to Scored Chatlogs sheet`);
  }
  
  const data = records.map(record => [
    record.contributor,
    record.project,
    record.contribution,
    record.rubric,
    record.tdgProvisioned, // Now contains the numerical TDG score
    record.status,
    record.tdgIssued, // Always "0.00"
    record.statusDate,
    record.foundInContributors,
    record.reportedBy,
    record.uniqueHash
  ]);
  
  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, data.length, headers.length).setValues(data);
  Logger.log(`writeToGoogleSheet: Wrote ${data.length} new rows to Google Sheet: ${OUTPUT_SHEET_URL} for ${platform}`);
}

function getTelegramActualName(usernameWithoutAt) {
  const spreadsheet = SpreadsheetApp.openByUrl(EXISTING_SHEET_URL);
  const sheet = spreadsheet.getSheetByName("Contributors contact information");
  if (!sheet) {
    Logger.log(`getTelegramActualName: Error: Sheet "Contributors contact information" not found in ${EXISTING_SHEET_URL}. Returning null.`);
    return { actualName: null, found: false };
  }
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const telegramHandle = data[i][7] ? data[i][7].toString() : "";
    const actualName = data[i][0] ? data[i][0].toString() : "";
    if (telegramHandle === `@${usernameWithoutAt}` && actualName) {
      Logger.log(`getTelegramActualName: Found actual name: ${actualName} for Telegram handle: ${telegramHandle}`);
      return { actualName: actualName, found: true };
    }
  }
  Logger.log(`getTelegramActualName: No actual name found for Telegram handle: @${usernameWithoutAt}`);
  return { actualName: null, found: false };
}

function parseWhatsappChatlog(content, startLine = 0) {
  const lines = content.split('\n');
  const messagesLF = [];
  const regex = /^\[(\d{1,2}\/\d{1,2}\/\d{2}), (\d{1,2}:\d{2}:\d{2}\u202f[AP]M)\] (.*?): (.+)$/;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const match = line.match(regex);
    if (match) {
      const [, datePart, timePart, sender, message] = match;

      let username = sender;
      let isSystemMessage = false;
      if (sender.startsWith('<ops>')) {
        isSystemMessage = true;
        username = sender.replace('<ops> ', '').split(':')[0] || 'System';
      }

      const [month, day, year] = datePart.split('/').map(Number);
      const fullYear = 2000 + year;
      const dateStr = `${fullYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${timePart.replace('\u202f', ' ')}`;
      const date = new Date(dateStr);
      const dateYYYYMMDD = `${fullYear}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;

      if (!isNaN(date.getTime()) && dateYYYYMMDD >= IGNORE_BEFORE_DATE) {
        messagesLF.push({ date, username, message: message.trim(), isSystemMessage });
        Logger.log(`parseWhatsappChatlog: Parsed valid message at line ${i + 1}: ${dateYYYYMMDD} - ${username} - ${message}`);
      } else if (isNaN(date.getTime())) {
        Logger.log(`parseWhatsappChatlog: Invalid date parsed from: ${dateStr} at line ${i + 1}`);
      } else {
        Logger.log(`parseWhatsappChatlog: Skipping message before ${IGNORE_BEFORE_DATE}: ${dateYYYYMMDD} - ${message} at line ${i + 1}`);
      }
    }
  }

  return messagesLF;
}

function isChatlogProcessed(fileName) {
  const spreadsheet = SpreadsheetApp.openByUrl(FILE_LOG_SHEET_URL);
  const sheet = spreadsheet.getSheetByName("WhatsApp Chatlog status") || spreadsheet.getSheets()[2];

  if (!sheet) {
    Logger.log(`isChatlogProcessed: Error: Sheet 'WhatsApp Chatlog status' not found in ${FILE_LOG_SHEET_URL}. Assuming not processed.`);
    return false;
  }

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const loggedFileName = data[i][0];
    const status = data[i][2];
    const lastProcessedLine = parseInt(data[i][4], 10);
    const totalLines = parseInt(data[i][5], 10);
    if (loggedFileName === fileName && status === "processed") {
      Logger.log(`isChatlogProcessed: ${fileName} already fully processed`);
      return true;
    }
  }
  Logger.log(`isChatlogProcessed: ${fileName} not yet fully processed`);
  return false;
}

function logFileStatus(fileName, fileUrl, status, lastProcessedLine = "", totalLinesToProcess = "") {
  const spreadsheet = SpreadsheetApp.openByUrl(FILE_LOG_SHEET_URL);
  const sheet = spreadsheet.getSheetByName("WhatsApp Chatlog status") || spreadsheet.getSheets()[2];

  if (!sheet) {
    Logger.log(`logFileStatus: Error: Sheet 'WhatsApp Chatlog status' not found in ${FILE_LOG_SHEET_URL}`);
    return;
  }

  const headers = ["Name of chat log", "URL location of the chat log file", "Status", "Date processed", "Last Processed Line", "Total Lines to Process"];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    Logger.log(`logFileStatus: Added headers to WhatsApp Chatlog status sheet`);
  }

  const dateProcessed = (status === "processing" || status === "error") ? "" : `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}`;
  const data = [[fileName, fileUrl, status, dateProcessed, lastProcessedLine, totalLinesToProcess]];

  const existingData = sheet.getDataRange().getValues();
  const fileIndex = existingData.findIndex(row => row[0] === fileName);

  if (fileIndex === -1) {
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, 6).setValues(data);
    Logger.log(`logFileStatus: Logged ${status} status for ${fileName} with last processed line ${lastProcessedLine} and total lines to process ${totalLinesToProcess} to ${FILE_LOG_SHEET_URL}`);
  } else {
    sheet.getRange(fileIndex + 1, 1, 1, 6).setValues(data);
    Logger.log(`logFileStatus: Updated ${status} status for ${fileName} with last processed line ${lastProcessedLine} and total lines to process ${totalLinesToProcess} in ${FILE_LOG_SHEET_URL}`);
  }
}

// New helper function to manually update status to "processed" with final line number
function updateWhatsappChatlogStatus(fileName, fileUrl, totalLines) {
  const lastProcessedLine = totalLines - 1; // Final line index (zero-based)
  logFileStatus(fileName, fileUrl, "processed", lastProcessedLine, totalLines);
  Logger.log(`updateWhatsappChatlogStatus: Manually updated ${fileName} to 'processed' with last processed line ${lastProcessedLine} and total lines ${totalLines}`);
}

// Example usage for manually updating a specific file
function updateSpecificChatlogStatus() {
  const fileUrl = "https://drive.google.com/file/d/1jiHHgE7aRPQDcRk4dAIli6-IuvhMKBlq/view?usp=drive_link";
  const fileIdMatch = fileUrl.match(/[-\w]{25,}/);
  const fileId = fileIdMatch ? fileIdMatch[0] : null;
  if (!fileId) {
    Logger.log(`updateSpecificChatlogStatus: Invalid file URL: ${fileUrl}`);
    return;
  }
  
  const file = DriveApp.getFileById(fileId);
  const fileName = file.getName();
  const content = file.getBlob().getDataAsString();
  const totalLines = content.split('\n').length;

  updateWhatsappChatlogStatus(fileName, fileUrl, totalLines);
}

function isContributorFound(contributor, platform) {
  const spreadsheet = SpreadsheetApp.openByUrl(EXISTING_SHEET_URL);
  const sheet = spreadsheet.getSheetByName("Contributors contact information");
  if (!sheet) {
    Logger.log(`isContributorFound: Error: Sheet "Contributors contact information" not found in ${EXISTING_SHEET_URL}. Assuming not found.`);
    return false;
  }
  const data = sheet.getDataRange().getValues();

  const normalizedContributor = contributor.replace(/\s/g, '').toLowerCase();
  const contributorWithAt = `@${normalizedContributor}`;
  const contributorWithoutAt = normalizedContributor.startsWith('@') ? normalizedContributor.slice(1) : normalizedContributor;

  for (let i = 1; i < data.length; i++) {
    const actualName = data[i][0] ? data[i][0].toString().replace(/\s/g, '').toLowerCase() : "";
    const telegramHandle = data[i][7] ? data[i][7].toString().replace(/\s/g, '').toLowerCase() : "";

    if (platform === "Telegram") {
      if ((actualName && actualName === contributorWithoutAt) || 
          (telegramHandle && (telegramHandle === contributorWithAt || telegramHandle === contributorWithoutAt))) {
        Logger.log(`isContributorFound: Contributor ${contributor} found in Contributors contact information`);
        return true;
      }
    } else {
      if (actualName && actualName === contributorWithoutAt) {
        Logger.log(`isContributorFound: Contributor ${contributor} found in Contributors contact information`);
        return true;
      }
    }
  }
  Logger.log(`isContributorFound: Contributor ${contributor} not found in Contributors contact information`);
  return false;
}

function getClosestEquinoxOrSolstice() {
  if (!OPENAI_API_KEY) {
    Logger.log(`getClosestEquinoxOrSolstice: Error: Please set OPENAI_API_KEY in Script Properties.`);
    return null;
  }

  const now = new Date();
  const currentDate = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd");
  const prompt = `return in concise response in YYYY-MM-DD format, the next date after (${currentDate}) for the equinox or solstice`;
  Logger.log(`getClosestEquinoxOrSolstice: ${prompt}`);

  const requestData = {
    "model": "gpt-3.5-turbo",
    "messages": [{ "role": "user", "content": prompt }],
    "max_tokens": 10
  };

  const options = {
    "method": "post",
    "contentType": "application/json",
    "headers": { "Authorization": "Bearer " + OPENAI_API_KEY },
    "payload": JSON.stringify(requestData),
    "muteHttpExceptions": true
  };

  const response = UrlFetchApp.fetch(OPENAI_API_URL, options);
  const status = response.getResponseCode();
  const result = response.getContentText();

  if (status === 200) {
    const json = JSON.parse(result);
    const dateResponse = json.choices[0].message.content.trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(dateResponse)) {
      Logger.log(`getClosestEquinoxOrSolstice: Next Equinox or Solstice date: ${dateResponse}`);
      const spreadsheet = SpreadsheetApp.openByUrl(OUTPUT_SHEET_URL);
      const sheet = spreadsheet.getSheetByName("Scored Chatlogs");
      if (!sheet) {
        Logger.log(`getClosestEquinoxOrSolstice: Error: Sheet "Scored Chatlogs" not found in ${OUTPUT_SHEET_URL}`);
        return dateResponse;
      }
      sheet.getRange("D2").setValue(dateResponse);
      Logger.log(`getClosestEquinoxOrSolstice: Updated D2 in Scored Chatlogs with ${dateResponse}`);
      return dateResponse;
    } else {
      Logger.log(`getClosestEquinoxOrSolstice: Invalid date format from ChatGPT: ${dateResponse}`);
      return null;
    }
  } else {
    Logger.log(`getClosestEquinoxOrSolstice: ChatGPT API error: ${status} - ${result}`);
    return null;
  }
}

function sendTelegramNotification(chatId, contributorUsernames) {
  const token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_API_TOKEN') || creds.TELEGRAM_API_TOKEN || telegramBotKey; // Fallback to telegramBotKey
  if (!token) {
    Logger.log(`sendTelegramNotification: Error: TELEGRAM_API_TOKEN not set in Script Properties, Credentials, or as telegramBotKey`);
    return;
  }

  Logger.log(`sendTelegramNotification: Using token (first 10 chars): ${token.substring(0, 10)}...`); // Debug token

  const apiUrl = `https://api.telegram.org/bot${token}/sendMessage`;
  const contributorNamesString = contributorUsernames.map(name => `@${name}`).join(", ");

  const baseOutputSheetLink = "https://truesight.me/submissions/scored-and-to-be-tokenized";
  
  // Add timestamp as a query parameter
  const timestamp = new Date().getTime(); // Current timestamp in milliseconds
  const outputSheetLink = `${baseOutputSheetLink}?ts=${timestamp}`;

  const payload = {
    chat_id: chatId,
    text: `Thank you ${contributorNamesString} for your contributions! They have been recorded in the Google Sheet. Review here: ${outputSheetLink}`
  };

  Logger.log(`sendTelegramNotification: Payload: ${JSON.stringify(payload)}`); // Debug payload

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    Logger.log(`sendTelegramNotification: Sending to ${apiUrl}`);
    const response = UrlFetchApp.fetch(apiUrl, options);
    const status = response.getResponseCode();
    const responseText = response.getContentText();
    if (status === 200) {
      Logger.log(`sendTelegramNotification: Successfully sent message to chat ${chatId} for ${contributorNamesString}`);
      Logger.log(`sendTelegramNotification: Response: ${responseText}`);
    } else {
      Logger.log(`sendTelegramNotification: Failed to send message to chat ${chatId}. Status: ${status}, Response: ${responseText}`);
    }
  } catch (e) {
    Logger.log(`sendTelegramNotification: Error sending Telegram message to chat ${chatId}: ${e.message}`);
    Logger.log(`sendTelegramNotification: Stack trace: ${e.stack}`);
  }
}

// Retrieves chat ID for a given row from Telegram Chat Logs (slightly modified for clarity)
function getChatIdForRow(row, telegramSheet, rowIndex) {
  const chatId = row[1] ? row[1].toString().trim() : "";
  if (chatId) {
    Logger.log(`getChatIdForRow: Found chat ID ${chatId} at row ${rowIndex + 1}`);
    return chatId;
  }
  Logger.log(`getChatIdForRow: No chat ID found at row ${rowIndex + 1}`);
  return null;
}

function sendTestAcknowledgement() {
  sendTelegramNotification(2102593402, ["garyjob"]);
}

function findContributorName(inputString) {
  if (!inputString || typeof inputString !== 'string') {
    Logger.log(`findContributorName: Invalid input: ${inputString}`);
    return false;
  }

  inputString = inputString.toLowerCase()
  Logger.log("Checking " + inputString)

  const existingSpreadsheet = SpreadsheetApp.openByUrl(EXISTING_SHEET_URL);
  const contributorSheet = existingSpreadsheet.getSheetByName("Contributors contact information");
  if (!contributorSheet) {
    Logger.log(`findContributorName: Error: Sheet "Contributors contact information" not found in ${EXISTING_SHEET_URL}`);
    return false;
  }

  const contributorData = contributorSheet.getDataRange().getValues();
  const normalizedInput = inputString.replace(/\s/g, '').toLowerCase();
  const inputWithAt = `@${normalizedInput}`;
  const inputWithoutAt = normalizedInput.startsWith('@') ? normalizedInput.slice(1) : normalizedInput;

  Logger.log(`findContributorName: Searching for ${inputString} (normalized: ${normalizedInput})`);

  for (let i = 1; i < contributorData.length; i++) {
    const actualName = contributorData[i][0] ? contributorData[i][0].toString().replace(/\s/g, '').toLowerCase() : "";
    const telegramHandle = contributorData[i][7] ? contributorData[i][7].toString().replace(/\s/g, '').toLowerCase() : "";
    
    const email = contributorData[i][5] ? contributorData[i][5].toString().replace(/\s/g, '').toLowerCase() : "";
    const emailPlus = email.replace(/\+.*?(?=@)/, ''); // Remove +suffix from email if present
    const columnQ = contributorData[i][16] ? contributorData[i][16].toString().replace(/\s/g, '').toLowerCase() : "";
    const columnQWithAt = columnQ && !columnQ.startsWith('@') ? `@${columnQ}` : columnQ;
    const columnQWithPlus = columnQ && !columnQ.startsWith('@') ? `+${columnQ.replace(/^@/, '')}` : columnQ.replace(/^@/, '+');

    // Check for matches
    if (actualName === inputWithoutAt ||
        telegramHandle === normalizedInput ||
        telegramHandle === inputWithAt ||
        telegramHandle === inputWithoutAt ||
        email === normalizedInput ||
        email === inputWithAt ||
        email === inputWithoutAt ||
        emailPlus === inputWithoutAt ||
        columnQ === normalizedInput ||
        columnQ === inputWithAt ||
        columnQ === inputWithoutAt ||
        columnQWithAt === normalizedInput ||
        columnQWithAt === inputWithAt ||
        columnQWithPlus === inputWithoutAt) {
      const matchedName = contributorData[i][0].toString().trim();
      Logger.log(`findContributorName: Match found for ${inputString} with ${matchedName}`);
      return matchedName;
    }
  }

  Logger.log(`findContributorName: No match found for ${inputString}`);
  return false;
}

function resolveUnknownUsers(outputSheet, rowIndex, contributorName) {
  if (!outputSheet || !contributorName || typeof rowIndex !== 'number' || rowIndex < 1) {
    Logger.log(`resolveUnknownUsers: Invalid parameters - sheet: ${outputSheet}, row: ${rowIndex}, contributor: ${contributorName}`);
    return;
  }

  Logger.log(`resolveUnknownUsers: Processing contributor ${contributorName} at row ${rowIndex + 1}`);

  // Use findContributorName to search for a match
  const matchedName = findContributorName(contributorName);
  
  if (matchedName) {
    Logger.log(`resolveUnknownUsers: Match found for ${contributorName} with ${matchedName} via findContributorName`);
    outputSheet.getRange(rowIndex + 1, 1).setValue(matchedName); // Column A
    outputSheet.getRange(rowIndex + 1, 9).setValue(true); // Column I
    Logger.log(`resolveUnknownUsers: Updated row ${rowIndex + 1}: Contributor Name to ${matchedName}, Found in Contributors to true`);
  } else {
    Logger.log(`resolveUnknownUsers: No match found for ${contributorName} via findContributorName`);
    outputSheet.getRange(rowIndex + 1, 9).setValue("RESOLVE FAILED"); // Column I
    Logger.log(`resolveUnknownUsers: Updated row ${rowIndex + 1}: Found in Contributors to RESOLVE FAILED`);
  }
}

function resolveAllUnknownUsers() {
  Logger.log(`resolveAllUnknownUsers: Starting to resolve all unknown users in Scored Chatlogs`);

  const outputSpreadsheet = SpreadsheetApp.openByUrl(OUTPUT_SHEET_URL);
  const outputSheet = outputSpreadsheet.getSheetByName("Scored Chatlogs");
  if (!outputSheet) {
    Logger.log(`resolveAllUnknownUsers: Error: Sheet "Scored Chatlogs" not found in ${OUTPUT_SHEET_URL}`);
    return;
  }

  const outputData = outputSheet.getDataRange().getValues();
  let resolvedCount = 0;
  let failedCount = 0;

  // Iterate through all rows once
  for (let i = 1; i < outputData.length; i++) {
    if (outputData[i][8] === false && outputData[i][5] === "Pending Review") {
      const contributorName = outputData[i][0].toString().trim();
      Logger.log(`resolveAllUnknownUsers: Found unresolved record at row ${i + 1} for contributor ${contributorName}`);
      resolveUnknownUsers(outputSheet, i, contributorName);
      const updatedStatus = outputSheet.getRange(i + 1, 9).getValue();
      if (updatedStatus === true) {
        resolvedCount++;
      } else if (updatedStatus === "RESOLVE FAILED") {
        failedCount++;
      }
    }
  }

  Logger.log(`resolveAllUnknownUsers: Completed processing. Resolved: ${resolvedCount}, Failed: ${failedCount}, Total rows processed: ${outputData.length - 1}`);
}

function testFindContributorName() {
  findContributorName('@Andrea');
}

function extractContributionDetails(message) {
  // Normalize line endings and trim whitespace
  message = message.replace(/\r\n/g, '\n').trim();
  
  // More flexible regex to match [CONTRIBUTION EVENT] format
  const pattern = /\[CONTRIBUTION EVENT\]\n\s*- Type:\s*(.*?)\n\s*- Amount:\s*(\d+\.?\d*)\n\s*- Description:\s*((?:.|\n)*?)\n\s*- Contributor\(s\):\s*(.*?)\n\s*- TDG Issued:\s*((?:.|\n)*?)\n\s*- Attached Filename:\s*(.*?)\n\s*- Destination Contribution File Location:\s*(.*?)(?:\n\s*-+\s*\n\s*My Digital Signature:.*)?$/i;
  
  const match = message.match(pattern);
  if (!match) {
    Logger.log(`extractContributionDetails: Regex failed to match contribution message: ${message}`);
    
    // Fallback parsing to extract fields line by line
    const lines = message.split('\n').map(line => line.trim());
    let contributionDetails = {
      type: null,
      amount: null,
      description: null,
      contributors: null,
      tdgIssued: null,
      attachedFilename: null,
      destinationFileLocation: null
    };
    
    let currentField = null;
    let descriptionLines = [];
    
    for (let line of lines) {
      if (line.startsWith('[CONTRIBUTION EVENT]')) continue;
      if (line.startsWith('- Type:')) {
        contributionDetails.type = line.replace(/^- Type:\s*/, '').trim();
        currentField = null;
      } else if (line.startsWith('- Amount:')) {
        const amountMatch = line.match(/^- Amount:\s*(\d+\.?\d*)/);
        contributionDetails.amount = amountMatch ? parseFloat(amountMatch[1]) : null;
        currentField = null;
      } else if (line.startsWith('- Description:')) {
        descriptionLines = [line.replace(/^- Description:\s*/, '').trim()];
        currentField = 'description';
      } else if (line.startsWith('- Contributor(s):')) {
        contributionDetails.contributors = line.replace(/^- Contributor\(s\):\s*/, '').trim();
        currentField = null;
      } else if (line.startsWith('- TDG Issued:')) {
        contributionDetails.tdgIssued = line.replace(/^- TDG Issued:\s*/, '').trim();
        currentField = null;
      } else if (line.startsWith('- Attached Filename:')) {
        const filename = line.replace(/^- Attached Filename:\s*/, '').trim();
        contributionDetails.attachedFilename = filename === 'None' ? null : filename;
        currentField = null;
      } else if (line.startsWith('- Destination Contribution File Location:')) {
        const location = line.replace(/^- Destination Contribution File Location:\s*/, '').trim();
        contributionDetails.destinationFileLocation = location === 'No file attached' ? null : location;
        currentField = null;
      } else if (line.startsWith('---') || line.startsWith('My Digital Signature:')) {
        break; // Stop parsing at signature or separator
      } else if (currentField === 'description' && line) {
        descriptionLines.push(line);
      }
    }
    
    if (descriptionLines.length > 0) {
      contributionDetails.description = descriptionLines.join(' ');
    }
    
    // Check if all required fields were found
    if (contributionDetails.type && contributionDetails.amount !== null && contributionDetails.description && contributionDetails.contributors && contributionDetails.tdgIssued) {
      Logger.log(`extractContributionDetails: Fallback parsing succeeded: ${JSON.stringify(contributionDetails)}`);
      return contributionDetails;
    }
    
    Logger.log(`extractContributionDetails: Fallback parsing failed, missing required fields: ${JSON.stringify(contributionDetails)}`);
    return null;
  }
  
  return {
    type: match[1].trim(),
    amount: parseFloat(match[2]),
    description: match[3].trim(),
    contributors: match[4].trim(),
    tdgIssued: match[5].trim(),
    attachedFilename: match[6].trim() === 'None' ? null : match[6].trim(),
    destinationFileLocation: match[7].trim() === 'No file attached' ? null : match[7].trim()
  };
}

// Function to generate a unique GitHub filename with a running number
function generateUniqueGitHubFilename(originalUrl, index) {
  try {
    const urlPattern = /github\.com\/([^\/]+)\/([^\/]+)\/tree\/([^\/]+)\/(.+?)(\.[^.]+)$/i;
    const match = originalUrl.match(urlPattern);
    if (!match) {
      Logger.log(`generateUniqueGitHubFilename: Invalid GitHub URL format for generating unique filename: ${originalUrl}`);
      return null;
    }

    const [, owner, repo, branch, pathWithoutExtension, extension] = match;
    const newPath = `${pathWithoutExtension}_${index}${extension}`;
    const newUrl = `https://github.com/${owner}/${repo}/tree/${branch}/${newPath}`;
    Logger.log(`generateUniqueGitHubFilename: Generated new URL: ${newUrl} for index ${index}`);
    return newUrl;
  } catch (e) {
    Logger.log(`generateUniqueGitHubFilename: Error generating unique GitHub filename: ${e.message}`);
    return null;
  }
}

// Function to upload file to GitHub
function uploadFileToGitHub(fileId, destinationUrl, commitMessage) {
  try {
    const token = creds.GITHUB_API_TOKEN;
    if (!token) {
      Logger.log(`uploadFileToGitHub: Error: GITHUB_API_TOKEN not set in Credentials`);
      return false;
    }

    const telegramApiUrl = `https://api.telegram.org/bot${creds.TELEGRAM_API_TOKEN}/getFile?file_id=${fileId}`;
    Logger.log(telegramApiUrl);
    const fileResponse = UrlFetchApp.fetch(telegramApiUrl);
    const fileData = JSON.parse(fileResponse.getContentText());
    
    if (!fileData.ok) {
      Logger.log(`uploadFileToGitHub: Failed to get file info from Telegram: ${fileData.description}`);
      return false;
    }

    const filePath = fileData.result.file_path;
    const fileContentResponse = UrlFetchApp.fetch(`https://api.telegram.org/file/bot${creds.TELEGRAM_API_TOKEN}/${filePath}`);
    const fileContent = Utilities.base64Encode(fileContentResponse.getBlob().getBytes());

    const urlPattern = /github\.com\/([^\/]+)\/([^\/]+)\/tree\/([^\/]+)\/(.+)/i;
    const match = destinationUrl.match(urlPattern);
    if (!match) {
      Logger.log(`uploadFileToGitHub: Invalid GitHub URL format: ${destinationUrl}`);
      return false;
    }

    const [, owner, repo, branch, path] = match;
    
    const githubApiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const payload = {
      message: commitMessage,
      content: fileContent,
      branch: branch
    };

    const options = {
      method: 'put',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      },
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(githubApiUrl, options);
    const status = response.getResponseCode();
    if (status === 200 || status === 201) {
      Logger.log(`uploadFileToGitHub: Successfully uploaded file to GitHub: ${destinationUrl}`);
      return true;
    } else {
      Logger.log(`uploadFileToGitHub: Failed to upload file to GitHub. Status: ${status}, Response: ${response.getContentText()}`);
      return false;
    }
  } catch (e) {
    Logger.log(`uploadFileToGitHub: Error uploading file to GitHub: ${e.message}`);
    return false;
  }
}

// Function to check if file exists in GitHub
function checkFileExistsInGitHub(fileUrl) {
  try {
    const options = {
      method: 'get',
      muteHttpExceptions: true
    };
    const response = UrlFetchApp.fetch(fileUrl, options);
    const status = response.getResponseCode();
    if (status === 200) {
      Logger.log(`checkFileExistsInGitHub: File exists at ${fileUrl}`);
      return true;
    } else {
      Logger.log(`checkFileExistsInGitHub: File does not exist at ${fileUrl} (Status: ${status})`);
      return false;
    }
  } catch (e) {
    Logger.log(`checkFileExistsInGitHub: Error checking file existence in GitHub: ${e.message}`);
    return false;
  }
}


function testProcessTelegramRow() {
  rowIndex = 6042
  if (!XAI_API_KEY) {
    Logger.log(`testProcessTelegramRow: Error: Please set XAI_API_KEY in Script Properties.`);
    return;
  }

  const telegramSpreadsheet = SpreadsheetApp.openByUrl(TELEGRAM_SHEET_URL);
  const telegramSheet = telegramSpreadsheet.getSheetByName("Telegram Chat Logs");

  if (!telegramSheet) {
    Logger.log(`testProcessTelegramRow: Error: Sheet "Telegram Chat Logs" not found in ${TELEGRAM_SHEET_URL}`);
    return;
  }

  const data = telegramSheet.getDataRange().getValues();
  if (rowIndex < 1 || rowIndex >= data.length) {
    Logger.log(`testProcessTelegramRow: Error: Invalid row index ${rowIndex + 1}. Must be between 2 and ${data.length}.`);
    return;
  }

  const row = data[rowIndex];
  const dateStr = row[11] ? row[11].toString().trim() : "";
  const username = row[4] ? row[4].toString() : "Unknown";
  const message = row[6] ? row[6].toString().trim() : "";
  const existingHash = row[13] ? row[13].toString().trim() : "";

  Logger.log(message);

  Logger.log(`testProcessTelegramRow: Testing row ${rowIndex + 1}: ${dateStr} - ${username} - ${message}`);

  if (existingHash) {
    Logger.log(`testProcessTelegramRow: Row ${rowIndex + 1} already processed with hash ${existingHash}. Skipping.`);
    return;
  }

  const { records, count } = processChatLogEntry({
    message,
    username,
    statusDate: dateStr,
    platform: "Telegram",
    projectName: "telegram_chatlog",
    rowIndex: rowIndex,
    telegramSheet: telegramSheet
  });

  if (records.length > 0) {
    writeToGoogleSheet(records, "Telegram");
    const messageHash = generateUniqueHash(username, message, dateStr);
    telegramSheet.getRange(rowIndex + 1, 14).setValue(messageHash);
    Logger.log(`testProcessTelegramRow: Processed row ${rowIndex + 1} with ${count} records, hash ${messageHash} inserted`);

    const chatId = getChatIdForRow(row, telegramSheet, rowIndex);
    if (chatId) {
      const contributorUsernames = records.map(record => record.telegramHandle.startsWith('@') ? record.telegramHandle.slice(1) : record.telegramHandle);
      // sendTelegramNotification(chatId, contributorUsernames);
      Logger.log(`testProcessTelegramRow: Sent notification to chat ${chatId} for contributors: ${contributorUsernames.join(', ')}`);
    }
  } else {
    const messageHash = generateUniqueHash(username, message, dateStr);
    telegramSheet.getRange(rowIndex + 1, 14).setValue(messageHash);
    Logger.log(`testProcessTelegramRow: No records generated for row ${rowIndex + 1}, hash ${messageHash} inserted`);
  }

  Logger.log(`testProcessTelegramRow: Completed testing row ${rowIndex + 1} with ${count} records processed`);
}


function testUploadFileToGitHub(fileId, destinationUrl, message) {
  fileId = "AgACAgEAAyEFAASCjq75AAIaZWiBA7uSthMZUR3LGz-P5gNpaNMoAAKFsTEbKVoJRIM-lE9iWKLqAQADAgADeQADNgQ"
  destinationUrl= "https://github.com/TrueSightDAO/.github/tree/main/assets/contribution_20250723154626_gary_teh_img_9606.png"
  message = "Testing upload"
  uploadFileToGitHub(fileId, destinationUrl, message);
}


/**
 * Checks if a message contains any DAO-specific event strings that should be skipped.
 * @param {string} message - The chat log message to check.
 * @returns {boolean} - True if the message contains a string to skip, false otherwise.
 */
function shouldSkipMessage(message) {
  const messageUpper = message.toUpperCase();
  const shouldSkip = SKIP_MESSAGE_STRINGS.some(skipString => messageUpper.includes(skipString));
  
  if (shouldSkip) {
    Logger.log(`shouldSkipMessage: Skipping message due to DAO-specific event: ${message}`);
  }
  
  return shouldSkip;
}