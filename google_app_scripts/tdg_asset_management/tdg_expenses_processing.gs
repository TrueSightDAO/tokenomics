// Load API keys and configuration settings
setApiKeys();
const creds = getCredentials();

// Deployment URL: https://script.google.com/macros/s/AKfycbwYBlFigSSPJKkI-F2T3dSsdLnvvBi2SCGF1z2y1k95YzA5HBrJVyMo6InTA9Fud2bOEw/exec

// Configuration Variables
const SOURCE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit?gid=0#gid=0';
const SOURCE_SHEET_NAME = 'Telegram Chat Logs';
const SCORED_EXPENSE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit?gid=0#gid=0';;
const SCORED_EXPENSE_SHEET_NAME = 'Scored Expense Submissions';

// Sandbox
// const OFFCHAIN_TRANSACTIONS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1F90Sq6jSfj8io0RmiUwdydzuWXOZA9siXHWDsj9ItTo/edit?usp=drive_web&ouid=115975718038592349436';

// Production
const OFFCHAIN_TRANSACTIONS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=0';

const OFFCHAIN_TRANSACTIONS_SHEET_NAME = 'offchain transactions';
const CONTRIBUTORS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=1460794618#gid=1460794618';
const CONTRIBUTORS_SHEET_NAME = 'Contributors contact information';
const SHIPMENT_LEDGER_SHEET_NAME = 'Shipment Ledger Listing';
const TELEGRAM_CHAT_ID = '-1002190388985'; // Fixed chat ID from reference code
const MAX_REDIRECTS = 10; // Maximum number of redirects to follow
const WIX_ACCESS_TOKEN = creds.WIX_API_KEY; // Wix API key for fetching ledger configurations (deprecated, kept for backward compatibility)

// Column indices for source sheet (Telegram Chat Logs)
const TELEGRAM_UPDATE_ID_COL = 0; // Column A
const CHAT_ID_COL = 1; // Column B (Telegram Chat ID)
const CHAT_NAME_COL = 2; // Column C (Telegram Chatroom Name)
const TELEGRAM_MESSAGE_ID_COL = 3; // Column D
const CONTRIBUTOR_NAME_COL = 4; // Column E (Reporter Name)
const MESSAGE_COL = 6; // Column G (Expense Reported)
const SALES_DATE_COL = 11; // Column L (Status Date)
const HASH_KEY_COL = 13; // Column N (Scoring Hash Key)
const TELEGRAM_FILE_ID_COL = 14; // Column O (Telegram File ID)

// Column indices for Scored Expense Submissions sheet
const DEST_UPDATE_ID_COL = 0; // Column A
const DEST_CHAT_ID_COL = 1; // Column B
const DEST_CHAT_NAME_COL = 2; // Column C
const DEST_MESSAGE_ID_COL = 3; // Column D
const DEST_REPORTER_NAME_COL = 4; // Column E
const DEST_EXPENSE_REPORTED_COL = 5; // Column F
const DEST_STATUS_DATE_COL = 6; // Column G
const DEST_CONTRIBUTOR_NAME = 7; // Column H
const DEST_CURRENCY = 8; // Column I
const DEST_AMOUNT = 9; // Column J
const DEST_HASH_KEY_COL = 10; // Column K
const DEST_TRANSACTION_LINE_COL = 11; // Column L

// Column indices for Contributors sheet
const TELEGRAM_HANDLE_COL_CONTRIBUTORS = 7; // Column H (Telegram Handle)

// Column indices for offchain transactions sheet
const TRANSACTION_STATUS_DATE_COL = 0; // Column A
const TRANSACTION_DESCRIPTION_COL = 1; // Column B
const TRANSACTION_FUND_HANDLER_COL = 2; // Column C
const TRANSACTION_AMOUNT_COL = 3; // Column D
const TRANSACTION_INVENTORY_TYPE_COL = 4; // Column E

// Function to generate a SHA-256 hash key
function generateHashKey(messageId, daoMemberName, salesDate) {
  try {
    const input = `${messageId}-${daoMemberName}-${salesDate}`;
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input);
    // Convert byte array to hex string
    const hash = digest.map(byte => {
      const hex = (byte & 0xFF).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('');
    return hash.substring(0, 16);
  } catch (e) {
    Logger.log(`Error generating hash key: ${e.message}`);
    return '';
  }
}

/**
 * Resolves redirect URLs to get the final URL.
 * @param {string} url - The URL to resolve.
 * @return {string} The resolved URL or empty string on error.
 */
function resolveRedirect(url) {
  try {
    let currentUrl = url;
    let redirectCount = 0;

    while (redirectCount < MAX_REDIRECTS) {
      const response = UrlFetchApp.fetch(currentUrl, {
        followRedirects: false,
        muteHttpExceptions: true
      });
      const responseCode = response.getResponseCode();

      // If not a redirect (2xx or other), return the current URL
      if (responseCode < 300 || responseCode >= 400) {
        return currentUrl;
      }

      // Get the Location header for the redirect
      const headers = response.getHeaders();
      const location = headers['Location'] || headers['location'];
      if (!location) {
        Logger.log(`No Location header for redirect at ${currentUrl}`);
        return '';
      }

      // Update the current URL and increment redirect count
      currentUrl = location;
      redirectCount++;
    }

    Logger.log(`Exceeded maximum redirects (${MAX_REDIRECTS}) for URL ${url}`);
    return '';
  } catch (e) {
    Logger.log(`Error resolving redirect for URL ${url}: ${e.message}`);
    return '';
  }
}

/**
 * Fetches ledger configurations from WIX AgroverseShipments data collection.
 * @return {Array} Array of ledger configuration objects with ledger_name, ledger_url, and sheet_name.
 */
function getLedgerConfigsFromWix() {
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': WIX_ACCESS_TOKEN,
      'wix-account-id': '0e2cde5f-b353-468b-9f4e-36835fc60a0e',
      'wix-site-id': 'd45a189f-d0cc-48de-95ee-30635a95385f'
    },
    payload: JSON.stringify({})
  };
  const request_url = 'https://www.wixapis.com/wix-data/v2/items/query?dataCollectionId=AgroverseShipments';

  try {
    const response = UrlFetchApp.fetch(request_url, options);
    const content = response.getContentText();
    const response_obj = JSON.parse(content);

    // Construct LEDGER_CONFIGS dynamically using title from WIX data
    const ledgerConfigs = response_obj.dataItems
      .filter(item => item.data.contract_url && item.data.contract_url !== '')
      .map(item => {
        const resolvedUrl = resolveRedirect(item.data.contract_url);
        return {
          ledger_name: item.data.title,
          ledger_url: resolvedUrl,
          sheet_name: 'Transactions', // Managed AGL ledgers use "Transactions" sheet
          is_managed_ledger: true
        };
      });

    Logger.log('Ledger configs fetched from Wix: ' + JSON.stringify(ledgerConfigs));
    return ledgerConfigs;
  } catch (e) {
    Logger.log('Error fetching ledger URLs from Wix: ' + e.message);
    return [];
  }
}

