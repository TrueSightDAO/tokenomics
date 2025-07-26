// Load API keys and configuration settings from Credentials.gs
setApiKeys();
const creds = getCredentials();

// Tab names and constants
const telegramLogTabName = "Telegram Chat Logs";
const sunMintTabName = "SunMint Tree Planting";
const contributorsSheetId = "1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU";
const contributorsTabName = "Contributors Digital Signatures";
const TELEGRAM_CHAT_ID = '-1002190388985';

// Helper: extract filename from Photo URL line
function extractFilenameFromPhotoURL(contributionText) {
  const match = contributionText.match(/- Photo URL: (.+\/([^\/]+))$/m);
  return match ? match[2] : null;
}

// Helper: extract Species
function extractSpecies(contributionText) {
  const match = contributionText.match(/- Species: (.+)$/m);
  return match ? match[1].trim() : 'Unknown';
}

// Send Telegram notification
function sendTreePlantingNotification(rowData, treePlantingRowNumber) {
  Logger.log("Sending tree planting notification");
  const token = creds.TELEGRAM_API_TOKEN;
  if (!token) {
    Logger.log(`sendTreePlantingNotification: Error: TELEGRAM_API_TOKEN not set`);
    return;
  }

  const apiUrl = `https://api.telegram.org/bot${token}/sendMessage`;
  const outputSheetLink = `https://www.agroverse.shop/trees-planted`;

  const messageText = `🌳 New Tree Planting Event Recorded\n\n` +
    `Tree Planting Row: ${treePlantingRowNumber}\n` +
    `Telegram Update ID: ${rowData[0]}\n` +
    `Chatroom ID: ${rowData[1]}\n` +
    `Chatroom Name: ${rowData[2]}\n` +
    `Message ID: ${rowData[3]}\n` +
    `Contributor Handle: ${rowData[4]}\n` +
    `Contributor Name: ${rowData[9]}\n` +
    `Photo URL: ${rowData[8]}\n` +
    `Location: ${rowData[10]}, ${rowData[11]}\n\n` +
    `Review here: ${outputSheetLink}`;

  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text: messageText,
    parse_mode: "HTML"
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    Logger.log(`Sending notification to chat ${TELEGRAM_CHAT_ID}`);
    const response = UrlFetchApp.fetch(apiUrl, options);
    const status = response.getResponseCode();
    if (status === 200) {
      Logger.log(`Notification sent successfully.`);
    } else {
      Logger.log(`Failed to send notification. Status: ${status}, Response: ${response.getContentText()}`);
    }
  } catch (e) {
    Logger.log(`Error sending Telegram notification: ${e.message}`);
  }
}

// Get processed message IDs
function getProcessedMessageIds(sunMintTab) {
  const lastRow = sunMintTab.getLastRow();
  if (lastRow < 2) return [];
  const messageIds = sunMintTab.getRange(2, 4, lastRow - 1, 1).getValues().flat();
  return messageIds.filter(id => id !== "");
}

// Get processed file IDs
function getProcessedFileIds(sunMintTab) {
  const lastRow = sunMintTab.getLastRow();
  if (lastRow < 2) return [];
  const fileIds = sunMintTab.getRange(2, 8, lastRow - 1, 1).getValues().flat();
  return fileIds.filter(id => id !== "" && id !== "N/A");
}

// Get Telegram file URL
function getTelegramFileUrl(token, fileId) {
  const getFileUrl = `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`;
  const response = UrlFetchApp.fetch(getFileUrl);
  const fileData = JSON.parse(response.getContentText());
  if (!fileData.ok) throw new Error("Failed to get file path: " + fileData.description);
  const filePath = fileData.result.file_path;
  return `https://api.telegram.org/file/bot${token}/${filePath}`;
}

// Check if file exists on GitHub
function checkGitHubFileExists(token, filename) {
  const repo = "TrueSightDAO/sunmint";
  const path = `images/${filename}`;
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${path}`;

  const options = {
    method: "GET",
    headers: {
      "Authorization": `token ${token}`,
      "Accept": "application/vnd.github.v3+json"
    },
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(apiUrl, options);
  const status = response.getResponseCode();

  if (status === 200) {
    Logger.log(`File exists on GitHub: ${path}`);
    return `https://raw.githubusercontent.com/${repo}/main/${path}`;
  } else if (status === 404) {
    Logger.log(`File does not exist on GitHub: ${path}`);
    return null;
  } else {
    throw new Error(`Failed to check GitHub file: ${response.getContentText()}`);
  }
}

