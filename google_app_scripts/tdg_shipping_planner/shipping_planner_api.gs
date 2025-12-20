/**
 * File: google_app_scripts/tdg_shipping_planner/shipping_planner_api.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * 
 * Description: REST API for shipping cost estimation. Provides member inventory lookup,
 * weight calculation, and shipping cost estimation via EasyPost (local) or freight cost
 * Google Sheet (freight). Supports both box and pallet packaging options.
 * 
 * Deployment URL: https://script.google.com/macros/s/AKfycbz5Tt_vz1X26i82yqlGUSI_OtCUEO31jImZH2tXfNaxMbfmJ01dkwUIEZDjsnd10xMbcg/exec
 * 
 * Deployment: Deploy as web app with execute as "Me" and access "Anyone"
 */

// ============================================================================
// REQUIRED CONFIGURATION - SET THESE IN SCRIPT PROPERTIES
// ============================================================================
/**
 * CONFIGURATION SETUP:
 * 
 * To use this script, you need to set the following properties in Google Apps Script:
 * 
 * 1. Go to Google Apps Script Editor
 * 2. Click on "Project Settings" (gear icon)
 * 3. Scroll down to "Script Properties"
 * 4. Add the following properties:
 * 
 * REQUIRED Properties:
 * - EASYPOST_API_KEY: Your EasyPost API key (for local shipping calculations)
 * 
 * OPTIONAL Properties (with defaults):
 * - ORIGIN_ADDRESS_LINE1: "1423 Hayes St" (origin address for EasyPost)
 * - ORIGIN_ADDRESS_LINE2: "" (optional address line 2)
 * - ORIGIN_ADDRESS_CITY: "San Francisco"
 * - ORIGIN_ADDRESS_STATE: "CA"
 * - ORIGIN_ADDRESS_POSTAL_CODE: "94117"
 * - ORIGIN_ADDRESS_COUNTRY: "US"
 * - BASE_BOX_WEIGHT_OZ: "11.5" (base box weight in ounces)
 * - PALLET_WEIGHT_KG: "35" (pallet weight in kilograms)
 */

// ============================================================================
// SPREADSHEET CONFIGURATION
// ============================================================================

const MAIN_SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
const INVENTORY_SHEET_NAME = 'offchain asset location';
const CURRENCIES_SHEET_NAME = 'Currencies';
const SHIPMENT_LEDGER_SHEET_NAME = 'Shipment Ledger Listing';
const FREIGHT_COST_SPREADSHEET_ID = '10Ps8BYcTa3sIqtoLwlQ13upuxIG_DgJIpfzchLjm9og';
const FREIGHT_COST_SHEET_NAME = 'Cost Breakdown';

// Shipment Ledger Listing columns (0-indexed)
const SHIPMENT_ID_COL = 0; // Column A - Shipment ID (ledger name)
const LEDGER_URL_COL = 11; // Column L - Ledger URL
const RESOLVED_URL_COL = 27; // Column AB - Resolved URL (if available)

// ============================================================================
// CONSTANTS
// ============================================================================

// Weight conversion constants
const GRAMS_TO_OUNCES = 0.035274; // 1 gram = 0.035274 ounces
const GRAMS_TO_KILOGRAMS = 0.001; // 1 gram = 0.001 kilograms
const OUNCES_TO_KILOGRAMS = 0.0283495; // 1 ounce = 0.0283495 kilograms

// Packaging weight defaults (can be overridden via Script Properties)
const DEFAULT_BASE_BOX_WEIGHT_OZ = 11.5;
const DEFAULT_PALLET_WEIGHT_KG = 35;

// Freight weight tiers (in kg) - must match the freight cost sheet
const FREIGHT_WEIGHT_TIERS = [200, 300, 500, 750, 1000];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get configuration value from Script Properties
 */
function getConfigValue(key, defaultValue) {
  const properties = PropertiesService.getScriptProperties();
  return properties.getProperty(key) || defaultValue;
}

/**
 * Get origin address from Script Properties
 */
function getOriginAddress() {
  return {
    street1: getConfigValue('ORIGIN_ADDRESS_LINE1', '1423 Hayes St'),
    street2: getConfigValue('ORIGIN_ADDRESS_LINE2', ''),
    city: getConfigValue('ORIGIN_ADDRESS_CITY', 'San Francisco'),
    state: getConfigValue('ORIGIN_ADDRESS_STATE', 'CA'),
    zip: getConfigValue('ORIGIN_ADDRESS_POSTAL_CODE', '94117'),
    country: getConfigValue('ORIGIN_ADDRESS_COUNTRY', 'US')
  };
}

/**
 * Get packaging weights from Script Properties
 */
