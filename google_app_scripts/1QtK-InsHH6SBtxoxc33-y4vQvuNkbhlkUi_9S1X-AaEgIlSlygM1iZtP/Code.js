/**
 * File: google_app_scripts/tdg_inventory_management/web_app.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * Apps Script editor:
 * https://script.google.com/home/projects/1QtK-InsHH6SBtxoxc33-y4vQvuNkbhlkUi_9S1X-AaEgIlSlygM1iZtP/edit
 * 
 * Description: REST API endpoints for inventory management, QR code queries, voting rights, and asset valuation. Provides data access for the TrueSight DAO DApp.
 */

/**
 * Web app to list inventory managers or fetch asset data for a specific manager.
 * Deployment URL: https://script.google.com/macros/s/AKfycbztpV3TUIRn3ftNW1aGHAKw32OBJrp_p1Pr9mMAttoyWFZyQgBRPU2T6eGhkmJtz7xV/exec
 *
 * Query parameters:
 *   list=true       : returns array of objects { key, name } for each unique manager name.
 *   manager=<key>   : returns array of objects { currency, amount, unit_cost?, total_value? } for the given manager.
 *                     <key> must be the URL-encoded manager name from the list output.
 *                     unit_cost (D) and total_value (E) are included for main-ledger rows when present; managed AGL
 *                     Balance rows may omit unit_cost (null) until those sheets expose cost columns.
 *   main_only=true  : optional with manager=<key>; skips managed-AGL Balance sheet aggregation (faster; main ledger only).
 *
 * Data range starts at row 5 (row 4 is header), columns:
 *   A: currency
 *   B: inventory manager name
 *   C: amount
 *   D: unit cost (USD)
 *   E: total value
 *
 * Ledger configs are read from the "Shipment Ledger Listing" sheet in the main spreadsheet.
 * Column A = ledger name, Column K = Ledger URL (truesight.me), Column L = Contract URL, Column AB = Resolved URL.
 */

// Constants for spreadsheet ID, sheet names, and API credentials
const SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
const SHEET_NAME = 'offchain asset location';
const SHIPMENT_LEDGER_LISTING_SHEET = 'Shipment Ledger Listing';
const CONTACT_SHEET_NAME = 'Contributors contact information';
const CURRENCIES_SHEET_NAME = 'Currencies';

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

// Fetches ledger configs from "Shipment Ledger Listing" sheet in the main spreadsheet.
// Column A = ledger name, Column K = Ledger URL (truesight.me for View Ledger link),
// Column L = Contract URL, Column AB = Resolved URL (Google Sheets for data access).
function getLedgerConfigsFromSheet() {
  try {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const shipmentSheet = spreadsheet.getSheetByName(SHIPMENT_LEDGER_LISTING_SHEET);
    if (!shipmentSheet) {
      Logger.log('Shipment Ledger Listing sheet not found');
      return [];
    }

    const lastRow = shipmentSheet.getLastRow();
    if (lastRow < 2) {
      return [];
    }

    // Read columns A, K, L, AB (indices 0, 10, 11, 27). Row 1 is header. Exclude last row (may be summary).
    const dataRange = shipmentSheet.getRange(2, 1, Math.max(2, lastRow - 1), 28);
    const data = dataRange.getValues();

    const ledgerConfigs = [];
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const ledgerName = row[0] ? row[0].toString().trim() : '';
      const ledgerViewUrl = row[10] ? row[10].toString().trim() : '';  // Column K
      const contractUrl = row[11] ? row[11].toString().trim() : '';    // Column L
      const resolvedUrl = row[27] ? row[27].toString().trim() : '';    // Column AB

      // Skip empty rows or rows without a ledger name
      if (!ledgerName || ledgerName === '0') continue;

      // Use resolved URL (Column AB) if available, else resolve Contract URL (Column L)
      let ledgerSpreadsheetUrl = resolvedUrl || (contractUrl ? resolveRedirect(contractUrl) : '');

      // Only include rows that have a valid Google Sheets URL for data access
      if (!ledgerSpreadsheetUrl || !ledgerSpreadsheetUrl.includes('docs.google.com/spreadsheets')) {
        continue;
      }

      // Use Column K (Ledger URL / truesight.me) for "View Ledger" link when available, else spreadsheet URL
      const displayUrl = ledgerViewUrl || ledgerSpreadsheetUrl;

      ledgerConfigs.push({
        ledger_name: ledgerName,
        ledger_url: displayUrl,
        ledger_spreadsheet_url: ledgerSpreadsheetUrl,
        sheet_name: 'Balance',
        manager_names_column: 'H',
        asset_name_column: 'J',
        asset_quantity_column: 'I',
        record_start_row: 6
      });
    }

    Logger.log('Ledger configs from Shipment Ledger Listing: ' + ledgerConfigs.length + ' ledgers');
    return ledgerConfigs;
  } catch (e) {
    Logger.log('Error fetching ledger configs from sheet: ' + e.message);
    return [];
  }
}

