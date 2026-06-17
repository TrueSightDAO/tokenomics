// https://docs.google.com/document/d/1ZfY7DrZMJoVwE9zzu4EuMYhBjAceJ5JyjIEtKzpcLRU/edit?tab=t.0
var written_assurance_letter_template_doc_id = "1ZfY7DrZMJoVwE9zzu4EuMYhBjAceJ5JyjIEtKzpcLRU";

function duplicateAndModifyDoc() {
  var originalDocId = written_assurance_letter_template_doc_id; // Replace with your Google Doc ID
  var newTitle = getTodaysDateKey() + " New Testing Document"; // Replace with your desired title
  
  // Duplicate the document
  var originalDoc = DriveApp.getFileById(originalDocId);
  var duplicateDoc = originalDoc.makeCopy(newTitle);
  
  // Move duplicate to same folder
  var originalFolder = DriveApp.getFolderById(originalDoc.getParents().next().getId());
  duplicateDoc.moveTo(originalFolder);

  replaceDocumentValue(duplicateDoc, "TODAY_DATE", getTodaysDate());
  replaceDocumentValue(duplicateDoc, "COMPANY_NAME", "Black King");

  var pdfFile = generatePdf(duplicateDoc);
  emailPdfFile(pdfFile, "GaryJob@gmail.com");

}

function replaceDocumentValue(duplicateDoc, searchText, replaceText) {
  var doc = DocumentApp.openById(duplicateDoc.getId());
  var body = doc.getBody();
  body.replaceText(searchText, replaceText);
  doc.saveAndClose();
}

function generatePdf(duplicateDoc) {  
  // Get the document
  var docFile = DriveApp.getFileById(duplicateDoc.getId());
  
  // Convert the document to PDF
  var pdfBlob = docFile.getAs('application/pdf');
  
  // Get the folder containing the document
  var folder = docFile.getParents().next();
  
  // Create a PDF file in the same folder
  var pdfFile = folder.createFile(pdfBlob).setName(docFile.getName() + '.pdf');  
  Logger.log('PDF created and saved in the same folder.');

  return pdfFile;
}

function getTodaysDate() {
  var today = new Date();
  var day = today.getDate();
  var month = today.getMonth() + 1; // Months are 0-based
  var year = today.getFullYear();
  
  // Format month
  var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var monthName = months[month - 1];
  
  // Format day with suffix (st, nd, rd, th)
  var suffix = "";
  if (day === 1 || day === 21 || day === 31) {
    suffix = "st";
  } else if (day === 2 || day === 22) {
    suffix = "nd";
  } else if (day === 3 || day === 23) {
    suffix = "rd";
  } else {
    suffix = "th";
  }
  
  var formattedDate = day + suffix + " " + monthName + " " + year;
  
  return formattedDate;
}

function getTodaysDateKey() {
  var today = new Date();
  var year = today.getFullYear();
  var month = today.getMonth() + 1; // Months are 0-based
  var day = today.getDate();
  
  // Pad single-digit months and days with zeros
  month = (month < 10) ? "0" + month : month;
  day = (day < 10) ? "0" + day : day;
  
  var formattedDate = year + "" + month + "" + day;
  
  return formattedDate;
}

function emailPdfFile(pdfFile, receipient_email) {
  
  // Email settings
  var recipient = receipient_email;
  var subject = "Your FDA Written Assurance Letter: " + pdfFile.getName();
  var body = "Please sign this written assurance letter PDF and revert.";
  
  // Send the email with the PDF as an attachment
  MailApp.sendEmail({
    to: recipient,
    subject: subject,
    body: body,
    attachments: [pdfFile.getAs('application/pdf')]
  });
  
  Logger.log('PDF created, saved in the same folder, and emailed to ' + recipient);

}