/**
 * Google Apps Script to handle HTTP GET request for retrieving voting rights and asset information based on a digital signature.
 *
 * Instructions to call this endpoint:
 * 1. Deploy this script as a web app:
 *    - Click Deploy > New deployment > Web app.
 *    - Set "Execute as" to "Me" and "Who has access" to "Anyone" (or restrict as needed).
 *    - Click Deploy and copy the web app URL (e.g., https://script.google.com/macros/s/<ID>/exec).
 * 2. Make an HTTP GET request with the digital signature as a query parameter:
 *    - URL format: <web_app_url>?signature=<publicKeyBase64>
 *    - Example: https://script.google.com/macros/s/<ID>/exec?signature=MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMI...
 * 3. The response will be a JSON object:
 *    - Success: {
 *        "voting_rights": <value>,
 *        "voting_rights_circulated": <value>,
 *        "total_assets": <value>,
 *        "asset_per_circulated_voting_right": <value>
 *      }
 *    - Error: { "error": "No matching signature found" } or { "error": "Signature parameter missing" }
 * 4. Use a tool like curl, Postman, or JavaScript fetch to test:
 *    - curl: curl "<web_app_url>?signature=<publicKeyBase64>"
 *    - JavaScript: fetch("<web_app_url>?signature=<publicKeyBase64>").then(res => res.json())
 * 5. To troubleshoot signature lookup:
 *    - Open the script editor and run the testSignatureLookup function with a test signature.
 *    - Example: testSignatureLookup("MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMI...");
 *    - Check the Logs (View > Logs) for the result: { contributorName: "Name" } or { error: "No matching signature found" }
 *
 * Note: Ensure the spreadsheet ID and sheet names defined in constants below match your setup. The digital signature must exactly match the value in Column R of "Contributors contact information".
 */

// Constants for spreadsheet ID and sheet names
const SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
const CONTACT_SHEET_NAME = 'Contributors contact information';
const VOTING_SHEET_NAME = 'Contributors voting weight';
const LEDGER_SHEET_NAME = 'Ledger history';
const ASSET_SHEET_NAME = 'off chain asset balance';

/**
 * Finds contributor name by matching signature in Contributors contact information sheet.
 * @param {string} signature - The digital signature to search for.
 * @param {Spreadsheet} spreadsheet - The Google Spreadsheet object.
 * @returns {Object} - { contributorName: string | null, error: string | null }
 */
function findContributorBySignature(signature, spreadsheet) {
  try {
    const contactSheet = spreadsheet.getSheetByName(CONTACT_SHEET_NAME);
    const contactData = contactSheet.getDataRange().getValues();

    for (let i = 1; i < contactData.length; i++) { // Skip header row
      if (contactData[i][17] === signature) { // Column R
        return { contributorName: contactData[i][0], error: null }; // Column A
      }
    }
    return { contributorName: null, error: "No matching signature found" };
  } catch (error) {
    return { contributorName: null, error: "Error searching for signature: " + error.message };
  }
}

/**
 * Test function for troubleshooting signature lookup.
 * @param {string} testSignature - The signature to test (optional, defaults to a sample).
 */
function testSignatureLookup(testSignature = "MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMI...") {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const result = findContributorBySignature(testSignature, spreadsheet);
  Logger.log(JSON.stringify(result));
}

function doGet(e) {
  // Check for signature parameter
  const signature = e.parameter.signature;
  if (!signature) {
    return ContentService.createTextOutput(
      JSON.stringify({ error: "Signature parameter missing" })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  // Open the spreadsheet
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);

  // Step 1: Search for signature using findContributorBySignature
  const { contributorName, error } = findContributorBySignature(signature, spreadsheet);
  if (error) {
    return ContentService.createTextOutput(
      JSON.stringify({ error })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  // Step 2: Find voting weight in "Contributors voting weight" Column H (index 7) where Column C (index 2) matches contributorName
  const votingSheet = spreadsheet.getSheetByName(VOTING_SHEET_NAME);
  const votingData = votingSheet.getDataRange().getValues();
  let votingRights = null;

  for (let i = 1; i < votingData.length; i++) { // Skip header row
    if (votingData[i][2] === contributorName) { // Column C
      votingRights = votingData[i][7]; // Column H
      break;
    }
  }

  if (votingRights === null) {
    return ContentService.createTextOutput(
      JSON.stringify({ error: "No matching contributor found in voting weight sheet" })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  // Step 3: Get voting_rights_circulated from "Ledger history" cell E1
  const ledgerSheet = spreadsheet.getSheetByName(LEDGER_SHEET_NAME);
  const votingRightsCirculated = ledgerSheet.getRange('E1').getValue();

  // Step 4: Get total_assets from "off chain asset balance" cell D1
  const assetSheet = spreadsheet.getSheetByName(ASSET_SHEET_NAME);
  const totalAssets = assetSheet.getRange('D1').getValue();

  // Step 5: Calculate asset_per_circulated_voting_right
  const assetPerCirculatedVotingRight = votingRightsCirculated !== 0 ? totalAssets / votingRightsCirculated : 0;

  // Return result
  return ContentService.createTextOutput(
    JSON.stringify({
      voting_rights: votingRights,
      voting_rights_circulated: votingRightsCirculated,
      total_assets: totalAssets,
      asset_per_circulated_voting_right: assetPerCirculatedVotingRight
    })
  ).setMimeType(ContentService.MimeType.JSON);
}