// Cache for the Currencies unit-cost map, populated lazily per-execution.
let _currenciesUnitCostMapCache = null;

/**
 * Reads the main spreadsheet's "Currencies" tab and returns a map of
 * currency-string → unit_cost (USD) from column B. Used to enrich AGL
 * Balance rows where the AGL's own sheet doesn't expose a cost column.
 *
 * Empty / non-numeric col B values are skipped.
 */
function getCurrenciesUnitCostMap_() {
  if (_currenciesUnitCostMapCache) return _currenciesUnitCostMapCache;
  const map = {};
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sh = ss.getSheetByName(CURRENCIES_SHEET_NAME);
    if (!sh) { _currenciesUnitCostMapCache = map; return map; }
    const lastRow = sh.getLastRow();
    if (lastRow < 2) { _currenciesUnitCostMapCache = map; return map; }
    const vals = sh.getRange(2, 1, lastRow - 1, 2).getValues();
    for (let i = 0; i < vals.length; i++) {
      const name = vals[i][0];
      const cost = vals[i][1];
      if (name == null) continue;
      const key = String(name).trim();
      if (!key) continue;
      if (cost === '' || cost == null) continue;
      const n = parseFloat(cost);
      if (!isNaN(n)) map[key] = n;
    }
  } catch (e) {
    Logger.log('getCurrenciesUnitCostMap_ error: ' + e.message);
  }
  _currenciesUnitCostMapCache = map;
  return map;
}

/**
 * For an AGL row with prefixed currency "[AGLn] <assetName>", try to resolve
 * the unit cost from the main Currencies tab.
 * 1) Prefixed name exact match.
 * 2) Bare <assetName> fallback (strips the [AGLn] prefix — the Currencies tab
 *    is the authoritative catalog and may store the canonical un-prefixed
 *    currency).
 * Returns null when neither matches.
 */
function resolveAglUnitCost_(prefixedName, assetName) {
  const map = getCurrenciesUnitCostMap_();
  if (map[prefixedName] != null) return map[prefixedName];
  const bare = assetName == null ? '' : String(assetName).trim();
  if (bare && map[bare] != null) return map[bare];
  return null;
}

