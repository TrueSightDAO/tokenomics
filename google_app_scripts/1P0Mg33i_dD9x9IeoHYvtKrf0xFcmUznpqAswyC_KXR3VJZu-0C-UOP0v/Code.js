/**
 * File: google-app-script/update_store_inventory.gs
 * Repository: https://github.com/TrueSightDAO/agroverse_shop
 * 
 * Description: Calculates and updates store inventory for Agroverse SKUs based on:
 * - Main ledger "offchain asset location" sheet
 * - Managed ledgers from "Shipment Ledger Listing" (Balance tabs)
 * - Only counts inventory managed by store managers (Contributors contact information Column T = TRUE)
 * 
 * Deployment URL: https://script.google.com/macros/s/AKfycbzcrCKpRv7ONKpDrrj6ZBTql_MHCLzkGTizvMgGfzT12Uc_SlObS_N5RbUwPqilAzdxoQ/exec
 * 
 * SETUP INSTRUCTIONS:
 * 1. Ensure the script has access to the main spreadsheet (ID: 1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU)
 * 2. The script needs read access to all managed ledger spreadsheets referenced in "Shipment Ledger Listing"
 * 3. Optionally, set up a time-driven trigger to run automatically (e.g., hourly or daily)
 * 4. GitHub snapshot (UrlFetchApp): appsscript.json oauthScopes MUST include
 *    https://www.googleapis.com/auth/script.external_request. After clasp push, open this project in the
 *    Apps Script editor, run authorizeUrlFetchForSnapshot() (or testUpdateStoreInventory), or Deploy → Test deployments,
 *    and complete the OAuth prompt so the deploying user grants external_request. Workspace: admin may need
 *    to allow that scope for Apps Script.
 * 
 * Endpoints:
 * - GET /exec?action=getInventory - Get inventory for all SKUs
 * - GET /exec?action=getInventory&sku=<product-id> - Get inventory for specific SKU
 * - GET /exec?action=publishInventorySnapshot&token=<secret> - Push current sheet Column I map to GitHub (raw JSON); requires Script property AGROVERSE_INVENTORY_PUBLISH_SECRET
 * - GET /exec?action=recalculateAndPublishInventory&token=<secret> - Run updateStoreInventory() then publish snapshot
 * - updateStoreInventory() - Calculate and update inventory (run via trigger or manually); on success, publishes snapshot if PAT is set
 * 
 * Web Service API:
 * - Returns JSON format with inventory counts
 * - Can query all SKUs or filter by specific SKU Product ID
 * - Reads directly from "Agroverse SKUs" sheet Column I (Store inventory)
 * - Values are updated by running updateStoreInventory() function (via trigger or manually)
 */

// Main spreadsheet ID
const MAIN_SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';

// Sheet names
const SKUS_SHEET_NAME = 'Agroverse SKUs';
const CURRENCIES_SHEET_NAME = 'Currencies';
const CONTRIBUTORS_SHEET_NAME = 'Contributors contact information';
const OFFCHAIN_ASSET_LOCATION_SHEET_NAME = 'offchain asset location';
const SHIPMENT_LEDGER_SHEET_NAME = 'Shipment Ledger Listing';
const BALANCE_SHEET_NAME = 'Balance';

// Column indices (0-based for arrays, 1-based for getRange)
// Agroverse SKUs
const SKU_PRODUCT_ID_COL = 0; // Column A (Product ID)
const SKU_STORE_INVENTORY_COL = 8; // Column I (Store inventory)

// Currencies
const CURRENCY_NAME_COL = 0; // Column A (Currency)
const CURRENCY_SKU_PRODUCT_ID_COL = 12; // Column M (SKU Product ID)

// Contributors contact information
const CONTRIBUTOR_NAME_COL = 0; // Column A (Contributor Name)
const IS_STORE_MANAGER_COL = 19; // Column T (Is Store Manager)

// offchain asset location
const ASSET_CURRENCY_COL = 0; // Column A (Currency)
const ASSET_LOCATION_COL = 1; // Column B (Location/Manager name)
const ASSET_AMOUNT_COL = 2; // Column C (Amount)

// Shipment Ledger Listing
const LEDGER_URL_COL = 27; // Column AB (Resolved Ledger URL)

// Balance sheet (in managed ledgers)
const BALANCE_LOCATION_COL = 7; // Column H (Location/Manager name)
const BALANCE_AMOUNT_COL = 8; // Column I (Amount)
const BALANCE_CURRENCY_COL = 9; // Column J (Currency)

