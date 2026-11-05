function processRecords() {
  var sheetId = "1d2nxU5RIhXD8vQFpT1xKXpRLc70guX-daHUD5Hnrqx8";
  var sheetRow = "2";
  var docId = "11aAB8EosMQSuuQj-Ntv0fKU_Jh8FGHQ1IO9S7QfdL1s";
  var destinationFolderId = "1gLRJxxx-ROc_BzU05pkvCan1Jm-W4QhM";
  // processDocWithRow(sheetId, docId, destinationFolderId, sheetRow);
  processAllRows(sheetId, docId, destinationFolderId);
}

function processAllRows(sheetId, docId, destinationFolderId) {
  var sheet = SpreadsheetApp.openById(sheetId).getActiveSheet();
  var lastRow = sheet.getLastRow(); // Get the last row with data

  // Start from row 2 onwards (assuming row 1 is the header)
  for (var row = 2; row <= lastRow; row++) {
    var columnAValue = sheet.getRange("A" + row).getValue(); // Get the value in column A
    var columnMValue = sheet.getRange("N" + row).getValue(); // Get the value in column N
    
    // Process only if column A has a value and column M is empty
    if (columnAValue && !columnMValue) {
      Logger.log('Processing row ' + row);
      processDocWithRow(sheetId, docId, destinationFolderId, row); // Call the processing function for the row
    }
  }
  
  Logger.log('Completed processing all applicable rows.');
}

function processDocWithRow(sheetId, docId, destinationFolderId, rowNumber) {
  // Step 1: Duplicate the Google Doc
  var originalDoc = DriveApp.getFileById(docId);
  var duplicateDoc = originalDoc.makeCopy(); // Create a duplicate of the original doc

  renameDocWithCNPJAndDate(duplicateDoc.getId(), sheetId, rowNumber);
  
  // Step 2: Move the duplicate to the destination folder
  var destinationFolder = DriveApp.getFolderById(destinationFolderId);
  destinationFolder.addFile(duplicateDoc); // Move the copy to the destination folder
  originalDoc.getParents().next().removeFile(duplicateDoc); // Remove from the original folder
  

  // Step 4: Open the duplicated document
  var newDoc = DocumentApp.openById(duplicateDoc.getId());

  // Step 5: Replace IMAGE placeholders with the images from the specified row's columns
  replaceImageInDoc(sheetId, "G" + rowNumber, "IMAGE_1", newDoc);
  replaceImageInDoc(sheetId, "H" + rowNumber, "IMAGE_2", newDoc);
  replaceImageInDoc(sheetId, "I" + rowNumber, "IMAGE_3", newDoc);
  replaceImageInDoc(sheetId, "J" + rowNumber, "IMAGE_4", newDoc);
  replaceImageInDoc(sheetId, "K" + rowNumber, "IMAGE_5", newDoc);

  // Step 6: Replace VERIFICATION_DATE with the formatted date from column A
  replaceVerificationDate(sheetId, "A" + rowNumber, "VERIFICATION_DATE", newDoc);

  // Step 7: Replace COMPANY_NAME with the value from column L
  replaceTextInDoc(sheetId, "L" + rowNumber, "COMPANY_NAME", newDoc);

  // Step 8: Replace CNPJ with the value from column C
  replaceTextInDoc(sheetId, "C" + rowNumber, "CNPJ", newDoc);

  // Step 9: Replace GOOGLE_MAP_LINK with the URL from column E
  replaceGoogleMapLink(sheetId, "E" + rowNumber, "GOOGLE_MAP_LINK", newDoc);

  // Step 10: Replace SITE_NAME with the value from column M
  replaceTextInDoc(sheetId, "M" + rowNumber, "SITE_NAME", newDoc);

  // Save the changes
  newDoc.saveAndClose();

  // Step 10: Get the duplicate file again after renaming to ensure the correct name is used
  var updatedDuplicateDoc = DriveApp.getFileById(duplicateDoc.getId());

  // Step 11: Convert the duplicate doc to PDF and save it in the same destination folder
  var pdfBlob = updatedDuplicateDoc.getAs('application/pdf');
  var pdfName = updatedDuplicateDoc.getName(); // Get the updated name of the document after renaming
  var pdfFile = destinationFolder.createFile(pdfBlob).setName(pdfName + '.pdf');

  // Step 12: Write the PDF URL to column M of the Google Sheet
  var pdfUrl = pdfFile.getUrl(); // Get the URL of the created PDF file
  updateSheetWithPDFLink(sheetId, rowNumber, pdfUrl);

}

function replaceImageInDoc(sheetId, cell, imageKey, doc) {
  // Get the image file URL from the Google Sheet cell
  var sheet = SpreadsheetApp.openById(sheetId).getActiveSheet();
  var imageFileUrl = sheet.getRange(cell).getValue(); // Get the URL from the specified cell

  // Extract the file ID from the Google Drive URL
  var imageFileId = extractFileIdFromUrl(imageFileUrl);
  if (!imageFileId) {
    Logger.log('Invalid Google Drive URL in cell: ' + cell);
    return;
  }

  // Get the image file from Google Drive
  var imageFile = DriveApp.getFileById(imageFileId);
  var imageBlob = imageFile.getBlob(); // Get the image blob from Google Drive

  // Get the body of the document
  var body = doc.getBody();
  
  // Find all instances of the placeholder text (imageKey)
  var rangeElement = body.findText(imageKey);
  
  while (rangeElement !== null) {
    // Get the element that contains the found text
    var element = rangeElement.getElement();
    var startOffset = rangeElement.getStartOffset();
    var endOffset = rangeElement.getEndOffsetInclusive();

    // Replace the placeholder text with the image
    element.asText().deleteText(startOffset, endOffset); // Remove the placeholder text
    var paragraph = element.getParent(); // Insert the image in the parent element (typically a Paragraph)
    
    // Insert the image into the parent element
    var insertedImage = paragraph.insertInlineImage(startOffset, imageBlob);

    // Get the original dimensions of the image
    var originalWidth = insertedImage.getWidth();
    var originalHeight = insertedImage.getHeight();

    // Set the new height to 50px and calculate the width proportionally
    var newHeight = 200; // Set the height to 50px
    var newWidth = (originalWidth / originalHeight) * newHeight; // Adjust width proportionally
    
    // Apply the new dimensions
    insertedImage.setWidth(newWidth);
    insertedImage.setHeight(newHeight);

    // Find the next instance of the placeholder
    rangeElement = body.findText(imageKey);
  }

  Logger.log('Replaced all instances of ' + imageKey + ' with the image from ' + cell);
}

