// Load API keys and configuration settings from Credentials.gs
// - setApiKeys(): Stores sensitive API keys in Google Apps Script’s Script Properties for security.
// - getCredentials(): Retrieves all configuration details (API keys, Sheet ID) as an object.
// - These steps ensure keys and settings are centralized and not hardcoded here.
setApiKeys();
const creds = getCredentials();

// Tab names in the Google Sheet
const telegramLogTabName = "Telegram Chat Logs";
const notarizationsTabName = "Document Notarizations";
const contributorsSheetId = "1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU";
const contributorsTabName = "Contributors Digital Signatures";

// Function to process file_ids from Telegram Chat Logs and upload to Document Notarizations tab
function processTelegramLogs() {
  var sheet = SpreadsheetApp.openById(creds.SHEET_ID);
  var telegramLogTab = sheet.getSheetByName(telegramLogTabName);
  var notarizationsTab = sheet.getSheetByName(notarizationsTabName);
  var contributorsSheet = SpreadsheetApp.openById(contributorsSheetId);
  var contributorsTab = contributorsSheet.getSheetByName(contributorsTabName);

  // Create Document Notarizations tab if it doesn't exist
  if (!notarizationsTab) {
    notarizationsTab = sheet.insertSheet(notarizationsTabName);
    notarizationsTab.getRange("A1:N1").setValues([[
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
      "Longitude",
      "Document Type",
      "GitHub Commit Hash URL",
      "Status"
    ]]);
  }

  // Get processed file_ids from Document Notarizations tab
  var processedFileIds = getProcessedFileIds(notarizationsTab);

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

    // Only process [NOTARIZATION EVENT] records
    if (contributionMade && contributionMade.startsWith("[NOTARIZATION EVENT]")) {
      Logger.log(contributionMade);

      // Extract fields from contribution_made
      var lines = contributionMade.split('\n');
      var latitude = lines.find(line => line.startsWith('- Latitude: '))?.replace('- Latitude: ', '') || 'N/A';
      var longitude = lines.find(line => line.startsWith('- Longitude: '))?.replace('- Longitude: ', '') || 'N/A';
      var documentType = lines.find(line => line.startsWith('- Document Type: '))?.replace('- Document Type: ', '') || 'N/A';
      var attachedFilename = lines.find(line => line.startsWith('- Attached Filename: '))?.replace('- Attached Filename: ', '') || 'N/A';
      var destinationNotarizedFile = lines.find(line => line.startsWith('- Destination Notarized File Location: '))?.replace('- Destination Notarized File Location: ', '') || 'N/A';
      
      // Extract notarized file name from destination URL
      var notarizedFileName = destinationNotarizedFile.split('/').pop() || attachedFilename;

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

      // Handle records with file attachments
      var fileIds = fileIdsString ? fileIdsString.split(',').map(function(id) { return id.trim(); }) : [];
      if (fileIds.length > 0) {
        fileIds.forEach(function(fileId) {
          if (fileId && !processedFileIds.includes(fileId)) {
            try {
              // Get file URL from Telegram
              var fileUrl = getTelegramFileUrl(creds.TELEGRAM_API_TOKEN, fileId);
              // Download file
              var fileBlob = UrlFetchApp.fetch(fileUrl).getBlob();
              // Check if file exists on GitHub; upload if it doesn't
              var uploadResult = uploadToGitHub(creds.GITHUB_API_TOKEN, fileBlob, notarizedFileName, contributionMade);

              // Append to Document Notarizations tab
              notarizationsTab.appendRow([
                row[0], // Column A: telegram_update_id
                row[1], // Column B: telegram_chatroom_id
                row[2], // Column C: telegram_chatroom_name
                row[3], // Column D: telegram_message_id
                row[4], // Column E: contributor_name (handle)
                contributionMade, // Column F: contribution_made
                row[11], // Column G: status_date
                fileId, // Column H: file_id
                uploadResult.rawUrl, // Column I: GitHub raw URL
                contributorName, // Column J: contributor name from Contributors Digital Signatures
                latitude, // Column K: extracted latitude
                longitude, // Column L: extracted longitude
                documentType, // Column M: document type
                uploadResult.commitUrl, // Column N: GitHub commit hash URL
                "NEW" // Column O: Status
              ]);
              Logger.log(`Processed file_id: ${fileId}, GitHub Raw URL: ${uploadResult.rawUrl}, Commit URL: ${uploadResult.commitUrl}, Latitude: ${latitude}, Longitude: ${longitude}, Document Type: ${documentType}`);
            } catch (err) {
              Logger.log(`Error processing file_id ${fileId}: ${err.message}`);
            }
          } else if (fileId) {
            Logger.log(`file_id already processed: ${fileId}`);
          }
        });
      } else {
        // Handle records without file attachments
        try {
          var fileId = "N/A";
          var rawUrl = "N/A";
          var commitUrl = "N/A";

          // Check the preceding row for a potential file
          if (index > 0) {
            var prevRow = dataRange[index - 1];
            var prevContributionMade = prevRow[6]; // Column G of previous row
            var prevFileIdsString = prevRow[14]; // Column O of previous row
            var prevFileIds = prevFileIdsString ? prevFileIdsString.split(',').map(function(id) { return id.trim(); }) : [];

            if (!prevContributionMade && prevFileIds.length > 0) {
              // Previous row has no contribution_made and has file_ids
              var prevFileId = prevFileIds[0]; // Take the first file_id
              if (prevFileId && !processedFileIds.includes(prevFileId)) {
                try {
                  // Get file URL from Telegram
                  var fileUrl = getTelegramFileUrl(creds.TELEGRAM_API_TOKEN, prevFileId);
                  // Download file
                  var fileBlob = UrlFetchApp.fetch(fileUrl).getBlob();
                  // Check if file exists on GitHub; upload if it doesn't
                  var uploadResult = uploadToGitHub(creds.GITHUB_API_TOKEN, fileBlob, notarizedFileName, contributionMade);
                  fileId = prevFileId;
                  rawUrl = uploadResult.rawUrl;
                  commitUrl = uploadResult.commitUrl;
                  Logger.log(`Associated file_id from previous row: ${fileId}, GitHub Raw URL: ${rawUrl}, Commit URL: ${commitUrl}`);
                } catch (err) {
                  Logger.log(`Error processing file_id from previous row ${prevFileId}: ${err.message}`);
                  // Continue with N/A values if file processing fails
                }
              } else if (prevFileId) {
                Logger.log(`file_id from previous row already processed: ${prevFileId}`);
              }
            }
          }

          // Append to Document Notarizations tab
          notarizationsTab.appendRow([
            row[0], // Column A: telegram_update_id
            row[1], // Column B: telegram_chatroom_id
            row[2], // Column C: telegram_chatroom_name
            row[3], // Column D: telegram_message_id
            row[4], // Column E: contributor_name (handle)
            contributionMade, // Column F: contribution_made
            row[11], // Column G: status_date
            fileId, // Column H: file_id (from previous row or "N/A")
            rawUrl, // Column I: GitHub raw URL (from previous row or "N/A")
            contributorName, // Column J: contributor name from Contributors Digital Signatures
            latitude, // Column K: extracted latitude
            longitude, // Column L: extracted longitude
            documentType, // Column M: document type
            commitUrl, // Column N: GitHub commit hash URL
            "NEW" // Column O: Status
          ]);
          Logger.log(`Processed record: File ID: ${fileId}, GitHub Raw URL: ${rawUrl}, Commit URL: ${commitUrl}, Latitude: ${latitude}, Longitude: ${longitude}, Document Type: ${documentType}`);
        } catch (err) {
          Logger.log(`Error processing record without file attachment: ${err.message}`);
        }
      }
    }
  });
}