/**
 * Finds contributor name by digital signature from Contributors Digital Signatures sheet
 * @param {string} digitalSignature - The digital signature to lookup
 * @return {Object} { contributorName: string | null, error: string | null }
 */
function findContributorByDigitalSignature(digitalSignature) {
  try {
    if (!digitalSignature) {
      return { contributorName: null, error: 'No digital signature provided' };
    }
    
    Logger.log(`Looking up contributor for signature: ${digitalSignature.substring(0, 50)}...`);
    
    const contributorsSpreadsheet = SpreadsheetApp.openByUrl(CONTRIBUTORS_SHEET_URL);
    const digitalSignaturesSheet = contributorsSpreadsheet.getSheetByName('Contributors Digital Signatures');
    
    if (!digitalSignaturesSheet) {
      return { contributorName: null, error: 'Contributors Digital Signatures sheet not found' };
    }
    
    const signatureData = digitalSignaturesSheet.getDataRange().getValues();
    
    // Skip header row, search through data
    for (let i = 1; i < signatureData.length; i++) {
      const contributorName = signatureData[i][0]; // Column A
      const signature = signatureData[i][4]; // Column E (Contributors Digital Signatures)
      const status = signatureData[i][3]; // Column D (Status)
      
      if (signature && signature.trim() === digitalSignature.trim()) {
        Logger.log(`Found contributor: ${contributorName} for signature`);
        
        // Check if status is ACTIVE
        if (status === 'ACTIVE') {
          return { contributorName: contributorName, error: null };
        } else {
          return { 
            contributorName: null, 
            error: `Signature found for ${contributorName} but status is ${status}, not ACTIVE` 
          };
        }
      }
    }
    
    Logger.log(`No active contributor found for signature: ${digitalSignature.substring(0, 50)}...`);
    return { contributorName: null, error: 'No matching active digital signature found' };
    
  } catch (e) {
    Logger.log(`Error looking up contributor by digital signature: ${e.message}`);
    return { contributorName: null, error: e.message };
  }
}

// Function to check if reporterName exists in Contributors sheet Column H
function ReporterExist(reporterName) {
  try {
    const contributorsSpreadsheet = SpreadsheetApp.openByUrl(CONTRIBUTORS_SHEET_URL);
    const contributorsSheet = contributorsSpreadsheet.getSheetByName(CONTRIBUTORS_SHEET_NAME);
    const contributorsData = contributorsSheet.getDataRange().getValues();
    
    const normalizedReporterName = reporterName.toLowerCase().replace(/^@/, '');
    
    for (let i = 1; i < contributorsData.length; i++) {
      const telegramHandle = contributorsData[i][TELEGRAM_HANDLE_COL_CONTRIBUTORS];
      if (telegramHandle) {
        const normalizedHandle = telegramHandle.toLowerCase().replace(/^@/, '');
        Logger.log(normalizedHandle + " versus " + normalizedReporterName);
        if (normalizedHandle === normalizedReporterName) {
          return true;
        }
      }
    }
    Logger.log(`Invalid contributor: ${reporterName} not found in Contributors sheet Column H`);
    return false;
  } catch (e) {
    Logger.log(`Error accessing Contributors sheet for validation: ${e.message}`);
    return false;
  }
}

