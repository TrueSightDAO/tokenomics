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
        list.push({
          key: encodeURIComponent(name),
          name: name
        });
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