// GitHub snapshot repo (override via Script properties)
const SCRIPT_PROP_INVENTORY_GITHUB_PAT = 'AGROVERSE_INVENTORY_GIT_REPO_UPDATE_PAT';
const SCRIPT_PROP_INVENTORY_PUBLISH_SECRET = 'AGROVERSE_INVENTORY_PUBLISH_SECRET';
const SCRIPT_PROP_INVENTORY_GITHUB_OWNER = 'AGROVERSE_INVENTORY_GITHUB_OWNER';
const SCRIPT_PROP_INVENTORY_GITHUB_REPO = 'AGROVERSE_INVENTORY_GITHUB_REPO';
const SCRIPT_PROP_INVENTORY_GITHUB_BRANCH = 'AGROVERSE_INVENTORY_GITHUB_BRANCH';
const SCRIPT_PROP_INVENTORY_GITHUB_PATH = 'AGROVERSE_INVENTORY_GITHUB_PATH';

/**
 * Resolved GitHub target for the public inventory JSON (Contents API).
 * @return {{ owner: string, repo: string, branch: string, path: string }}
 */
function getInventoryGitHubTarget_() {
  const p = PropertiesService.getScriptProperties();
  return {
    owner: p.getProperty(SCRIPT_PROP_INVENTORY_GITHUB_OWNER) || 'TrueSightDAO',
    repo: p.getProperty(SCRIPT_PROP_INVENTORY_GITHUB_REPO) || 'agroverse-inventory',
    branch: p.getProperty(SCRIPT_PROP_INVENTORY_GITHUB_BRANCH) || 'main',
    path: p.getProperty(SCRIPT_PROP_INVENTORY_GITHUB_PATH) || 'store-inventory.json'
  };
}

/**
 * Read SKU → store inventory count from "Agroverse SKUs" (Column A, Column I).
 * @return {{ inventory: Object.<string, number>, error: (string|null) }}
 */