// Function to replace all instances of VERIFICATION_DATE with the formatted date from a Google Sheet cell
function replaceVerificationDate(sheetId, cell, dateKey, doc) {
  var sheet = SpreadsheetApp.openById(sheetId).getActiveSheet();
  var dateValue = sheet.getRange(cell).getValue(); // Get the timestamp from the specified cell
  
  // Convert the date to the desired format (e.g., 2nd July 2024)
  var formattedDate = formatDateToReadable(dateValue);
  
  // Replace all instances of the date key in the document
  var body = doc.getBody();
  body.replaceText(dateKey, formattedDate);
  
  Logger.log('Replaced all instances of ' + dateKey + ' with ' + formattedDate);
}

// Helper function to format the date (e.g., 2nd July 2024)
function formatDateToReadable(dateValue) {
  var date = new Date(dateValue);
  var day = date.getDate();
  var suffix = getDaySuffix(day);
  var month = date.toLocaleString('default', { month: 'long' }); // Full month name (e.g., July)
  var year = date.getFullYear();
  
  return day + suffix + ' ' + month + ' ' + year;
}

// Helper function to get the suffix for the day (e.g., 1st, 2nd, 3rd, etc.)
function getDaySuffix(day) {
  if (day >= 11 && day <= 13) {
    return 'th';
  }
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

// Function to replace a placeholder text in the document with a value from a Google Sheet cell
function replaceTextInDoc(sheetId, cell, placeholderKey, doc) {
  var sheet = SpreadsheetApp.openById(sheetId).getActiveSheet();
  var value = sheet.getRange(cell).getValue(); // Get the value from the specified cell
  
  // Replace all instances of the placeholder in the document
  var body = doc.getBody();
  body.replaceText(placeholderKey, value);
  
  Logger.log('Replaced all instances of ' + placeholderKey + ' with ' + value);
} 

// Helper function to extract the file ID from a Google Drive URL
function extractFileIdFromUrl(url) {
  var match = url.match(/[-\w]{25,}/); // Regular expression to match the file ID from the URL
  return match ? match[0] : null;
}

function renameDocWithCNPJAndDate(docId, sheetId, rowNumber) {
  // Get the CNPJ value from the specified row in the Google Sheet (e.g., "C2")
  var sheet = SpreadsheetApp.openById(sheetId).getActiveSheet();
  var site_name = sheet.getRange("M" + rowNumber).getValue();
  var companyName = sheet.getRange("L" + rowNumber).getValue();
  
  // Get the current date in YYYYMMDD format
  var today = new Date();
  var formattedDate = today.getFullYear().toString() + 
                      ("0" + (today.getMonth() + 1)).slice(-2) + 
                      ("0" + today.getDate()).slice(-2);
  
  // Rename the Google Doc
  var docFile = DriveApp.getFileById(docId);
  docFile.setName(formattedDate  + " - " + companyName +" site: " + site_name);
  
  Logger.log('Renamed the document to: ' + formattedDate  + " - " + companyName +" site: " + site_name );
}


// New function to replace GOOGLE_MAP_LINK with a clickable link to Google Maps
function replaceGoogleMapLink(sheetId, cell, placeholderKey, doc) {
  var sheet = SpreadsheetApp.openById(sheetId).getActiveSheet();
  var googleMapUrl = sheet.getRange(cell).getValue(); // Get the Google Maps URL from the specified cell

  if (!googleMapUrl) {
    Logger.log('No Google Map URL found in ' + cell);
    return;
  }
  
  var body = doc.getBody();
  var textFinder = body.findText(placeholderKey); // Find the placeholder in the document

  while (textFinder !== null) {
    var foundElement = textFinder.getElement();
    var startOffset = textFinder.getStartOffset();
    var endOffset = textFinder.getEndOffsetInclusive();

    // Replace the placeholder text with "Google Map location"
    foundElement.asText().deleteText(startOffset, endOffset); // Remove the placeholder
    foundElement.asText().insertText(startOffset, "Google Map location");

    // Apply hyperlink to the newly inserted text
    foundElement.asText().setLinkUrl(startOffset, startOffset + "Google Map location".length - 1, googleMapUrl);

    Logger.log('Replaced ' + placeholderKey + ' with a clickable Google Maps link.');
    
    // Find the next instance of the placeholder
    textFinder = body.findText(placeholderKey);
  }
}

// Function to update the Google Sheet with the PDF URL
function updateSheetWithPDFLink(sheetId, rowNumber, pdfUrl) {
  var sheet = SpreadsheetApp.openById(sheetId).getActiveSheet();
  sheet.getRange("N" + rowNumber).setValue(pdfUrl); // Write the PDF URL to column M of the specified row
  Logger.log('Updated row ' + rowNumber + ' in column M with the PDF URL: ' + pdfUrl);
}