function getPackagingWeights() {
  return {
    baseBoxWeightOz: parseFloat(getConfigValue('BASE_BOX_WEIGHT_OZ', DEFAULT_BASE_BOX_WEIGHT_OZ.toString())),
    palletWeightKg: parseFloat(getConfigValue('PALLET_WEIGHT_KG', DEFAULT_PALLET_WEIGHT_KG.toString()))
  };
}

/**
 * Convert column letter(s) to number
 */
function letterToColumn(letter) {
  let col = 0;
  for (let i = 0; i < letter.length; i++) {
    col = col * 26 + (letter.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
  }
  return col;
}

/**
 * Create JSON response
 */
function createResponse(data, statusCode = 200) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Create error response
 */
function createErrorResponse(message, statusCode = 400) {
  return createResponse({
    status: 'error',
    message: message
  }, statusCode);
}

/**
 * Create success response
 */
function createSuccessResponse(data) {
  return createResponse({
    status: 'success',
    data: data
  });
}

// ============================================================================
// INVENTORY DATA FUNCTIONS
// ============================================================================

/**
 * Get product weights from Currencies sheet
 * Reads from Column K (grams) or Column L (ounces)
 * - Column K (grams) takes precedence if both are present
 * - Column L (ounces) is converted to grams if only that is available
 * - Items without weight in either column are excluded
 * Returns object mapping product name to weight in grams
 */
function getProductWeights() {
  try {
    const spreadsheet = SpreadsheetApp.openById(MAIN_SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(CURRENCIES_SHEET_NAME);
    
    if (!sheet) {
      Logger.log('Currencies sheet not found');
      return {};
    }
    
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      Logger.log('No data in Currencies sheet');
      return {};
    }
    
    // Read columns A (product name), K (weight in grams), and L (weight in ounces)
    // Column A = index 0, Column K = index 10, Column L = index 11
    // Read 12 columns to include both K and L
    const dataRange = sheet.getRange(2, 1, lastRow - 1, 12).getValues();
    const weights = {};
    
    for (let i = 0; i < dataRange.length; i++) {
      const row = dataRange[i];
      const productName = row[0] ? row[0].toString().trim() : '';
      const weightGrams = parseFloat(row[10]) || 0;
      const weightOunces = parseFloat(row[11]) || 0;
      
      if (productName) {
        let finalWeightGrams = 0;
        
        // Prefer grams (Column K) if available
        if (weightGrams > 0) {
          finalWeightGrams = weightGrams;
        } else if (weightOunces > 0) {
          // Convert ounces to grams if only ounces available
          finalWeightGrams = weightOunces / GRAMS_TO_OUNCES;
        }
        
        // Only add if we have weight data
        if (finalWeightGrams > 0) {
          weights[productName] = finalWeightGrams;
        }
      }
    }
    
    Logger.log('Loaded ' + Object.keys(weights).length + ' product weights');
    return weights;
  } catch (error) {
    Logger.log('Error loading product weights: ' + error.message);
    return {};
  }
}

/**
 * Resolves redirect URLs to get the final URL.
 * First checks "Shipment Ledger Listing" sheet (Column L -> Column AB lookup)
 * Falls back to HTTP resolution if not found in sheet
 */
function resolveRedirect(url) {
  try {
    // First, try to look up the URL in "Shipment Ledger Listing" sheet
    // Column L (index 11) = unresolved URL, Column AB (index 27) = resolved URL
    try {
      const spreadsheet = SpreadsheetApp.openById(MAIN_SPREADSHEET_ID);
      const shipmentSheet = spreadsheet.getSheetByName(SHIPMENT_LEDGER_SHEET_NAME);
      
      if (shipmentSheet) {
        const lastRow = shipmentSheet.getLastRow();
        if (lastRow >= 2) {
          // Read columns A to AB (28 columns) to get both Column L and Column AB
          const dataRange = shipmentSheet.getRange(2, 1, lastRow - 1, 28);
          const data = dataRange.getValues();
          
          for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const ledgerUrl = row[LEDGER_URL_COL] ? row[LEDGER_URL_COL].toString().trim() : '';
            
            // Check if this row's Column L matches the input URL
            if (ledgerUrl === url || ledgerUrl === url.trim()) {
              const resolvedUrl = row[RESOLVED_URL_COL] ? row[RESOLVED_URL_COL].toString().trim() : '';
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

      // If not a redirect (2xx or other), return current URL
      if (responseCode < 300 || responseCode >= 400) {
        return currentUrl;
      }

      // Get the Location header for HTTP redirect
      const headers = response.getHeaders();
      const location = headers['Location'] || headers['location'];
      if (!location) {
        Logger.log(`No Location header for redirect at ${currentUrl}`);
        return currentUrl;
      }

      // Update the current URL and increment redirect count
      currentUrl = location;
      redirectCount++;
    }

    Logger.log(`Exceeded maximum redirects (${maxRedirects}) for URL ${url}`);
    return currentUrl;
  } catch (e) {
    Logger.log(`Error resolving redirect for URL ${url}: ${e.message}`);
    return url;
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
    const spreadsheet = SpreadsheetApp.openById(MAIN_SPREADSHEET_ID);
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
    // Read columns A to M (13 columns) to get Shipment ID and Ledger URL
    const dataRange = shipmentSheet.getRange(2, 1, lastRow - 1, 13);
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
    return ledgerConfigs;
  } catch (e) {
    Logger.log(`Error fetching ledger configs from ${SHIPMENT_LEDGER_SHEET_NAME}: ${e.message}`);
    return [];
  }
}

/**
 * Get inventory for a specific manager across all ledgers
 * Returns array of { currency, amount, ledger_name, weight_grams }
 */
function getManagerInventory(managerKey) {
  const inventory = [];
  const productWeights = getProductWeights();
  
  try {
    // Get from main inventory sheet
    const mainSpreadsheet = SpreadsheetApp.openById(MAIN_SPREADSHEET_ID);
    const mainSheet = mainSpreadsheet.getSheetByName(INVENTORY_SHEET_NAME);
    
    if (mainSheet) {
      const lastRow = mainSheet.getLastRow();
      const numRows = Math.max(0, lastRow - 4);
      if (numRows > 0) {
        const data = mainSheet.getRange(5, 1, numRows, 3).getValues();
        
        for (let i = 0; i < data.length; i++) {
          const row = data[i];
          const currencyName = row[0] ? row[0].toString().trim() : '';
          const managerName = row[1] ? row[1].toString().trim() : '';
          const quantity = parseFloat(row[2]) || 0;
          
            if (currencyName && managerName === managerKey && quantity > 0) {
            const weightGrams = productWeights[currencyName] || 0;
            inventory.push({
              currency: currencyName,
              amount: quantity,
              ledger_name: 'Main Inventory',
              weight_grams: weightGrams,
              has_weight: weightGrams > 0
            });
          }
        }
      }
    }
    
    // Get from external ledgers (if configured)
    const ledgerConfigs = getLedgerConfigsFromWix();
    for (let c = 0; c < ledgerConfigs.length; c++) {
      const config = ledgerConfigs[c];
      try {
        if (!config.ledger_url || !config.ledger_url.includes('docs.google.com/spreadsheets')) {
          continue;
        }
        
        const ledgerSpreadsheet = SpreadsheetApp.openByUrl(config.ledger_url);
        const ledgerSheet = ledgerSpreadsheet.getSheetByName(config.sheet_name);
        if (!ledgerSheet) continue;
        
        const startRow = config.record_start_row;
        const lastLedgerRow = ledgerSheet.getLastRow();
        const numRows = Math.max(0, lastLedgerRow - startRow + 1);
        if (numRows < 1) continue;
        
        const nameCol = letterToColumn(config.manager_names_column);
        const assetCol = letterToColumn(config.asset_name_column);
        const qtyCol = letterToColumn(config.asset_quantity_column);
        
        const names = ledgerSheet.getRange(startRow, nameCol, numRows, 1).getValues();
        const assets = ledgerSheet.getRange(startRow, assetCol, numRows, 1).getValues();
        const qtys = ledgerSheet.getRange(startRow, qtyCol, numRows, 1).getValues();
        
        for (let i = 0; i < names.length; i++) {
          const managerName = names[i][0] ? names[i][0].toString().trim() : '';
          const assetName = assets[i][0] ? assets[i][0].toString().trim() : '';
          const quantity = parseFloat(qtys[i][0]) || 0;
          
          if (managerName === managerKey && assetName && quantity > 0) {
            const weightGrams = productWeights[assetName] || 0;
            inventory.push({
              currency: assetName,
              amount: quantity,
              ledger_name: config.ledger_name,
              weight_grams: weightGrams,
              has_weight: weightGrams > 0
            });
          }
        }
      } catch (err) {
        Logger.log('Error processing ledger ' + config.ledger_name + ': ' + err);
      }
    }
    
    Logger.log('Found ' + inventory.length + ' inventory items for manager: ' + managerKey);
    return inventory;
  } catch (error) {
    Logger.log('Error getting manager inventory: ' + error.message);
    return [];
  }
}

/**
 * List all managers
 */
function listManagers() {
  const managers = [];
  const seen = {};
  
  try {
    // Get from main inventory sheet
    const mainSpreadsheet = SpreadsheetApp.openById(MAIN_SPREADSHEET_ID);
    const mainSheet = mainSpreadsheet.getSheetByName(INVENTORY_SHEET_NAME);
    
    if (mainSheet) {
      const lastRow = mainSheet.getLastRow();
      const numRows = Math.max(0, lastRow - 4);
      if (numRows > 0) {
        const data = mainSheet.getRange(5, 1, numRows, 2).getValues();
        
        for (let i = 0; i < data.length; i++) {
          const managerName = data[i][1] ? data[i][1].toString().trim() : '';
          if (managerName && !seen[managerName]) {
            seen[managerName] = true;
            managers.push({
              key: managerName,
              name: managerName
            });
          }
        }
      }
    }
    
    // Get from external ledgers
    const ledgerConfigs = getLedgerConfigsFromWix();
    for (let c = 0; c < ledgerConfigs.length; c++) {
      const config = ledgerConfigs[c];
      try {
        if (!config.ledger_url || !config.ledger_url.includes('docs.google.com/spreadsheets')) {
          continue;
        }
        
        const ledgerSpreadsheet = SpreadsheetApp.openByUrl(config.ledger_url);
        const ledgerSheet = ledgerSpreadsheet.getSheetByName(config.sheet_name);
        if (!ledgerSheet) continue;
        
        const startRow = config.record_start_row;
        const lastRow = ledgerSheet.getLastRow();
        const numRows = Math.max(0, lastRow - startRow + 1);
        if (numRows < 1) continue;
        
        const nameCol = letterToColumn(config.manager_names_column);
        const values = ledgerSheet.getRange(startRow, nameCol, numRows, 1).getValues();
        
        for (let i = 0; i < values.length; i++) {
          const managerName = values[i][0] ? values[i][0].toString().trim() : '';
          if (managerName && !seen[managerName]) {
            seen[managerName] = true;
            managers.push({
              key: managerName,
              name: managerName
            });
          }
        }
      } catch (err) {
        Logger.log('Error listing managers in ledger ' + config.ledger_name + ': ' + err);
      }
    }
    
    managers.sort(function(a, b) {
      return a.name.localeCompare(b.name);
    });
    
    return managers;
  } catch (error) {
    Logger.log('Error listing managers: ' + error.message);
    return [];
  }
}

// ============================================================================
// WEIGHT CALCULATION FUNCTIONS
// ============================================================================

/**
 * Calculate total weight for selected items
 * @param {Array} selectedItems - Array of { currency, quantity, weight_grams }
 * @param {String} packagingType - "box" or "pallet"
 * @returns {Object} { total_weight_grams, total_weight_oz, total_weight_kg, product_weight_grams, packaging_weight_grams }
 */
function calculateTotalWeight(selectedItems, packagingType) {
  const packaging = getPackagingWeights();
  
  // Calculate product weight
  let productWeightGrams = 0;
  let totalQuantity = 0;
  
  for (let i = 0; i < selectedItems.length; i++) {
    const item = selectedItems[i];
    const weightGrams = parseFloat(item.weight_grams) || 0;
    const quantity = parseFloat(item.quantity) || 0;
    
    if (weightGrams > 0 && quantity > 0) {
      productWeightGrams += weightGrams * quantity;
      totalQuantity += quantity;
    }
  }
  
  // Calculate packaging weight
  let packagingWeightGrams = 0;
  if (packagingType === 'box') {
    // Box: base weight only (11.5 oz) - no per-item packaging
    const baseBoxGrams = packaging.baseBoxWeightOz / GRAMS_TO_OUNCES;
    packagingWeightGrams = baseBoxGrams;
    
    Logger.log('=== Box Packaging Weight Calculation ===');
    Logger.log('Base box weight: ' + packaging.baseBoxWeightOz + ' oz = ' + baseBoxGrams.toFixed(2) + ' g');
    Logger.log('Total packaging weight: ' + packagingWeightGrams.toFixed(2) + ' g = ' + (packagingWeightGrams * GRAMS_TO_OUNCES).toFixed(2) + ' oz');
  } else if (packagingType === 'pallet') {
    // Pallet: fixed weight in kg, convert to grams
    packagingWeightGrams = packaging.palletWeightKg * 1000;
    Logger.log('Pallet weight: ' + packaging.palletWeightKg + ' kg = ' + packagingWeightGrams.toFixed(2) + ' g');
  }
  
  // Total weight
  const totalWeightGrams = productWeightGrams + packagingWeightGrams;
  const totalWeightOz = totalWeightGrams * GRAMS_TO_OUNCES;
  const totalWeightKg = totalWeightGrams * GRAMS_TO_KILOGRAMS;
  
  Logger.log('=== Total Weight Summary ===');
  Logger.log('Product weight: ' + productWeightGrams.toFixed(2) + ' g = ' + (productWeightGrams * GRAMS_TO_OUNCES).toFixed(2) + ' oz');
  Logger.log('Packaging weight: ' + packagingWeightGrams.toFixed(2) + ' g = ' + (packagingWeightGrams * GRAMS_TO_OUNCES).toFixed(2) + ' oz');
  Logger.log('TOTAL weight: ' + totalWeightGrams.toFixed(2) + ' g = ' + totalWeightOz.toFixed(2) + ' oz = ' + totalWeightKg.toFixed(3) + ' kg');
  
  return {
    total_weight_grams: totalWeightGrams,
    total_weight_oz: totalWeightOz,
    total_weight_kg: totalWeightKg,
    product_weight_grams: productWeightGrams,
    packaging_weight_grams: packagingWeightGrams,
    total_quantity: totalQuantity
  };
}

// ============================================================================
// SHIPPING COST CALCULATION FUNCTIONS
// ============================================================================

/**
 * Calculate shipping rates via EasyPost (for local shipping)
 * @param {Number} weightOz - Total weight in ounces
 * @param {Object} destinationAddress - Destination address object
 * @returns {Array} Array of shipping rate options
 */
function calculateEasyPostRates(weightOz, destinationAddress) {
  try {
    const easypostApiKey = getConfigValue('EASYPOST_API_KEY');
    
    if (!easypostApiKey) {
      Logger.log('ERROR: EasyPost API key not configured');
      return [];
    }
    
    if (weightOz <= 0) {
      Logger.log('ERROR: Invalid weight for EasyPost: ' + weightOz + ' oz');
      return [];
    }
    
    const originAddress = getOriginAddress();
    
    // Use provided destination or default
    const dest = destinationAddress || {
      street1: '1600 Pennsylvania Avenue NW',
      city: 'Washington',
      state: 'DC',
      zip: '20500',
      country: 'US'
    };
    
    const shipmentPayload = {
      to_address: dest,
      from_address: originAddress,
      parcel: {
        weight: weightOz,
        length: 10,
        width: 10,
        height: 10
      }
    };
    
    Logger.log('=== EasyPost Weight Calculation ===');
    Logger.log('Total weight sent to EasyPost: ' + weightOz.toFixed(2) + ' oz');
    Logger.log('Total weight in grams: ' + (weightOz / GRAMS_TO_OUNCES).toFixed(2) + ' g');
    Logger.log('Total weight in kg: ' + (weightOz * OUNCES_TO_KILOGRAMS).toFixed(3) + ' kg');
    
    const response = UrlFetchApp.fetch('https://api.easypost.com/v2/shipments', {
      method: 'post',
      headers: {
        'Authorization': 'Basic ' + Utilities.base64Encode(easypostApiKey + ':'),
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({ shipment: shipmentPayload }),
      muteHttpExceptions: true
    });
    
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    if (responseCode !== 201) {
      Logger.log('ERROR: EasyPost API error (code ' + responseCode + '): ' + responseText);
      return [];
    }
    
    const shipmentData = JSON.parse(responseText);
    const shipment = shipmentData.shipment || shipmentData;
    
    if (!shipment || !shipment.rates) {
      Logger.log('ERROR: No rates in EasyPost response');
      return [];
    }
    
    const rates = shipment.rates || [];
    const uspsRates = rates.filter(function(rate) {
      return rate.carrier === 'USPS';
    });
    
    const shippingOptions = uspsRates.map(function(rate) {
      const rateValue = parseFloat(rate.rate || rate.price || 0);
      const serviceName = rate.service || 'Standard';
      
      return {
        carrier: 'USPS',
        service: serviceName,
        rate: rateValue,
        rate_cents: Math.round(rateValue * 100),
        currency: 'USD'
      };
    });
    
    // Sort by price (cheapest first)
    shippingOptions.sort(function(a, b) {
      return a.rate - b.rate;
    });
    
    Logger.log('Returning ' + shippingOptions.length + ' EasyPost shipping options');
    return shippingOptions;
  } catch (error) {
    Logger.log('ERROR: Exception in calculateEasyPostRates: ' + error.toString());
    return [];
  }
}

/**
 * Get freight cost from Google Sheet with detailed line item breakdown
 * Reads from "Cost Breakdown" sheet to get all cost components
 * @param {Number} weightKg - Total weight in kilograms
 * @param {Number} cargoValueUsd - Optional cargo value in USD (defaults to weight * 5)
 * @param {Object} options - Optional parameters: fdaRequired, bondRequired, invoiceLines, customsExams, dutyPercent
 * @returns {Object} Freight cost estimate with detailed line items
 */
function getFreightCost(weightKg, cargoValueUsd, options) {
  try {
    const spreadsheet = SpreadsheetApp.openById(FREIGHT_COST_SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(FREIGHT_COST_SHEET_NAME);
    
    if (!sheet) {
      Logger.log('Freight cost sheet not found');
      return {
        weight_kg: weightKg,
        estimated_cost_usd: null,
        line_items: [],
        error: 'Freight cost sheet not found'
      };
    }
    
    // Default cargo value if not provided
    if (!cargoValueUsd || cargoValueUsd <= 0) {
      cargoValueUsd = weightKg * 5; // Default $5/kg
    }
    
    // Default options
    const opts = options || {};
    const fdaRequired = opts.fdaRequired === true || opts.fdaRequired === 'Yes' || opts.fdaRequired === 'yes';
    const bondRequired = opts.bondRequired === true || opts.bondRequired === 'Yes' || opts.bondRequired === 'yes';
    const invoiceLines = parseInt(opts.invoiceLines) || 3; // Default 3 (first 3 free)
    const customsExams = parseInt(opts.customsExams) || 0;
    const dutyPercent = parseFloat(opts.dutyPercent) || 0;
    
    // Find weight tier for interpolation
    let lowerTier = null;
    let upperTier = null;
    
    for (let i = 0; i < FREIGHT_WEIGHT_TIERS.length - 1; i++) {
      if (weightKg >= FREIGHT_WEIGHT_TIERS[i] && weightKg <= FREIGHT_WEIGHT_TIERS[i + 1]) {
        lowerTier = FREIGHT_WEIGHT_TIERS[i];
        upperTier = FREIGHT_WEIGHT_TIERS[i + 1];
        break;
      }
    }
    
    if (!lowerTier) {
      if (weightKg < FREIGHT_WEIGHT_TIERS[0]) {
        lowerTier = upperTier = FREIGHT_WEIGHT_TIERS[0];
      } else {
        lowerTier = upperTier = FREIGHT_WEIGHT_TIERS[FREIGHT_WEIGHT_TIERS.length - 1];
      }
    }
    
    // Air freight rates per kg
    const AIR_FREIGHT_RATES = {200: 3.50, 300: 3.40, 500: 3.30, 750: 3.30, 1000: 3.20};
    
    // Calculate air freight rate (interpolated)
    let airFreightRate = AIR_FREIGHT_RATES[lowerTier];
    if (lowerTier !== upperTier) {
      const lowerRate = AIR_FREIGHT_RATES[lowerTier];
      const upperRate = AIR_FREIGHT_RATES[upperTier];
      const weightRatio = (weightKg - lowerTier) / (upperTier - lowerTier);
      airFreightRate = lowerRate + (upperRate - lowerRate) * weightRatio;
    }
    
    const lineItems = [];
    let totalCost = 0;
    
    // 1. Air Freight (airport to airport)
    const airFreightCost = airFreightRate * weightKg;
    lineItems.push({
      description: 'Air Freight (airport to airport)',
      amount: airFreightCost,
      type: 'variable'
    });
    totalCost += airFreightCost;
    
    // 2. Export Documentation
    const exportDocCost = 95.00;
    lineItems.push({
      description: 'Export Documentation',
      amount: exportDocCost,
      type: 'fixed'
    });
    totalCost += exportDocCost;
    
    // 3. Inland Transport (Brazil)
    const inlandTransportCost = 695 + (0.0015 * cargoValueUsd);
    lineItems.push({
      description: 'Inland Transport (Brazil)',
      amount: inlandTransportCost,
      type: 'fixed_variable',
      note: '695 + 0.15% of cargo value'
    });
    totalCost += inlandTransportCost;
    
    // 4. Brazil Airport Charges
    const brazilAirportCost = Math.max(0.30 * weightKg, 250);
    lineItems.push({
      description: 'Brazil Airport Charges',
      amount: brazilAirportCost,
      type: 'variable',
      note: '0.30/kg, minimum 250'
    });
    totalCost += brazilAirportCost;
    
    // 5. US Airline Terminal Fee
    const terminalFeeCost = 212.50;
    lineItems.push({
      description: 'US Airline Terminal Fee',
      amount: terminalFeeCost,
      type: 'fixed'
    });
    totalCost += terminalFeeCost;
    
    // 6. US Import Handling Fee
    const handlingFeeCost = 125.00;
    lineItems.push({
      description: 'US Import Handling Fee',
      amount: handlingFeeCost,
      type: 'fixed'
    });
    totalCost += handlingFeeCost;
    
    // 7. US Customs Clearance
    const customsClearanceCost = 150.00;
    lineItems.push({
      description: 'US Customs Clearance',
      amount: customsClearanceCost,
      type: 'fixed'
    });
    totalCost += customsClearanceCost;
    
    // 8. Invoice Line Items (first 3 free, then $5/line) - Always show, even if $0
    const extraLines = Math.max(0, invoiceLines - 3);
    const invoiceLinesCost = extraLines * 5;
    lineItems.push({
      description: 'Invoice Line Items',
      amount: invoiceLinesCost,
      type: 'conditional',
      note: extraLines > 0 ? (extraLines + ' extra lines × $5') : 'First 3 free, then $5/line'
    });
    totalCost += invoiceLinesCost;
    
    // 9. FDA Processing - Always show, $0 if not required
    const fdaCost = fdaRequired ? 100.00 : 0.00;
    lineItems.push({
      description: 'FDA Processing',
      amount: fdaCost,
      type: 'conditional',
      note: fdaRequired ? 'If applicable (likely for cacao)' : 'Not required'
    });
    totalCost += fdaCost;
    
    // 10. Bond (Single-Entry) - Always show, $0 if not required
    let bondCost = 0.00;
    if (bondRequired) {
      const dutyAmount = cargoValueUsd * (dutyPercent / 100);
      bondCost = Math.max(100, (6 * (cargoValueUsd / 1000)) + dutyAmount);
    }
    lineItems.push({
      description: 'Bond (Single-Entry)',
      amount: bondCost,
      type: 'conditional',
      note: bondRequired ? '6 per 1000 value + duty, min 100' : 'Not required (assumes no continuous bond)'
    });
    totalCost += bondCost;
    
    // 11. MPF (Merchandise Processing Fee) - Always show
    const mpfCost = Math.min(Math.max(0.003464 * cargoValueUsd, 33.58), 651.50);
    lineItems.push({
      description: 'MPF (Merchandise Processing Fee)',
      amount: mpfCost,
      type: 'variable',
      note: '0.3464% of value, min 33.58, max 651.50'
    });
    totalCost += mpfCost;
    
    // 12. US Customs Exam Charges - Always show, $0 if no exams
    const examCost = customsExams * 250; // Cost per exam (assume $250 per exam, including $125 base)
    lineItems.push({
      description: 'US Customs Exam Charges',
      amount: examCost,
      type: 'conditional',
      note: customsExams > 0 ? (customsExams + ' exam(s) × $250 (cost + $125 per exam)') : 'No exams expected'
    });
    totalCost += examCost;
    
    // 13. Duty (if applicable) - Only show if duty percent > 0
    if (dutyPercent > 0) {
      const dutyCost = cargoValueUsd * (dutyPercent / 100);
      lineItems.push({
        description: 'Duty (' + dutyPercent + '% of cargo value)',
        amount: dutyCost,
        type: 'variable'
      });
      totalCost += dutyCost;
    }
    
    return {
      weight_kg: weightKg,
      cargo_value_usd: cargoValueUsd,
      estimated_cost_usd: totalCost,
      line_items: lineItems,
      weight_tier_lower: lowerTier,
      weight_tier_upper: upperTier,
      air_freight_rate_per_kg: airFreightRate
    };
  } catch (error) {
    Logger.log('Error getting freight cost: ' + error.message);
    return {
      weight_kg: weightKg,
      estimated_cost_usd: null,
      line_items: [],
      error: error.message
    };
  }
}

// ============================================================================
// MAIN API ENDPOINT
// ============================================================================

/**
 * Main doGet handler
 */
function doGet(e) {
  try {
    const action = e.parameter.action;
    
    // List managers
    if (action === 'list_managers' || e.parameter.list === 'true') {
      const managers = listManagers();
      return createSuccessResponse({
        action: 'list_managers',
        managers: managers,
        total: managers.length
      });
    }
    
    // Get manager inventory
    if (action === 'get_inventory' && e.parameter.manager) {
      const managerKey = decodeURIComponent(e.parameter.manager);
      const inventory = getManagerInventory(managerKey);
      return createSuccessResponse({
        action: 'get_inventory',
        manager: managerKey,
        inventory: inventory,
        total_items: inventory.length
      });
    }
    
    // Calculate shipping estimate
    if (action === 'calculate_shipping') {
      const selectedItemsJson = e.parameter.selected_items;
      const packagingType = e.parameter.packaging_type || 'box';
      const shippingType = e.parameter.shipping_type; // 'local' or 'freight'
      const destinationAddressJson = e.parameter.destination_address;
      
      if (!selectedItemsJson) {
        return createErrorResponse('Missing selected_items parameter');
      }
      
      if (!shippingType || (shippingType !== 'local' && shippingType !== 'freight')) {
        return createErrorResponse('Missing or invalid shipping_type parameter (must be "local" or "freight")');
      }
      
      let selectedItems;
      try {
        selectedItems = JSON.parse(selectedItemsJson);
      } catch (parseError) {
        return createErrorResponse('Invalid JSON in selected_items parameter');
      }
      
      // Calculate weight
      const weightInfo = calculateTotalWeight(selectedItems, packagingType);
      
      let shippingOptions = [];
      let freightCost = null;
      
      if (shippingType === 'local') {
        // Calculate EasyPost rates
        let destinationAddress = null;
        if (destinationAddressJson) {
          try {
            destinationAddress = JSON.parse(destinationAddressJson);
          } catch (parseError) {
            Logger.log('Warning: Invalid destination address JSON, using default');
          }
        }
        
        shippingOptions = calculateEasyPostRates(weightInfo.total_weight_oz, destinationAddress);
      } else if (shippingType === 'freight') {
        // Get freight cost with detailed breakdown
        // Calculate cargo value from selected items (could be enhanced to use actual product values)
        const cargoValueUsd = parseFloat(e.parameter.cargo_value_usd) || (weightInfo.total_weight_kg * 5); // Default $5/kg, could be made configurable
        const freightOptions = {
          fdaRequired: e.parameter.fda_required === 'true' || e.parameter.fda_required === 'Yes' || e.parameter.fda_required === 'yes',
          bondRequired: e.parameter.bond_required === 'true' || e.parameter.bond_required === 'Yes' || e.parameter.bond_required === 'yes',
          invoiceLines: parseInt(e.parameter.invoice_lines) || 3,
          customsExams: parseInt(e.parameter.customs_exams) || 0,
          dutyPercent: parseFloat(e.parameter.duty_percent) || 0
        };
        freightCost = getFreightCost(weightInfo.total_weight_kg, cargoValueUsd, freightOptions);
      }
      
      return createSuccessResponse({
        action: 'calculate_shipping',
        weight_info: weightInfo,
        packaging_type: packagingType,
        shipping_type: shippingType,
        shipping_options: shippingOptions,
        freight_cost: freightCost
      });
    }
    
    // Default: return available actions
    return createErrorResponse('Invalid or missing action parameter. Available actions: list_managers, get_inventory, calculate_shipping');
    
  } catch (error) {
    Logger.log('Error in doGet: ' + error.message);
    return createErrorResponse('Server error: ' + error.message, 500);
  }
}

/**
 * Main doPost handler (for complex requests)
 */
function doPost(e) {
  try {
    const postData = e.postData ? JSON.parse(e.postData.contents) : {};
    const action = postData.action || e.parameter.action;
    
    // Handle POST requests similar to GET, but with JSON body
    if (action === 'calculate_shipping') {
      const selectedItems = postData.selected_items;
      const packagingType = postData.packaging_type || 'box';
      const shippingType = postData.shipping_type;
      const destinationAddress = postData.destination_address;
      
      if (!selectedItems) {
        return createErrorResponse('Missing selected_items in request body');
      }
      
      if (!shippingType || (shippingType !== 'local' && shippingType !== 'freight')) {
        return createErrorResponse('Missing or invalid shipping_type (must be "local" or "freight")');
      }
      
      const weightInfo = calculateTotalWeight(selectedItems, packagingType);
      
      let shippingOptions = [];
      let freightCost = null;
      
      if (shippingType === 'local') {
        shippingOptions = calculateEasyPostRates(weightInfo.total_weight_oz, destinationAddress);
      } else if (shippingType === 'freight') {
        // Get freight cost with detailed breakdown
        const cargoValueUsd = postData.cargo_value_usd || (weightInfo.total_weight_kg * 5);
        const freightOptions = {
          fdaRequired: postData.fda_required || false,
          bondRequired: postData.bond_required || false,
          invoiceLines: parseInt(postData.invoice_lines) || 3,
          customsExams: parseInt(postData.customs_exams) || 0,
          dutyPercent: parseFloat(postData.duty_percent) || 0
        };
        freightCost = getFreightCost(weightInfo.total_weight_kg, cargoValueUsd, freightOptions);
      }
      
      return createSuccessResponse({
        action: 'calculate_shipping',
        weight_info: weightInfo,
        packaging_type: packagingType,
        shipping_type: shippingType,
        shipping_options: shippingOptions,
        freight_cost: freightCost
      });
    }
    
    return createErrorResponse('Invalid or missing action parameter');
    
  } catch (error) {
    Logger.log('Error in doPost: ' + error.message);
    return createErrorResponse('Server error: ' + error.message, 500);
  }
}