function readStoreInventoryMapFromSheet_() {
  try {
    const spreadsheet = SpreadsheetApp.openById(MAIN_SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(SKUS_SHEET_NAME);

    if (!sheet) {
      return { inventory: {}, error: `Sheet "${SKUS_SHEET_NAME}" not found` };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return { inventory: {}, error: 'No SKU data found' };
    }

    const dataRange = sheet.getRange(2, 1, lastRow, 9);
    const data = dataRange.getValues();
    const inventory = {};

    for (let i = 0; i < data.length; i++) {
      const productId = data[i][SKU_PRODUCT_ID_COL] ? data[i][SKU_PRODUCT_ID_COL].toString().trim() : '';
      const inventoryCount = parseFloat(data[i][SKU_STORE_INVENTORY_COL]) || 0;
      if (productId) {
        inventory[productId] = inventoryCount;
      }
    }

    return { inventory: inventory, error: null };
  } catch (err) {
    Logger.log(`readStoreInventoryMapFromSheet_: ${err.message}`);
    return { inventory: {}, error: err.message };
  }
}

/**
 * Compare two SKU → quantity maps (order-independent, numeric values).
 * @param {Object.<string, number>} a
 * @param {Object.<string, number>} b
 * @return {boolean}
 */
function inventoryMapsEqual_(a, b) {
  const aa = a || {};
  const bb = b || {};
  const keysA = Object.keys(aa).sort();
  const keysB = Object.keys(bb).sort();
  if (keysA.length !== keysB.length) {
    return false;
  }
  for (let i = 0; i < keysA.length; i++) {
    if (keysA[i] !== keysB[i]) {
      return false;
    }
    if (Number(aa[keysA[i]]) !== Number(bb[keysB[i]])) {
      return false;
    }
  }
  return true;
}

/**
 * Commit inventory snapshot JSON to TrueSightDAO/agroverse-inventory (or overrides) via Contents API.
 * Uses GET-then-PUT: if the file exists and **inventory** matches the new map, skips PUT (no commit churn on hourly runs).
 * @param {Object.<string, number>} inventoryMap
 * @return {{ ok: boolean, message: string, sha: (string|undefined), skipped: (boolean|undefined) }}
 */
function publishInventorySnapshotToGitHub_(inventoryMap) {
  const pat = PropertiesService.getScriptProperties().getProperty(SCRIPT_PROP_INVENTORY_GITHUB_PAT);
  if (!pat) {
    const msg = 'Script property AGROVERSE_INVENTORY_GIT_REPO_UPDATE_PAT is not set; skip GitHub publish';
    Logger.log(msg);
    return { ok: false, message: msg };
  }

  const t = getInventoryGitHubTarget_();
  const nextInventory = inventoryMap || {};
  const payloadObj = {
    generatedAt: new Date().toISOString(),
    source: 'update_store_inventory',
    inventory: nextInventory
  };
  const jsonString = JSON.stringify(payloadObj, null, 2);
  const encoded = Utilities.base64Encode(jsonString, Utilities.Charset.UTF_8);

  const pathEncoded = t.path.split('/').filter(function (s) {
    return s.length > 0;
  }).map(function (seg) {
    return encodeURIComponent(seg);
  }).join('/');
  const apiBase = 'https://api.github.com/repos/' + encodeURIComponent(t.owner) + '/' + encodeURIComponent(t.repo) + '/contents/' + pathEncoded;
  const getUrl = apiBase + '?ref=' + encodeURIComponent(t.branch);

  const headers = {
    Authorization: 'Bearer ' + pat,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  let existingSha = null;
  const getResp = UrlFetchApp.fetch(getUrl, {
    method: 'get',
    headers: headers,
    muteHttpExceptions: true
  });
  const getCode = getResp.getResponseCode();
  if (getCode === 200) {
    const body = JSON.parse(getResp.getContentText());
    existingSha = body.sha || null;
    if (body.content) {
      try {
        const decoded = Utilities.newBlob(Utilities.base64Decode(body.content.replace(/\s/g, ''))).getDataAsString();
        const prev = JSON.parse(decoded);
        if (prev && prev.inventory && inventoryMapsEqual_(prev.inventory, nextInventory)) {
          Logger.log('GitHub snapshot inventory unchanged; skipping PUT');
          return {
            ok: true,
            message: 'Inventory unchanged; skipped GitHub PUT',
            skipped: true,
            sha: existingSha
          };
        }
      } catch (parseErr) {
        Logger.log('Could not compare existing snapshot (will PUT): ' + parseErr.message);
      }
    }
  } else if (getCode !== 404) {
    const errText = getResp.getContentText();
    Logger.log('GitHub GET contents failed: ' + getCode + ' ' + errText);
    return { ok: false, message: 'GitHub GET ' + getCode + ': ' + errText };
  }

  const putBody = {
    message: 'chore: refresh Agroverse store inventory snapshot',
    content: encoded,
    branch: t.branch
  };
  if (existingSha) {
    putBody.sha = existingSha;
  }

  const putResp = UrlFetchApp.fetch(apiBase, {
    method: 'put',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
    payload: JSON.stringify(putBody),
    muteHttpExceptions: true
  });
  const putCode = putResp.getResponseCode();
  const putText = putResp.getContentText();

  if (putCode !== 200 && putCode !== 201) {
    Logger.log('GitHub PUT contents failed: ' + putCode + ' ' + putText);
    return { ok: false, message: 'GitHub PUT ' + putCode + ': ' + putText };
  }

  let commitSha;
  try {
    const parsed = JSON.parse(putText);
    commitSha = parsed.content && parsed.content.sha;
  } catch (err) {
    commitSha = undefined;
  }
  Logger.log('Published inventory snapshot to ' + t.owner + '/' + t.repo + '/' + t.path);
  return { ok: true, message: 'Published', sha: commitSha };
}

/**
 * Optionally verify token for public web-app publish actions.
 * @param {string} tokenFromQuery
 * @return {boolean}
 */
function verifyPublishToken_(tokenFromQuery) {
  const expected = PropertiesService.getScriptProperties().getProperty(SCRIPT_PROP_INVENTORY_PUBLISH_SECRET);
  if (!expected) {
    return false;
  }
  return tokenFromQuery && tokenFromQuery === expected;
}

/**
 * Get store managers list from Contributors contact information sheet.
 * Filters for rows where Column T ("Is Store Manager") = TRUE.
 * 
 * @return {Array<string>} Array of store manager names
 */
function getStoreManagers() {
  try {
    const spreadsheet = SpreadsheetApp.openById(MAIN_SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(CONTRIBUTORS_SHEET_NAME);
    
    if (!sheet) {
      Logger.log(`Error: Sheet "${CONTRIBUTORS_SHEET_NAME}" not found`);
      return [];
    }
    
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      Logger.log(`No data in "${CONTRIBUTORS_SHEET_NAME}" sheet`);
      return [];
    }
    
    // Read data starting from row 2 (row 1 is header)
    const dataRange = sheet.getRange(2, 1, lastRow - 1, 20); // Columns A to T
    const data = dataRange.getValues();
    
    const storeManagers = [];
    
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const isStoreManager = row[IS_STORE_MANAGER_COL];
      const managerName = row[CONTRIBUTOR_NAME_COL] ? row[CONTRIBUTOR_NAME_COL].toString().trim() : '';
      
      // Check if Is Store Manager (Column T) is TRUE
      if (isStoreManager === true || isStoreManager === 'TRUE' || isStoreManager === 'True' || isStoreManager === 'true') {
        if (managerName) {
          storeManagers.push(managerName);
          Logger.log(`Found store manager: ${managerName}`);
        }
      }
    }
    
    Logger.log(`Total store managers found: ${storeManagers.length}`);
    return storeManagers;
    
  } catch (e) {
    Logger.log(`Error getting store managers: ${e.message}`);
    return [];
  }
}

/**
 * Get currency to SKU Product ID mapping from Currencies sheet.
 * Maps Column A (Currency) to Column M (SKU Product ID).
 * This links inventory currencies to specific product SKUs in "Agroverse SKUs" sheet.
 * 
 * @return {Object} Map of currency name to SKU Product ID (e.g., { "AGL4": "oscar-bahia-ceremonial-cacao-200g", ... })
 */
function getCurrencyToSKUMapping() {
  try {
    const spreadsheet = SpreadsheetApp.openById(MAIN_SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(CURRENCIES_SHEET_NAME);
    
    if (!sheet) {
      Logger.log(`Error: Sheet "${CURRENCIES_SHEET_NAME}" not found`);
      return {};
    }
    
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      Logger.log(`No data in "${CURRENCIES_SHEET_NAME}" sheet`);
      return {};
    }
    
    // Read data starting from row 2 (row 1 is header)
    // Columns A (Currency) and M (SKU Product ID)
    const dataRange = sheet.getRange(2, 1, lastRow - 1, 13); // Columns A to M
    const data = dataRange.getValues();
    
    const mapping = {};
    
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const currency = row[CURRENCY_NAME_COL] ? row[CURRENCY_NAME_COL].toString().trim() : '';
      const skuProductId = row[CURRENCY_SKU_PRODUCT_ID_COL] ? row[CURRENCY_SKU_PRODUCT_ID_COL].toString().trim() : '';
      
      if (currency && skuProductId) {
        mapping[currency] = skuProductId;
        Logger.log(`Currency "${currency}" maps to SKU "${skuProductId}"`);
      }
    }
    
    Logger.log(`Total currency mappings found: ${Object.keys(mapping).length}`);
    return mapping;
    
  } catch (e) {
    Logger.log(`Error getting currency to SKU mapping: ${e.message}`);
    return {};
  }
}

