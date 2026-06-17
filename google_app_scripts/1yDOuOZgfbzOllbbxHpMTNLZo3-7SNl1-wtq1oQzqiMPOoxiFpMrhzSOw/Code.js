// Google Drive folder ID for both input .txt files and output Google Sheets
const CHATLOG_FOLDER_ID = "19PqD0GPcgmkdC_wv8hHaSo6x2b9Nor06";

// Google Sheet URL for logging status
const FILE_LOG_SHEET_URL = "https://docs.google.com/spreadsheets/d/1SQyHOowczy5ITHR5t0hn1p78kGBRoZWJsp74cuAQOMo/edit";

function processWhatsappChatlogsToSheets() {
  const folder = DriveApp.getFolderById(CHATLOG_FOLDER_ID);
  const files = folder.getFilesByType(MimeType.PLAIN_TEXT);
  const chatlogFiles = [];
  
  // Collect all .txt files
  while (files.hasNext()) {
    chatlogFiles.push(files.next());
  }
  Logger.log(`Found ${chatlogFiles.length} chatlog files: ${chatlogFiles.map(f => f.getName())}`);

  // Process each file
  chatlogFiles.forEach(file => {
    const fileName = file.getName();
    const sheetName = `${fileName} Parsed Records`;
    
    // Check if corresponding sheet already exists
    const existingSheets = folder.getFilesByName(sheetName);
    if (existingSheets.hasNext()) {
      Logger.log(`Skipping ${fileName}: Sheet ${sheetName} already exists`);
      return; // Skip if sheet exists
    }

    // Process the chatlog file and log status
    processSingleWhatsappChatlogToSheet(file);
  });

  Logger.log(`Completed processing ${chatlogFiles.length} chatlog files`);
}

function processSingleWhatsappChatlogToSheet(file) {
  const fileName = file.getName();
  const fileUrl = file.getUrl();
  const content = file.getBlob().getDataAsString();
  const totalLines = content.split('\n').length;
  Logger.log(`Processing ${fileName}`);

  // Log initial processing status
  logFileStatus(fileName, fileUrl, "processing", "", totalLines);

  // Create new sheet
  const sheet = createNewSheet(fileName);
  if (!sheet) {
    Logger.log(`Failed to create sheet for ${fileName}`);
    logFileStatus(fileName, fileUrl, "error", "", totalLines);
    return;
  }

  // Parse and populate the chatlog
  const messages = parseWhatsappChatlog(content);
  Logger.log(`Parsed ${messages.length} messages from ${fileName}`);
  
  if (messages.length > 0) {
    populateSheet(sheet, messages);
    Logger.log(`Populated ${sheet.getName()} with ${messages.length} records`);
    // Log successful completion
    logFileStatus(fileName, fileUrl, "processed", messages.length - 1, totalLines);
  } else {
    Logger.log(`No messages found in ${fileName}`);
    logFileStatus(fileName, fileUrl, "processed", 0, totalLines);
  }
}

function createNewSheet(fileName) {
  const folder = DriveApp.getFolderById(CHATLOG_FOLDER_ID);
  const sheetName = `${fileName} Parsed Records`;
  
  // Create new spreadsheet
  const spreadsheet = SpreadsheetApp.create(sheetName);
  const file = DriveApp.getFileById(spreadsheet.getId());
  file.moveTo(folder);
  Logger.log(`Created new sheet ${sheetName} in folder ${CHATLOG_FOLDER_ID}`);

  const sheet = spreadsheet.getSheets()[0];
  // Add headers
  sheet.appendRow(["Date", "Username", "Message", "IsSystemMessage"]);
  Logger.log(`Added headers to ${sheetName}`);
  
  return sheet;
}

function populateSheet(sheet, messages) {
  const newRecords = messages.map(msg => [
    msg.date.toISOString(),
    msg.username,
    msg.message,
    msg.isSystemMessage
  ]);

  if (newRecords.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRecords.length, 4).setValues(newRecords);
    Logger.log(`Added ${newRecords.length} records to ${sheet.getName()}`);
  }
}

function parseWhatsappChatlog(content) {
  const lines = content.split('\n');
  const messages = [];
  const regex = /^\[(\d{1,2}\/\d{1,2}\/\d{2}), (\d{1,2}:\d{2}:\d{2}\u202f[AP]M)\] (.*?): (.+)$/;

  for (let i = 0; i < lines.length; i++) {
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

      if (!isNaN(date.getTime())) {
        messages.push({ date, username, message: message.trim(), isSystemMessage });
        Logger.log(`Parsed message at line ${i + 1}: ${date.toISOString()} - ${username} - ${message}`);
      } else {
        Logger.log(`Invalid date parsed from: ${dateStr} at line ${i + 1}`);
      }
    }
  }

  return messages;
}

function logFileStatus(fileName, fileUrl, status, lastProcessedLine = "", totalLinesToProcess = "") {
  const spreadsheet = SpreadsheetApp.openByUrl(FILE_LOG_SHEET_URL);
  const sheet = spreadsheet.getSheetByName("WhatsApp Chatlog status");

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
    Logger.log(`logFileStatus: Logged ${status} status for ${fileName} with last processed line ${lastProcessedLine} and total lines ${totalLinesToProcess}`);
  } else {
    sheet.getRange(fileIndex + 1, 1, 1, 6).setValues(data);
    Logger.log(`logFileStatus: Updated ${status} status for ${fileName} with last processed line ${lastProcessedLine} and total lines ${totalLinesToProcess}`);
  }
}

// Run this function to start the process
function startProcessing() {
  processWhatsappChatlogsToSheets();
}