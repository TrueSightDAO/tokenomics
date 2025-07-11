// Load API keys and configuration settings from Credentials.gs
// - setApiKeys(): Stores sensitive API keys in Google Apps Script’s Script Properties for security.
// - getCredentials(): Retrieves all configuration details (API keys, Sheet ID) as an object.
// - These steps ensure keys and settings are centralized and not hardcoded here.
setApiKeys();
const creds = getCredentials();

// Tab names in the Google Sheet
const telegramLogTabName = "Telegram Chat Logs";
const sunMintTabName = "SunMint Tree Planting";
const contributorsSheetId = "1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU";
const contributorsTabName = "Contributors Digital Signatures";

// Function to process file_ids from Telegram Chat Logs and upload to SunMint Tree Planting tab
function processFileIdsToGitHub() {
  var sheet = SpreadsheetApp.openById(creds.SHEET_ID);
  var telegramLogTab = sheet.getSheetByName(telegramLogTabName);
  var sunMintTab = sheet.getSheetByName(sunMintTabName);
  var contributorsSheet = SpreadsheetApp.openById(contributorsSheetId);
  var contributorsTab = contributorsSheet.getSheetByName(contributorsTabName);

  // Create SunMint Tree Planting tab if it doesn't exist
  if (!sunMintTab) {
    sunMintTab = sheet.insertSheet(sunMintTabName);
    sunMintTab.getRange("A1:L1").setValues([[
      "Telegram Update ID", 
      "Chatroom ID", 
      "Chatroom Name", 
      "Message ID", 
      "Contributor Handle", 
      "Contribution Made", 
      "Status Date", 
      "File ID", 
      "GitHub Raw URL", 
      "Contributor Name", 
      "Latitude", 
      "Longitude"
    ]]);
  }

  // Get processed file_ids from SunMint Tree Planting tab
  var processedFileIds = getProcessedFileIds(sunMintTab);

  // Get data from Telegram Chat Logs (Columns A to O)
  var lastRow = telegramLogTab.getLastRow();
  if (lastRow < 2) {
    Logger.log("No data in Telegram Chat Logs tab");
    return;
  }
  var dataRange = telegramLogTab.getRange(2, 1, lastRow - 1, 15).getValues();

  // Get contributor signatures from Contributors Digital Signatures tab
  var contributorsLastRow = contributorsTab.getLastRow();
  var contributorsData = contributorsLastRow > 1 ? contributorsTab.getRange(2, 1, contributorsLastRow - 1, 5).getValues() : [];

  // Process each row in Telegram Chat Logs
  dataRange.forEach(function(row, index) {
    var contributionMade = row[6]; // Column G
    var fileIdsString = row[14]; // Column O

    // Only process [TREE PLANTING EVENT] records
    if (contributionMade && contributionMade.startsWith("[TREE PLANTING EVENT]")) {
      var fileIds = fileIdsString ? fileIdsString.split(',').map(function(id) { return id.trim(); }) : [];
      fileIds.forEach(function(fileId) {
        if (fileId && !processedFileIds.includes(fileId)) {
          try {
            // Get file URL from Telegram
            var fileUrl = getTelegramFileUrl(creds.TELEGRAM_API_TOKEN, fileId);
            // Download image
            var imageBlob = UrlFetchApp.fetch(fileUrl).getBlob();
            // Upload to GitHub and get raw URL
            var rawUrl = uploadToGitHub(creds.GITHUB_API_TOKEN, imageBlob, fileId);

            // Extract latitude and longitude from contribution_made
            var lines = contributionMade.split('\n');
            var latitude = lines.find(line => line.startsWith('- Latitude: '))?.replace('- Latitude: ', '') || 'N/A';
            var longitude = lines.find(line => line.startsWith('- Longitude: '))?.replace('- Longitude: ', '') || 'N/A';

            // Extract public signature from contribution_made
            var publicSignatureMatch = contributionMade.match(/My Digital Signature: ([^\n]+)/);
            var publicSignature = publicSignatureMatch ? publicSignatureMatch[1].trim() : 'N/A';

            // Match public signature to contributor name
            var contributorName = 'Unknown';
            contributorsData.forEach(function(contributorRow) {
              if (contributorRow[4] === publicSignature) { // Column E in Contributors Digital Signatures
                contributorName = contributorRow[0]; // Column A
              }
            });

            // Append to SunMint Tree Planting tab
            sunMintTab.appendRow([
              row[0], // Column A: telegram_update_id
              row[1], // Column B: telegram_chatroom_id
              row[2], // Column C: telegram_chatroom_name
              row[3], // Column D: telegram_message_id
              row[4], // Column E: contributor_name (handle)
              contributionMade, // Column F: contribution_made
              row[11], // Column G: status_date
              fileId, // Column H: file_id
              rawUrl, // Column I: GitHub raw URL
              contributorName, // Column J: contributor name from Contributors Digital Signatures
              latitude, // Column K: extracted latitude
              longitude, // Column L: extracted longitude
              "NEW"
            ]);
            Logger.log(`Processed file_id: ${fileId}, GitHub URL: ${rawUrl}, Latitude: ${latitude}, Longitude: ${longitude}`);
          } catch (err) {
            Logger.log(`Error processing file_id ${fileId}: ${err.message}`);
          }
        } else if (fileId) {
          Logger.log(`file_id already processed: ${fileId}`);
        }
      });
    }
  });
}

// Get list of already processed file_ids from SunMint Tree Planting tab
function getProcessedFileIds(sunMintTab) {
  var lastRow = sunMintTab.getLastRow();
  if (lastRow < 2) return [];
  var fileIds = sunMintTab.getRange(2, 8, lastRow - 1, 1).getValues().flat(); // Column H
  return fileIds.filter(function(id) { return id !== ""; });
}

// Get Telegram file URL using file_id
function getTelegramFileUrl(token, fileId) {
  var getFileUrl = `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`;
  var response = UrlFetchApp.fetch(getFileUrl);
  var fileData = JSON.parse(response.getContentText());
  if (!fileData.ok) throw new Error("Failed to get file path: " + fileData.description);
  var filePath = fileData.result.file_path;
  return `https://api.telegram.org/file/bot${token}/${filePath}`;
}

// Upload image to GitHub and return raw URL
function uploadToGitHub(token, imageBlob, fileId) {
  var repo = "TrueSightDAO/sunmint";
  var path = `images/${fileId}.jpg`; // Use file_id as filename to ensure uniqueness
  var apiUrl = `https://api.github.com/repos/${repo}/contents/${path}`;
  var base64Content = Utilities.base64Encode(imageBlob.getBytes());
  
  var payload = {
    message: `Upload image ${fileId}.jpg`,
    content: base64Content
  };

  var options = {
    method: "PUT",
    headers: {
      "Authorization": `token ${token}`,
      "Accept": "application/vnd.github.v3+json"
    },
    contentType: "application/json",
    payload: JSON.stringify(payload)
  };

  var response = UrlFetchApp.fetch(apiUrl, options);
  var responseData = JSON.parse(response.getContentText());
  if (!responseData.content) throw new Error("Failed to upload to GitHub: " + response.getContentText());
  
  // Return raw URL
  return `https://raw.githubusercontent.com/${repo}/main/${path}`;
}