function extractExpenseDetails(message) {
  // Normalize line endings and trim leading/trailing whitespace
  message = message.replace(/\r\n/g, '\n').trim();
  
  // Updated regex with more flexible whitespace handling and trailing content
  const pattern = /\[DAO Inventory Expense Event\]\n\s*- DAO Member Name:\s*(.*?)\n\s*- (?:Latitude:\s*(.*?)\n\s*- Longitude:\s*(.*?)\n\s*- )?Inventory Type:\s*(.*?)\n\s*- Inventory Quantity:\s*(\d+\.?\d*)\n\s*- Description:\s*(.*?)(?:\n\s*- Attached Filename:\s*(.*?))?(?:\n\s*- Destination Expense File Location:\s*(.*?))?(?:\n\s*- Submission Source:\s*(.*?))?(?:(?:\n\s*-+\s*\n\s*My Digital Signature:.*?(?:\n\s*Request Transaction ID:.*?)?)?(?:\n\s*This submission was generated using.*?(?:\n\s*Verify submission here:.*?)?)?)?$/i;
  
  const match = message.match(pattern);
  if (!match) {
    Logger.log(`Regex failed to match message: ${message}`);
    // Log partial matches for debugging
    const partialPattern = /\[DAO Inventory Expense Event\].*?(?=\n\s*-|$)/i;
    Logger.log(`Partial match: ${JSON.stringify(message.match(partialPattern))}`);
    return null;
  }
  
  // Extract digital signature if present
  let digitalSignature = null;
  const sigPattern = /My Digital Signature:\s*([\s\S]*?)(?:\n\s*Request Transaction ID:|This submission was generated using|$)/i;
  const sigMatch = message.match(sigPattern);
  if (sigMatch) {
    digitalSignature = sigMatch[1].trim();
  }
  
  return {
    daoMemberName: match[1].trim(),
    latitude: match[2] ? match[2].trim() : null,
    longitude: match[3] ? match[3].trim() : null,
    inventoryType: match[4].trim(),
    quantity: parseFloat(match[5]),
    description: match[6].trim(),
    attachedFilename: match[7] ? match[7].trim() : null,
    destinationFileLocation: match[8] ? match[8].trim() : null,
    submissionSource: match[9] ? match[9].trim() : null,
    digitalSignature: digitalSignature
  };
}

// Function to generate a unique GitHub filename with a running number
function generateUniqueGitHubFilename(originalUrl, index) {
  try {
    // Parse the original URL to extract path components
    const urlPattern = /github\.com\/([^\/]+)\/([^\/]+)\/tree\/([^\/]+)\/(.+?)(\.[^.]+)$/i;
    const match = originalUrl.match(urlPattern);
    if (!match) {
      Logger.log(`Invalid GitHub URL format for generating unique filename: ${originalUrl}`);
      return null;
    }

    const [, owner, repo, branch, pathWithoutExtension, extension] = match;
    // Generate new filename with running number
    const newPath = `${pathWithoutExtension}_${index}${extension}`;
    const newUrl = `https://github.com/${owner}/${repo}/tree/${branch}/${newPath}`;
    return newUrl;
  } catch (e) {
    Logger.log(`Error generating unique GitHub filename: ${e.message}`);
    return null;
  }
}

// Function to check Telegram file ID and get from current or previous row
function getTelegramFileId(sourceSheet, currentRowIndex, sourceData) {
  try {
    // Check current row's Column O
    let fileIds = sourceData[currentRowIndex][TELEGRAM_FILE_ID_COL];
    if (fileIds && typeof fileIds === 'string') {
      // Split comma-separated file IDs and filter out empty values
      return fileIds.split(',').map(id => id.trim()).filter(id => id);
    }
    
    // If not found, check previous row
    if (currentRowIndex > 1) {
      fileIds = sourceData[currentRowIndex - 1][TELEGRAM_FILE_ID_COL];
      if (fileIds && typeof fileIds === 'string') {
        return fileIds.split(',').map(id => id.trim()).filter(id => id);
      }
    }
    
    return [];
  } catch (e) {
    Logger.log(`Error checking Telegram file ID: ${e.message}`);
    return [];
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

    // Get file content from Telegram
    const telegramApiUrl = `https://api.telegram.org/bot${creds.TELEGRAM_API_TOKEN}/getFile?file_id=${fileId}`;
    const fileResponse = UrlFetchApp.fetch(telegramApiUrl);
    const fileData = JSON.parse(fileResponse.getContentText());
    
    if (!fileData.ok) {
      Logger.log(`Failed to get file info from Telegram: ${fileData.description}`);
      return false;
    }

    const filePath = fileData.result.file_path;
    const fileContentResponse = UrlFetchApp.fetch(`https://api.telegram.org/file/bot${creds.TELEGRAM_API_TOKEN}/${filePath}`);
    const fileContent = Utilities.base64Encode(fileContentResponse.getBlob().getBytes());

    // Parse GitHub URL to get repo details
    const urlPattern = /github\.com\/([^\/]+)\/([^\/]+)\/tree\/([^\/]+)\/(.+)/i;
    const match = destinationUrl.match(urlPattern);
    if (!match) {
      Logger.log(`Invalid GitHub URL format: ${destinationUrl}`);
      return false;
    }

    const [, owner, repo, branch, path] = match;
    
    // GitHub API request to create/update file
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
      Logger.log(`Successfully uploaded file to GitHub: ${destinationUrl}`);
      return true;
    } else {
      Logger.log(`Failed to upload file to GitHub. Status: ${status}, Response: ${response.getContentText()}`);
      return false;
    }
  } catch (e) {
    Logger.log(`Error uploading file to GitHub: ${e.message}`);
    return false;
  }
}