// Augment the result array with assets from external ledgers
function augmentWithLedgers(managerName, result) {
  const ledgerConfigs = getLedgerConfigsFromSheet();
  ledgerConfigs.forEach(function(config) {
    try {
      const spreadsheetUrl = config.ledger_spreadsheet_url || config.ledger_url;
      if (!spreadsheetUrl || !spreadsheetUrl.includes('docs.google.com/spreadsheets')) {
        Logger.log(`Skipping invalid or non-spreadsheet URL: ${spreadsheetUrl}`);
        return;
      }
      const ss = SpreadsheetApp.openByUrl(spreadsheetUrl);
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
          const prefixedName = `[${config.ledger_name}] ${assetName}`;
          const unitCost = resolveAglUnitCost_(prefixedName, assetName);
          const totalValue = (unitCost != null && typeof quantity === 'number' && !isNaN(quantity))
            ? quantity * unitCost : null;
          result.push({
            currency: prefixedName,
            amount: quantity,
            unit_cost: unitCost,
            total_value: totalValue
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
  const ledgerConfigs = getLedgerConfigsFromSheet();
  ledgerConfigs.forEach(function(config) {
    try {
      const spreadsheetUrl = config.ledger_spreadsheet_url || config.ledger_url;
      if (!spreadsheetUrl || !spreadsheetUrl.includes('docs.google.com/spreadsheets')) {
        Logger.log(`Skipping invalid or non-spreadsheet URL: ${spreadsheetUrl}`);
        return;
      }
      const ss = SpreadsheetApp.openByUrl(spreadsheetUrl);
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
  const data = numRows > 0 ? sheet.getRange(5, 1, numRows, 5).getValues() : [];

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
        const unitCost = row[3];
        const totalVal = row[4];
        const item = {
          currency: row[0],
          amount: row[2]
        };
        if (unitCost !== '' && unitCost !== null && unitCost !== undefined) {
          const uc = parseFloat(unitCost);
          if (!isNaN(uc)) item.unit_cost = uc;
        }
        if (totalVal !== '' && totalVal !== null && totalVal !== undefined) {
          const tv = parseFloat(totalVal);
          if (!isNaN(tv)) item.total_value = tv;
        }
        result.push(item);
      }
    });
    // Augment result with assets from external ledgers (skip when main_only=true for faster response)
    if (e.parameter.main_only !== 'true') {
      augmentWithLedgers(managerName, result);
    }
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Return list of ledger names and URLs from Shipment Ledger Listing sheet
  if (e.parameter.ledgers) {
    const ledgerConfigs = getLedgerConfigsFromSheet();
    const ledgers = ledgerConfigs.map(function(config) {
      return {
        ledger_name: config.ledger_name,
        ledger_url: config.ledger_url  // truesight.me View Ledger link or spreadsheet URL
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
 * Test function: list all ledgers from Shipment Ledger Listing.
 * Usage (in Apps Script console): testLedgers();
 */
function testLedgers() {
  const e = { parameter: { ledgers: 'true' } };
  const output = doGet(e);
  Logger.log('Ledgers: %s', output.getContent());
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
 * Get weight (in grams) for a currency from the Currencies sheet
 * @param {string} currencyName - The currency/product name to look up
 * @return {number|null} Weight in grams, or null if not found
 */
function getCurrencyWeight(currencyName) {
  try {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const currenciesSheet = spreadsheet.getSheetByName(CURRENCIES_SHEET_NAME);
    
    if (!currenciesSheet) {
      Logger.log('Currencies sheet not found');
      return null;
    }
    
    const lastRow = currenciesSheet.getLastRow();
    if (lastRow < 2) {
      return null;
    }
    
    // Read columns A (name) and K (weight in grams)
    const dataRange = currenciesSheet.getRange(2, 1, lastRow - 1, 11).getValues(); // A to K
    
    for (let i = 0; i < dataRange.length; i++) {
      const row = dataRange[i];
      const productName = row[0] ? row[0].toString().trim() : '';
      const weightGrams = row[10] ? parseFloat(row[10]) : null; // Column K (index 10)
      
      if (productName && productName.toLowerCase() === currencyName.toLowerCase()) {
        return weightGrams && weightGrams > 0 ? weightGrams : null;
      }
    }
    
    return null;
  } catch (error) {
    Logger.log('Error getting currency weight: ' + error.message);
    return null;
  }
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
            // Get weight from Currencies sheet
            const weightGrams = getCurrencyWeight(currencyName);
            currencyQuantities[currencyName] = {
              product_name: currencyName,
              product_image: '',
              landing_page: '',
              ledger: '',
              farm_name: '',
              state: '',
              country: '',
              year: '',
              unit_weight_g: weightGrams, // Weight in grams from Column K
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
    const ledgerConfigs = getLedgerConfigsFromSheet();
    Logger.log('Processing ' + ledgerConfigs.length + ' external ledgers for currencies');
    
    ledgerConfigs.forEach(function(config) {
      try {
        const spreadsheetUrl = config.ledger_spreadsheet_url || config.ledger_url;
        Logger.log('Processing ledger: ' + config.ledger_name + ' - ' + spreadsheetUrl);
        
        if (!spreadsheetUrl || !spreadsheetUrl.includes('docs.google.com/spreadsheets')) {
          Logger.log('Skipping invalid or non-spreadsheet URL: ' + spreadsheetUrl);
          return;
        }
        
        const ledgerSpreadsheet = SpreadsheetApp.openByUrl(spreadsheetUrl);
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
              // Get weight from Currencies sheet
              const weightGrams = getCurrencyWeight(assetName);
              currencyQuantities[assetName] = {
                product_name: assetName,
                product_image: '',
                landing_page: '',
                ledger: config.ledger_url,
                farm_name: '',
                state: '',
                country: '',
                year: '',
                unit_weight_g: weightGrams, // Weight in grams from Column K
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