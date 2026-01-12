/**
 * File: google_app_scripts/tdg_asset_management/tdg_expenses_processing.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * 
 * Description: Processes DAO inventory expense submissions from Telegram Chat Logs, validates them via 
 * digital signatures, scores them into the Scored Expense Submissions sheet, and inserts expense records 
 * into the appropriate ledgers (offchain or managed AGL ledgers). Supports Target Ledger selection from 
 * the expense submission form, with fallback to ledger prefix in inventory type format [ledger name].
 * 
 * Flow:
 * 1. Reads expense events from "Telegram Chat Logs" sheet
 * 2. Validates reporter via digital signature or Telegram handle
 * 3. Uploads attached files to GitHub if present
 * 4. Inserts scored expense into "Scored Expense Submissions" sheet (Column M: Target Ledger)
 * 5. Inserts expense transaction into target ledger (offchain or managed AGL ledger)
 * 6. Sends Telegram notification with expense details
 * 
 * Deployment URL: https://script.google.com/macros/s/AKfycbwYBlFigSSPJKkI-F2T3dSsdLnvvBi2SCGF1z2y1k95YzA5HBrJVyMo6InTA9Fud2bOEw/exec
 */

// Load API keys and configuration settings from Credentials.gs
// - setApiKeys(): Stores sensitive API keys in Google Apps Script's Script Properties for security.
// - getCredentials(): Retrieves all configuration details (API keys, URLs, IDs) as an object.
// - These steps ensure keys and settings are centralized and not hardcoded here.
setApiKeys();
const creds = getCredentials();

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
const DEST_TARGET_LEDGER_COL = 12; // Column M

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
 * Resolves redirect URLs to get the final destination URL.
 * 
 * First checks "Shipment Ledger Listing" sheet (Column L -> Column AB lookup)
 * for cached resolved URLs. Falls back to HTTP resolution if not found in sheet.
 * Follows HTTP redirects (Location headers) up to MAX_REDIRECTS times.
 * 
 * Used primarily for resolving ledger URLs from Wix data or other sources
 * that may use URL shorteners or redirect chains.
 * 
 * @param {string} url - The URL to resolve (may be a redirect or shortened URL)
 * @return {string} The final resolved URL after following redirects, or empty string on error
 */
