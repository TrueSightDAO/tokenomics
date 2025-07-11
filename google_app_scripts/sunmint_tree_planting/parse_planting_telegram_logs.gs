// Load API keys and configuration settings from Credentials.gs
// - setApiKeys(): Stores sensitive API keys in Google Apps Script’s Script Properties for security.
// - getCredentials(): Retrieves all configuration details (API keys, Sheet ID) as an object.
// - These steps ensure keys and settings are centralized and not hardcoded here.
setApiKeys();
const creds = getCredentials();

// Tab names in the Google Sheet
const telegramLogTabName = "Telegram Chat Logs";
const sunMintTabName = "SunMint Tree Planting";

// Function to process file_ids from Telegram Chat Logs and upload to GitHub
function processFileIdsToGitHub() {
  var sheet = SpreadsheetApp.openById(creds.SHEET_ID);
  var telegramLogTab = sheet.getSheetByName(telegramLogTabName);
  var sunMintTab = sheet.getSheetByName(sunMintTabName);

  // Create SunMint Tree Planting tab if it doesn't exist
  if (!sunMintTab) {
    sunMintTab = sheet.insertSheet(sunMintTabName);
    sunMintTab.getRange("A1:B1").setValues([["Telegram File ID", "GitHub Raw URL"]]);
  }

  // Get file_ids from Column O (15th column)
  var lastRow = telegramLogTab.getLastRow();
  if (lastRow < 2) {
    Logger.log("No data in Telegram Chat Logs tab");
    return;
  }
  var fileIdsRange = telegramLogTab.getRange(2, 15, lastRow - 1, 1).getValues();
  var processedFileIds = getProcessedFileIds(sunMintTab);

  // Process each row in Column O
  fileIdsRange.forEach(function(row, index) {
    var fileIdsString = row[0];
    if (fileIdsString) {
      var fileIds = fileIdsString.split(',').map(function(id) { return id.trim(); });
      fileIds.forEach(function(fileId) {
        if (!processedFileIds.includes(fileId)) {
          try {
            // Get file URL from Telegram
            var fileUrl = getTelegramFileUrl(creds.TELEGRAM_TOKEN, fileId);
            // Download image
            var imageBlob = UrlFetchApp.fetch(fileUrl).getBlob();
            // Upload to GitHub and get raw URL
            var rawUrl = uploadToGitHub(creds.GITHUB_API_TOKEN, imageBlob, fileId);
            // Append to SunMint Tree Planting tab
            sunMintTab.appendRow([fileId, rawUrl]);
            Logger.log("Processed file_id: " + fileId + ", GitHub URL: " + rawUrl);
          } catch (err) {
            Logger.log("Error processing file_id " + fileId + ": " + err.message);
          }
        } else {
          Logger.log("file_id already processed: " + fileId);
        }
      });
    }
  });
}

// Get list of already processed file_ids from SunMint Tree Planting tab
function getProcessedFileIds(sunMintTab) {
  var lastRow = sunMintTab.getLastRow();
  if (lastRow < 2) return [];
  var fileIds = sunMintTab.getRange(2, 1, lastRow - 1, 1).getValues().flat();
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