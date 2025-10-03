/**
 * Web app to list inventory managers or fetch asset data for a specific manager.
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

// Resolves redirect URLs to get the final URL
function resolveRedirect(url) {
  try {
    let currentUrl = url;
    let redirectCount = 0;
    const maxRedirects = 10;

    while (redirectCount < maxRedirects) {
      const response = UrlFetchApp.fetch(currentUrl, {
        followRedirects: false,
        muteHttpExceptions: true
      });
      const responseCode = response.getResponseCode();

      if (responseCode < 300 || responseCode >= 400) {
        return currentUrl;
      }

      const headers = response.getHeaders();
      const location = headers['Location'] || headers['location'];
      if (!location) {
        Logger.log(`No Location header for redirect at ${currentUrl}`);
        return '';
      }

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

    const ledgerUrls = response_obj.dataItems
      .map(item => item.data.contract_url)
      .filter(url => url && url !== '')
      .filter((url, index, self) => self.indexOf(url) === index);

    // Construct LEDGER_CONFIGS dynamically
    const ledgerConfigs = ledgerUrls.map(url => {
      const resolvedUrl = resolveRedirect(url);
      // Extract ledger name from the last segment of the URL (after the last '/')
      const urlParts = resolvedUrl.split('/');
      const lastSegment = urlParts[urlParts.length - 1];
      // Use the spreadsheet ID (before any query params like ?gid) and capitalize
      const ledgerName = lastSegment.split('?')[0].toUpperCase();
      return {
        ledger_name: ledgerName,
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

  // No valid parameter provided
  return ContentService
    .createTextOutput(JSON.stringify({
      error: 'Please specify ?list=true to list managers, ?manager=<key> to get assets, ?recipients=true to list recipients, or ?ledgers=true to list ledgers.'
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