/**
 * Get inventory from main ledger "offchain asset location" sheet.
 * Only counts inventory where Column B (Location/Manager Name) matches a store manager.
 * Data starts at row 5 (row 4 is header).
 *
 * @param {Array<string>} storeManagers - List of store manager names to filter by
 * @return {Object} Map of currency to manager breakdown (e.g., { "AGL4": { "manager1": 50, "manager2": 25 }, ... })
 */
function getMainLedgerInventory(storeManagers) {
  const inventory = {};

  try {
    const spreadsheet = SpreadsheetApp.openById(MAIN_SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(OFFCHAIN_ASSET_LOCATION_SHEET_NAME);

    if (!sheet) {
      Logger.log(`Warning: Sheet "${OFFCHAIN_ASSET_LOCATION_SHEET_NAME}" not found`);
      return inventory;
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 5) { // Data starts at row 5
      Logger.log(`No data in "${OFFCHAIN_ASSET_LOCATION_SHEET_NAME}" sheet`);
      return inventory;
    }

    // Read data starting from row 5 (row 4 is header)
    const dataRange = sheet.getRange(5, 1, lastRow - 4, 3); // Columns A, B, C
    const data = dataRange.getValues();

    // Create a Set for faster lookup
    const storeManagerSet = new Set(storeManagers);

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const currency = row[ASSET_CURRENCY_COL] ? row[ASSET_CURRENCY_COL].toString().trim() : '';
      const location = row[ASSET_LOCATION_COL] ? row[ASSET_LOCATION_COL].toString().trim() : '';
      const amount = parseFloat(row[ASSET_AMOUNT_COL]) || 0;

      // Only count if location/manager is in our store managers list
      if (currency && location && storeManagerSet.has(location) && amount > 0) {
        if (!inventory[currency]) {
          inventory[currency] = {};
        }
        if (!inventory[currency][location]) {
          inventory[currency][location] = 0;
        }
        inventory[currency][location] += amount;
        Logger.log(`📦 Main ledger (${OFFCHAIN_ASSET_LOCATION_SHEET_NAME}): ${currency} +${amount} units managed by ${location}`);
      }
    }

    Logger.log(`Main ledger inventory totals: ${Object.keys(inventory).length} currencies across ${storeManagers.length} managers`);
    return inventory;

  } catch (e) {
    Logger.log(`Error getting main ledger inventory: ${e.message}`);
    return inventory;
  }
}

/**
 * Get resolved ledger URLs from "Shipment Ledger Listing" sheet, Column AB.
 * Returns unique resolved URLs (Google Sheets URLs) to managed ledger spreadsheets.
 * 
 * @return {Array<string>} Array of unique resolved ledger URLs
 */
