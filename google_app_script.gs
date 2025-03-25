// Flag to ignore chatlogs before this date (YYYYMMDD format)
// - Messages with dates earlier than this will be skipped during processing.
// - Format: "YYYYMMDD" (e.g., "20241213" means December 13, 2024).
// - Adjust this to filter out old data you don’t want to process.
const IGNORE_BEFORE_DATE = "20241213";

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
// - The web address for OpenAI API requests (e.g., for equinox/solstice calculations).
// - Default: "https://api.openai.com/v1/chat/completions". Update if OpenAI changes their endpoint.
const OPENAI_API_URL = creds.OPENAI_API_URL;

// Google Drive folder ID for storing intermediate parsed data sheets
// - Holds temporary Google Sheets (e.g., "[fileName] Parsed Records") during WhatsApp processing.
// - Find this ID in your Google Drive folder URL (e.g., "1UxxDWh5yOeLIUDyTcCgAiMZztp5_8PLU").
// - Change in Credentials.gs if you want intermediate files in a different folder.
const INTERMEDIATE_FOLDER_ID = creds.INTERMEDIATE_FOLDER_ID;

function processChatLogEntry({ message, username, statusDate, platform, projectName, rowIndex = null, telegramSheet = null }) {
  Logger.log(message, username, statusDate, platform, projectName, rowIndex , telegramSheet )
  const logPrefix = platform === "Telegram" ? `Telegram Chat Logs${rowIndex !== null ? ` (Row ${rowIndex + 1})` : ''}` : `WhatsApp Chat Log (${projectName})`;
  Logger.log(`processChatLogEntry: Processing ${logPrefix}: ${message}`);

  if (!message) {
    Logger.log(`processChatLogEntry: Skipping invalid record: ${statusDate} - ${username} - ${message} (Reason: Missing contribution message)`);
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
  
  const contributors = getContributorsFromMessage(message, actualName, platform).split(';').filter(c => c);
  Logger.log(`processChatLogEntry: Contributors identified: ${contributors.join(', ') || 'none'}`);
  
  const newRecords = [];
  if (scoringResult.classification !== "Unknown" && scoringResult.classification !== "Unexpected response format" && scoringResult.classification !== "Grok API error") {
    contributors.forEach(contributor => {
      if (contributor) {
        const foundInContributors = isContributorFound(contributor, platform);
        const tdgPerContributor = (parseFloat(scoringResult.tdgIssued) / contributors.length).toFixed(2);
        newRecords.push({
          contributor: contributor,
          project: projectName,
          contribution: message,
          rubric: scoringResult.classification,
          tdgProvisioned: tdgPerContributor, // Scored TDG value moved here
          status: "Pending",
          tdgIssued: "0.00", // Always 0 as it’s human-verified later
          statusDate: statusDate,
          foundInContributors: foundInContributors,
          reportedBy: actualName,
          uniqueHash: messageHash
        });
      }
    });
  }

  return { records: newRecords, count: newRecords.length };
}

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
      telegramSheet.getRange(i + 1, 14).setValue(generateUniqueHash(username, message, dateStr));          
    } else {
      Logger.log(`processTelegramChatLogs: Updated row ${i + 1} Column N with hash even though no contributors were found`);    
      telegramSheet.getRange(i + 1, 14).setValue(generateUniqueHash(username, message, dateStr));          
    }


  }

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
  const payload = `From the following ${platform} message by ${reporter}: "${message}", identify all individuals explicitly mentioned as contributors. Include the reporter (${reporter}) as a contributor if the message explicitly states they performed an action contributing to the work (e.g., "I worked", "I spent time", "I created", "I spent $607"), but exclude them if the message only indicates reporting on behalf of others (e.g., "Reporting on behalf of John") without their own contribution. Extract all names${platform === "Telegram" ? ", including Telegram handles (with or without @)," : ", including WhatsApp handles (e.g., @ followed by numbers),"} from phrases like "I worked with June and Kirsten" or "Me and @557391090002 spent 12 minutes". Exclude generic terms like "team", "group", and URLs. Return ONLY a semicolon-separated list of names or handles (e.g., "${reporter};June;@557391090002") or an empty string ('') if no valid contributors are found. Do not include any explanatory text, backticks, or additional formatting.`;

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
      ? /^([@a-zA-Z\s]+;)*[@a-zA-Z\s]*$/ 
      : /^([@0-9a-zA-Z\s]+;)*[@0-9a-zA-Z\s]*$/;
    if (content === '' || content.match(validPattern)) {
      Logger.log(`getContributorsFromMessage: Successful response: ${content}`);
      return content;
    } else {
      Logger.log(`getContributorsFromMessage: Unexpected contributor response format: ${content}`);
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

function testSingleChatlog() {
  const testUrl = "https://drive.google.com/file/d/1jiHHgE7aRPQDcRk4dAIli6-IuvhMKBlq/view?usp=drive_link";
  Logger.log(`testSingleChatlog: Starting test with URL: ${testUrl}`);
  processSingleWhatsappChatlog(testUrl);
}

function testGetClosestEquinoxOrSolstice() {
  Logger.log(`testGetClosestEquinoxOrSolstice: Starting test`);
  const date = getClosestEquinoxOrSolstice();
  Logger.log(`testGetClosestEquinoxOrSolstice: Test result: Closest Equinox or Solstice date is ${date}`);
}