// Get list of already processed file_ids from Document Notarizations tab
function getProcessedFileIds(notarizationsTab) {
  var lastRow = notarizationsTab.getLastRow();
  if (lastRow < 2) return [];
  var fileIds = notarizationsTab.getRange(2, 8, lastRow - 1, 1).getValues().flat(); // Column H
  return fileIds.filter(function(id) { return id !== "" && id !== "N/A"); });
}

// Check if file exists on GitHub
function checkGitHubFileExists(token, fileName) {
  var repo = "TrueSightDAO/notarizations";
  var apiUrl = `https://api.github.com/repos/${repo}/contents/${fileName}`;
  
  var options = {
    method: "GET",
    headers: {
      "Authorization": `token ${token}`,
      "Accept": "application/vnd.github.v3+json"
    },
    muteHttpExceptions: true // Prevent throwing errors for 404
  };

  var response = UrlFetchApp.fetch(apiUrl, options);
  var status = response.getResponseCode();

  if (status === 200) {
    var responseData = JSON.parse(response.getContentText());
    Logger.log(`File exists on GitHub: ${fileName}`);
    return `https://raw.githubusercontent.com/${repo}/main/${fileName}`;
  } else if (status === 404) {
    Logger.log(`File does not exist on GitHub: ${fileName}`);
    return null;
  } else {
    throw new Error(`Failed to check GitHub file: ${response.getContentText()}`);
  }
}

// Upload file to GitHub and return raw URL and commit hash URL
function uploadToGitHub(token, fileBlob, fileName, telegramMessage) {
  // Check if file already exists
  var existingUrl = checkGitHubFileExists(token, fileName);
  if (existingUrl) {
    return { rawUrl: existingUrl, commitUrl: "N/A" }; // Return existing URL, no new commit
  }

  var repo = "TrueSightDAO/notarizations";
  var apiUrl = `https://api.github.com/repos/${repo}/contents/${fileName}`;
  var base64Content = Utilities.base64Encode(fileBlob.getBytes());
  
  var payload = {
    message: `Upload notarized document: ${fileName}\n\nTelegram Message:\n${telegramMessage}`,
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
  
  // Get commit hash URL
  var commitUrl = responseData.commit ? responseData.commit.html_url : "N/A";
  
  // Return raw URL and commit URL
  return {
    rawUrl: `https://raw.githubusercontent.com/${repo}/main/${fileName}`,
    commitUrl: commitUrl
  };
}