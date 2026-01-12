/**
 * File: google_app_scripts/tdg_inventory_management/process_movement_telegram_logs.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * 
 * Description: Processes inventory movement requests from Telegram, validates them, and updates both source and destination ledgers.
 * 
 * Deployment URL: https://script.google.com/macros/s/AKfycbzECOd1Y3mH7L0zU8hOC4AxQctYICX0Ws8j2-Md1dWg0k3GFGQx_4Cf7n-CM0usmSJ1/exec
 */

// Load API keys and configuration settings from Credentials.gs
setApiKeys();
const creds = getCredentials();
const WIX_ACCESS_TOKEN = creds.WIX_API_KEY;

// Configuration Variables
const TELEGRAM_CHAT_ID = '-1002190388985'; // Fixed chat ID for Telegram notifications
const INVENTORY_SPREADSHEET_ID = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
const OFFCHAIN_SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
const TELEGRAM_SHEET_NAME = 'Telegram Chat Logs';
const INVENTORY_SHEET_NAME = 'Inventory Movement';
const OFFCHAIN_SHEET_NAME = 'offchain transactions';
const AGL_SHEET_NAME = 'Transactions';
const OFFCHAIN_ASSET_SHEET_NAME = 'offchain asset location';
const DEFAULT_AGL_SHEET_NAME = 'Balance'; // Default sheet name for AGL ledgers
const MAX_REDIRECTS = 10; // Maximum number of redirects to follow in resolveRedirect
const AGROVERSE_QR_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit';
const AGROVERSE_QR_SHEET_NAME = 'Agroverse QR codes';
const CONTRIBUTORS_SHEET_NAME = 'Contributors contact information';
const SHIPMENT_LEDGER_SHEET_NAME = 'Shipment Ledger Listing';
const QR_CODE_COL = 0; // Column A (0-indexed)
const LEDGER_COL = 2; // Column C (0-indexed) - ledger shortcut
const CURRENCY_COL = 8; // Column I (0-indexed) - Currency/Inventory Type
const MANAGER_NAME_COL = 20; // Column U (0-indexed) - Manager Name
const CONTRIBUTOR_NAME_COL = 0; // Column A (0-indexed) - Contributor Name
const CONTRIBUTORS_DATA_START_ROW = 5; // Data starts at row 5 (row 4 is header)
// Shipment Ledger Listing columns (0-indexed)
const SHIPMENT_ID_COL = 0; // Column A - Shipment ID (ledger name)
const LEDGER_URL_COL = 11; // Column L - Ledger URL

/**
 * Resolves redirect URLs to get the final URL.
 * First checks "Shipment Ledger Listing" sheet (Column L -> Column AB lookup)
 * Falls back to HTTP resolution if not found in sheet
 * @param {string} url - The URL to resolve.
 * @return {string} The resolved URL or empty string on error.
 */
