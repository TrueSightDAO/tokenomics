/**
 * Google Apps Script to handle HTTP GET request for retrieving voting rights and asset information based on a digital signature.
 * The total_assets value is calculated as the sum of off-chain assets, USDT vault balance, and AGL investment holdings.
 * Asset values (total_assets, asset_per_circulated_voting_right) are formatted to 5 decimal places.
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
 *        "contributor_name": <string>,
 *        "voting_rights": <value>,
 *        "voting_rights_circulated": <value>,
 *        "total_assets": <number, 5 decimal places>,
 *        "asset_per_circulated_voting_right": <number, 5 decimal places>
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
 * Note: Ensure the spreadsheet ID, sheet names, Wix API key, and QuickNode API key defined in constants below match your setup.
 * The digital signature must exactly match the value in Column R of "Contributors contact information".
 * The getCredentials() function is assumed to be defined elsewhere, providing WIX_API_KEY and QUICKNODE_API_KEY.
 */

// Constants for spreadsheet ID, sheet names, and API credentials
const SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
const CONTACT_SHEET_NAME = 'Contributors contact information';
const VOTING_SHEET_NAME = 'Contributors voting weight';
const LEDGER_SHEET_NAME = 'Ledger history';
const ASSET_SHEET_NAME = 'off chain asset balance';
const creds = getCredentials(); // Assumed to be defined elsewhere
const WIX_ACCESS_TOKEN = creds.WIX_API_KEY; // Wix API key
const QUICKNODE_API_KEY = creds.QUICKNODE_API_KEY; // QuickNode API key
const SOLANA_USDT_VAULT_WALLET_ADDRESS = 'BkcbCEnD14C7cYiN6VwpYuGmpVrjfoRwobhQQScBugqQ';

/**
 * Resolves redirect URLs to get the final URL.
 * @param {string} url - The URL to resolve.
 * @return {string} The resolved URL or empty string on error.
 */
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

/**
 * Fetches unique ledger URLs from the ledger_url column in Wix AgroverseShipments.
 * @return {Array<string>} Array of unique ledger URLs.
 */
function getLedgerUrlsFromWix() {
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

    Logger.log('Unique Ledger URLs fetched from Wix: ' + ledgerUrls);
    return ledgerUrls;
  } catch (e) {
    Logger.log('Error fetching ledger URLs from Wix: ' + e.message);
    return [];
  }
}

/**
 * Fetches TrueSight DAO equity holdings (USD) from each ledger's Balance sheet.
 * @param {Array<string>} ledgerUrls - Array of ledger URLs to process.
 * @return {Array<number>} Array of USD balances for TrueSight DAO.
 */
function getTrueSightDAOEquityHoldings(ledgerUrls) {
  const balances = [];

  ledgerUrls.forEach(function(url) {
    const resolvedUrl = resolveRedirect(url);
    if (!resolvedUrl || !resolvedUrl.includes('docs.google.com/spreadsheets')) {
      Logger.log(`Skipping invalid or non-spreadsheet URL: ${resolvedUrl}`);
      return;
    }

    try {
      const spreadsheet = SpreadsheetApp.openByUrl(resolvedUrl);
      const balanceSheet = spreadsheet.getSheetByName('Balance');

      if (!balanceSheet) {
        Logger.log(`Balance sheet not found in spreadsheet: ${resolvedUrl}`);
        return;
      }

      const data = balanceSheet.getDataRange().getValues();

      for (let i = 0; i < data.length; i++) {
        if (data[i][0] === 'TrueSight DAO' && data[i][2] === 'USD') {
          const balance = data[i][1];
          if (typeof balance === 'number') {
            balances.push(parseFloat(balance.toFixed(5)));
            Logger.log(`TrueSight DAO USD balance from ${resolvedUrl}: ${balance.toFixed(5)}`);
          } else {
            Logger.log(`Invalid balance value for TrueSight DAO in ${resolvedUrl}`);
          }
        }
      }
    } catch (e) {
      Logger.log(`Error accessing spreadsheet ${resolvedUrl}: ${e.message}`);
    }
  });

  return balances;
}