function resolveRedirect(url) {
  try {
    // First, try to look up the URL in "Shipment Ledger Listing" sheet
    // Column L (index 11) = unresolved URL, Column AB (index 27) = resolved URL
    try {
      const spreadsheet = SpreadsheetApp.openByUrl(CONTRIBUTORS_SHEET_URL);
      const shipmentSheet = spreadsheet.getSheetByName(SHIPMENT_LEDGER_SHEET_NAME);
      
      if (shipmentSheet) {
        const lastRow = shipmentSheet.getLastRow();
        if (lastRow >= 2) {
          // Read columns A to AB (28 columns) to get both Column L and Column AB
          const dataRange = shipmentSheet.getRange(2, 1, lastRow - 1, 28);
          const data = dataRange.getValues();
          
          for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const ledgerUrl = row[11] ? row[11].toString().trim() : ''; // Column L (index 11)
            
            // Check if this row's Column L matches the input URL
            if (ledgerUrl === url || ledgerUrl === url.trim()) {
              const resolvedUrl = row[27] ? row[27].toString().trim() : ''; // Column AB (index 27)
              if (resolvedUrl) {
                Logger.log(`Found resolved URL in sheet: ${url} -> ${resolvedUrl}`);
                return resolvedUrl;
              }
            }
          }
        }
      }
    } catch (sheetError) {
      Logger.log(`Could not lookup URL in sheet, falling back to HTTP resolution: ${sheetError.message}`);
    }
    
    // Fallback to HTTP resolution if not found in sheet
    let currentUrl = url;
    let redirectCount = 0;

    while (redirectCount < MAX_REDIRECTS) {
      const response = UrlFetchApp.fetch(currentUrl, {
        followRedirects: false,
        muteHttpExceptions: true
      });
      const responseCode = response.getResponseCode();

      // If not a redirect (2xx or other), check for JavaScript redirects
      if (responseCode < 300 || responseCode >= 400) {
        // Check if the response contains JavaScript redirects
        const content = response.getContentText();
        const jsRedirectMatch = content.match(/window\.location\.(replace|href)\s*=\s*['"]([^'"]+)['"]/i) ||
                                content.match(/window\.location\.replace\(['"]([^'"]+)['"]\)/i) ||
                                content.match(/<meta\s+http-equiv=['"]refresh['"]\s+content=['"]\d+;url=([^'"]+)['"]/i);
        
        if (jsRedirectMatch) {
          const redirectUrl = jsRedirectMatch[1] || jsRedirectMatch[2];
          if (redirectUrl) {
            // Resolve relative URLs to absolute
            if (redirectUrl.startsWith('http://') || redirectUrl.startsWith('https://')) {
              currentUrl = redirectUrl;
              redirectCount++;
              Logger.log(`Found JavaScript redirect to: ${currentUrl}`);
              continue;
            } else {
              // Relative URL - construct absolute URL
              try {
                const baseUrl = new URL(currentUrl);
                const resolvedUrl = new URL(redirectUrl, baseUrl).toString();
                currentUrl = resolvedUrl;
                redirectCount++;
                Logger.log(`Resolved relative JavaScript redirect to: ${currentUrl}`);
                continue;
              } catch (e) {
                Logger.log(`Error resolving relative JavaScript redirect: ${e.message}`);
                return currentUrl;
              }
            }
          }
        }
        
        // No JavaScript redirect found, return current URL
        return currentUrl;
      }

      // Get the Location header for the redirect
      const headers = response.getHeaders();
      const location = headers['Location'] || headers['location'];
      if (!location) {
        Logger.log(`No Location header for redirect at ${currentUrl}`);
        // Try to check for JavaScript redirect in response body
        const content = response.getContentText();
        const jsRedirectMatch = content.match(/window\.location\.(replace|href)\s*=\s*['"]([^'"]+)['"]/i) ||
                                content.match(/window\.location\.replace\(['"]([^'"]+)['"]\)/i) ||
                                content.match(/<meta\s+http-equiv=['"]refresh['"]\s+content=['"]\d+;url=([^'"]+)['"]/i);
        
        if (jsRedirectMatch) {
          const redirectUrl = jsRedirectMatch[1] || jsRedirectMatch[2];
          if (redirectUrl) {
            if (redirectUrl.startsWith('http://') || redirectUrl.startsWith('https://')) {
              currentUrl = redirectUrl;
            } else {
              try {
                const baseUrl = new URL(currentUrl);
                currentUrl = new URL(redirectUrl, baseUrl).toString();
              } catch (e) {
                Logger.log(`Error resolving relative JavaScript redirect: ${e.message}`);
                return '';
              }
            }
            redirectCount++;
            Logger.log(`Found JavaScript redirect to: ${currentUrl}`);
            continue;
          }
        }
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
 * Fetches ledger configurations from Google Sheets "Shipment Ledger Listing".
 * 
 * Migrated from Wix API to Google Sheets for cost savings. Reads ledger configurations
 * from the "Shipment Ledger Listing" sheet where:
 * - Column A: Shipment ID (ledger name, e.g., "AGL10", "AGL#25")
 * - Column L: Ledger URL (unresolved, may be a redirect)
 * 
 * Each ledger configuration includes:
 * - ledger_name: The ledger identifier from Column A
 * - ledger_url: Resolved URL to the ledger spreadsheet (after following redirects)
 * - sheet_name: Sheet name within the ledger ("Transactions" for managed AGL ledgers)
 * - is_managed_ledger: Boolean indicating if this is a managed AGL ledger (always true)
 * 
 * @return {Array<Object>} Array of ledger configuration objects
 * @return {string} return[].ledger_name - Ledger identifier/name from Column A
 * @return {string} return[].ledger_url - Resolved URL to ledger spreadsheet
 * @return {string} return[].sheet_name - Sheet name within ledger ("Transactions")
 * @return {boolean} return[].is_managed_ledger - Always true for managed ledgers
 */
function getLedgerConfigsFromWix() {
  // Note: Function name kept for backward compatibility, but now reads from Google Sheets
  try {
    // Shipment Ledger Listing is in the same spreadsheet as Contributors
    // Use the spreadsheet ID from CONTRIBUTORS_SHEET_URL
    const spreadsheet = SpreadsheetApp.openByUrl(CONTRIBUTORS_SHEET_URL);
    const shipmentSheet = spreadsheet.getSheetByName(SHIPMENT_LEDGER_SHEET_NAME);
    
    if (!shipmentSheet) {
      Logger.log(`Error: ${SHIPMENT_LEDGER_SHEET_NAME} sheet not found`);
      return [];
    }

    // Get all data from the sheet (skip header row)
    const lastRow = shipmentSheet.getLastRow();
    if (lastRow < 2) {
      Logger.log(`No data in ${SHIPMENT_LEDGER_SHEET_NAME} sheet`);
      return [];
    }

    // Read data starting from row 2 (row 1 is header)
    // Columns: A (Shipment ID/ledger name), L (Ledger URL)
    const SHIPMENT_ID_COL = 0; // Column A - Shipment ID (ledger name)
    const LEDGER_URL_COL = 11; // Column L - Ledger URL
    const dataRange = shipmentSheet.getRange(2, 1, lastRow - 1, 13); // Columns A to M
    const data = dataRange.getValues();

    // Construct LEDGER_CONFIGS from sheet data
    const ledgerConfigs = [];
    const seenUrls = new Set(); // Track unique URLs to avoid duplicates

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const shipmentId = row[SHIPMENT_ID_COL] ? row[SHIPMENT_ID_COL].toString().trim() : '';
      const ledgerUrl = row[LEDGER_URL_COL] ? row[LEDGER_URL_COL].toString().trim() : '';
      
      // Skip if no URL or no shipment ID
      if (!ledgerUrl || !shipmentId) {
        continue;
      }
      
      // Skip if we've already processed this URL (avoid duplicates)
      if (seenUrls.has(ledgerUrl)) {
        continue;
      }
      seenUrls.add(ledgerUrl);

      try {
        const resolvedUrl = resolveRedirect(ledgerUrl);
        if (resolvedUrl) {
          ledgerConfigs.push({
            ledger_name: shipmentId,
            ledger_url: resolvedUrl,
            sheet_name: 'Transactions', // Managed AGL ledgers use "Transactions" sheet
            is_managed_ledger: true
          });
        } else {
          Logger.log(`Warning: Could not resolve URL for ${shipmentId}: ${ledgerUrl}`);
        }
      } catch (e) {
        Logger.log(`Error resolving URL for ${shipmentId}: ${e.message}`);
      }
    }

    Logger.log(`Ledger configs fetched from ${SHIPMENT_LEDGER_SHEET_NAME}: ${ledgerConfigs.length} configs`);
    Logger.log('Ledger configs: ' + JSON.stringify(ledgerConfigs));
    return ledgerConfigs;
  } catch (e) {
    Logger.log(`Error fetching ledger configs from ${SHIPMENT_LEDGER_SHEET_NAME}: ${e.message}`);
    return [];
  }
}

/**
 * Finds contributor name by digital signature from Contributors Digital Signatures sheet.
 * 
 * Validates that the digital signature exists and is ACTIVE before returning the
 * contributor name. This ensures only authorized contributors can submit expenses.
 * 
 * @param {string} digitalSignature - The digital signature (public key) to lookup
 * @return {Object} Result object with contributor name or error
 * @return {string|null} return.contributorName - Contributor name if signature is valid and ACTIVE, null otherwise
 * @return {string|null} return.error - Error message if signature not found or not ACTIVE, null if successful
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

/**
 * Checks if a reporter name exists in Contributors sheet Column H (Telegram Handle).
 * 
 * Used as a fallback validation method when digital signature is not available.
 * Normalizes both the reporter name and Telegram handles by removing @ symbols
 * and converting to lowercase for case-insensitive matching.
 * 
 * @param {string} reporterName - Telegram handle or contributor name to validate
 * @return {boolean} True if reporter exists in Contributors sheet, false otherwise
 */
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

/**
 * Extracts expense details from a DAO Inventory Expense Event message.
 * 
 * Parses the expense submission message format and extracts all relevant fields including:
 * - DAO Member Name (required)
 * - Target Ledger (optional, new field from expense form)
 * - Latitude/Longitude (optional)
 * - Inventory Type (required, may include ledger prefix like [AGL10] USD)
 * - Inventory Quantity (required)
 * - Description (required)
 * - File attachment details (optional)
 * - Digital signature (optional, for validation)
 * 
 * @param {string} message - The full expense submission message text
 * @return {Object|null} Object containing extracted expense details, or null if parsing fails
 * @return {string} return.daoMemberName - Name of the DAO member who incurred the expense
 * @return {string|null} return.targetLedger - Target ledger name if specified in submission (e.g., "AGL10", "offchain")
 * @return {string|null} return.latitude - GPS latitude if provided
 * @return {string|null} return.longitude - GPS longitude if provided
 * @return {string} return.inventoryType - Type of inventory (may include [ledger name] prefix)
 * @return {number} return.quantity - Quantity of inventory expensed
 * @return {string} return.description - Description of the expense
 * @return {string|null} return.attachedFilename - Original filename if file attached
 * @return {string|null} return.destinationFileLocation - GitHub URL where file should be stored
 * @return {string|null} return.submissionSource - URL of the form that generated the submission
 * @return {string|null} return.digitalSignature - Digital signature for reporter validation
 */
function extractExpenseDetails(message) {
  // Normalize line endings and trim leading/trailing whitespace
  message = message.replace(/\r\n/g, '\n').trim();
  
  // Updated regex with more flexible whitespace handling and trailing content
  // Now includes optional "Target Ledger" field
  // Pattern handles: DAO Member Name, optional Target Ledger, optional Latitude/Longitude, Inventory Type, Quantity, Description, optional file fields
  const pattern = /\[DAO Inventory Expense Event\]\n\s*- DAO Member Name:\s*(.*?)\n\s*(?:- Target Ledger:\s*(.*?)\n\s*)?(?:- Latitude:\s*(.*?)\n\s*- Longitude:\s*(.*?)\n\s*)?- Inventory Type:\s*(.*?)\n\s*- Inventory Quantity:\s*(\d+\.?\d*)\n\s*- Description:\s*(.*?)(?:\n\s*- Attached Filename:\s*(.*?))?(?:\n\s*- Destination Expense File Location:\s*(.*?))?(?:\n\s*- Submission Source:\s*(.*?))?(?:(?:\n\s*-+\s*\n\s*My Digital Signature:.*?(?:\n\s*Request Transaction ID:.*?)?)?(?:\n\s*This submission was generated using.*?(?:\n\s*Verify submission here:.*?)?)?)?$/i;
  
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
  
  // Extract target ledger (match[2]) - may be undefined if not present
  const targetLedger = match[2] ? match[2].trim() : null;
  
  return {
    daoMemberName: match[1].trim(),
    targetLedger: targetLedger, // New field: Target Ledger from expense form
    latitude: match[3] ? match[3].trim() : null,
    longitude: match[4] ? match[4].trim() : null,
    inventoryType: match[5].trim(),
    quantity: parseFloat(match[6]),
    description: match[7].trim(),
    attachedFilename: match[8] ? match[8].trim() : null,
    destinationFileLocation: match[9] ? match[9].trim() : null,
    submissionSource: match[10] ? match[10].trim() : null,
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

/**
 * Retrieves Telegram file ID(s) from the source sheet.
 * 
 * Checks the current row's Column O (Telegram File ID) first. If not found,
 * checks the previous row's Column O as a fallback. Handles comma-separated
 * file IDs for multiple attachments.
 * 
 * @param {Sheet} sourceSheet - The Telegram Chat Logs sheet
 * @param {number} currentRowIndex - Current row index (0-based)
 * @param {Array<Array>} sourceData - All data from the source sheet
 * @return {Array<string>} Array of file IDs (may be empty if none found)
 */
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

/**
 * Uploads a file from Telegram to GitHub.
 * 
 * Retrieves the file from Telegram using the file ID, then uploads it to
 * the specified GitHub repository location. Uses GitHub Contents API to
 * create or update the file.
 * 
 * @param {string} fileId - Telegram file ID
 * @param {string} destinationUrl - GitHub URL where file should be stored (tree/blob format)
 * @param {string} commitMessage - Commit message for the GitHub upload
 * @return {boolean} True if upload successful, false otherwise
 */
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

/**
 * Inserts expense records into the appropriate ledger (offchain or managed AGL ledger).
 * 
 * Determines the target ledger using the following priority:
 * 1. Column M (Target Ledger) - highest priority, explicitly set in expense form
 * 2. Extracted targetLedger from expense message - fallback if Column M not set
 * 3. Ledger prefix in inventory type format [ledger name] inventoryType - legacy support
 * 4. Default to offchain transactions sheet - if no ledger specified
 * 
 * For managed AGL ledgers, inserts into "Transactions" sheet with 6 columns:
 * - Date, Description, Entity (DAO Member), Amount (negative), Type, Category ("Assets")
 * 
 * For offchain ledger, inserts into "offchain transactions" sheet with 5 columns:
 * - Date, Description, Fund Handler (DAO Member), Amount (negative), Inventory Type
 * 
 * @param {Array} scoredRow - Row data from Scored Expense Submissions sheet (includes Column M: Target Ledger)
 * @param {number} rowIndex - Index of the source row in Telegram Chat Logs (0-based)
 * @return {number|null} Row number where expense was inserted in target ledger, or null on error
 */
function InsertExpenseRecords(scoredRow, rowIndex) {
  try {
    Logger.log(`InsertExpenseRecords called for rowIndex ${rowIndex + 1}`);
    Logger.log(`ScoredRow length: ${scoredRow.length}, Column M (index ${DEST_TARGET_LEDGER_COL}): "${scoredRow[DEST_TARGET_LEDGER_COL] || ''}"`);
    Logger.log(`Expense message (Column F): ${scoredRow[DEST_EXPENSE_REPORTED_COL] ? scoredRow[DEST_EXPENSE_REPORTED_COL].substring(0, 100) + '...' : 'empty'}`);
    
    const expenseDetails = extractExpenseDetails(scoredRow[DEST_EXPENSE_REPORTED_COL]);
    if (!expenseDetails) {
      Logger.log(`Failed to extract expense details for row ${rowIndex + 1}`);
      return null;
    }
    Logger.log(`Extracted expense details: DAO Member: ${expenseDetails.daoMemberName}, Inventory Type: ${expenseDetails.inventoryType}, Quantity: ${expenseDetails.quantity}, Target Ledger from message: ${expenseDetails.targetLedger || 'none'}`);

    // Priority 1: Use Target Ledger from Column M if available
    // Priority 2: Check if inventoryType has ledger name encoded in format [ledger name] inventoryType
    // Priority 3: Default to offchain
    let targetSpreadsheetUrl = OFFCHAIN_TRANSACTIONS_SHEET_URL;
    let targetSheetName = OFFCHAIN_TRANSACTIONS_SHEET_NAME;
    let cleanInventoryType = expenseDetails.inventoryType;
    let isManagedLedger = false;
    let targetLedgerName = null;
    
    // Check Column M for Target Ledger (highest priority)
    const targetLedgerFromColumn = scoredRow[DEST_TARGET_LEDGER_COL] ? scoredRow[DEST_TARGET_LEDGER_COL].toString().trim() : null;
    if (targetLedgerFromColumn && targetLedgerFromColumn.toLowerCase() !== 'offchain') {
      targetLedgerName = targetLedgerFromColumn;
      Logger.log(`Target Ledger from Column M: ${targetLedgerName}`);
    } else if (expenseDetails.targetLedger && expenseDetails.targetLedger.toLowerCase() !== 'offchain') {
      // Fallback to extracted target ledger from message
      targetLedgerName = expenseDetails.targetLedger;
      Logger.log(`Target Ledger from message: ${targetLedgerName}`);
    } else {
      // Check inventory type for ledger prefix
      const ledgerMatch = expenseDetails.inventoryType.match(/^\[([^\]]+)\]\s*(.+)$/);
      if (ledgerMatch) {
        targetLedgerName = ledgerMatch[1];
        cleanInventoryType = ledgerMatch[2]; // Extract the actual inventory type without the ledger prefix
        Logger.log(`Ledger name detected in inventory type: ${targetLedgerName}`);
      }
    }
    
    // If we have a target ledger name, resolve it
    if (targetLedgerName) {
      // Get ledger configs from Shipment Ledger Listing sheet
      const ledgerConfigs = getLedgerConfigsFromWix();
      
      // Log available ledgers for debugging
      Logger.log(`Available ledger configs: ${ledgerConfigs.map(c => c.ledger_name).join(', ')}`);
      
      // Try multiple matching strategies (similar to inventory movement script)
      const ledgerConfig = ledgerConfigs.find(config => {
        const configName = config.ledger_name.toLowerCase().trim();
        const targetName = targetLedgerName.toLowerCase().trim();
        
        // Strategy 1: Exact match (case-insensitive)
        if (configName === targetName) {
          Logger.log(`Matched ledger by exact name: ${config.ledger_name}`);
          return true;
        }
        
        // Strategy 2: Remove spaces/dashes and match (e.g., "AGL 10" or "AGL-10" matches "AGL10")
        const configNameNormalized = configName.replace(/[\s\-_]/g, '');
        const targetNameNormalized = targetName.replace(/[\s\-_]/g, '');
        if (configNameNormalized === targetNameNormalized) {
          Logger.log(`Matched ledger by normalized name: ${config.ledger_name}`);
          return true;
        }
        
        // Strategy 3: Extract number from AGL format and match (e.g., "AGL10" -> "10", matches "AGL 10")
        const aglNumberMatch = targetName.match(/agl\s*(\d+)/i);
        if (aglNumberMatch) {
          const number = aglNumberMatch[1];
          const configNumberMatch = configName.match(/agl\s*(\d+)/i);
          if (configNumberMatch && configNumberMatch[1] === number) {
            Logger.log(`Matched ledger by AGL number: ${config.ledger_name}`);
            return true;
          }
        }
        
        // Strategy 4: Extract ledger identifier from URL format (e.g., "https://agroverse.shop/agl10" -> "agl10")
        const urlMatch = targetName.match(/\/(agl\d+|sef\d+|pp\d+)/i);
        if (urlMatch) {
          const urlLedgerId = urlMatch[1].toLowerCase();
          const configLedgerMatch = configName.match(/(agl\d+|sef\d+|pp\d+)/i);
          if (configLedgerMatch && configLedgerMatch[1].toLowerCase() === urlLedgerId) {
            Logger.log(`Matched ledger by URL identifier extraction: ${config.ledger_name}`);
            return true;
          }
        }
        
        return false;
      });
      
      if (ledgerConfig && ledgerConfig.ledger_url) {
        targetSpreadsheetUrl = ledgerConfig.ledger_url;
        targetSheetName = ledgerConfig.sheet_name;
        isManagedLedger = ledgerConfig.is_managed_ledger || false;
        Logger.log(`Resolved ledger URL for ${targetLedgerName}: ${targetSpreadsheetUrl}, Sheet: ${targetSheetName}, Managed: ${isManagedLedger}`);
      } else {
        Logger.log(`Warning: Ledger "${targetLedgerName}" not found in Shipment Ledger Listing. Available ledgers: ${ledgerConfigs.map(c => c.ledger_name).join(', ')}. Using default offchain transactions sheet.`);
      }
    } else {
      Logger.log(`No target ledger specified, using default offchain transactions sheet`);
    }
    
    // Open the target spreadsheet and sheet
    Logger.log(`Attempting to open spreadsheet: ${targetSpreadsheetUrl}`);
    const targetSpreadsheet = SpreadsheetApp.openByUrl(targetSpreadsheetUrl);
    if (!targetSpreadsheet) {
      Logger.log(`Error: Failed to open spreadsheet at ${targetSpreadsheetUrl}`);
      return null;
    }
    Logger.log(`Successfully opened spreadsheet, looking for sheet: ${targetSheetName}`);
    const targetSheet = targetSpreadsheet.getSheetByName(targetSheetName);
    
    if (!targetSheet) {
      Logger.log(`Error: Sheet "${targetSheetName}" not found in spreadsheet ${targetSpreadsheetUrl}`);
      Logger.log(`Available sheets: ${targetSpreadsheet.getSheets().map(s => s.getName()).join(', ')}`);
      return null;
    }
    Logger.log(`Successfully found sheet "${targetSheetName}"`);

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
    Logger.log(`Target sheet "${targetSheetName}" last row: ${lastRow}, preparing to insert at row ${lastRow + 1}`);
    Logger.log(`Row data to insert (${rowToAppend.length} columns): ${JSON.stringify(rowToAppend)}`);
    
    targetSheet.getRange(lastRow + 1, 1, 1, rowToAppend.length).setValues([rowToAppend]);
    Logger.log(`✅ Successfully inserted ${isManagedLedger ? 'managed ledger' : 'offchain'} expense record at row ${lastRow + 1} in ${targetSheetName} (${targetSpreadsheetUrl}) for hash key ${scoredRow[DEST_HASH_KEY_COL]}`);
    return lastRow + 1;
  } catch (e) {
    Logger.log(`❌ Error inserting into transactions sheet: ${e.message}`);
    Logger.log(`Error stack: ${e.stack || 'No stack trace available'}`);
    return null;
  }
}

/**
 * Sends a Telegram notification for a processed expense submission.
 * 
 * Notifies the TrueSight DAO Telegram chat with details about the newly
 * processed expense, including row numbers and a link to view the expense.
 * 
 * @param {Array} rowData - Row data from Scored Expense Submissions sheet
 * @param {number} scoredRowNumber - Row number in Scored Expense Submissions sheet
 * @param {number|null} transactionRowNumber - Row number in target ledger, or null if not recorded
 * @return {void}
 */
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

/**
 * Main function to parse and process Telegram logs for DAO expense events.
 * 
 * Reads expense submissions from "Telegram Chat Logs" sheet, validates them, and processes them:
 * 1. Extracts expense details from message text
 * 2. Validates reporter via digital signature or Telegram handle
 * 3. Uploads attached files to GitHub if present
 * 4. Inserts scored expense into "Scored Expense Submissions" sheet (includes Column M: Target Ledger)
 * 5. Inserts expense transaction into target ledger (offchain or managed AGL ledger)
 * 6. Updates Column L with transaction row number
 * 7. Sends Telegram notification with expense details
 * 
 * Uses hash key (message ID + DAO member name + date) for deduplication to prevent processing
 * the same expense multiple times.
 * 
 * @return {void}
 */
/**
 * Parses a date string in YYYYMMDD format and returns a Date object.
 * 
 * @param {string|number} dateStr - Date string in YYYYMMDD format (e.g., "20240115")
 * @return {Date|null} Date object or null if parsing fails
 */
function parseDateFromYYYYMMDD(dateStr) {
  try {
    if (!dateStr) return null;
    const dateString = dateStr.toString().trim();
    if (dateString.length !== 8) return null;
    
    const year = parseInt(dateString.substring(0, 4), 10);
    const month = parseInt(dateString.substring(4, 6), 10) - 1; // Month is 0-indexed
    const day = parseInt(dateString.substring(6, 8), 10);
    
    if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
    
    const date = new Date(year, month, day);
    // Validate the date is valid
    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
      return null;
    }
    return date;
  } catch (e) {
    Logger.log(`Error parsing date ${dateStr}: ${e.message}`);
    return null;
  }
}

function parseAndProcessTelegramLogs() {
  try {
    const sourceSpreadsheet = SpreadsheetApp.openByUrl(SOURCE_SHEET_URL);
    const scoredExpenseSpreadsheet = SpreadsheetApp.openByUrl(SCORED_EXPENSE_SHEET_URL);
    const sourceSheet = sourceSpreadsheet.getSheetByName(SOURCE_SHEET_NAME);
    const scoredExpenseSheet = scoredExpenseSpreadsheet.getSheetByName(SCORED_EXPENSE_SHEET_NAME);
    
    // Calculate cutoff date (30 days ago)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);
    cutoffDate.setHours(0, 0, 0, 0); // Set to start of day
    Logger.log(`Processing expenses from the last 30 days (since ${cutoffDate.toISOString().split('T')[0]})`);
    
    // Get all source data
    const sourceData = sourceSheet.getDataRange().getValues();
    const scoredData = scoredExpenseSheet.getDataRange().getValues();
    
    const existingHashKeys = scoredData.slice(1).map(row => row[DEST_HASH_KEY_COL]).filter(key => key);
    
    let newEntries = 0;
    let skippedOldEntries = 0;
    let skippedNoDate = 0;
    const expensePattern = /\[DAO Inventory Expense Event\]/i;
    
    Logger.log(`Total rows in source sheet: ${sourceData.length - 1} (excluding header)`);
    
    for (let i = 1; i < sourceData.length; i++) {
      // Check if row date is within the last 30 days
      const rowDateStr = sourceData[i][SALES_DATE_COL];
      const rowDate = parseDateFromYYYYMMDD(rowDateStr);
      
      if (!rowDate) {
        skippedNoDate++;
        continue; // Skip rows without valid dates
      }
      
      if (rowDate < cutoffDate) {
        skippedOldEntries++;
        continue; // Skip rows older than 30 days
      }
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
        
        // Prepare row data for Scored Expense Submissions sheet
        // Columns: A=Update ID, B=Chat ID, C=Chat Name, D=Message ID, E=Reporter, F=Expense Reported,
        //          G=Status Date, H=Contributor Name, I=Currency, J=Amount, K=Hash Key, L=Ledger Lines, M=Target Ledger
        const rowToAppend = [
          sourceData[i][TELEGRAM_UPDATE_ID_COL], // Column A: Telegram Update ID
          sourceData[i][CHAT_ID_COL], // Column B: Telegram Chatroom ID
          sourceData[i][CHAT_NAME_COL], // Column C: Telegram Chatroom Name
          sourceData[i][TELEGRAM_MESSAGE_ID_COL], // Column D: Telegram Message ID
          reporterName, // Column E: Reporter Name (validated via digital signature or Telegram handle)
          message, // Column F: Expense Reported (full message text)
          sourceData[i][SALES_DATE_COL], // Column G: Status Date (YYYYMMDD format)
          expenseDetails.daoMemberName, // Column H: Contributor Name (DAO Member who incurred expense)
          expenseDetails.inventoryType, // Column I: Currency (Inventory Type, may include [ledger name] prefix)
          expenseDetails.quantity * -1, // Column J: Amount (negative for expense)
          hashKey, // Column K: Scoring Hash Key (for deduplication)
          '', // Column L: Ledger Lines Number (will be filled after InsertExpenseRecords)
          expenseDetails.targetLedger || '' // Column M: Target Ledger (from expense form, e.g., "AGL10", "offchain")
        ];
        
        const lastRow = scoredExpenseSheet.getLastRow();
        const scoredRowNumber = lastRow + 1;
        scoredExpenseSheet.getRange(scoredRowNumber, 1, 1, rowToAppend.length).setValues([rowToAppend]);
        
        Logger.log(`Calling InsertExpenseRecords for row ${scoredRowNumber} with target ledger: ${rowToAppend[DEST_TARGET_LEDGER_COL] || 'not specified'}`);
        const transactionRowNumber = InsertExpenseRecords(rowToAppend, i);
        Logger.log(`InsertExpenseRecords returned: ${transactionRowNumber || 'null (failed to insert)'}`);
        
        if (transactionRowNumber) {
          scoredExpenseSheet.getRange(scoredRowNumber, DEST_TRANSACTION_LINE_COL + 1).setValue(transactionRowNumber);
          Logger.log(`Updated Column L (Ledger Lines Number) with row ${transactionRowNumber}`);
        } else {
          Logger.log(`Warning: InsertExpenseRecords returned null for row ${scoredRowNumber}. Expense was not inserted into ledger.`);
        }
        
        sendExpenseNotification(rowToAppend, scoredRowNumber, transactionRowNumber);
        
        existingHashKeys.push(hashKey);
        newEntries++;
        
        Logger.log(`Processed row ${i + 1} with hash key: ${hashKey}`);
      }
    }
    
    Logger.log(`Processed ${sourceData.length - 1} total rows from source sheet.`);
    Logger.log(`  - Rows processed (last 30 days): ${sourceData.length - 1 - skippedOldEntries - skippedNoDate}`);
    Logger.log(`  - Rows skipped (older than 30 days): ${skippedOldEntries}`);
    Logger.log(`  - Rows skipped (no valid date): ${skippedNoDate}`);
    Logger.log(`  - New expense entries added: ${newEntries}`);
    
    if (newEntries > 0) {
      Logger.log(`✅ Successfully processed ${newEntries} new expense entries. Check logs above for ledger insertion details.`);
    } else {
      Logger.log(`ℹ️ No new expense entries to process in the last 30 days.`);
    }
  } catch (e) {
    Logger.log(`❌ Error in parseAndProcessTelegramLogs: ${e.message}`);
    Logger.log(`Error stack: ${e.stack || 'No stack trace available'}`);
    throw e; // Re-throw to ensure error is visible
  }
}

/**
 * Webhook handler for processing expense submissions.
 * 
 * Handles GET requests with action parameter to trigger expense processing.
 * Called by Sidekiq background jobs from Edgar (sentiment_importer) when
 * expense submissions are received via submit_contribution endpoint.
 * 
 * @param {Object} e - Event object from Google Apps Script web app
 * @param {Object} e.parameter - URL parameters
 * @param {string} e.parameter.action - Action to perform ("parseAndProcessTelegramLogs")
 * @return {TextOutput} Response text indicating success or error
 */
function doGet(e) {
  const action = e.parameter?.action;
  Logger.log(`doGet called with action: ${action || 'none'}`);
  
  if (action === 'parseAndProcessTelegramLogs') {
    try {
      Logger.log("Webhook triggered: processing Telegram logs for expense submissions");
      parseAndProcessTelegramLogs();
      Logger.log("Webhook processing completed successfully");
      return ContentService.createTextOutput("✅ Telegram logs processed successfully. Check execution logs for details.");
    } catch (err) {
      Logger.log(`❌ Error in parseAndProcessTelegramLogs: ${err.message}`);
      Logger.log(`Error stack: ${err.stack || 'No stack trace available'}`);
      return ContentService.createTextOutput("❌ Error: " + err.message);
    }
  }

  Logger.log(`No valid action specified. Received action: ${action || 'none'}`);
  return ContentService.createTextOutput("ℹ️ No valid action specified. Expected: ?action=parseAndProcessTelegramLogs");
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
      sourceData[i][TELEGRAM_UPDATE_ID_COL], // Column A: Telegram Update ID
      sourceData[i][CHAT_ID_COL], // Column B: Telegram Chatroom ID
      sourceData[i][CHAT_NAME_COL], // Column C: Telegram Chatroom Name
      sourceData[i][TELEGRAM_MESSAGE_ID_COL], // Column D: Telegram Message ID
      reporterName, // Column E: Reporter Name
      message, // Column F: Expense Reported
      sourceData[i][SALES_DATE_COL], // Column G: Status Date
      expenseDetails.daoMemberName, // Column H: Contributor Name (DAO Member)
      expenseDetails.inventoryType, // Column I: Currency (Inventory Type)
      expenseDetails.quantity * -1, // Column J: Amount (negative for expense)
      hashKey, // Column K: Scoring Hash Key
      '', // Column L: Ledger Lines Number (will be filled after insertion)
      expenseDetails.targetLedger || '' // Column M: Target Ledger (from expense form)
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

/**
 * Checks if a file already exists at the given GitHub URL.
 * 
 * Used to prevent duplicate file uploads. Returns true if the file
 * is accessible (HTTP 200), false otherwise.
 * 
 * @param {string} fileUrl - GitHub URL to check (tree/blob format)
 * @return {boolean} True if file exists and is accessible, false otherwise
 */
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