// Function to insert records into offchain transactions sheet or resolved ledger
function InsertExpenseRecords(scoredRow, rowIndex) {
  try {
    const expenseDetails = extractExpenseDetails(scoredRow[DEST_EXPENSE_REPORTED_COL]);
    if (!expenseDetails) {
      Logger.log(`Failed to extract expense details for row ${rowIndex + 1}`);
      return null;
    }

    // Check if inventoryType has ledger name encoded in format [ledger name] inventoryType
    let targetSpreadsheetUrl = OFFCHAIN_TRANSACTIONS_SHEET_URL;
    let targetSheetName = OFFCHAIN_TRANSACTIONS_SHEET_NAME;
    let cleanInventoryType = expenseDetails.inventoryType;
    let isManagedLedger = false;
    
    const ledgerMatch = expenseDetails.inventoryType.match(/^\[([^\]]+)\]\s*(.+)$/);
    if (ledgerMatch) {
      const ledgerName = ledgerMatch[1];
      cleanInventoryType = ledgerMatch[2]; // Extract the actual inventory type without the ledger prefix
      
      Logger.log(`Ledger name detected in inventory type: ${ledgerName}`);
      
      // Get ledger configs from Wix
      const ledgerConfigs = getLedgerConfigsFromWix();
      const ledgerConfig = ledgerConfigs.find(config => 
        config.ledger_name === ledgerName || 
        config.ledger_name.toLowerCase() === ledgerName.toLowerCase()
      );
      
      if (ledgerConfig && ledgerConfig.ledger_url) {
        targetSpreadsheetUrl = ledgerConfig.ledger_url;
        targetSheetName = ledgerConfig.sheet_name;
        isManagedLedger = ledgerConfig.is_managed_ledger || false;
        Logger.log(`Resolved ledger URL for ${ledgerName}: ${targetSpreadsheetUrl}, Sheet: ${targetSheetName}, Managed: ${isManagedLedger}`);
      } else {
        Logger.log(`Warning: Ledger ${ledgerName} not found in WIX data, using default offchain transactions sheet`);
      }
    }
    
    // Open the target spreadsheet and sheet
    const targetSpreadsheet = SpreadsheetApp.openByUrl(targetSpreadsheetUrl);
    const targetSheet = targetSpreadsheet.getSheetByName(targetSheetName);
    
    if (!targetSheet) {
      Logger.log(`Error: Sheet ${targetSheetName} not found in spreadsheet ${targetSpreadsheetUrl}`);
      return null;
    }

    // Prepare row data based on ledger type
    let rowToAppend;
    
    if (isManagedLedger) {
      // Managed AGL ledger structure (6 columns):
      // A: Date, B: Description, C: Entity, D: Amount, E: Type, F: Category
      rowToAppend = [
        scoredRow[DEST_STATUS_DATE_COL], // Column A: Date
        `${scoredRow[DEST_EXPENSE_REPORTED_COL]} reported by ${scoredRow[DEST_CHAT_NAME_COL]} \n\n\nAutomated processing by Edgar via script: https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_asset_management/tdg_expenses_processing.gs\n\nEdgar Scoring Hash Key: ${scoredRow[DEST_HASH_KEY_COL]}`, // Column B: Description
        expenseDetails.daoMemberName, // Column C: Entity (DAO Member)
        expenseDetails.quantity * -1, // Column D: Amount (negative for expense)
        cleanInventoryType, // Column E: Type (clean inventory type without ledger prefix)
        'Assets' // Column F: Category (Assets since we're reducing assets)
      ];
    } else {
      // Default offchain transactions structure (5 columns):
      // A: Date, B: Description, C: Fund Handler, D: Amount, E: Inventory Type
      rowToAppend = [
        scoredRow[DEST_STATUS_DATE_COL], // Column A: Date
        `${scoredRow[DEST_EXPENSE_REPORTED_COL]} reported by ${scoredRow[DEST_CHAT_NAME_COL]} \n\n\nAutomated processing by Edgar via script: https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_asset_management/tdg_expenses_processing.gs\n\nEdgar Scoring Hash Key: ${scoredRow[DEST_HASH_KEY_COL]}`, // Column B: Description
        expenseDetails.daoMemberName, // Column C: Fund Handler
        expenseDetails.quantity * -1, // Column D: Amount (negative for expense)
        cleanInventoryType // Column E: Inventory Type (clean inventory type without ledger prefix)
      ];
    }

    const lastRow = targetSheet.getLastRow();
    targetSheet.getRange(lastRow + 1, 1, 1, rowToAppend.length).setValues([rowToAppend]);
    Logger.log(`Inserted ${isManagedLedger ? 'managed ledger' : 'offchain'} expense record at row ${lastRow + 1} in ${targetSheetName} (${targetSpreadsheetUrl}) for hash key ${scoredRow[DEST_HASH_KEY_COL]}`);
    return lastRow + 1;
  } catch (e) {
    Logger.log(`Error inserting into transactions sheet: ${e.message}`);
    return null;
  }
}

// Function to send Telegram notification for expense submission
function sendExpenseNotification(rowData, scoredRowNumber, transactionRowNumber) {
  const token = creds.TELEGRAM_API_TOKEN;
  if (!token) {
    Logger.log(`sendExpenseNotification: Error: TELEGRAM_API_TOKEN not set in Credentials`);
    return;
  }

  const apiUrl = `https://api.telegram.org/bot${token}/sendMessage`;
  const outputSheetLink = `https://truesight.me/physical-transactions/expenses`;

  const messageText = `New DAO Inventory Expense Recorded\n\n` +
    `Scored Expense Submissions Row: ${scoredRowNumber}\n` +
    `Telegram Update ID: ${rowData[DEST_UPDATE_ID_COL]}\n` +
    `Chatroom ID: ${rowData[DEST_CHAT_ID_COL]}\n` +
    `Chatroom Name: ${rowData[DEST_CHAT_NAME_COL]}\n` +
    `Message ID: ${rowData[DEST_MESSAGE_ID_COL]}\n` +
    `Reporter Name: ${rowData[DEST_REPORTER_NAME_COL]}\n` +
    `Expense Reported:\n${rowData[DEST_EXPENSE_REPORTED_COL]}\n` +
    `Status Date: ${rowData[DEST_STATUS_DATE_COL]}\n` +
    `Contributor Name: ${rowData[DEST_CONTRIBUTOR_NAME]}\n` +
    `Currency: ${rowData[DEST_CURRENCY]}\n` +
    `Amount: ${rowData[DEST_AMOUNT]}\n` +
    `Hash Key: ${rowData[DEST_HASH_KEY_COL]}\n` +
    `Offchain Transaction Row: ${transactionRowNumber || 'Not recorded'}\n\n` +
    `Review here: ${outputSheetLink}`;

  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text: messageText
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    Logger.log(`sendExpenseNotification: Sending notification for hash key ${rowData[DEST_HASH_KEY_COL]} to chat ${TELEGRAM_CHAT_ID}`);
    const response = UrlFetchApp.fetch(apiUrl, options);
    const status = response.getResponseCode();
    const responseText = response.getContentText();
    if (status === 200) {
      Logger.log(`sendExpenseNotification: Successfully sent notification for hash key ${rowData[DEST_HASH_KEY_COL]} to chat ${TELEGRAM_CHAT_ID}`);
    } else {
      Logger.log(`sendExpenseNotification: Failed to send notification for hash key ${rowData[DEST_HASH_KEY_COL]}. Status: ${status}, Response: ${responseText}`);
    }
  } catch (e) {
    Logger.log(`sendExpenseNotification: Error sending Telegram notification for hash key ${rowData[DEST_HASH_KEY_COL]}: ${e.message}`);
  }
}