/**
 * Calculates the total investment holdings in AGL (USD) by summing TrueSight DAO equity holdings.
 * @return {number} Total USD value of TrueSight DAO holdings across all ledgers, to 5 decimal places.
 */
function getInvestmentHoldingsInAGL() {
  const ledgerUrls = getLedgerUrlsFromWix();
  const equityHoldings = getTrueSightDAOEquityHoldings(ledgerUrls);
  const totalHoldings = equityHoldings.reduce(function(sum, balance) {
    return sum + balance;
  }, 0);

  Logger.log('Total TrueSight DAO investment holdings in AGL (USD): ' + totalHoldings.toFixed(5));
  return parseFloat(totalHoldings.toFixed(5));
}

/**
 * Fetches the off-chain asset value from the "off chain asset balance" sheet, cell D1.
 * @return {number} The off-chain asset value in USD, to 5 decimal places.
 */
function getOffChainAssetValue() {
  const offChainAssetBalanceTab = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(ASSET_SHEET_NAME);
  const assets = offChainAssetBalanceTab.getRange('D1').getValue();
  Logger.log('Off Chain Asset in USD: ' + assets.toFixed(5));
  return parseFloat(assets.toFixed(5));
}

/**
 * Fetches the USDT balance in the Solana vault.
 * @return {number} The USDT balance in the vault, to 5 decimal places.
 */
function getUSDTBalanceInVault() {
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenAccountBalance',
      params: [SOLANA_USDT_VAULT_WALLET_ADDRESS]
    })
  };

  const request_url = 'https://side-clean-replica.solana-mainnet.quiknode.pro/' + QUICKNODE_API_KEY + '/';
  try {
    const response = UrlFetchApp.fetch(request_url, options);
    const content = response.getContentText();
    const response_obj = JSON.parse(content);
    const balance = response_obj.result.value.uiAmount;
    Logger.log('Amount of USDT in vault: ' + balance.toFixed(5));
    return parseFloat(balance.toFixed(5));
  } catch (e) {
    Logger.log('Error fetching USDT balance: ' + e.message);
    return 0;
  }
}

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
    return { contributorName: null, error: 'No matching signature found' };
  } catch (error) {
    return { contributorName: null, error: 'Error searching for signature: ' + error.message };
  }
}

/**
 * Test function for troubleshooting signature lookup.
 * @param {string} testSignature - The signature to test (optional, defaults to a sample).
 */
function testSignatureLookup(testSignature = 'MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMI...') {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const result = findContributorBySignature(testSignature, spreadsheet);
  Logger.log(JSON.stringify(result));
}

function doGet(e) {
  // Check for signature parameter
  const signature = e.parameter.signature;
  if (!signature) {
    return ContentService.createTextOutput(
      JSON.stringify({ error: 'Signature parameter missing' })
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
      JSON.stringify({ error: 'No matching contributor found in voting weight sheet' })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  // Step 3: Get voting_rights_circulated from "Ledger history" cell E1
  const ledgerSheet = spreadsheet.getSheetByName(LEDGER_SHEET_NAME);
  const votingRightsCirculated = ledgerSheet.getRange('E1').getValue();

  // Step 4: Calculate total_assets as off-chain assets + USDT vault balance + AGL investment holdings
  const totalAssets = getOffChainAssetValue() + getUSDTBalanceInVault() + getInvestmentHoldingsInAGL();

  // Step 5: Calculate asset_per_circulated_voting_right
  const assetPerCirculatedVotingRight = votingRightsCirculated !== 0 ? totalAssets / votingRightsCirculated : 0;

  // Return result with asset values formatted to 5 decimal places
  return ContentService.createTextOutput(
    JSON.stringify({
      contributor_name: contributorName,
      voting_rights: votingRights,
      voting_rights_circulated: votingRightsCirculated,
      total_assets: parseFloat(totalAssets.toFixed(5)),
      asset_per_circulated_voting_right: parseFloat(assetPerCirculatedVotingRight.toFixed(5))
    })
  ).setMimeType(ContentService.MimeType.JSON);
}