function getManagedLedgerUrls() {
  const urls = [];
  
  try {
    const spreadsheet = SpreadsheetApp.openById(MAIN_SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(SHIPMENT_LEDGER_SHEET_NAME);
    
    if (!sheet) {
      Logger.log(`Warning: Sheet "${SHIPMENT_LEDGER_SHEET_NAME}" not found`);
      return urls;
    }
    
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      Logger.log(`No data in "${SHIPMENT_LEDGER_SHEET_NAME}" sheet`);
      return urls;
    }
    
    // Read data starting from row 2 (row 1 is header)
    // Read columns A to AB (28 columns) to get Column AB
    const dataRange = sheet.getRange(2, 1, lastRow - 1, 28);
    const data = dataRange.getValues();
    
    const seenUrls = new Set();
    
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const resolvedUrl = row[LEDGER_URL_COL] ? row[LEDGER_URL_COL].toString().trim() : '';
      
      if (resolvedUrl && !seenUrls.has(resolvedUrl)) {
        seenUrls.add(resolvedUrl);
        urls.push(resolvedUrl);
      }
    }
    
    Logger.log(`Found ${urls.length} unique managed ledger URLs`);
    return urls;
    
  } catch (e) {
    Logger.log(`Error getting managed ledger URLs: ${e.message}`);
    return urls;
  }
}

/**
 * Get inventory from a managed ledger's Balance sheet.
 * Reads the "Balance" sheet in the ledger spreadsheet.
 * Only counts inventory where Column H (Location/Manager Name) matches a store manager.
 *
 * @param {string} ledgerUrl - Resolved ledger URL (Google Sheets URL)
 * @param {Array<string>} storeManagers - List of store manager names to filter by
 * @return {Object} Map of currency to manager breakdown (e.g., { "AGL4": { "manager1": 25, "manager2": 10 }, ... })
 */
function getManagedLedgerInventory(ledgerUrl, storeManagers) {
  const inventory = {};

  try {
    // Extract spreadsheet ID from URL
    const spreadsheetIdMatch = ledgerUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!spreadsheetIdMatch) {
      Logger.log(`Could not extract spreadsheet ID from URL: ${ledgerUrl}`);
      return inventory;
    }

    const spreadsheetId = spreadsheetIdMatch[1];

    // Extract ledger name from URL for logging (e.g., "AGL4" from agroverse.shop/agl4)
    const ledgerNameMatch = ledgerUrl.match(/\/([^\/]+)$/);
    const ledgerName = ledgerNameMatch ? ledgerNameMatch[1].toUpperCase() : spreadsheetId.substring(0, 10);

    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const sheet = spreadsheet.getSheetByName(BALANCE_SHEET_NAME);

    if (!sheet) {
      Logger.log(`Warning: Balance sheet not found in ledger: ${ledgerUrl}`);
      return inventory;
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      Logger.log(`No data in Balance sheet for ledger: ${ledgerUrl}`);
      return inventory;
    }

    // Read data starting from row 2 (row 1 is header)
    // Columns H (Location), I (Amount), J (Currency)
    const dataRange = sheet.getRange(2, 8, lastRow - 1, 3); // Columns H, I, J
    const data = dataRange.getValues();

    // Create a Set for faster lookup
    const storeManagerSet = new Set(storeManagers);

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const location = row[0] ? row[0].toString().trim() : ''; // Column H
      const amount = parseFloat(row[1]) || 0; // Column I
      const currency = row[2] ? row[2].toString().trim() : ''; // Column J

      // Only count if location/manager is in our store managers list
      if (currency && location && storeManagerSet.has(location) && amount > 0) {
        if (!inventory[currency]) {
          inventory[currency] = {};
        }
        if (!inventory[currency][location]) {
          inventory[currency][location] = 0;
        }
        inventory[currency][location] += amount;
        Logger.log(`📦 Managed ledger ${ledgerName}: ${currency} +${amount} units managed by ${location}`);
      }
    }

    return inventory;

  } catch (e) {
    Logger.log(`Error getting inventory from ledger ${ledgerUrl}: ${e.message}`);
    return inventory;
  }
}

/**
 * Calculate total store inventory for each SKU.
 * Orchestrates the entire calculation process:
 * 1. Gets store managers
 * 2. Gets currency to SKU mappings
 * 3. Gets inventory from main ledger (with manager breakdown)
 * 4. Gets inventory from all managed ledgers (with manager breakdown)
 * 5. Combines and maps to SKU Product IDs
 * 6. Provides detailed logging of manager/ledger breakdown per SKU
 *
 * @return {Object} Map of SKU Product ID to total inventory count (e.g., { "sku1": 100, "sku2": 50, ... })
 */
