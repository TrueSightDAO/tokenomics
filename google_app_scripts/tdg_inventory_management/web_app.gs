/**
 * File: google_app_scripts/tdg_inventory_management/web_app.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * 
 * Description: REST API endpoints for inventory management, QR code queries, voting rights, and asset valuation. Provides data access for the TrueSight DAO DApp.
 */

/**
 * Web app to list inventory managers or fetch asset data for a specific manager.
 * Deployment URL: https://script.google.com/macros/s/AKfycbztpV3TUIRn3ftNW1aGHAKw32OBJrp_p1Pr9mMAttoyWFZyQgBRPU2T6eGhkmJtz7xV/exec
 *
 * Query parameters:
 *   list=true       : returns array of objects { key, name } for each unique manager name.
 *   manager=<key>   : returns array of objects { currency, amount } for the given manager.
 *                     <key> must be the URL-encoded manager name from the list output.
 *
 * Data range starts at row 5 (row 4 is header), columns:
 *   A: currency
 *   B: inventory manager name
 *   C: amount
 *
 * Ledger URLs are dynamically fetched from Wix AgroverseShipments data collection.
 * Ledger names are derived from the last segment of the URL (after the last '/') and capitalized.
 */

// Constants for spreadsheet ID, sheet names, and API credentials
const SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
const SHEET_NAME = 'offchain asset location';
const CONTACT_SHEET_NAME = 'Contributors contact information';
const creds = getCredentials(); // Assumed to be defined elsewhere
const WIX_ACCESS_TOKEN = creds.WIX_API_KEY; // Wix API key

// Helper to convert column letter(s) to number
function letterToColumn(letter) {
  let col = 0;
  for (let i = 0; i < letter.length; i++) {
    col = col * 26 + (letter.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
  }
  return col;
}

// Resolves redirect URLs to get the final URL.
// First checks "Shipment Ledger Listing" sheet (Column L -> Column AB lookup)
// Falls back to HTTP resolution if not found in sheet
function resolveRedirect(url) {
  try {
    // First, try to look up the URL in "Shipment Ledger Listing" sheet
    // Column L (index 11) = unresolved URL, Column AB (index 27) = resolved URL
    try {
      const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
      const shipmentSheet = spreadsheet.getSheetByName('Shipment Ledger Listing');
      
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
    const maxRedirects = 10;

    while (redirectCount < maxRedirects) {
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

      // Get the Location header for HTTP redirect
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

    Logger.log(`Exceeded maximum redirects (${maxRedirects}) for URL ${url}`);
    return '';
  } catch (e) {
    Logger.log(`Error resolving redirect for URL ${url}: ${e.message}`);
    return '';
  }
}

// Fetches unique ledger URLs from Wix AgroverseShipments and constructs LEDGER_CONFIGS
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
        sheet_name: 'Balance',
        manager_names_column: 'H',
        asset_name_column: 'J',
        asset_quantity_column: 'I',
        record_start_row: 6
      };
    });

    Logger.log('Ledger configs fetched from Wix: ' + JSON.stringify(ledgerConfigs));
    return ledgerConfigs;
  } catch (e) {
    Logger.log('Error fetching ledger URLs from Wix: ' + e.message);
    return [];
  }
}

// Augment the result array with assets from external ledgers
function augmentWithLedgers(managerName, result) {
  const ledgerConfigs = getLedgerConfigsFromWix();
  ledgerConfigs.forEach(function(config) {
    try {
      if (!config.ledger_url || !config.ledger_url.includes('docs.google.com/spreadsheets')) {
        Logger.log(`Skipping invalid or non-spreadsheet URL: ${config.ledger_url}`);
        return;
      }
      const ss = SpreadsheetApp.openByUrl(config.ledger_url);
      const sheet = ss.getSheetByName(config.sheet_name);
      if (!sheet) return;
      const startRow = config.record_start_row;
      const lastRow = sheet.getLastRow();
      const numRows = Math.max(0, lastRow - startRow + 1);
      if (numRows < 1) return;
      const nameCol = letterToColumn(config.manager_names_column);
      const assetCol = letterToColumn(config.asset_name_column);
      const qtyCol = letterToColumn(config.asset_quantity_column);
      const names = sheet.getRange(startRow, nameCol, numRows, 1).getValues();
      const assets = sheet.getRange(startRow, assetCol, numRows, 1).getValues();
      const qtys = sheet.getRange(startRow, qtyCol, numRows, 1).getValues();
      for (let i = 0; i < names.length; i++) {
        if (names[i][0] === managerName) {
          const assetName = assets[i][0];
          const quantity = qtys[i][0];
          result.push({
            currency: `[${config.ledger_name}] ${assetName}`,
            amount: quantity
          });
        }
      }
    } catch (err) {
      Logger.log(`Error processing ledger ${config.ledger_name}: ${err}`);
    }
  });
}

