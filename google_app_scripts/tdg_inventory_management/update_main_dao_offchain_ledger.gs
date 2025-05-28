// Configuration Variables
const SOURCE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/18bAVJfV-u57LBUgnCKB4kg65YOzvTfR3PZJ5WS9IVos/edit?gid=0#gid=0';
const SOURCE_SHEET_NAME = 'Scored Chatlogs';

// Sandbox version
// const DEST_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1F90Sq6jSfj8io0RmiUwdydzuWXOZA9siXHWDsj9ItTo/edit?gid=0#gid=0';

// Production version
const DEST_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=995916231#gid=995916231';
const DEST_SHEET_NAME = 'offchain transactions';

// Column indices for source sheet (Scored Chatlogs)
const AGROVERSE_VALUE_COL = 6; // Column G
const SALES_DATE_COL = 7; // Column H
const INVENTORY_TYPE_COL = 8; // Column I
const TOKENIZED_STATUS_COL = 9; // Column J
const OFFCHAIN_ROW_NUMS_COL = 10; // Column K
const MESSAGE_COL = 2; // Column C
const CONTRIBUTOR_NAME_COL = 3; // Column D
const SALE_PRICE_COL = 5; // Column F

// Function to process Scored Chatlogs and update offchain transactions
function processTokenizedTransactions() {
  // Get source and destination spreadsheets
  const sourceSpreadsheet = SpreadsheetApp.openByUrl(SOURCE_SHEET_URL);
  const destSpreadsheet = SpreadsheetApp.openByUrl(DEST_SHEET_URL);
  const sourceSheet = sourceSpreadsheet.getSheetByName(SOURCE_SHEET_NAME);
  const destSheet = destSpreadsheet.getSheetByName(DEST_SHEET_NAME);
  
  // Get data from source sheet
  const sourceData = sourceSheet.getDataRange().getValues();
  
  // Counter for processed rows
  let processedRows = 0;
  
  // Process source data, skipping header row
  for (let i = 1; i < sourceData.length; i++) {
    const agroverseValue = sourceData[i][AGROVERSE_VALUE_COL];
    const tokenizedStatus = sourceData[i][TOKENIZED_STATUS_COL];
    
    // Check if Column G is "https://www.agroverse.shop/agl4" and Column J is empty
    if (agroverseValue === 'https://www.agroverse.shop/agl4' && (!tokenizedStatus || tokenizedStatus === '')) {
      // Update Column J to "TOKENIZED"
      sourceSheet.getRange(i + 1, TOKENIZED_STATUS_COL + 1).setValue('TOKENIZED');
      
      // Get values for offchain transactions
      const salesDate = sourceData[i][SALES_DATE_COL] || '';
      const message = sourceData[i][MESSAGE_COL] || '';
      const contributorName = sourceData[i][CONTRIBUTOR_NAME_COL] || '';
      const salePrice = sourceData[i][SALE_PRICE_COL] || 0;
      const inventoryType = sourceData[i][INVENTORY_TYPE_COL] || '';
      
      // Get the current last row in destination sheet
      const destLastRow = destSheet.getLastRow();
      const insertRow = destLastRow + 1; // Append after last row
      
      // Prepare three rows to insert
      const rowsToInsert = [
        // First row
        [
          salesDate, // Column A: Sales Date
          message, // Column B: Message
          contributorName, // Column C: Contributor Name
          -1, // Column D: -1
          inventoryType, // Column E: Inventory Type
          '', // Column F: Empty
          true // Column G: TRUE
        ],
        // Second row
        [
          salesDate, // Column A: Sales Date
          message, // Column B: Message
          contributorName, // Column C: Contributor Name
          salePrice, // Column D: Sale Price
          'USD', // Column E: USD
          '', // Column F: Empty
          true // Column G: TRUE
        ],
        // Third row
        [
          salesDate, // Column A: Sales Date
          message, // Column B: Message
          'Agroverse Tree Planting Contract - agl4', // Column C: Fixed value
          1, // Column D: -1
          'Cacao Tree To Be Planted', // Column E: Fixed value
          '', // Column F: Empty
          true // Column G: TRUE
        ]
      ];
      
      // Append the three rows at the end of the destination sheet
      destSheet.getRange(insertRow, 1, 3, rowsToInsert[0].length).setValues(rowsToInsert);
      
      // Get row numbers (1-based) for the inserted rows
      const rowNumbers = [insertRow, insertRow + 1, insertRow + 2].join(',');
      
      // Update Column K in source sheet with row numbers
      sourceSheet.getRange(i + 1, OFFCHAIN_ROW_NUMS_COL + 1).setValue(rowNumbers);
      
      processedRows++;
      Logger.log(`Processed row ${i + 1}: Updated TOKENIZED status and appended rows ${rowNumbers} in offchain transactions`);
    }
  }
  
  Logger.log(`Processed ${sourceData.length - 1} rows, updated ${processedRows} records.`);
}

// Function to run the script manually or set up a trigger
function setupTrigger() {
  ScriptApp.newTrigger('processTokenizedTransactions')
    .timeBased()
    .everyHours(1)
    .create();
}