function calculateStoreInventory() {
  Logger.log('🔄 Starting store inventory calculation...');

  // Get store managers
  const storeManagers = getStoreManagers();
  if (storeManagers.length === 0) {
    Logger.log('❌ No store managers found. Aborting.');
    return {};
  }

  // Get currency to SKU mapping
  const currencyToSKU = getCurrencyToSKUMapping();
  if (Object.keys(currencyToSKU).length === 0) {
    Logger.log('❌ No currency mappings found. Aborting.');
    return {};
  }

  // Get inventory from main ledger (with manager breakdown)
  const mainLedgerInventory = getMainLedgerInventory(storeManagers);

  // Get inventory from managed ledgers (with manager breakdown)
  const managedLedgerUrls = getManagedLedgerUrls();
  const allManagedInventory = {};

  for (let i = 0; i < managedLedgerUrls.length; i++) {
    const ledgerUrl = managedLedgerUrls[i];
    Logger.log(`🔍 Processing managed ledger ${i + 1}/${managedLedgerUrls.length}: ${ledgerUrl}`);
    const ledgerInventory = getManagedLedgerInventory(ledgerUrl, storeManagers);

    // Merge into allManagedInventory (preserving manager breakdown)
    for (const currency in ledgerInventory) {
      if (!allManagedInventory[currency]) {
        allManagedInventory[currency] = {};
      }
      for (const manager in ledgerInventory[currency]) {
        if (!allManagedInventory[currency][manager]) {
          allManagedInventory[currency][manager] = 0;
        }
        allManagedInventory[currency][manager] += ledgerInventory[currency][manager];
      }
    }
  }

  // Convert currency inventory to SKU inventory with detailed breakdown
  const skuInventory = {};
  const skuBreakdown = {}; // For detailed logging

  Logger.log('📊 Processing inventory breakdown by SKU, manager, and ledger:');

  // Process main ledger inventory
  for (const currency in mainLedgerInventory) {
    const skuProductId = currencyToSKU[currency];
    if (skuProductId) {
      // Initialize SKU tracking
      if (!skuBreakdown[skuProductId]) {
        skuBreakdown[skuProductId] = {};
        skuInventory[skuProductId] = 0;
      }

      for (const manager in mainLedgerInventory[currency]) {
        const amount = mainLedgerInventory[currency][manager];
        const ledgerKey = `${OFFCHAIN_ASSET_LOCATION_SHEET_NAME} (offchain)`;

        if (!skuBreakdown[skuProductId][ledgerKey]) {
          skuBreakdown[skuProductId][ledgerKey] = {};
        }
        skuBreakdown[skuProductId][ledgerKey][manager] = (skuBreakdown[skuProductId][ledgerKey][manager] || 0) + amount;
        skuInventory[skuProductId] += amount;
      }
    }
  }

  // Process managed ledger inventory
  for (const currency in allManagedInventory) {
    const skuProductId = currencyToSKU[currency];
    if (skuProductId) {
      // Initialize SKU tracking if not already done
      if (!skuBreakdown[skuProductId]) {
        skuBreakdown[skuProductId] = {};
        skuInventory[skuProductId] = 0;
      }

      for (const manager in allManagedInventory[currency]) {
        const amount = allManagedInventory[currency][manager];

        // Try to determine ledger name from the inventory data
        let ledgerName = 'Unknown Ledger';
        for (let i = 0; i < managedLedgerUrls.length; i++) {
          const ledgerUrl = managedLedgerUrls[i];
          const ledgerNameMatch = ledgerUrl.match(/\/([^\/]+)$/);
          const candidateName = ledgerNameMatch ? ledgerNameMatch[1].toUpperCase() : 'Unknown';

          // Check if this ledger contains this currency/manager combination
          try {
            const spreadsheetIdMatch = ledgerUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
            if (spreadsheetIdMatch) {
              const spreadsheetId = spreadsheetIdMatch[1];
              const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
              const sheet = spreadsheet.getSheetByName(BALANCE_SHEET_NAME);
              if (sheet) {
                const lastRow = sheet.getLastRow();
                if (lastRow >= 2) {
                  const dataRange = sheet.getRange(2, 8, lastRow - 1, 3);
                  const data = dataRange.getValues();
                  for (let j = 0; j < data.length; j++) {
                    const row = data[j];
                    const rowLocation = row[0] ? row[0].toString().trim() : '';
                    const rowCurrency = row[2] ? row[2].toString().trim() : '';
                    const rowAmount = parseFloat(row[1]) || 0;

                    if (rowLocation === manager && rowCurrency === currency && rowAmount > 0) {
                      ledgerName = candidateName;
                      break;
                    }
                  }
                }
              }
            }
          } catch (e) {
            // Ignore errors when checking ledgers
          }
        }

        const ledgerKey = `${ledgerName} (managed)`;

        if (!skuBreakdown[skuProductId][ledgerKey]) {
          skuBreakdown[skuProductId][ledgerKey] = {};
        }
        skuBreakdown[skuProductId][ledgerKey][manager] = (skuBreakdown[skuProductId][ledgerKey][manager] || 0) + amount;
        skuInventory[skuProductId] += amount;
      }
    } else {
      Logger.log(`⚠️ Warning: Currency "${currency}" has no SKU mapping`);
    }
  }

  // Log detailed breakdown for each SKU
  Logger.log('📋 Detailed SKU inventory breakdown:');
  for (const skuProductId in skuBreakdown) {
    Logger.log(`🛍️ SKU: ${skuProductId} (Total: ${skuInventory[skuProductId]} units)`);

    for (const ledgerKey in skuBreakdown[skuProductId]) {
      Logger.log(`  📁 Ledger: ${ledgerKey}`);

      for (const manager in skuBreakdown[skuProductId][ledgerKey]) {
        const units = skuBreakdown[skuProductId][ledgerKey][manager];
        Logger.log(`    👤 ${manager}: ${units} units`);
      }
    }
    Logger.log(''); // Empty line between SKUs
  }

  Logger.log(`✅ Total SKUs with inventory: ${Object.keys(skuInventory).length}`);
  return skuInventory;
}