// Main function to parse and process Telegram logs for DAO expense events
function parseAndProcessTelegramLogs() {
  try {
    const sourceSpreadsheet = SpreadsheetApp.openByUrl(SOURCE_SHEET_URL);
    const scoredExpenseSpreadsheet = SpreadsheetApp.openByUrl(SCORED_EXPENSE_SHEET_URL);
    const sourceSheet = sourceSpreadsheet.getSheetByName(SOURCE_SHEET_NAME);
    const scoredExpenseSheet = scoredExpenseSpreadsheet.getSheetByName(SCORED_EXPENSE_SHEET_NAME);
    
    const sourceData = sourceSheet.getDataRange().getValues();
    const scoredData = scoredExpenseSheet.getDataRange().getValues();
    
    const existingHashKeys = scoredData.slice(1).map(row => row[DEST_HASH_KEY_COL]).filter(key => key);
    
    let newEntries = 0;
    const expensePattern = /\[DAO Inventory Expense Event\]/i;
    
    for (let i = 1; i < sourceData.length; i++) {
      const message = sourceData[i][MESSAGE_COL];
      
      const expenseDetails = extractExpenseDetails(message);
      Logger.log(message);
      Logger.log(expenseDetails);
      if (!expenseDetails) {
        Logger.log(`Skipping row ${i + 1} due to invalid expense details`);
        continue;
      }
      
      const hashKey = generateHashKey(
        sourceData[i][TELEGRAM_MESSAGE_ID_COL],
        expenseDetails.daoMemberName,
        sourceData[i][SALES_DATE_COL]
      );
      
      Logger.log(message + " \npattern match: " + expensePattern.test(message) + " \nprocessed: " + existingHashKeys.includes(hashKey));
      Logger.log("To process: " + (expensePattern.test(message) && !existingHashKeys.includes(hashKey)));
      
      if (expensePattern.test(message) && !existingHashKeys.includes(hashKey)) {
        Logger.log("Line 148: new line detected");
        
        // Get reporter name from digital signature
        let reporterName = null;
        if (expenseDetails.digitalSignature) {
          const result = findContributorByDigitalSignature(expenseDetails.digitalSignature);
          if (result.contributorName) {
            reporterName = result.contributorName;
            Logger.log(`Reporter identified from digital signature: ${reporterName}`);
          } else {
            Logger.log(`Skipping row ${i + 1}: ${result.error}`);
            continue;
          }
        } else {
          // Fallback: try to use Telegram contributor name from column
          const telegramName = sourceData[i][CONTRIBUTOR_NAME_COL];
          if (ReporterExist(telegramName)) {
            reporterName = telegramName;
            Logger.log(`Reporter identified from Telegram handle: ${reporterName}`);
          } else {
            Logger.log(`Skipping row ${i + 1}: No valid digital signature and Telegram name ${telegramName} not found in contributors`);
            continue;
          }
        }
        
        // Check for Telegram file IDs and upload if needed
        if (expenseDetails.attachedFilename && expenseDetails.destinationFileLocation) {
          const fileIds = getTelegramFileId(sourceSheet, i, sourceData);
          Logger.log(`Processing file IDs: ${fileIds.join(', ')}`);
          
          // Process the first file ID with the original destination URL
          if (fileIds.length > 0 && !checkFileExistsInGitHub(expenseDetails.destinationFileLocation)) {
            const uploaded = uploadFileToGitHub(fileIds[0], expenseDetails.destinationFileLocation, message);
            if (uploaded) {
              Logger.log(`Successfully uploaded primary file ${expenseDetails.attachedFilename} for row ${i + 1} to ${expenseDetails.destinationFileLocation}`);
            } else {
              Logger.log(`Failed to upload primary file ${expenseDetails.attachedFilename} for row ${i + 1}`);
            }
          } else if (fileIds.length === 0) {
            Logger.log(`No Telegram file IDs found for row ${i + 1}`);
          } else {
            Logger.log(`Primary file already exists at ${expenseDetails.destinationFileLocation}, skipping upload`);
          }

          // Process additional unique file IDs
          const processedFileIds = [fileIds[0]]; // Track processed file IDs to ensure uniqueness
          for (let j = 1; j < fileIds.length; j++) {
            const fileId = fileIds[j];
            if (fileId && !processedFileIds.includes(fileId)) {
              const newDestinationUrl = generateUniqueGitHubFilename(expenseDetails.destinationFileLocation, j);
              if (newDestinationUrl && !checkFileExistsInGitHub(newDestinationUrl)) {
                const uploaded = uploadFileToGitHub(fileId, newDestinationUrl, `Additional file for ${message}`);
                if (uploaded) {
                  Logger.log(`Successfully uploaded additional file ${fileId} for row ${i + 1} to ${newDestinationUrl}`);
                } else {
                  Logger.log(`Failed to upload additional file ${fileId} for row ${i + 1} to ${newDestinationUrl}`);
                }
              } else if (!newDestinationUrl) {
                Logger.log(`Failed to generate unique filename for additional file ID ${fileId} for row ${i + 1}`);
              } else {
                Logger.log(`Additional file already exists at ${newDestinationUrl}, skipping upload`);
              }
              processedFileIds.push(fileId);
            }
          }
        }
        
        const rowToAppend = [
          sourceData[i][TELEGRAM_UPDATE_ID_COL],
          sourceData[i][CHAT_ID_COL],
          sourceData[i][CHAT_NAME_COL],
          sourceData[i][TELEGRAM_MESSAGE_ID_COL],
          reporterName,
          message,
          sourceData[i][SALES_DATE_COL],
          expenseDetails.daoMemberName,
          expenseDetails.inventoryType,
          expenseDetails.quantity * -1,
          hashKey,
          ''
        ];
        
        const lastRow = scoredExpenseSheet.getLastRow();
        const scoredRowNumber = lastRow + 1;
        scoredExpenseSheet.getRange(scoredRowNumber, 1, 1, rowToAppend.length).setValues([rowToAppend]);
        
        const transactionRowNumber = InsertExpenseRecords(rowToAppend, i);
        
        if (transactionRowNumber) {
          scoredExpenseSheet.getRange(scoredRowNumber, DEST_TRANSACTION_LINE_COL + 1).setValue(transactionRowNumber);
        }
        
        sendExpenseNotification(rowToAppend, scoredRowNumber, transactionRowNumber);
        
        existingHashKeys.push(hashKey);
        newEntries++;
        
        Logger.log(`Processed row ${i + 1} with hash key: ${hashKey}`);
      }
    }
    
    Logger.log(`Processed ${sourceData.length - 1} rows, added ${newEntries} new expense entries.`);
  } catch (e) {
    Logger.log(`Error in parseAndProcessTelegramLogs: ${e.message}`);
  }
}

