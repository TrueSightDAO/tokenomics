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
 */
// Configuration for additional ledgers to augment inventory
var LEDGER_CONFIGS = [
  {
    ledger_name: "AGL6",
    ledger_url: "https://docs.google.com/spreadsheets/d/186vHg-baSaT9BlueDYMB58Cq6HIETgf3hu1GaOGAJvE/edit?gid=1930053694",
    sheet_name: "Balance",
    manager_names_column: "H",
    asset_name_column: "J",
    asset_quantity_column: "I",
    record_start_row: 6
  },
  {
    ledger_name: "AGL7",
    ledger_url: "https://docs.google.com/spreadsheets/d/1gJKOXf2qE2LwqtxjS-_1KerrKer20Zi1GTppZpB5n1k/edit?gid=2133986329#gid=2133986329",
    sheet_name: "Balance",
    manager_names_column: "H",
    asset_name_column: "J",
    asset_quantity_column: "I",
    record_start_row: 6
  }  ,
  {
    ledger_name: "AGL8",
    ledger_url: "https://docs.google.com/spreadsheets/d/1pdI1lMChyD2-3mEaQr8krkzQUeFQ60JMz57IbfO-qLE/edit?gid=2133986329#gid=2133986329",
    sheet_name: "Balance",
    manager_names_column: "H",
    asset_name_column: "J",
    asset_quantity_column: "I",
    record_start_row: 6
  }  
  // Add more configs as needed
];

// Helper to convert column letter(s) to number
function letterToColumn(letter) {
  var col = 0;
  for (var i = 0; i < letter.length; i++) {
    col = col * 26 + (letter.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
  }
  return col;
}

// Augment the result array with assets from external ledgers
function augmentWithLedgers(managerName, result) {
  LEDGER_CONFIGS.forEach(function(config) {
    try {
      var ss = SpreadsheetApp.openByUrl(config.ledger_url);
      var sheet = ss.getSheetByName(config.sheet_name);
      if (!sheet) return;
      var startRow = config.record_start_row;
      var lastRow = sheet.getLastRow();
      var numRows = Math.max(0, lastRow - startRow + 1);
      if (numRows < 1) return;
      var nameCol = letterToColumn(config.manager_names_column);
      var assetCol = letterToColumn(config.asset_name_column);
      var qtyCol = letterToColumn(config.asset_quantity_column || config.asset_quantity);
      var names = sheet.getRange(startRow, nameCol, numRows, 1).getValues();
      var assets = sheet.getRange(startRow, assetCol, numRows, 1).getValues();
      var qtys = sheet.getRange(startRow, qtyCol, numRows, 1).getValues();
      for (var i = 0; i < names.length; i++) {
        if (names[i][0] === managerName) {
          var assetName = assets[i][0];
          var quantity = qtys[i][0];
          result.push({
            currency: "[" + config.ledger_name + "] " + assetName,
            amount: quantity
          });
        }
      }
    } catch (err) {
      Logger.log("Error processing ledger " + config.ledger_name + ": " + err);
    }
  });
}
/**
 * Return unique manager names from all configured ledgers.
 */
function getManagersFromLedgers() {
  var names = [];
  var seen = {};
  LEDGER_CONFIGS.forEach(function(config) {
    try {
      var ss = SpreadsheetApp.openByUrl(config.ledger_url);
      var sheet = ss.getSheetByName(config.sheet_name);
      if (!sheet) return;
      var startRow = config.record_start_row;
      var lastRow = sheet.getLastRow();
      var numRows = Math.max(0, lastRow - startRow + 1);
      if (numRows < 1) return;
      var nameCol = letterToColumn(config.manager_names_column);
      var values = sheet.getRange(startRow, nameCol, numRows, 1).getValues();
      values.forEach(function(row) {
        var nm = row[0];
        if (nm && !seen[nm]) {
          seen[nm] = true;
          names.push(nm);
        }
      });
    } catch (err) {
      Logger.log('Error listing managers in ledger ' + config.ledger_name + ': ' + err);
    }
  });
  return names;
}
function doGet(e) {
  var SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
  var SHEET_NAME = 'offchain asset location';
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: 'Sheet not found: ' + SHEET_NAME }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var lastRow = sheet.getLastRow();
  var numRows = Math.max(0, lastRow - 4);
  var data = numRows > 0 ? sheet.getRange(5, 1, numRows, 3).getValues() : [];

  // Return list of possible recipients from "Contributors contact information" sheet
  if (e.parameter.recipients) {
    var CONTACT_SHEET_NAME = 'Contributors contact information';
    var contactSheet = ss.getSheetByName(CONTACT_SHEET_NAME);
    if (!contactSheet) {
      return ContentService
        .createTextOutput(JSON.stringify({ error: 'Sheet not found: ' + CONTACT_SHEET_NAME }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var lastRow2 = contactSheet.getLastRow();
    var numRows2 = Math.max(0, lastRow2 - 4);
    var data2 = numRows2 > 0 ? contactSheet.getRange(5, 1, numRows2, 1).getValues() : [];
    var seenRecipients = {};
    var recipients = [];
    data2.forEach(function(row) {
      var name = row[0];
      if (name && !seenRecipients[name]) {
        seenRecipients[name] = true;
        recipients.push({
          key: encodeURIComponent(name),
          name: name
        });
      }
    });
    // Augment result with assets from external ledgers
    augmentWithLedgers(managerName, result);
    return ContentService
      .createTextOutput(JSON.stringify(recipients))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Return list of unique inventory managers with URL-encoded keys
  if (e.parameter.list) {
    var seen = {};
    var list = [];
    data.forEach(function(row) {
      var name = row[1];
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
  var managerKey = e.parameter.manager;
  if (managerKey) {
    var managerName = decodeURIComponent(managerKey);
    var result = [];
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

  // No valid parameter provided
  return ContentService
    .createTextOutput(JSON.stringify({
      error: 'Please specify ?list=true to list managers, ?manager=<key> to get assets, or ?recipients=true to list recipients.'
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Test function: fetch assets for a given manager.
 * Usage (in Apps Script console): testManager('Manager Name');
 */
function testManager() {
  managerName = "DHL"
  var e = { parameter: { manager: encodeURIComponent(managerName) } };
  var output = doGet(e);
  Logger.log('Assets for %s: %s', managerName, output.getContent());
}

/**
 * Test function: list all managers.
 * Usage (in Apps Script console): testList();
 */
function testList() {
  var e = { parameter: { list: 'true' } };
  var output = doGet(e);
  Logger.log('Manager list: %s', output.getContent());
}