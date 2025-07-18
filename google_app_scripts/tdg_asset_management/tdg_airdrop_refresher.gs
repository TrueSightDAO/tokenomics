function processAirdrops() {
  // Access the source and destination spreadsheets
  var ledgerSpreadsheet = SpreadsheetApp.openById('1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU');
  var airdropSpreadsheet = SpreadsheetApp.openById('1Tbj7H5ur_egQLRugdXUaSIhEYIKp0vvVv2IZ7WTLCUo');
  
  // Get the sheets
  var ledgerSheet = ledgerSpreadsheet.getSheetByName('Ledger history');
  var contactSheet = ledgerSpreadsheet.getSheetByName('Contributors contact information');
  var outputSheet = airdropSpreadsheet.getSheetByName('To Be Airdropped');

  // Insert current date in YYYYMMDD format into cell E1
  var now = new Date();
  var yyyyMMdd = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyyMMdd");
  outputSheet.getRange("E1").setValue(yyyyMMdd);

  // Get data from Ledger history
  var ledgerData = ledgerSheet.getDataRange().getValues();
  var contactData = contactSheet.getDataRange().getValues();
  
  // Create a map to store contributor data
  var contributorMap = {};
  
  // Process Ledger history
  for (var i = 1; i < ledgerData.length; i++) {
    var contributorName = ledgerData[i][0].toString().trim();
    var workStatus = ledgerData[i][5];
    var tdgAmount = parseFloat(ledgerData[i][6]) || 0;
    var solanaTrasferHash = ledgerData[i][8];
    
    if (workStatus == 'Successfully Completed / Full Provision Awarded' && solanaTrasferHash.trim() == '' && tdgAmount > 0 ) {
      Logger.log("Parsing Row " + i + ": Contributor name " + contributorName + ", TDG Amount :" + tdgAmount);
      if (!contributorMap[contributorName]) {
        contributorMap[contributorName] = { tdgTotal: 0 };
      }
      contributorMap[contributorName].tdgTotal += tdgAmount;
    }
  }
  
  // Process contact information and match with ledger data
  var outputData = [['Contributor Name', 'TDG Amount', 'Solana Wallet Address', 'Status']];
  for (var i = 1; i < contactData.length; i++) {
    var contributorName = contactData[i][0].toString().trim();
    var walletAddress = contactData[i][1];
    
    if (contributorMap[contributorName] ) {
      Logger.log("Inserting tabulation " + i + ": Contributor name " + contributorName + ", TDG Amount :" + contributorMap[contributorName].tdgTotal);

      var airdropStatus = 'TO BE AIR DOPPED';
      if( walletAddress.trim() == '' ) {
        var airdropStatus = 'MISSING WALLET ADDRESS';
      }

      outputData.push([
        contributorName,
        contributorMap[contributorName].tdgTotal,
        walletAddress,
        airdropStatus
      ]);
    }
  }
  
  // Clear existing data from row 4 onwards
  if (outputSheet.getLastRow() >= 4) {
    outputSheet.getRange(4, 1, outputSheet.getLastRow() - 3, outputSheet.getLastColumn()).clearContent();
  }
  
  // Write new data starting from row 4
  if (outputData.length > 1) {
    outputSheet.getRange(4, 1, outputData.length, outputData[0].length).setValues(outputData);
  }
}