function doGet(e) {
  const action = e.parameter?.action;
  if (action === 'parseAndProcessTelegramLogs') {
    try {
      Logger.log("Webhook triggered: processing Telegram logs");
      parseAndProcessTelegramLogs();
      return ContentService.createTextOutput("✅ Telegram logs processed");
    } catch (err) {
      Logger.log("Error in processTelegramLogs: " + err.message);
      return ContentService.createTextOutput("❌ Error: " + err.message);
    }
  }

  return ContentService.createTextOutput("ℹ️ No valid action specified");
}

// Test function to process a specific row from the source sheet
function testParseAndProcessRow() {
  rowNumber = 6772
  try {
    // Validate row number
    if (!Number.isInteger(rowNumber) || rowNumber < 2) {
      Logger.log(`Invalid row number: ${rowNumber}. Must be an integer >= 2.`);
      return;
    }

    // Load sheets
    const sourceSpreadsheet = SpreadsheetApp.openByUrl(SOURCE_SHEET_URL);
    const scoredExpenseSpreadsheet = SpreadsheetApp.openByUrl(SCORED_EXPENSE_SHEET_URL);
    const sourceSheet = sourceSpreadsheet.getSheetByName(SOURCE_SHEET_NAME);
    const scoredExpenseSheet = scoredExpenseSpreadsheet.getSheetByName(SCORED_EXPENSE_SHEET_NAME);
    
    // Get source data and check if row exists
    const sourceData = sourceSheet.getDataRange().getValues();
    if (rowNumber > sourceData.length) {
      Logger.log(`Row ${rowNumber} does not exist in ${SOURCE_SHEET_NAME}. Total rows: ${sourceData.length}`);
      return;
    }

    // Get scored data for hash key check
    const scoredData = scoredExpenseSheet.getDataRange().getValues();
    const existingHashKeys = scoredData.slice(1).map(row => row[DEST_HASH_KEY_COL]).filter(key => key);
    
    const expensePattern = /\[DAO Inventory Expense Event\]/i;
    const i = rowNumber - 1; // Adjust for 0-based indexing

    // Get message and log it
    const message = sourceData[i][MESSAGE_COL];
    Logger.log(`Testing row ${rowNumber} with message:\n${message}`);

    // Step 1: Extract expense details
    const expenseDetails = extractExpenseDetails(message);
    Logger.log(`Expense Details: ${JSON.stringify(expenseDetails)}`);
    if (!expenseDetails) {
      Logger.log(`Test Failed: Skipping row ${rowNumber} due to invalid expense details`);
      // Log partial matches for debugging
      const partialPatterns = [
        /\[DAO Inventory Expense Event\].*?(?=\n\s*-|$)/i, // Up to first field
        /\[DAO Inventory Expense Event\]\n\s*- DAO Member Name:\s*(.*?)(?=\n\s*-|$)/i, // Up to DAO Member Name
        /\[DAO Inventory Expense Event\].*?- Inventory Type:\s*(.*?)(?=\n\s*-|$)/i, // Up to Inventory Type
        /\[DAO Inventory Expense Event\].*?- Description:\s*(.*?)(?=\n\s*-|$)/i, // Up to Description
        /\[DAO Inventory Expense Event\].*?(?:\n\s*-+\s*\n\s*My Digital Signature:.*)?$/i // Up to signature
      ];
      partialPatterns.forEach((pattern, index) => {
        const match = message.match(pattern);
        Logger.log(`Partial Pattern ${index + 1} Match: ${JSON.stringify(match)}`);
      });
      return;
    }

    // Step 2: Generate hash key
    const hashKey = generateHashKey(
      sourceData[i][TELEGRAM_MESSAGE_ID_COL],
      expenseDetails.daoMemberName,
      sourceData[i][SALES_DATE_COL]
    );
    Logger.log(`Generated Hash Key: ${hashKey}`);
    if (!hashKey) {
      Logger.log(`Test Failed: Failed to generate hash key for row ${rowNumber}`);
      return;
    }

    // Step 3: Check if the message is a DAO expense event and not already processed
    if (!expensePattern.test(message)) {
      Logger.log(`Test Failed: Row ${rowNumber} does not contain a DAO Inventory Expense Event`);
      return;
    }
    if (existingHashKeys.includes(hashKey)) {
      Logger.log(`Test Failed: Row ${rowNumber} already processed (hash key: ${hashKey})`);
      return;
    }
    Logger.log(`Pattern match: ${expensePattern.test(message)}, Not processed: ${!existingHashKeys.includes(hashKey)}`);

    // Step 4: Determine and validate reporter
    let reporterName = null;
    if (expenseDetails.digitalSignature) {
      const result = findContributorByDigitalSignature(expenseDetails.digitalSignature);
      if (result.contributorName) {
        reporterName = result.contributorName;
        Logger.log(`Reporter identified from digital signature: ${reporterName}`);
      } else {
        Logger.log(`Test Failed: ${result.error}`);
        return;
      }
    } else {
      // Fallback: try to use Telegram contributor name from column
      const telegramName = sourceData[i][CONTRIBUTOR_NAME_COL];
      if (ReporterExist(telegramName)) {
        reporterName = telegramName;
        Logger.log(`Reporter identified from Telegram handle: ${reporterName}`);
      } else {
        Logger.log(`Test Failed: No valid digital signature and Telegram name ${telegramName} not found in contributors`);
        return;
      }
    }
    Logger.log(`Reporter ${reporterName} validated successfully`);

    // Step 5: Check file upload if applicable
    let fileUploadStatus = [];
    if (expenseDetails.attachedFilename && expenseDetails.destinationFileLocation) {
      const fileIds = getTelegramFileId(sourceSheet, i, sourceData);
      Logger.log(`File IDs: ${fileIds.join(', ')}`);
      
      // Process the first file ID with the original destination URL
      if (fileIds.length > 0 && !checkFileExistsInGitHub(expenseDetails.destinationFileLocation)) {
        const uploaded = uploadFileToGitHub(fileIds[0], expenseDetails.destinationFileLocation, message);
        fileUploadStatus.push({
          fileId: fileIds[0],
          destination: expenseDetails.destinationFileLocation,
          status: uploaded ? "Success" : "Failed"
        });
        Logger.log(`Primary File Upload Status: ${uploaded ? "Success" : "Failed"} for ${expenseDetails.attachedFilename}`);
      } else if (fileIds.length === 0) {
        fileUploadStatus.push({ fileId: null, destination: null, status: "No Telegram file IDs found" });
        Logger.log(`No Telegram file IDs found for row ${rowNumber}`);
      } else {
        fileUploadStatus.push({
          fileId: fileIds[0],
          destination: expenseDetails.destinationFileLocation,
          status: "File already exists"
        });
        Logger.log(`Primary file already exists at ${expenseDetails.destinationFileLocation}, skipping upload`);
      }

      // Process additional unique file IDs
      const processedFileIds = [fileIds[0]]; // Track processed file IDs to ensure uniqueness
      for (let j = 1; j < fileIds.length; j++) {
        const fileId = fileIds[j];
        if (fileId && !processedFileIds.includes(fileId)) {
          const newDestinationUrl = generateUniqueGitHubFilename(expenseDetails.destinationFileLocation, j);
          if (newDestinationUrl && !checkFileExistsInGitHub(newDestinationUrl)) {
            const uploaded = uploadFileToGitHub(fileId, newDestinationUrl, `Additional file for ${message}`);
            fileUploadStatus.push({
              fileId: fileId,
              destination: newDestinationUrl,
              status: uploaded ? "Success" : "Failed"
            });
            Logger.log(`Additional File Upload Status: ${uploaded ? "Success" : "Failed"} for ${fileId} to ${newDestinationUrl}`);
          } else if (!newDestinationUrl) {
            fileUploadStatus.push({
              fileId: fileId,
              destination: null,
              status: "Failed to generate unique filename"
            });
            Logger.log(`Failed to generate unique filename for additional file ID ${fileId} for row ${rowNumber}`);
          } else {
            fileUploadStatus.push({
              fileId: fileId,
              destination: newDestinationUrl,
              status: "File already exists"
            });
            Logger.log(`Additional file already exists at ${newDestinationUrl}, skipping upload`);
          }
          processedFileIds.push(fileId);
        }
      }
    } else {
      fileUploadStatus.push({ fileId: null, destination: null, status: "No attached filename or destination" });
      Logger.log(`No attached filename or destination for row ${rowNumber}`);
    }

    // Step 6: Append to scored expense sheet
    const rowToAppend = [
      sourceData[i][TELEGRAM_UPDATE_ID_COL],
      sourceData[i][CHAT_ID_COL],
      sourceData[i][CHAT_NAME_COL],
      sourceData[i][TELEGRAM_MESSAGE_ID_COL],
      reporterName,
      message,
      sourceData[i][SALES_DATE_COL],
      expenseDetails.daoMemberName,
      expenseDetails.inventoryType,
      expenseDetails.quantity * -1,
      hashKey,
      ''
    ];
    
    const lastRow = scoredExpenseSheet.getLastRow();
    const scoredRowNumber = lastRow + 1;
    scoredExpenseSheet.getRange(scoredRowNumber, 1, 1, rowToAppend.length).setValues([rowToAppend]);
    Logger.log(`✅ Inserted into Scored Expense Submissions at row ${scoredRowNumber}`);
    Logger.log(`   Data: ${JSON.stringify(rowToAppend)}`);

    // Step 7: Insert into offchain transactions sheet or resolved ledger
    const transactionRowNumber = InsertExpenseRecords(rowToAppend, i);
    Logger.log(`Transaction Row Number: ${transactionRowNumber || 'Not recorded'}`);

    // Update Column L with transaction row number
    if (transactionRowNumber) {
      scoredExpenseSheet.getRange(scoredRowNumber, DEST_TRANSACTION_LINE_COL + 1).setValue(transactionRowNumber);
      Logger.log(`✅ Updated Scored Expense Submissions Column L with transaction row: ${transactionRowNumber}`);
    }

    // Step 8: Send notification
    sendExpenseNotification(rowToAppend, scoredRowNumber, transactionRowNumber);

    // Log test success
    Logger.log(`✅ Test Passed: Successfully processed row ${rowNumber} with hash key: ${hashKey}`);
    Logger.log(`   Scored Row: ${scoredRowNumber}`);
    Logger.log(`   Transaction Row: ${transactionRowNumber || 'Not recorded'}`);
    Logger.log(`   File Uploads: ${JSON.stringify(fileUploadStatus)}`);
  } catch (e) {
    Logger.log(`Test Failed: Error processing row ${rowNumber}: ${e.message}`);
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
    return response.getResponseCode() === 200;
  } catch (e) {
    Logger.log(`Error checking file existence in GitHub: ${e.message}`);
    return false;
  }
}