// Return unique manager names from all configured ledgers
function getManagersFromLedgers() {
  const names = [];
  const seen = {};
  const ledgerConfigs = getLedgerConfigsFromWix();
  ledgerConfigs.forEach(function(config) {
    try {
      if (!config.ledger_url || !config.ledger_url.includes('docs.google.com/spreadsheets')) {
        Logger.log(`Skipping invalid or non-spreadsheet URL: ${config.ledger_url}`);
        return;
      }
      const ss = SpreadsheetApp.openByUrl(config.ledger_url);
      const sheet = ss.getSheetByName(config.sheet_name);
      if (!sheet) return;
      const startRow = config.record_start_row;
      const lastRow = sheet.getLastRow();
      const numRows = Math.max(0, lastRow - startRow + 1);
      if (numRows < 1) return;
      const nameCol = letterToColumn(config.manager_names_column);
      const values = sheet.getRange(startRow, nameCol, numRows, 1).getValues();
      values.forEach(function(row) {
        const nm = row[0];
        if (nm && !seen[nm]) {
          seen[nm] = true;
          names.push(nm);
        }
      });
    } catch (err) {
      Logger.log(`Error listing managers in ledger ${config.ledger_name}: ${err}`);
    }
  });
  return names;
}

function doGet(e) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: `Sheet not found: ${SHEET_NAME}` }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  const lastRow = sheet.getLastRow();
  const numRows = Math.max(0, lastRow - 4);
  const data = numRows > 0 ? sheet.getRange(5, 1, numRows, 3).getValues() : [];

  // Return list of possible recipients from "Contributors contact information" sheet
  if (e.parameter.recipients) {
    const contactSheet = ss.getSheetByName(CONTACT_SHEET_NAME);
    if (!contactSheet) {
      return ContentService
        .createTextOutput(JSON.stringify({ error: `Sheet not found: ${CONTACT_SHEET_NAME}` }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const lastRow2 = contactSheet.getLastRow();
    const numRows2 = Math.max(0, lastRow2 - 4);
    const data2 = numRows2 > 0 ? contactSheet.getRange(5, 1, numRows2, 1).getValues() : [];
    const seenRecipients = {};
    const recipients = [];
    data2.forEach(function(row) {
      const name = row[0];
      if (name && !seenRecipients[name]) {
        seenRecipients[name] = true;
        recipients.push({
          key: encodeURIComponent(name),
          name: name
        });
      }
    });
    return ContentService
      .createTextOutput(JSON.stringify(recipients))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Return list of unique inventory managers with URL-encoded keys
  if (e.parameter.list) {
    const seen = {};
    const list = [];
    data.forEach(function(row) {
      const name = row[1];
      if (name && !seen[name]) {
        seen[name] = true;
        list.push({ key: encodeURIComponent(name), name: name });
      }
    });
    // Include managers from external ledgers
    getManagersFromLedgers().forEach(function(nm) {
      if (nm && !seen[nm]) {
        seen[nm] = true;
        list.push({ key: encodeURIComponent(nm), name: nm });
      }
    });
    return ContentService
      .createTextOutput(JSON.stringify(list))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Return assets for a given manager (using URL-encoded key)
  const managerKey = e.parameter.manager;
  if (managerKey) {
    const managerName = decodeURIComponent(managerKey);
    const result = [];
    data.forEach(function(row) {
      if (row[1] === managerName) {
        result.push({ currency: row[0], amount: row[2] });
      }
    });
    // Augment result with assets from external ledgers
    augmentWithLedgers(managerName, result);
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Return list of ledger names and URLs from WIX AgroverseShipments
  if (e.parameter.ledgers) {
    const ledgerConfigs = getLedgerConfigsFromWix();
    const ledgers = ledgerConfigs.map(function(config) {
      return {
        ledger_name: config.ledger_name,
        ledger_url: config.ledger_url
      };
    });
    return ContentService
      .createTextOutput(JSON.stringify(ledgers))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Return all currencies across all ledgers
  if (e.parameter.all_currencies) {
    return listAllCurrenciesAcrossLedgers();
  }

  // No valid parameter provided
  return ContentService
    .createTextOutput(JSON.stringify({
      error: 'Please specify ?list=true to list managers, ?manager=<key> to get assets, ?recipients=true to list recipients, ?ledgers=true to list ledgers, or ?all_currencies=true to list all currencies.'
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Test function: fetch assets for a given manager.
 * Usage (in Apps Script console): testManager('Manager Name');
 */
function testManager() {
  const managerName = "DHL";
  const e = { parameter: { manager: encodeURIComponent(managerName) } };
  const output = doGet(e);
  Logger.log('Assets for %s: %s', managerName, output.getContent());
}

/**
 * Test function: list all managers.
 * Usage (in Apps Script console): testList();
 */
function testList() {
  const e = { parameter: { list: 'true' } };
  const output = doGet(e);
  Logger.log('Manager list: %s', output.getContent());
}

/**
 * Test function: list all currencies across all ledgers.
 * Usage (in Apps Script console): testAllCurrencies();
 */
function testAllCurrencies() {
  const e = { parameter: { all_currencies: 'true' } };
  const output = doGet(e);
  Logger.log('All currencies: %s', output.getContent());
}

/**
 * List all currencies across all ledgers with their quantities
 * Returns currencies from both the main inventory sheet and all external ledgers
 */
function listAllCurrenciesAcrossLedgers() {
  try {
    const currencyQuantities = {}; // Track currencies and their quantities per ledger
    
    // First, get currencies from the main inventory sheet
    const mainSpreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const mainSheet = mainSpreadsheet.getSheetByName(SHEET_NAME);
    
    if (mainSheet) {
      const lastRow = mainSheet.getLastRow();
      const numRows = Math.max(0, lastRow - 4);
      const data = numRows > 0 ? mainSheet.getRange(5, 1, numRows, 3).getValues() : [];
      
      data.forEach(function(row) {
        const currencyName = row[0];
        const managerName = row[1];
        const quantity = parseFloat(row[2]) || 0;
        
        if (currencyName && quantity > 0) {
          if (!currencyQuantities[currencyName]) {
            currencyQuantities[currencyName] = {
              product_name: currencyName,
              product_image: '',
              landing_page: '',
              ledger: '',
              farm_name: '',
              state: '',
              country: '',
              year: '',
              total_quantity: 0,
              ledger_quantities: {}
            };
          }
          currencyQuantities[currencyName].total_quantity += quantity;
          // Don't add to ledger_quantities for main inventory sheet - it's not a specific ledger
        }
      });
    }
    
    // Then, get currencies from all external ledgers
    const ledgerConfigs = getLedgerConfigsFromWix();
    Logger.log('Processing ' + ledgerConfigs.length + ' external ledgers for currencies');
    
    ledgerConfigs.forEach(function(config) {
      try {
        Logger.log('Processing ledger: ' + config.ledger_name + ' - ' + config.ledger_url);
        
        if (!config.ledger_url || !config.ledger_url.includes('docs.google.com/spreadsheets')) {
          Logger.log('Skipping invalid or non-spreadsheet URL: ' + config.ledger_url);
          return;
        }
        
        const ledgerSpreadsheet = SpreadsheetApp.openByUrl(config.ledger_url);
        const ledgerSheet = ledgerSpreadsheet.getSheetByName(config.sheet_name);
        if (!ledgerSheet) {
          Logger.log('Sheet not found: ' + config.sheet_name + ' in ledger ' + config.ledger_name);
          return;
        }
        
        const startRow = config.record_start_row;
        const lastLedgerRow = ledgerSheet.getLastRow();
        const numRows = Math.max(0, lastLedgerRow - startRow + 1);
        if (numRows < 1) {
          Logger.log('No data rows found in ledger ' + config.ledger_name);
          return;
        }
        
        Logger.log('Processing ' + numRows + ' rows in ledger ' + config.ledger_name);
        
        const nameCol = letterToColumn(config.manager_names_column);
        const assetCol = letterToColumn(config.asset_name_column);
        const qtyCol = letterToColumn(config.asset_quantity_column);
        
        const names = ledgerSheet.getRange(startRow, nameCol, numRows, 1).getValues();
        const assets = ledgerSheet.getRange(startRow, assetCol, numRows, 1).getValues();
        const qtys = ledgerSheet.getRange(startRow, qtyCol, numRows, 1).getValues();
        
        let matchesFound = 0;
        for (let i = 0; i < names.length; i++) {
          const assetName = assets[i][0];
          const quantity = parseFloat(qtys[i][0]) || 0;
          
          if (assetName && quantity > 0) {
            if (!currencyQuantities[assetName]) {
              currencyQuantities[assetName] = {
                product_name: assetName,
                product_image: '',
                landing_page: '',
                ledger: config.ledger_url,
                farm_name: '',
                state: '',
                country: '',
                year: '',
                total_quantity: 0,
                ledger_quantities: {}
              };
            }
            currencyQuantities[assetName].total_quantity += quantity;
            currencyQuantities[assetName].ledger_quantities[config.ledger_name] = 
              (currencyQuantities[assetName].ledger_quantities[config.ledger_name] || 0) + quantity;
            matchesFound++;
          }
        }
        
        Logger.log('Found ' + matchesFound + ' currencies in ledger ' + config.ledger_name);
        
      } catch (err) {
        Logger.log('Error processing ledger ' + config.ledger_name + ': ' + err);
      }
    });
    
    // Convert to array and sort by total quantity (descending)
    const allCurrencies = [];
    for (const currencyName in currencyQuantities) {
      const currency = currencyQuantities[currencyName];
      if (currency.total_quantity > 0) {
        allCurrencies.push(currency);
      }
    }
    
    allCurrencies.sort(function(a, b) {
      return b.total_quantity - a.total_quantity;
    });
    
    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      data: {
        action: 'all_currencies',
        currencies: allCurrencies,
        total_currencies: allCurrencies.length
      }
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    Logger.log('Error in listAllCurrenciesAcrossLedgers: ' + error.message);
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: 'Error listing currencies: ' + error.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}