function resolveRedirect(url) {
  console.log("resolving " + url);
  try {
    // First, try to look up the URL in "Shipment Ledger Listing" sheet
    // Column L (index 11) = unresolved URL, Column AB (index 27) = resolved URL
    try {
      const spreadsheet = SpreadsheetApp.openByUrl(AGROVERSE_QR_SHEET_URL);
      const shipmentSheet = spreadsheet.getSheetByName(SHIPMENT_LEDGER_SHEET_NAME);
      
      if (shipmentSheet) {
        const lastRow = shipmentSheet.getLastRow();
        if (lastRow >= 2) {
          // Read columns A to AB (28 columns) to get both Column L and Column AB
          const dataRange = shipmentSheet.getRange(2, 1, lastRow - 1, 28);
          const data = dataRange.getValues();
          
          for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const ledgerUrl = row[LEDGER_URL_COL] ? row[LEDGER_URL_COL].toString().trim() : ''; // Column L (index 11)
            
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
      Logger.log(responseCode);

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

      // Get the Location header for HTTP redirect
      const headers = response.getHeaders();
      const location = headers['Location'] || headers['location'];
      console.log(location);
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
      console.log("resolve count " + redirectCount);
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
 * Migrated from Wix API to Google Sheets for cost savings.
 * @return {Array} Array of ledger configuration objects.
 */
function getLedgerConfigsFromWix() {
  // Note: Function name kept for backward compatibility, but now reads from Google Sheets
  try {
    const spreadsheet = SpreadsheetApp.openByUrl(AGROVERSE_QR_SHEET_URL);
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
            sheet_name: 'Balance',
            manager_names_column: 'H',
            asset_name_column: 'J',
            asset_quantity_column: 'I',
            record_start_row: 6
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
 * Looks up QR code information from Agroverse QR codes sheet.
 * @param {string} qrCode - The QR code to look up.
 * @return {Object} Object with currency (inventory type) and ledger_url, or null if not found.
 */
function lookupQRCode(qrCode) {
  try {
    const agroverseSpreadsheet = SpreadsheetApp.openByUrl(AGROVERSE_QR_SHEET_URL);
    const agroverseSheet = agroverseSpreadsheet.getSheetByName(AGROVERSE_QR_SHEET_NAME);
    if (!agroverseSheet) {
      Logger.log(`Error: Agroverse QR codes sheet not found`);
      return null;
    }
    
    const agroverseData = agroverseSheet.getDataRange().getValues();
    
    // Skip header row (row 0)
    for (let i = 1; i < agroverseData.length; i++) {
      const row = agroverseData[i];
      if (row[QR_CODE_COL] && row[QR_CODE_COL].toString().trim() === qrCode.trim()) {
        const currency = row[CURRENCY_COL] ? row[CURRENCY_COL].toString().trim() : '';
        const ledgerShortcut = row[LEDGER_COL] ? row[LEDGER_COL].toString().trim() : '';
        
        Logger.log(`Found QR code ${qrCode}: currency=${currency}, ledger=${ledgerShortcut}`);
        
        return {
          currency: currency,
          ledger_shortcut: ledgerShortcut,
          qr_code: qrCode,
          row_index: i + 1 // Return 1-based row index for updating
        };
      }
    }
    
    Logger.log(`QR code ${qrCode} not found in Agroverse QR codes sheet`);
    return null;
  } catch (e) {
    Logger.log(`Error looking up QR code ${qrCode}: ${e.message}`);
    return null;
  }
}

/**
 * Updates the Manager Name (Column U) in Agroverse QR codes sheet for a given QR code.
 * @param {string} qrCode - The QR code to update.
 * @param {string} managerName - The manager name to set.
 * @return {boolean} True if update was successful, false otherwise.
 */
function updateAgroverseQrManagerName(qrCode, managerName) {
  try {
    const agroverseSpreadsheet = SpreadsheetApp.openByUrl(AGROVERSE_QR_SHEET_URL);
    const agroverseSheet = agroverseSpreadsheet.getSheetByName(AGROVERSE_QR_SHEET_NAME);
    if (!agroverseSheet) {
      Logger.log(`Error: Agroverse QR codes sheet not found`);
      return false;
    }
    
    const agroverseData = agroverseSheet.getDataRange().getValues();
    
    // Skip header row (row 0)
    for (let i = 1; i < agroverseData.length; i++) {
      const row = agroverseData[i];
      if (row[QR_CODE_COL] && row[QR_CODE_COL].toString().trim() === qrCode.trim()) {
        // Update Column U (index 20, 1-based column 21)
        agroverseSheet.getRange(i + 1, MANAGER_NAME_COL + 1).setValue(managerName);
        Logger.log(`Updated QR code ${qrCode} Manager Name to "${managerName}" in Agroverse QR codes sheet (row ${i + 1}, column U)`);
        return true;
      }
    }
    
    Logger.log(`QR code ${qrCode} not found in Agroverse QR codes sheet for manager name update`);
    return false;
  } catch (e) {
    Logger.log(`Error updating Manager Name for QR code ${qrCode}: ${e.message}`);
    return false;
  }
}

/**
 * Checks if a recipient name exists in the Contributors contact information sheet.
 * Performs case-insensitive comparison to avoid duplicates.
 * @param {string} recipientName - The recipient name to check.
 * @return {boolean} True if recipient exists, false otherwise.
 */
function recipientExists(recipientName) {
  try {
    if (!recipientName || recipientName.trim() === '') {
      return false; // Empty names don't exist
    }
    
    const contributorsSpreadsheet = SpreadsheetApp.openByUrl(AGROVERSE_QR_SHEET_URL);
    const contributorsSheet = contributorsSpreadsheet.getSheetByName(CONTRIBUTORS_SHEET_NAME);
    if (!contributorsSheet) {
      Logger.log(`Error: ${CONTRIBUTORS_SHEET_NAME} sheet not found`);
      return false;
    }
    
    const lastRow = contributorsSheet.getLastRow();
    if (lastRow < CONTRIBUTORS_DATA_START_ROW) {
      return false; // No data rows
    }
    
    // Read Column A starting from data start row
    const dataRange = contributorsSheet.getRange(CONTRIBUTORS_DATA_START_ROW, 1, lastRow - CONTRIBUTORS_DATA_START_ROW + 1, 1);
    const data = dataRange.getValues();
    
    // Normalize the recipient name for comparison (trim and lowercase)
    const normalizedRecipientName = recipientName.trim().toLowerCase();
    
    for (let i = 0; i < data.length; i++) {
      const name = data[i][0];
      if (name && typeof name === 'string') {
        const normalizedName = name.trim().toLowerCase();
        if (normalizedName === normalizedRecipientName) {
          Logger.log(`Recipient "${recipientName}" already exists in Contributors sheet (row ${CONTRIBUTORS_DATA_START_ROW + i})`);
          return true;
        }
      }
    }
    
    return false;
  } catch (e) {
    Logger.log(`Error checking if recipient exists: ${e.message}`);
    return false;
  }
}

/**
 * Adds a new recipient to the Contributors contact information sheet.
 * Finds the first empty row (where Column A is empty) and adds the name there.
 * Will NOT add the recipient if it already exists in Column A (case-insensitive check).
 * @param {string} recipientName - The recipient name to add.
 * @return {boolean} True if addition was successful or recipient already exists, false otherwise.
 */
function addNewRecipient(recipientName) {
  try {
    if (!recipientName || recipientName.trim() === '') {
      Logger.log('Error: Empty recipient name provided');
      return false;
    }
    
    // Check if recipient already exists - this prevents duplicates
    if (recipientExists(recipientName)) {
      Logger.log(`Recipient "${recipientName}" already exists in Contributors sheet (Column A), skipping addition to prevent duplicate`);
      return true; // Return true since it already exists (no error)
    }
    
    const contributorsSpreadsheet = SpreadsheetApp.openByUrl(AGROVERSE_QR_SHEET_URL);
    const contributorsSheet = contributorsSpreadsheet.getSheetByName(CONTRIBUTORS_SHEET_NAME);
    if (!contributorsSheet) {
      Logger.log(`Error: ${CONTRIBUTORS_SHEET_NAME} sheet not found`);
      return false;
    }
    
    const lastRow = contributorsSheet.getLastRow();
    let targetRow = CONTRIBUTORS_DATA_START_ROW;
    
    // Check if there are existing rows
    if (lastRow >= CONTRIBUTORS_DATA_START_ROW) {
      // Read Column A to find first empty row
      const dataRange = contributorsSheet.getRange(CONTRIBUTORS_DATA_START_ROW, 1, lastRow - CONTRIBUTORS_DATA_START_ROW + 1, 1);
      const data = dataRange.getValues();
      
      // Find first empty row
      let foundEmpty = false;
      for (let i = 0; i < data.length; i++) {
        const name = data[i][0];
        if (!name || name.toString().trim() === '') {
          targetRow = CONTRIBUTORS_DATA_START_ROW + i;
          foundEmpty = true;
          break;
        }
      }
      
      // If no empty row found, add to the end
      if (!foundEmpty) {
        targetRow = lastRow + 1;
      }
    }
    
    // Add the new recipient name in Column A
    contributorsSheet.getRange(targetRow, CONTRIBUTOR_NAME_COL + 1).setValue(recipientName.trim());
    Logger.log(`Added new recipient "${recipientName}" to Contributors sheet at row ${targetRow}`);
    return true;
  } catch (e) {
    Logger.log(`Error adding new recipient "${recipientName}": ${e.message}`);
    return false;
  }
}

/**
 * Processes the inventory movement report string copied to the clipboard and returns a JSON object
 * with extracted sender name, recipient name, currency, amount, and source details.
 * The input string is expected to match the format generated by the Report Inventory Movement button:
 * "[INVENTORY MOVEMENT] manager name: <managerName>\nrecipient name: <recipientName>\ninventory item: <itemName>\nquantity: <quantity>"
 * 
 * If a QR code is provided, it will be looked up to determine the inventory type and ledger automatically.
 *
 * @param {string} reportText - The text copied to the clipboard from the Report Inventory Movement button.
 * @return {Object} JSON object containing extracted fields, source details, or an error message.
 */
function processInventoryReport(reportText) {
  try {
    // Validate input
    if (!reportText || typeof reportText !== 'string') {
      return { error: 'Invalid or empty report text' };
    }

    Logger.log(reportText);

    // Expected format: [INVENTORY MOVEMENT] manager name: ... \nrecipient name: ... \ninventory item: ... \nquantity: ...
    const lines = reportText.split('\n').map(line => line.trim());
    
    // Check for correct header
    if (!lines[0].startsWith('[INVENTORY MOVEMENT]')) {
      return { error: 'Invalid report format: Missing [INVENTORY MOVEMENT] header' };
    }

    // Extract fields using regex for key-value pairs
    const managerMatch = lines.find(line => line.startsWith('- Manager Name:'));
    const recipientMatch = lines.find(line => line.startsWith('- Recipient Name:'));
    const itemMatch = lines.find(line => line.startsWith('- Inventory Item:'));
    const qrCodeMatch = lines.find(line => line.startsWith('- QR Code:'));
    const quantityMatch = lines.find(line => line.startsWith('- Quantity:'));

    if (!managerMatch || !recipientMatch || !quantityMatch) {
      return { error: 'Invalid report format: Missing required fields' };
    }

    // Extract values
    const managerName = managerMatch.replace('- Manager Name:', '').trim();
    const recipientName = recipientMatch.replace('- Recipient Name:', '').trim();
    let currency = itemMatch ? itemMatch.replace('- Inventory Item:', '').trim() : '';
    const qrCode = qrCodeMatch ? qrCodeMatch.replace('- QR Code:', '').trim() : null;
    const quantity = parseFloat(quantityMatch.replace('- Quantity:', '').trim());
    
    // If QR code is provided, look it up to determine inventory type and ledger
    let qrCodeInfo = null;
    if (qrCode) {
      qrCodeInfo = lookupQRCode(qrCode);
      if (qrCodeInfo && qrCodeInfo.currency) {
        // Use the currency from QR code lookup
        currency = qrCodeInfo.currency;
        Logger.log(`Using currency from QR code lookup: ${currency}`);
      } else {
        Logger.log(`Warning: QR code ${qrCode} not found, using provided inventory item: ${currency}`);
      }
    }
    
    if (!currency) {
      return { error: 'Invalid report format: Missing inventory item or QR code' };
    }

    // Validate quantity
    if (isNaN(quantity) || quantity <= 0) {
      return { error: 'Invalid quantity: Must be a positive number' };
    }

    // Determine currency source (offchain or AGL ledger)
    let currencySource = {
      spreadsheet_id: '',
      sheet_name: '',
      ledger_name: '',
      ledger_url: ''
    };

    // If QR code lookup provided ledger shortcut, use it to find the ledger
    if (qrCodeInfo && qrCodeInfo.ledger_shortcut) {
      const ledgerShortcut = qrCodeInfo.ledger_shortcut;
      Logger.log(`Using ledger shortcut from QR code: ${ledgerShortcut}`);
      
      // Get the actual ledger URL from WIX data
      const ledgerConfigs = getLedgerConfigsFromWix();
      
      // Log available ledger configs for debugging
      Logger.log(`Available ledger configs: ${ledgerConfigs.map(c => c.ledger_name).join(', ')}`);
      
      // Try multiple matching strategies
      const ledgerConfig = ledgerConfigs.find(config => {
        const configName = config.ledger_name.toLowerCase().trim();
        const shortcutLower = ledgerShortcut.toLowerCase().trim();
        const configUrl = config.ledger_url.toLowerCase();
        
        // Strategy 1: Exact match of ledger name
        if (configName === shortcutLower) {
          Logger.log(`Matched ledger by exact name: ${config.ledger_name}`);
          return true;
        }
        
        // Strategy 2: URL contains the shortcut
        if (configUrl.includes(shortcutLower)) {
          Logger.log(`Matched ledger by URL containing shortcut: ${config.ledger_name}`);
          return true;
        }
        
        // Strategy 3: Remove spaces/dashes and match (e.g., "AGL 10" or "AGL-10" matches "AGL10")
        const configNameNormalized = configName.replace(/[\s\-_]/g, '');
        const shortcutNormalized = shortcutLower.replace(/[\s\-_]/g, '');
        if (configNameNormalized === shortcutNormalized) {
          Logger.log(`Matched ledger by normalized name: ${config.ledger_name}`);
          return true;
        }
        
        // Strategy 4: Extract number from AGL format and match (e.g., "AGL10" -> "10", matches "AGL 10")
        const aglNumberMatch = shortcutLower.match(/agl\s*(\d+)/i);
        if (aglNumberMatch) {
          const number = aglNumberMatch[1];
          const configNumberMatch = configName.match(/agl\s*(\d+)/i);
          if (configNumberMatch && configNumberMatch[1] === number) {
            Logger.log(`Matched ledger by AGL number: ${config.ledger_name}`);
            return true;
          }
        }
        
        // Strategy 5: Extract ledger identifier from URL (e.g., "https://agroverse.shop/agl10" -> "agl10")
        // and match to ledger name (e.g., "AGL10")
        const urlMatch = shortcutLower.match(/\/(agl\d+|sef\d+|pp\d+)/i);
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
        currencySource = {
          spreadsheet_id: ledgerConfig.ledger_url.match(/\/d\/([^\/]+)/)?.[1] || '',
          sheet_name: DEFAULT_AGL_SHEET_NAME,
          ledger_name: ledgerConfig.ledger_name,
          ledger_url: ledgerConfig.ledger_url
        };
        Logger.log(`Found ledger from QR code shortcut: ${ledgerConfig.ledger_name} (URL: ${ledgerConfig.ledger_url})`);
      } else {
        Logger.log(`Warning: Ledger shortcut "${ledgerShortcut}" from QR code not found in Shipment Ledger Listing. Available ledgers: ${ledgerConfigs.map(c => c.ledger_name).join(', ')}. Treating as offchain.`);
        currencySource = {
          spreadsheet_id: OFFCHAIN_SPREADSHEET_ID,
          sheet_name: OFFCHAIN_ASSET_SHEET_NAME,
          ledger_name: 'offchain',
          ledger_url: `https://docs.google.com/spreadsheets/d/${OFFCHAIN_SPREADSHEET_ID}/edit`
        };
      }
    } else {
      // Check if currency is from any ledger (format: [LEDGER_NAME] currency_name)
      const ledgerMatch = currency.match(/^\[([^\]]+)\]\s*(.+)$/);
      if (ledgerMatch) {
        const ledgerName = ledgerMatch[1];
        // Get the actual ledger URL from WIX data
        const ledgerConfigs = getLedgerConfigsFromWix();
        const ledgerConfig = ledgerConfigs.find(config => 
          config.ledger_name === ledgerName || 
          config.ledger_name.toLowerCase() === ledgerName.toLowerCase()
        );
        
        if (ledgerConfig && ledgerConfig.ledger_url) {
          currencySource = {
            spreadsheet_id: ledgerConfig.ledger_url.match(/\/d\/([^\/]+)/)?.[1] || '', // Extract spreadsheet ID from resolved URL
            sheet_name: DEFAULT_AGL_SHEET_NAME,
            ledger_name: ledgerConfig.ledger_name,
            ledger_url: ledgerConfig.ledger_url
          };
        } else {
          Logger.log(`Warning: Ledger ${ledgerName} not found in WIX data, treating as offchain`);
          // Fall back to offchain if ledger not found in WIX
          currencySource = {
            spreadsheet_id: OFFCHAIN_SPREADSHEET_ID,
            sheet_name: OFFCHAIN_ASSET_SHEET_NAME,
            ledger_name: 'offchain',
            ledger_url: `https://docs.google.com/spreadsheets/d/${OFFCHAIN_SPREADSHEET_ID}/edit`
          };
        }
      } else {
        // Assume currency is from offchain asset location
        currencySource = {
          spreadsheet_id: OFFCHAIN_SPREADSHEET_ID,
          sheet_name: OFFCHAIN_ASSET_SHEET_NAME,
          ledger_name: 'offchain',
          ledger_url: `https://docs.google.com/spreadsheets/d/${OFFCHAIN_SPREADSHEET_ID}/edit`
        };
      }
    }

    // Return JSON object with extracted fields and source details
    return {
      sender_name: managerName,
      recipient_name: recipientName,
      currency: currency,
      amount: quantity,
      currency_source: currencySource
    };
  } catch (error) {
    Logger.log('Error processing inventory report: ' + error.message);
    return { error: 'Error processing report: ' + error.message };
  }
}

/**
 * Parses the "Telegram Chat Logs" sheet (Column G) for entries matching the [INVENTORY MOVEMENT] pattern,
 * processes them using processInventoryReport, uploads associated files to GitHub if available,
 * and inserts new records into the "Inventory Movement" sheet.
 * Skips records already existing in "Inventory Movement" based on Telegram Update ID (Column A).
 * Maps columns as follows:
 * - Telegram Chat Logs Column A (Telegram Update ID) -> Inventory Movement Column A
 * - Telegram Chat Logs Column B (Telegram Chatroom ID) -> Inventory Movement Column B
 * - Telegram Chat Logs Column C (Telegram Chatroom Name) -> Inventory Movement Column C
 * - Telegram Chat Logs Column D (Telegram Message ID) -> Inventory Movement Column D
 * - Telegram Chat Logs Column E (Contributor Name) -> Inventory Movement Column E
 * - Telegram Chat Logs Column G (Contribution Made) -> Inventory Movement Column F
 * - Telegram Chat Logs Column L (Status Date) -> Inventory Movement Column G
 * - Inventory Movement Column H: sender_name extracted from Column G
 * - Inventory Movement Column I: recipient_name extracted from Column G
 * - Inventory Movement Column J: currency extracted from Column G, with [AGL#] prefix removed
 * - Inventory Movement Column K: amount extracted from Column G
 * - Inventory Movement Column L: ledger_name extracted from Column G
 * - Inventory Movement Column M: ledger_url extracted from Column G
 * - Inventory Movement Column N: "NEW"
 */
function processTelegramChatLogsToInventoryMovement() {
  try {
    // Open the spreadsheet
    const spreadsheet = SpreadsheetApp.openById(INVENTORY_SPREADSHEET_ID);
    const telegramSheet = spreadsheet.getSheetByName(TELEGRAM_SHEET_NAME);
    const inventorySheet = spreadsheet.getSheetByName(INVENTORY_SHEET_NAME);

    if (!telegramSheet || !inventorySheet) {
      Logger.log(`Error: Sheet not found - Telegram Chat Logs: ${!!telegramSheet}, Inventory Movement: ${!!inventorySheet}`);
      return;
    }

    // Get existing Telegram Update IDs in Inventory Movement to avoid duplicates
    const inventoryLastRow = inventorySheet.getLastRow();
    const existingUpdateIds = inventoryLastRow > 0
      ? inventorySheet.getRange(1, 1, inventoryLastRow, 1).getValues().map(row => row[0])
      : [];

    // Get data from Telegram Chat Logs (starting from row 1, assuming no header)
    const telegramLastRow = telegramSheet.getLastRow();
    if (telegramLastRow < 1) {
      Logger.log('No data in Telegram Chat Logs');
      return;
    }
    // Read up to Column O (15th column) to include file IDs
    const telegramData = telegramSheet.getRange(1, 1, telegramLastRow, 15).getValues(); // Columns A to O

    // Prepare array to collect new rows for batch insertion
    const newRows = [];

    // Process each row in Telegram Chat Logs
    telegramData.forEach((row, index) => {
      const updateId = row[0]; // Column A: Telegram Update ID
      const contribution = row[6]; // Column G: Contribution Made

      // Skip if updateId is empty or already exists in Inventory Movement
      if (!updateId || existingUpdateIds.includes(updateId)) {
        return;
      }

      // Check if Contribution Made matches [INVENTORY MOVEMENT] pattern
      if (typeof contribution === 'string' && contribution.trim().startsWith('[INVENTORY MOVEMENT]')) {
        // Get file IDs from the previous row (if it exists)
        const fileIdsString = (index > 0 && telegramData[index - 1][14]) ? telegramData[index - 1][14].toString().trim() : '';

        const reportResult = processInventoryReport(contribution);
        if (reportResult.error) {
          Logger.log(`Error processing contribution for Update ID ${updateId}: ${reportResult.error}`);
          return;
        }

        // Extract file-related fields from contribution
        const lines = contribution.split('\n').map(line => line.trim());
        const attachedFilenameMatch = lines.find(line => line.startsWith('- Attached Filename:'));
        const destinationMatch = lines.find(line => line.startsWith('- Destination Inventory File Location:'));
        const attachedFilename = attachedFilenameMatch ? attachedFilenameMatch.replace('- Attached Filename:', '').trim() : null;
        const destinationInventoryFileLocation = destinationMatch ? destinationMatch.replace('- Destination Inventory File Location:', '').trim() : null;

        // Process file uploads if file IDs and destination are available
        if (fileIdsString && attachedFilename && destinationInventoryFileLocation && destinationInventoryFileLocation !== 'No file attached') {
          const fileIds = fileIdsString.split(',').map(id => id.trim()).filter(id => id);
          Logger.log(`Processing ${fileIds.length} file IDs for Update ID ${updateId}: ${fileIds.join(', ')}`);
          
          fileIds.forEach((fileId, fileIndex) => {
            // Generate unique destination URL for multiple files
            let destinationUrl = fileIndex === 0 ? destinationInventoryFileLocation : generateUniqueGitHubFilename(destinationInventoryFileLocation, fileIndex);
            if (!destinationUrl) {
              Logger.log(`Failed to generate destination URL for file ID ${fileId} at Update ID ${updateId}`);
              return;
            }

            // Check if file already exists in GitHub
            if (!checkFileExistsInGitHub(destinationUrl)) {
              const uploaded = uploadFileToGitHub(fileId, destinationUrl, `Inventory movement file upload for ${attachedFilename}`);
              if (uploaded) {
                Logger.log(`Successfully uploaded file ${fileId} for Update ID ${updateId} to ${destinationUrl}`);
              } else {
                Logger.log(`Failed to upload file ${fileId} for Update ID ${updateId} to ${destinationUrl}`);
              }
            } else {
              Logger.log(`File already exists at ${destinationUrl} for Update ID ${updateId}, skipping upload`);
            }
          });
        } else {
          Logger.log(`No file upload required for Update ID ${updateId}: File IDs: ${fileIdsString}, Filename: ${attachedFilename}, Destination: ${destinationInventoryFileLocation}`);
        }

        // Map currency to original value by removing [LEDGER_NAME] prefix
        const originalCurrency = reportResult.currency.replace(/^\[[^\]]+\]\s*/, '');

        // Extract QR code from contribution if present
        const qrCodeMatch = lines.find(line => line.startsWith('- QR Code:'));
        const qrCode = qrCodeMatch ? qrCodeMatch.replace('- QR Code:', '').trim() : null;
        
        // Check if recipient exists, if not add them to Contributors sheet
        if (reportResult.recipient_name && reportResult.recipient_name.trim() !== '') {
          const exists = recipientExists(reportResult.recipient_name);
          if (!exists) {
            const added = addNewRecipient(reportResult.recipient_name);
            if (added) {
              Logger.log(`Successfully added new recipient "${reportResult.recipient_name}" to Contributors sheet`);
            } else {
              Logger.log(`Warning: Failed to add new recipient "${reportResult.recipient_name}" to Contributors sheet`);
            }
          }
        }
        
        // If QR code is provided, update the Manager Name in Agroverse QR codes sheet
        // The Manager Name should be set to the recipient name, as the recipient is now the holder of the QR code
        if (qrCode && reportResult.recipient_name) {
          const updated = updateAgroverseQrManagerName(qrCode, reportResult.recipient_name);
          if (updated) {
            Logger.log(`Successfully updated Manager Name for QR code ${qrCode} to ${reportResult.recipient_name} (recipient is now the holder)`);
          } else {
            Logger.log(`Warning: Failed to update Manager Name for QR code ${qrCode}`);
          }
        }

        // Create new row for Inventory Movement
        const newRow = [
          row[0], // Column A: Telegram Update ID
          row[1], // Column B: Telegram Chatroom ID
          row[2], // Column C: Telegram Chatroom Name
          row[3], // Column D: Telegram Message ID
          row[4], // Column E: Contributor Name
          row[6], // Column F: Contribution Made
          row[11], // Column G: Status Date
          reportResult.sender_name, // Column H: sender_name
          reportResult.recipient_name, // Column I: recipient_name
          originalCurrency, // Column J: currency (without [AGL#])
          reportResult.amount, // Column K: amount
          reportResult.currency_source.ledger_name, // Column L: ledger_name
          reportResult.currency_source.ledger_url, // Column M: ledger_url
          'NEW' // Column N: Status
        ];

        newRows.push(newRow);
      }
    });

    // Insert new rows into Inventory Movement sheet
    if (newRows.length > 0) {
      inventorySheet.getRange(inventoryLastRow + 1, 1, newRows.length, 14).setValues(newRows);
      Logger.log(`Inserted ${newRows.length} new records into Inventory Movement`);
    } else {
      Logger.log('No new valid inventory movement records found in Telegram Chat Logs');
    }
  } catch (error) {
    Logger.log(`Error in processTelegramChatLogsToInventoryMovement: ${error.message}`);
  }
}

/**
 * Sends a Telegram notification to the specified chat ID with transaction details.
 * @param {string} contributionMade - The Contribution Made field from Inventory Movement Column F.
 * @param {string} ledgerName - The ledger name (e.g., AGL6 or offchain).
 * @param {string} ledgerUrl - The ledger URL from Inventory Movement Column M.
 */
function sendInventoryTransactionNotification(contributionMade, ledgerName, ledgerUrl) {
  const token = creds.TELEGRAM_API_TOKEN;
  if (!token) {
    Logger.log(`sendInventoryTransactionNotification: Error: TELEGRAM_API_TOKEN not set in Credentials`);
    return;
  }

  const apiUrl = `https://api.telegram.org/bot${token}/sendMessage`;

  // Format the notification message with details from contributionMade
  const messageText = `✅ Transaction successfully updated on ${ledgerName} ledger.\n\nDetails:\n${contributionMade}\n\nReview here: ${ledgerUrl}`;

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
    Logger.log(`sendInventoryTransactionNotification: Sending notification for transaction on ${ledgerName} to chat ${TELEGRAM_CHAT_ID}`);
    const response = UrlFetchApp.fetch(apiUrl, options);
    const status = response.getResponseCode();
    const responseText = response.getContentText();
    if (status === 200) {
      Logger.log(`sendInventoryTransactionNotification: Successfully sent notification for transaction on ${ledgerName} to chat ${TELEGRAM_CHAT_ID}`);
    } else {
      Logger.log(`sendInventoryTransactionNotification: Failed to send notification for ${ledgerName}. Status: ${status}, Response: ${responseText}`);
    }
  } catch (e) {
    Logger.log(`sendInventoryTransactionNotification: Error sending Telegram notification for ${ledgerName}: ${e.message}`);
  }
}

/**
 * Parses the "Inventory Movement" sheet for records with status "NEW" in Column N and inserts double-entry
 * records into the respective ledgers (AGL or offchain). Updates Column O with the row numbers of the
 * inserted records, sets Column N to "PROCESSED", and sends a Telegram notification with transaction details.
 * For AGL ledgers, inserts into the "Balance" sheet of the spreadsheet from Column M (ledger_url).
 * For offchain ledgers, inserts into the "offchain transactions" sheet of the offchain SPREADSHEET_ID.
 * Double-entry mappings:
 * Part 1 (Sender/Debit):
 * - Column A: Status Date (Inventory Movement Column G)
 * - Column B: Contribution Made (Inventory Movement Column F)
 * - Column C: Sender Name (Inventory Movement Column H)
 * - Column D: Amount * -1 (Inventory Movement Column K)
 * - Column E: Currency (Inventory Movement Column J)
 * - Column F: "Assets" (for AGL ledgers only)
 * Part 2 (Recipient/Credit):
 * - Column A: Status Date (Inventory Movement Column G)
 * - Column B: Contribution Made (Inventory Movement Column F)
 * - Column C: Recipient Name (Inventory Movement Column I)
 * - Column D: Amount (Inventory Movement Column K)
 * - Column E: Currency (Inventory Movement Column J)
 * - Column F: "Assets" (for AGL ledgers only)
 */
function processInventoryMovementToLedgers() {
  try {
    // Open the Inventory Movement spreadsheet
    const inventorySpreadsheet = SpreadsheetApp.openById(INVENTORY_SPREADSHEET_ID);
    const inventorySheet = inventorySpreadsheet.getSheetByName(INVENTORY_SHEET_NAME);

    if (!inventorySheet) {
      Logger.log(`Error: Inventory Movement sheet not found`);
      return;
    }

    // Get all data from Inventory Movement (Columns A to O)
    const inventoryLastRow = inventorySheet.getLastRow();
    if (inventoryLastRow < 1) {
      Logger.log('No data in Inventory Movement');
      return;
    }
    const inventoryData = inventorySheet.getRange(1, 1, inventoryLastRow, 15).getValues(); // Columns A to O (to check Column O for backfill)

    // Process each row in Inventory Movement
    const updates = []; // Store updates for Column N (status) and Column O (row numbers)
    inventoryData.forEach((row, index) => {
      const rowNumber = index + 1;
      const status = row[13]; // Column N: Status
      if (status !== 'NEW') {
        return; // Skip if status is not NEW
      }

      const ledgerName = row[11]; // Column L: ledger_name
      const ledgerUrl = row[12]; // Column M: ledger_url
      const statusDate = row[6]; // Column G: Status Date
      const contributionMade = row[5]; // Column F: Contribution Made
      const senderName = row[7]; // Column H: sender_name
      const recipientName = row[8]; // Column I: recipient_name
      const currency = row[9]; // Column J: currency (without [AGL#])
      const amount = row[10]; // Column K: amount
      
      // Extract QR code from contribution if present
      let qrCode = null;
      if (typeof contributionMade === 'string') {
        const lines = contributionMade.split('\n').map(line => line.trim());
        const qrCodeMatch = lines.find(line => line.startsWith('- QR Code:'));
        qrCode = qrCodeMatch ? qrCodeMatch.replace('- QR Code:', '').trim() : null;
      }

      // Validate required fields
      if (!statusDate || !contributionMade || !senderName || !recipientName || !currency || !amount) {
        Logger.log(`Skipping row ${rowNumber}: Missing required fields`);
        return;
      }

      let targetSpreadsheetId, targetSheetName;
      if (ledgerName === 'offchain') {
        targetSpreadsheetId = OFFCHAIN_SPREADSHEET_ID;
        targetSheetName = OFFCHAIN_SHEET_NAME;
      } else {
        // For AGL ledgers, resolve redirect URL first, then extract spreadsheet ID
        let resolvedLedgerUrl = ledgerUrl;
        if (ledgerUrl && typeof ledgerUrl === 'string' && ledgerUrl.trim()) {
          resolvedLedgerUrl = resolveRedirect(ledgerUrl.trim());
          if (!resolvedLedgerUrl) {
            Logger.log(`Skipping row ${rowNumber}: Could not resolve ledger URL for ${ledgerName}: ${ledgerUrl}`);
            // Mark as error instead of leaving as NEW
            inventorySheet.getRange(rowNumber, 14).setValue('ERROR: Could not resolve ledger URL');
            return;
          }
        }
        // Extract spreadsheet ID from resolved URL
        targetSpreadsheetId = resolvedLedgerUrl.match(/\/d\/([^\/]+)/)?.[1] || '';
        targetSheetName = AGL_SHEET_NAME;
      }

      if (!targetSpreadsheetId) {
        Logger.log(`Skipping row ${rowNumber}: Invalid ledger URL for ${ledgerName}: ${ledgerUrl}`);
        // Mark as error instead of leaving as NEW
        inventorySheet.getRange(rowNumber, 14).setValue('ERROR: Invalid ledger URL');
        return;
      }

      // Open the target ledger spreadsheet
      let targetSheet;
      try {
        const targetSpreadsheet = SpreadsheetApp.openById(targetSpreadsheetId);
        targetSheet = targetSpreadsheet.getSheetByName(targetSheetName);
        if (!targetSheet) {
          Logger.log(`Error: Sheet ${targetSheetName} not found in spreadsheet ${targetSpreadsheetId} for row ${rowNumber}`);
          return;
        }
      } catch (e) {
        Logger.log(`Error accessing spreadsheet ${targetSpreadsheetId} for row ${rowNumber}: ${e.message}`);
        return;
      }

      // Get the last row of the target sheet
      const targetLastRow = targetSheet.getLastRow();

      // Prepare double-entry records
      const doubleEntryRows = [
        // Part 1: Sender (Debit)
        [
          statusDate, // Column A: Status Date
          contributionMade, // Column B: Contribution Made
          senderName, // Column C: Sender Name
          -amount, // Column D: Amount * -1
          currency, // Column E: Currency
          ledgerName === 'offchain' ? '' : 'Assets' // Column F: "Assets" for AGL, empty for offchain
        ],
        // Part 2: Recipient (Credit)
        [
          statusDate, // Column A: Status Date
          contributionMade, // Column B: Contribution Made
          recipientName, // Column C: Recipient Name
          amount, // Column D: Amount
          currency, // Column E: Currency
          ledgerName === 'offchain' ? '' : 'Assets' // Column F: "Assets" for AGL, empty for offchain
        ]
      ];

        // Insert double-entry records
      try {
        targetSheet.getRange(targetLastRow + 1, 1, 2, 6).setValues(doubleEntryRows);
        // Record the row numbers (1-based) of the inserted records
        const insertedRowNumbers = `${targetLastRow + 1},${targetLastRow + 2}`;
        updates.push({ rowNumber, insertedRowNumbers });
        Logger.log(`Inserted double-entry records for row ${rowNumber} in ${targetSheetName} (rows ${insertedRowNumbers})`);

        // Check if recipient exists, if not add them to Contributors sheet
        // This ensures new recipients are added even when processing from Inventory Movement sheet
        if (recipientName && recipientName.trim() !== '') {
          const exists = recipientExists(recipientName);
          if (!exists) {
            const added = addNewRecipient(recipientName);
            if (added) {
              Logger.log(`Successfully added new recipient "${recipientName}" to Contributors sheet during ledger processing`);
            } else {
              Logger.log(`Warning: Failed to add new recipient "${recipientName}" to Contributors sheet during ledger processing`);
            }
          }
        }

        // If QR code is provided, update the Manager Name in Agroverse QR codes sheet
        // The Manager Name should be set to the recipient name, as the recipient is now the holder of the QR code
        // This happens after successful ledger update to ensure transaction is committed
        if (qrCode && recipientName) {
          const updated = updateAgroverseQrManagerName(qrCode, recipientName);
          if (updated) {
            Logger.log(`Successfully updated Manager Name for QR code ${qrCode} to ${recipientName} (recipient is now the holder) after ledger update`);
          } else {
            Logger.log(`Warning: Failed to update Manager Name for QR code ${qrCode} (may not exist in sheet)`);
          }
        }

        // Send Telegram notification
        sendInventoryTransactionNotification(contributionMade, ledgerName, ledgerUrl);
      } catch (e) {
        Logger.log(`Error inserting double-entry records for row ${rowNumber} in ${targetSheetName}: ${e.message}`);
        return;
      }
    });

    // Update Inventory Movement with row numbers and status
    updates.forEach(update => {
      // Set Column O as text format to prevent Google Sheets from interpreting comma-separated numbers
      const columnOCell = inventorySheet.getRange(update.rowNumber, 15);
      columnOCell.setNumberFormat('@'); // Set format to text
      columnOCell.setValue(update.insertedRowNumbers); // Column O
      inventorySheet.getRange(update.rowNumber, 14).setValue('PROCESSED'); // Column N
    });

    // Fix: Backfill Column O for rows that are PROCESSED but missing Column O
    // This handles cases where Column N was updated but Column O update failed
    let backfilledCount = 0;
    inventoryData.forEach((row, index) => {
      const rowNumber = index + 1;
      if (rowNumber === 1) return; // Skip header row
      const status = row[13]; // Column N: Status
      const recordRows = row[14]; // Column O: Record Rows (if available in data range)
      if (status === 'PROCESSED' && (!recordRows || recordRows.toString().trim() === '')) {
        Logger.log(`Warning: Row ${rowNumber} is PROCESSED but Column O is empty. Manual review may be needed.`);
        backfilledCount++;
      }
    });
    if (backfilledCount > 0) {
      Logger.log(`Found ${backfilledCount} rows with PROCESSED status but missing Column O. Manual review recommended.`);
    }

    if (updates.length > 0) {
      Logger.log(`Processed ${updates.length} records in Inventory Movement`);
    } else {
      Logger.log('No new records with status NEW found in Inventory Movement');
    }
  } catch (error) {
    Logger.log(`Error in processInventoryMovementToLedgers: ${error.message}`);
  }
}

/**
 * Test function to verify the processInventoryReport function.
 * @param {string} testReport - Optional test report string to process.
 */
function testProcessInventoryReport() {
  const testReport = "[INVENTORY MOVEMENT]\n" +
    "- Manager Name: Gary Teh\n" +
    "- Recipient Name: @alexadoglio\n" +
    "- Inventory Item: [AGL6] Brazilian Reis\n" +
    "- Quantity: 1";
  const result = processInventoryReport(testReport);
  Logger.log(JSON.stringify(result, null, 2));

  // Test offchain asset
  const testReportOffchain = "[INVENTORY MOVEMENT]\n" +
    "- Manager Name: Gary Teh\n" +
    "- Recipient Name: @alexadoglio\n" +
    "- Inventory Item: USD\n" +
    "- Quantity: 100";
  const resultOffchain = processInventoryReport(testReportOffchain);
  Logger.log(JSON.stringify(resultOffchain, null, 2));
}

/**
 * Webhook handler for HTTP GET requests.
 * Supports two actions:
 * - processTelegramChatLogs: Processes Telegram Chat Logs to Inventory Movement, then to Ledgers
 * - processInventoryMovementToLedgers: Processes only Inventory Movement to Ledgers (for retries)
 */
function doGet(e) {
  const action = e.parameter?.action;
  
  if (action === 'processTelegramChatLogs') {
    try {
      Logger.log("Webhook triggered: processing inventory movements from Telegram Chat Logs");
      processTelegramChatLogs();
      return ContentService.createTextOutput("✅ Inventory movements processed from Telegram Chat Logs");
    } catch (err) {
      Logger.log("Error in processTelegramChatLogs webhook: " + err.message);
      return ContentService.createTextOutput("❌ Error: " + err.message);
    }
  } else if (action === 'processInventoryMovementToLedgers') {
    try {
      Logger.log("Webhook triggered: processing Inventory Movement to Ledgers");
      processInventoryMovementToLedgers();
      return ContentService.createTextOutput("✅ Inventory Movement processed to Ledgers");
    } catch (err) {
      Logger.log("Error in processInventoryMovementToLedgers webhook: " + err.message);
      return ContentService.createTextOutput("❌ Error: " + err.message);
    }
  }
  
  return ContentService.createTextOutput("ℹ️ No valid action specified. Use ?action=processTelegramChatLogs or ?action=processInventoryMovementToLedgers");
}

/**
 * Runs both processTelegramChatLogsToInventoryMovement and processInventoryMovementToLedgers sequentially.
 */
function processTelegramChatLogs() {
  processTelegramChatLogsToInventoryMovement();
  processInventoryMovementToLedgers();
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