/**
 * Test function to verify ledger resolution from inventory type with encoded ledger name
 * This tests the pattern: [ledger name] inventoryType and shows the different structures
 */
function testLedgerResolution() {
  try {
    Logger.log('=== Testing Ledger Resolution ===');
    
    // Test 1: Fetch ledger configs from Wix
    Logger.log('\n1. Fetching ledger configurations from Wix...');
    const ledgerConfigs = getLedgerConfigsFromWix();
    Logger.log(`Found ${ledgerConfigs.length} ledger configurations`);
    ledgerConfigs.forEach(config => {
      Logger.log(`  - Ledger: ${config.ledger_name}`);
      Logger.log(`    URL: ${config.ledger_url}`);
      Logger.log(`    Sheet: ${config.sheet_name}`);
      Logger.log(`    Managed: ${config.is_managed_ledger}`);
    });
    
    // Test 2: Test ledger name extraction from inventory type
    Logger.log('\n2. Testing ledger name extraction from inventory type...');
    const testInventoryTypes = [
      '[AGL#25] Avocado',
      '[Test Ledger] Coffee Beans',
      'Regular Inventory Item',
      '[AGL#1] Bananas'
    ];
    
    testInventoryTypes.forEach(inventoryType => {
      const ledgerMatch = inventoryType.match(/^\[([^\]]+)\]\s*(.+)$/);
      if (ledgerMatch) {
        const ledgerName = ledgerMatch[1];
        const cleanInventoryType = ledgerMatch[2];
        Logger.log(`  Inventory Type: "${inventoryType}"`);
        Logger.log(`    - Ledger Name: ${ledgerName}`);
        Logger.log(`    - Clean Inventory Type: ${cleanInventoryType}`);
        
        // Try to find matching ledger config
        const ledgerConfig = ledgerConfigs.find(config => 
          config.ledger_name === ledgerName || 
          config.ledger_name.toLowerCase() === ledgerName.toLowerCase()
        );
        
        if (ledgerConfig) {
          Logger.log(`    - ✅ Matched Ledger: ${ledgerConfig.ledger_name}`);
          Logger.log(`    - Target URL: ${ledgerConfig.ledger_url}`);
          Logger.log(`    - Target Sheet: ${ledgerConfig.sheet_name}`);
          Logger.log(`    - Is Managed: ${ledgerConfig.is_managed_ledger}`);
          Logger.log(`    - Would insert ${ledgerConfig.is_managed_ledger ? '6' : '5'} columns`);
          if (ledgerConfig.is_managed_ledger) {
            Logger.log(`    - Structure: [Date, Description, Entity, Amount, Type, "Assets"]`);
          } else {
            Logger.log(`    - Structure: [Date, Description, Fund Handler, Amount, Type]`);
          }
        } else {
          Logger.log(`    - ❌ No matching ledger found, would use default offchain transactions sheet`);
          Logger.log(`    - Would insert 5 columns`);
          Logger.log(`    - Structure: [Date, Description, Fund Handler, Amount, Type]`);
        }
      } else {
        Logger.log(`  Inventory Type: "${inventoryType}"`);
        Logger.log(`    - No ledger name detected, would use default offchain transactions sheet`);
        Logger.log(`    - Would insert 5 columns`);
        Logger.log(`    - Structure: [Date, Description, Fund Handler, Amount, Type]`);
      }
    });
    
    Logger.log('\n=== Test Complete ===');
  } catch (e) {
    Logger.log(`Error in testLedgerResolution: ${e.message}`);
  }
}