/**
 * Main function to calculate and update store inventory.
 * Calculates inventory for all SKUs and updates "Agroverse SKUs" sheet Column I (Store inventory).
 * 
 * This function should be run:
 * - Manually when needed
 * - Via time-driven trigger (recommended: hourly or daily)
 * 
 * @return {Object} Result object with success status and message
 */
function updateStoreInventory() {
  try {
    Logger.log('=== Starting Store Inventory Update ===');
    
    // Calculate inventory
    const skuInventory = calculateStoreInventory();
    
    if (Object.keys(skuInventory).length === 0) {
      Logger.log('No inventory to update');
      return { success: false, message: 'No inventory calculated' };
    }
    
    // Open SKUs sheet
    const spreadsheet = SpreadsheetApp.openById(MAIN_SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(SKUS_SHEET_NAME);
    
    if (!sheet) {
      Logger.log(`Error: Sheet "${SKUS_SHEET_NAME}" not found`);
      return { success: false, message: `Sheet "${SKUS_SHEET_NAME}" not found` };
    }
    
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      Logger.log(`No data in "${SKUS_SHEET_NAME}" sheet`);
      return { success: false, message: 'No SKU data found' };
    }
    
    // Read Product IDs (Column A) starting from row 2
    const productIdRange = sheet.getRange(2, 1, lastRow - 1, 1);
    const productIds = productIdRange.getValues();
    
    let updatedCount = 0;
    
    // Update inventory for each SKU
    for (let i = 0; i < productIds.length; i++) {
      const productId = productIds[i][0] ? productIds[i][0].toString().trim() : '';
      
      if (productId) {
        const inventory = skuInventory[productId] || 0;
        const rowIndex = i + 2; // +2 because we start from row 2
        
        // Update Column I (Store inventory)
        sheet.getRange(rowIndex, SKU_STORE_INVENTORY_COL + 1).setValue(inventory);
        
        if (inventory > 0) {
          Logger.log(`Updated ${productId}: ${inventory} units`);
          updatedCount++;
        }
      }
    }
    
    Logger.log(`=== Store Inventory Update Complete ===`);
    Logger.log(`Updated ${updatedCount} SKUs with inventory`);

    const snapshot = readStoreInventoryMapFromSheet_();
    let publish = { ok: false, message: 'skipped' };
    if (!snapshot.error) {
      publish = publishInventorySnapshotToGitHub_(snapshot.inventory);
    } else {
      Logger.log('Snapshot read after update failed: ' + snapshot.error);
    }

    return {
      success: true,
      message: `Updated ${updatedCount} SKUs`,
      updatedCount: updatedCount,
      githubPublish: publish
    };

  } catch (e) {
    Logger.log(`Error updating store inventory: ${e.message}`);
    Logger.log(`Stack trace: ${e.stack}`);
    return { success: false, error: e.message };
  }
}

/**
 * Run once from the Apps Script editor (▶ Run) after adding oauthScopes / script.external_request.
 * Forces the OAuth prompt for "Connect to an external service". If you still get UrlFetch errors,
 * revoke the app at https://myaccount.google.com/permissions then run this again.
 * Does not use your GitHub PAT.
 */
function authorizeUrlFetchForSnapshot() {
  const r = UrlFetchApp.fetch('https://api.github.com/', {
    muteHttpExceptions: true
  });
  Logger.log('authorizeUrlFetchForSnapshot: HTTP ' + r.getResponseCode());
  return r.getResponseCode();
}

/**
 * Test function to run the inventory update.
 * Useful for testing and debugging. Check execution logs for detailed output.
 * 
 * @return {Object} Result object from updateStoreInventory()
 */
function testUpdateStoreInventory() {
  const result = updateStoreInventory();
  Logger.log('Result: ' + JSON.stringify(result));
  return result;
}