// Upload image to GitHub and return raw URL
function uploadToGitHub(token, imageBlob, filename) {
  // Check if file already exists
  const existingUrl = checkGitHubFileExists(token, filename);
  if (existingUrl) {
    return existingUrl;
  }

  const repo = "TrueSightDAO/sunmint";
  const path = `images/${filename}`;
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${path}`;
  const base64Content = Utilities.base64Encode(imageBlob.getBytes());

  const payload = {
    message: `Upload image ${filename}`,
    content: base64Content
  };

  const options = {
    method: "PUT",
    headers: {
      "Authorization": `token ${token}`,
      "Accept": "application/vnd.github.v3+json"
    },
    contentType: "application/json",
    payload: JSON.stringify(payload)
  };

  const response = UrlFetchApp.fetch(apiUrl, options);
  const responseData = JSON.parse(response.getContentText());
  if (!responseData.content) throw new Error("Failed to upload to GitHub: " + response.getContentText());

  return `https://raw.githubusercontent.com/${repo}/main/${path}`;
}

// Main processing function
function processTelegramLogs() {
  const sheet = SpreadsheetApp.openById(creds.SHEET_ID);
  let telegramLogTab = sheet.getSheetByName(telegramLogTabName);
  let sunMintTab = sheet.getSheetByName(sunMintTabName);
  const contributorsSheet = SpreadsheetApp.openById(contributorsSheetId);
  const contributorsTab = contributorsSheet.getSheetByName(contributorsTabName);

  // Create tab if not exists
  if (!sunMintTab) {
    sunMintTab = sheet.insertSheet(sunMintTabName);
    sunMintTab.getRange("A1:O1").setValues([[
      "Telegram Update ID",      // A
      "Chatroom ID",             // B
      "Chatroom Name",           // C
      "Message ID",              // D
      "Contributor Handle",      // E
      "Contribution Made",       // F
      "Status Date",             // G
      "File ID",                 // H
      "Photo URL",               // I  <- changed from GitHub URL
      "Contributor Name",        // J
      "Latitude",                // K
      "Longitude",               // L
      "Status",                  // M
      "Species",                 // N  <- new column
      "GitHub Raw URL"           // O  <- optional for your use or can be removed
    ]]);
  }

  const processedFileIds = getProcessedFileIds(sunMintTab);
  const processedMessageIds = getProcessedMessageIds(sunMintTab);

  const lastRow = telegramLogTab.getLastRow();
  if (lastRow < 2) {
    Logger.log("No data in Telegram Chat Logs tab");
    return;
  }
  const dataRange = telegramLogTab.getRange(2, 1, lastRow - 1, 15).getValues();

  const contributorsLastRow = contributorsTab.getLastRow();
  const contributorsData = contributorsLastRow > 1 ? contributorsTab.getRange(2, 1, contributorsLastRow - 1, 5).getValues() : [];

  dataRange.forEach(function(row, index) {
    const contributionMade = row[6]; // Column G
    const messageId = row[3]; // Column D
    const fileIdsString = row[14]; // Column O

    if (processedMessageIds.includes(messageId)) {
      Logger.log(`Message ID already processed: ${messageId}`);
      return;
    }

    if (contributionMade && contributionMade.startsWith("[TREE PLANTING EVENT]")) {
      Logger.log(contributionMade);

      // Extract latitude, longitude
      const lines = contributionMade.split('\n');
      const latitude = lines.find(l => l.startsWith('- Latitude: '))?.replace('- Latitude: ', '') || 'N/A';
      const longitude = lines.find(l => l.startsWith('- Longitude: '))?.replace('- Longitude: ', '') || 'N/A';

      // Extract Species
      const species = extractSpecies(contributionMade);

      // Extract Photo URL
      const photoUrlMatch = contributionMade.match(/- Photo URL: (.+)$/m);
      const photoUrl = photoUrlMatch ? photoUrlMatch[1].trim() : 'N/A';

      // Extract public signature
      const publicSignatureMatch = contributionMade.match(/My Digital Signature: ([^\n]+)/);
      const publicSignature = publicSignatureMatch ? publicSignatureMatch[1].trim() : 'N/A';

      // Match contributor name by public signature
      let contributorName = 'Unknown';
      contributorsData.forEach(function(contributorRow) {
        if (contributorRow[4] === publicSignature) {
          contributorName = contributorRow[0];
        }
      });

      // Extract filename from Photo URL or fallback to fileId.jpg
      const filenameFromPhotoURL = extractFilenameFromPhotoURL(contributionMade);

      // Process files attached or from previous row
      const fileIds = fileIdsString ? fileIdsString.split(',').map(id => id.trim()) : [];

      if (fileIds.length > 0) {
        fileIds.forEach(function(fileId) {
          if (fileId && !processedFileIds.includes(fileId)) {
            try {
              const fileNameToUse = filenameFromPhotoURL || (fileId + '.jpg');
              const fileUrl = getTelegramFileUrl(creds.TELEGRAM_API_TOKEN, fileId);
              const imageBlob = UrlFetchApp.fetch(fileUrl).getBlob();
              const rawUrl = uploadToGitHub(creds.GITHUB_API_TOKEN, imageBlob, fileNameToUse);

              sunMintTab.appendRow([
                row[0], // A
                row[1], // B
                row[2], // C
                row[3], // D
                row[4], // E
                contributionMade, // F
                row[11], // G
                fileId, // H
                photoUrl, // I
                contributorName, // J
                latitude, // K
                longitude, // L
                "NEW", // M
                species, // N
                rawUrl // O
              ]);

              const treePlantingRowNumber = sunMintTab.getLastRow();
              sendTreePlantingNotification([
                row[0], row[1], row[2], row[3], row[4], contributionMade, row[11], fileId,
                photoUrl, contributorName, latitude, longitude, "NEW", species, rawUrl
              ], treePlantingRowNumber);

              Logger.log(`Processed file_id: ${fileId}, filename: ${fileNameToUse}`);
            } catch (err) {
              Logger.log(`Error processing file_id ${fileId}: ${err.message}`);
            }
          } else if (fileId) {
            Logger.log(`file_id already processed: ${fileId}`);
          }
        });
      } else {
        // No files attached, check previous row or skip image upload
        try {
          let fileId = "N/A";
          let rawUrl = "N/A";
          const fileNameToUse = filenameFromPhotoURL || "N/A";

          // Check previous row for file
          if (index > 0) {
            const prevRow = dataRange[index - 1];
            const prevContributionMade = prevRow[6];
            const prevFileIdsString = prevRow[14];
            const prevFileIds = prevFileIdsString ? prevFileIdsString.split(',').map(id => id.trim()) : [];

            if (!prevContributionMade && prevFileIds.length > 0) {
              const prevFileId = prevFileIds[0];
              if (prevFileId && !processedFileIds.includes(prevFileId)) {
                try {
                  fileId = prevFileId;
                  const fileUrl = getTelegramFileUrl(creds.TELEGRAM_API_TOKEN, fileId);
                  const imageBlob = UrlFetchApp.fetch(fileUrl).getBlob();
                  rawUrl = uploadToGitHub(creds.GITHUB_API_TOKEN, imageBlob, fileNameToUse);
                  Logger.log(`Associated file_id from previous row: ${fileId}, filename: ${fileNameToUse}`);
                } catch (err) {
                  Logger.log(`Error processing file_id from previous row ${prevFileId}: ${err.message}`);
                }
              } else if (prevFileId) {
                Logger.log(`file_id from previous row already processed: ${prevFileId}`);
              }
            }
          }

          sunMintTab.appendRow([
            row[0], // A
            row[1], // B
            row[2], // C
            row[3], // D
            row[4], // E
            contributionMade, // F
            row[11], // G
            fileId, // H
            photoUrl, // I
            contributorName, // J
            latitude, // K
            longitude, // L
            "NEW", // M
            species, // N
            rawUrl // O
          ]);

          const treePlantingRowNumber = sunMintTab.getLastRow();
          sendTreePlantingNotification([
            row[0], row[1], row[2], row[3], row[4], contributionMade, row[11], fileId,
            photoUrl, contributorName, latitude, longitude, "NEW", species, rawUrl
          ], treePlantingRowNumber);

          Logger.log(`Processed record without file attachment: ${fileId}, filename: ${fileNameToUse}`);
        } catch (err) {
          Logger.log(`Error processing record without file attachment: ${err.message}`);
        }
      }
    }
  });
}