/**
 * Handles GET requests to this web app.
 * 
 * Expected actions:
 * - getInventory: Get current store inventory for SKU(s)
 * 
 * Query parameters:
 * - action=getInventory (required)
 * - sku=<product-id> (optional) - If provided, returns inventory for specific SKU only
 * 
 * Returns JSON:
 * - All SKUs: { "sku1": 10, "sku2": 5, ... }
 * - Single SKU: { "sku": "product-id", "inventory": 10 }
 * - Error: { "error": "error message" }
 * 
 * @param {Object} e Event object containing parameters
 * @return {ContentService.TextOutput} JSON response with inventory data or error
 */
function doGet(e) {
  try {
    const action = e.parameter?.action;
    const params = e.parameter || {};

    if (action === 'getInventory') {
      return getInventoryWebService(params.sku);
    }

    if (action === 'publishInventorySnapshot') {
      if (!verifyPublishToken_(params.token)) {
        return ContentService.createTextOutput(JSON.stringify({
          error: 'Unauthorized. Set AGROVERSE_INVENTORY_PUBLISH_SECRET and pass token=<secret>.'
        })).setMimeType(ContentService.MimeType.JSON);
      }
      const snap = readStoreInventoryMapFromSheet_();
      if (snap.error) {
        return ContentService.createTextOutput(JSON.stringify({ error: snap.error }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      const pub = publishInventorySnapshotToGitHub_(snap.inventory);
      return ContentService.createTextOutput(JSON.stringify(pub))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'recalculateAndPublishInventory') {
      if (!verifyPublishToken_(params.token)) {
        return ContentService.createTextOutput(JSON.stringify({
          error: 'Unauthorized. Set AGROVERSE_INVENTORY_PUBLISH_SECRET and pass token=<secret>.'
        })).setMimeType(ContentService.MimeType.JSON);
      }
      const upd = updateStoreInventory();
      return ContentService.createTextOutput(JSON.stringify(upd))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Default response for unknown actions
    return ContentService.createTextOutput(JSON.stringify({
      error: 'Invalid action. Use ?action=getInventory, publishInventorySnapshot, or recalculateAndPublishInventory'
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    Logger.log(`Error in doGet: ${error.message}`);
    return ContentService.createTextOutput(JSON.stringify({
      error: error.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Web service to get inventory for SKU(s).
 * Reads inventory values directly from "Agroverse SKUs" sheet Column I.
 * This is faster than recalculating, but requires updateStoreInventory() to be run regularly.
 * 
 * @param {string} sku - Optional SKU Product ID to filter by. If not provided, returns all SKUs.
 * @return {ContentService.TextOutput} JSON response with inventory data
 */
function getInventoryWebService(sku) {
  try {
    Logger.log(`getInventoryWebService called with sku: ${sku || 'all'}`);

    const read = readStoreInventoryMapFromSheet_();
    if (read.error) {
      return ContentService.createTextOutput(JSON.stringify({
        error: read.error
      })).setMimeType(ContentService.MimeType.JSON);
    }

    const inventory = read.inventory;

    // If specific SKU requested, return just that one
    if (sku && sku.trim()) {
      const requestedSku = sku.trim();
      const skuInventory = inventory[requestedSku] !== undefined ? inventory[requestedSku] : 0;
      
      return ContentService.createTextOutput(JSON.stringify({
        sku: requestedSku,
        inventory: skuInventory
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // Return all SKUs
    return ContentService.createTextOutput(JSON.stringify(inventory))
      .setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    Logger.log(`Error in getInventoryWebService: ${error.message}`);
    Logger.log(`Stack trace: ${error.stack}`);
    return ContentService.createTextOutput(JSON.stringify({
      error: error.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Alternative web service that recalculates inventory on-demand (slower but always current).
 * This function calculates inventory in real-time rather than reading from the sheet.
 * 
 * WARNING: This is slower than getInventoryWebService() because it recalculates all inventory.
 * Only use this if you need absolutely current data and don't mind the performance cost.
 * 
 * @param {string} sku - Optional SKU Product ID to filter by. If not provided, returns all SKUs.
 * @return {ContentService.TextOutput} JSON response with inventory data
 */
function getInventoryWebServiceRecalculated(sku) {
  try {
    Logger.log(`getInventoryWebServiceRecalculated called with sku: ${sku || 'all'}`);
    
    // Calculate current inventory
    const skuInventory = calculateStoreInventory();
    
    // If specific SKU requested, return just that one
    if (sku && sku.trim()) {
      const requestedSku = sku.trim();
      const inventory = skuInventory[requestedSku] !== undefined ? skuInventory[requestedSku] : 0;
      
      return ContentService.createTextOutput(JSON.stringify({
        sku: requestedSku,
        inventory: inventory
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // Return all SKUs
    return ContentService.createTextOutput(JSON.stringify(skuInventory))
      .setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    Logger.log(`Error in getInventoryWebServiceRecalculated: ${error.message}`);
    return ContentService.createTextOutput(JSON.stringify({
      error: error.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

