/**
 * File: google_app_scripts/tdg_asset_management/tdg_wix_dashboard.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * 
 * Description: Updates Wix dashboard metrics including treasury balance, TDG issuance, and exchange rates.
 */

/**
 * TDG Wix Dashboard - TrueSight DAO Asset Management and Tokenomics Automation
 * 
 * This Google Apps Script manages the complete tokenomics and asset tracking system for TrueSight DAO.
 * It integrates multiple data sources and automates critical financial operations.
 * 
 * KEY FEATURES:
 * - Asset Management: Tracks off-chain assets, USDT vault balance, and AGL investment holdings
 * - Tokenomics Calculations: Calculates asset per TDG, voting rights, and buy-back budgets
 * - Wix Integration: Syncs data with Wix platform for public display
 * - Performance Statistics Sync: Automatically syncs Wix updates to Google Sheet "Performance Statistics" tab
 * - Web Service: Exposes doGet endpoint to return Performance Statistics as JSON for index.html
 * - Transaction Automation: Creates daily buy-back provisions and recurring tokenizations
 * - Multi-Source Data: Integrates Wix APIs, Solana blockchain, and Google Sheets
 * 
 * MAIN FUNCTIONS:
 * - updateTotalDAOAssetOnWix(): Updates total DAO asset value on Wix
 * - updateAssetPerIssuedTdg(): Calculates and updates asset per TDG ratio
 * - getDailyTdgBuyBackBudget(): Creates daily buy-back transaction pairs
 * - getInvestmentHoldingsInAGL(): Calculates total AGL investment holdings
 * - update30DaysSalesOnWix(): Updates 30-day sales data on Wix
 * - doGet(): Web service endpoint returning Performance Statistics as JSON
 * - updatePerformanceStatistic(): Syncs Wix updates to Performance Statistics sheet
 * 
 * DAILY AUTOMATION:
 * - Daily buy-back budget calculation and transaction creation
 * - Asset value updates and tokenomics recalculation
 * - Treasury yield monitoring and adjustment
 * - Automatic sync of Wix updates to Performance Statistics sheet
 * 
 * WEB SERVICE DEPLOYMENT:
 * - Deploy as web app: Publish > Deploy as web app
 * - Set "Execute as: Me" and "Who has access: Anyone, even anonymous"
 * - Web service URL: https://script.google.com/macros/s/AKfycbzlfOBo9UqKOh7jIqGcmbPAMM1RxCbsJHb-UV_vM6VbvK_HSdT44KyGbbXIeo-_Ovfy/exec
 * - Use this URL in index.html to fetch Performance Statistics
 * 
 * DATA SOURCES:
 * - Google Sheets: Ledger history, off-chain transactions, asset balances, Performance Statistics
 * - Wix APIs: Public data display and exchange rates
 * - Solana Blockchain: USDT vault balance monitoring
 * - US Treasury: Real-time yield data for calculations
 * 
 * SPREADSHEET STRUCTURE:
 * - "Ledger history": TDG token issuance and voting rights tracking
 * - "offchain transactions": All off-chain financial transactions
 * - "off chain asset balance": Current asset valuations
 * - "Performance Statistics": Synced copy of Wix ExchangeRate collection values
 * - "Recurring Transactions": Automated recurring tokenization rules
 * 
 * KEYWORDS: TDG, TrueSight DAO, tokenomics, asset management, buy-back, voting rights, 
 *           Wix integration, Solana, USDT vault, treasury yield, AGL investments,
 *           Performance Statistics, web service, JSON API
 */

// Stores the credentials object retrieved from the getCredentials() function
const creds = getCredentials();

// Wix API key for authentication with Wix APIs
var wixAccessToken = creds.WIX_API_KEY;

// QuickNode API key for accessing Solana blockchain data
var quickNodeApiKey = creds.QUICKNODE_API_KEY;

// Google Spreadsheet ID for the ledger document
var ledgerDocId = "1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU";

// Reference to the "off chain asset balance" sheet in the ledger Google Spreadsheet
var offChainAssetBalanceTab = SpreadsheetApp.openById(ledgerDocId).getSheetByName("off chain asset balance");

// Reference to the "offchain transactions" sheet in the ledger Google Spreadsheet
var offTransactionsTab = SpreadsheetApp.openById(ledgerDocId).getSheetByName("offchain transactions");

// Reference to the "Ledger history" sheet in the ledger Google Spreadsheet
var tdgIssuedBalanceTab = SpreadsheetApp.openById(ledgerDocId).getSheetByName("Ledger history");

// Sheet name for Performance Statistics (used for web service and sync)
var PERFORMANCE_STATISTICS_SHEET_NAME = "Performance Statistics";

// Solana wallet address for the USDT vault
var solanaUsdtVaultWalletAddress = "BkcbCEnD14C7cYiN6VwpYuGmpVrjfoRwobhQQScBugqQ";

// Function to resolve redirect URL - handles both HTTP redirects and JavaScript redirects
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

      // If not a redirect (2xx or other), check if it's a Google Sheets URL
      if (responseCode < 300 || responseCode >= 400) {
        // Check if it's already a Google Sheets URL
        if (currentUrl.includes('docs.google.com/spreadsheets')) {
          return currentUrl;
        }
        
        // If not, try to parse HTML for JavaScript redirects
        const content = response.getContentText();
        const resolvedFromHtml = extractUrlFromHtml(content, currentUrl);
        if (resolvedFromHtml && resolvedFromHtml.includes('docs.google.com/spreadsheets')) {
          Logger.log(`Resolved JavaScript redirect: ${url} -> ${resolvedFromHtml}`);
          return resolvedFromHtml;
        }
        
        // If we got a 200 response but it's not a spreadsheet URL, return it anyway
        return currentUrl;
      }

      // Get the Location header for HTTP redirect
      const headers = response.getHeaders();
      const location = headers['Location'] || headers['location'];
      if (!location) {
        // No Location header - try parsing HTML for JavaScript redirect
        const content = response.getContentText();
        const resolvedFromHtml = extractUrlFromHtml(content, currentUrl);
        if (resolvedFromHtml) {
          currentUrl = resolvedFromHtml;
          redirectCount++;
          continue;
        }
        
        Logger.log(`No Location header or JavaScript redirect found at ${currentUrl}`);
        return '';
      }

      // Update the current URL and increment redirect count
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
 * Extracts the actual Google Sheets URL from HTML content that may contain JavaScript redirects
 * Handles:
 * - window.location.href = "url"
 * - window.location.replace("url")
 * - meta refresh tags
 * - direct links to Google Sheets
 * 
 * @param {string} htmlContent - The HTML content to parse
 * @param {string} baseUrl - The base URL for resolving relative URLs
 * @return {string} The extracted Google Sheets URL, or empty string if not found
 */
function extractUrlFromHtml(htmlContent, baseUrl) {
  try {
    // Look for Google Sheets URLs directly in the content
    var sheetsUrlPattern = /https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9_-]+[^\s"']*/g;
    var match = htmlContent.match(sheetsUrlPattern);
    if (match && match.length > 0) {
      // Return the first Google Sheets URL found
      var url = match[0].replace(/[^a-zA-Z0-9\/:._-]/g, ''); // Clean up trailing characters
      Logger.log(`Found Google Sheets URL in HTML: ${url}`);
      return url;
    }
    
    // Look for window.location redirects
    var locationPatterns = [
      /window\.location\.href\s*=\s*["']([^"']+)["']/gi,
      /window\.location\.replace\s*\(\s*["']([^"']+)["']/gi,
      /window\.location\s*=\s*["']([^"']+)["']/gi
    ];
    
    for (var i = 0; i < locationPatterns.length; i++) {
      var pattern = locationPatterns[i];
      var matches = htmlContent.match(pattern);
      if (matches && matches.length > 0) {
        for (var j = 0; j < matches.length; j++) {
          var urlMatch = matches[j].match(/["']([^"']+)["']/);
          if (urlMatch && urlMatch[1]) {
            var extractedUrl = urlMatch[1];
            // If it's a Google Sheets URL, return it
            if (extractedUrl.includes('docs.google.com/spreadsheets')) {
              Logger.log(`Found Google Sheets URL in JavaScript redirect: ${extractedUrl}`);
              return extractedUrl;
            }
            // If it's a relative URL, try to resolve it
            if (extractedUrl.startsWith('/')) {
              var base = baseUrl.match(/https?:\/\/[^\/]+/);
              if (base) {
                extractedUrl = base[0] + extractedUrl;
              }
            }
            // Recursively try to resolve this URL
            if (extractedUrl.startsWith('http')) {
              return resolveRedirect(extractedUrl);
            }
          }
        }
      }
    }
    
    // Look for meta refresh tags
    var metaRefreshPattern = /<meta[^>]*http-equiv=["']refresh["'][^>]*content=["']\d+;\s*url=([^"']+)["']/gi;
    var metaMatch = htmlContent.match(metaRefreshPattern);
    if (metaMatch) {
      var urlMatch = metaMatch[0].match(/url=([^"']+)/i);
      if (urlMatch && urlMatch[1]) {
        var extractedUrl = urlMatch[1];
        if (extractedUrl.includes('docs.google.com/spreadsheets')) {
          Logger.log(`Found Google Sheets URL in meta refresh: ${extractedUrl}`);
          return extractedUrl;
        }
      }
    }
    
    return '';
  } catch (e) {
    Logger.log(`Error extracting URL from HTML: ${e.message}`);
    return '';
  }
}

/**
 * Fetches unique resolved ledger URLs from "Shipment Ledger Listing" sheet, column AB.
 * This reads the pre-resolved URLs that were populated from legacy-redirects.js,
 * avoiding the need to resolve JavaScript redirects.
 * 
 * @return {Array<string>} Array of unique resolved ledger URLs (Google Sheets URLs).
 */
function getLedgerUrlsFromWix() {
  try {
    var spreadsheet = SpreadsheetApp.openById(ledgerDocId);
    var shipmentSheet = spreadsheet.getSheetByName("Shipment Ledger Listing");
    
    if (!shipmentSheet) {
      Logger.log("Error: 'Shipment Ledger Listing' sheet not found");
      return [];
    }
    
    // Get all data from the sheet (skip header row)
    var lastRow = shipmentSheet.getLastRow();
    if (lastRow < 2) {
      Logger.log("No data in 'Shipment Ledger Listing' sheet");
      return [];
    }
    
    // Read data starting from row 2 (row 1 is header)
    // Column A (1) = Shipment ID
    // Column AB (28) = Resolved Ledger URL
    var dataRange = shipmentSheet.getRange(2, 1, lastRow - 1, 28); // Columns A to AB
    var data = dataRange.getValues();
    
    var ledgerUrls = [];
    var seenUrls = {}; // Track unique URLs to avoid duplicates
    
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var shipmentId = row[0] ? row[0].toString().trim() : ''; // Column A - Shipment ID
      var resolvedUrl = row[27] ? row[27].toString().trim() : ''; // Column AB (index 27) - Resolved Ledger URL
      
      // Skip if no URL or no shipment ID
      if (!resolvedUrl || !shipmentId || shipmentId === '0') {
        continue;
      }
      
      // Skip if we've already processed this URL (avoid duplicates)
      if (seenUrls[resolvedUrl]) {
        continue;
      }
      seenUrls[resolvedUrl] = true;
      
      // Only include Google Sheets URLs
      if (resolvedUrl.includes('docs.google.com/spreadsheets')) {
        ledgerUrls.push(resolvedUrl);
        Logger.log("Found resolved URL for " + shipmentId + ": " + resolvedUrl);
      }
    }
    
    Logger.log("Unique Resolved Ledger URLs fetched from Shipment Ledger Listing: " + ledgerUrls.length);
    return ledgerUrls;
    
  } catch (e) {
    Logger.log("Error fetching ledger URLs from Shipment Ledger Listing: " + e.message);
    // Fallback: return empty array
    return [];
  }
}

/**
 * Fetches TrueSight DAO equity holdings (USD) from each ledger's Balance sheet.
 * @param {Array<string>} ledgerUrls - Array of ledger URLs to process.
 * @return {Array<number>} Array of USD balances for TrueSight DAO.
 */
function getTrueSightDAOEquityHoldings(ledgerUrls) {
  var balances = [];
  
  Logger.log("Starting getTrueSightDAOEquityHoldings with " + ledgerUrls.length + " ledger URLs");
  Logger.log("Ledger URLs: " + JSON.stringify(ledgerUrls));
  
  ledgerUrls.forEach(function(url, index) {
    Logger.log(`Processing ledger URL ${index + 1}: ${url}`);
    
    // Check if URL is already a resolved Google Sheets URL (from column AB)
    var resolvedUrl = url;
    
    // If it's not already a Google Sheets URL, try to resolve it (fallback for legacy URLs)
    if (!url.includes('docs.google.com/spreadsheets')) {
      Logger.log(`URL is not a Google Sheets URL, attempting to resolve: ${url}`);
      resolvedUrl = resolveRedirect(url);
      Logger.log(`Resolved URL: ${resolvedUrl}`);
    } else {
      Logger.log(`Using pre-resolved URL from column AB: ${resolvedUrl}`);
    }
    
    if (!resolvedUrl || !resolvedUrl.includes('docs.google.com/spreadsheets')) {
      Logger.log(`Skipping invalid or non-spreadsheet URL: ${resolvedUrl}`);
      return;
    }
    
    try {
      // Open the spreadsheet
      var spreadsheet = SpreadsheetApp.openByUrl(resolvedUrl);
      var balanceSheet = spreadsheet.getSheetByName("Balance");
      
      if (!balanceSheet) {
        Logger.log(`Balance sheet not found in spreadsheet: ${resolvedUrl}`);
        return;
      }
      
      Logger.log(`Successfully opened Balance sheet from: ${resolvedUrl}`);
      
      // Get all data from the Balance sheet
      var data = balanceSheet.getDataRange().getValues();
      Logger.log(`Balance sheet has ${data.length} rows of data`);
      
      // Log first few rows to see the structure
      for (var j = 0; j < Math.min(5, data.length); j++) {
        Logger.log(`Row ${j}: [${data[j][0]}, ${data[j][1]}, ${data[j][2]}]`);
      }
      
      // Find rows where Column A = "TrueSight DAO" and Column C = "USD"
      var foundTrueSightDAO = false;
      for (var i = 0; i < data.length; i++) {
        if (data[i][0] === "TrueSight DAO" && data[i][2] === "USD") {
          foundTrueSightDAO = true;
          var balance = data[i][1]; // Column B value
          Logger.log(`Found TrueSight DAO row at index ${i}: balance=${balance}, type=${typeof balance}`);
          if (typeof balance === 'number') {
            balances.push(balance);
            Logger.log(`TrueSight DAO USD balance from ${resolvedUrl}: ${balance}`);
          } else {
            Logger.log(`Invalid balance value for TrueSight DAO in ${resolvedUrl}: ${balance} (type: ${typeof balance})`);
          }
        }
      }
      
      if (!foundTrueSightDAO) {
        Logger.log(`No TrueSight DAO row found in ${resolvedUrl}`);
      }
      
    } catch (e) {
      Logger.log(`Error accessing spreadsheet ${resolvedUrl}: ${e.message}`);
    }
  });
  
  Logger.log(`getTrueSightDAOEquityHoldings returning ${balances.length} balances: ${JSON.stringify(balances)}`);
  return balances;
}

/**
 * Calculates the total investment holdings in AGL (USD) by summing TrueSight DAO equity holdings.
 * @return {number} Total USD value of TrueSight DAO holdings across all ledgers.
 */
function getInvestmentHoldingsInAGL() {
  Logger.log("Starting getInvestmentHoldingsInAGL...");
  
  var ledgerUrls = getLedgerUrlsFromWix();
  Logger.log("Retrieved " + ledgerUrls.length + " ledger URLs");
  
  var equityHoldings = getTrueSightDAOEquityHoldings(ledgerUrls);
  Logger.log("Retrieved " + equityHoldings.length + " equity holdings: " + JSON.stringify(equityHoldings));
  
  var totalHoldings = equityHoldings.reduce(function(sum, balance) {
    return sum + balance;
  }, 0);
  
  Logger.log("Total TrueSight DAO investment holdings in AGL (USD): " + totalHoldings);
  return totalHoldings;
}

/**
 * Updates the total DAO asset value on Wix, including off-chain assets, USDT vault balance, and AGL investment holdings.
 * NOTE: This function also updates Performance Statistics directly (even if Wix is not used).
 */
function updateTotalDAOAssetOnWix() {
  var full_asset_value = getOffChainAssetValue() + getUSDTBalanceInVault() + getInvestmentHoldingsInAGL();
  Logger.log("Full amount of Asset in USD value managed off chain: " + full_asset_value);      

  setAssetBalanceOnWix(full_asset_value);
  getAssetBalanceOnWix();
}

/**
 * Updates USD_TREASURY_BALANCE in Performance Statistics directly from Google Sheets
 * (without going through Wix). Use this when you're updating the sheet directly.
 * 
 * This function calculates: off-chain assets + USDT vault balance + AGL investment holdings
 * 
 * CALL THIS FUNCTION to update USD_TREASURY_BALANCE in Performance Statistics
 */
function updateUSD_TREASURY_BALANCE() {
  try {
    var treasuryBalance = getOffChainAssetValue() + getUSDTBalanceInVault() + getInvestmentHoldingsInAGL();
    Logger.log("Calculating USD_TREASURY_BALANCE: " + treasuryBalance);
    Logger.log("  - Off-chain assets: " + getOffChainAssetValue());
    Logger.log("  - USDT vault balance: " + getUSDTBalanceInVault());
    Logger.log("  - AGL investment holdings: " + getInvestmentHoldingsInAGL());
    
    updatePerformanceStatistic("USD_TREASURY_BALANCE", treasuryBalance, "USD");
    Logger.log("✅ Successfully updated USD_TREASURY_BALANCE: " + treasuryBalance);
    return treasuryBalance;
  } catch (error) {
    Logger.log("❌ Error updating USD_TREASURY_BALANCE: " + error.message);
    throw error;
  }
}


function getOffChainAssetValue() {
  var assets = offChainAssetBalanceTab.getRange(1,4).getValues().map(function(valueArray) {
    return valueArray[0];
  });
  Logger.log("Off Chain Asset in USD: " + assets[0]);      
  return assets[0];
}

function getTdgTokensIssued() {
  var assets = tdgIssuedBalanceTab.getRange(1,5).getValues().map(function(valueArray) {
    return valueArray[0];
  });
  Logger.log("Total TDG issued: " + assets[0]);      
  return assets[0];
}

function getVotingRightsCirculated() {
  var votingRightsCirculated = tdgIssuedBalanceTab.getRange('E1').getValue();
  Logger.log("Voting rights circulated: " + votingRightsCirculated);
  return votingRightsCirculated;
}

function getUSDTBalanceInVault() {
  try {
    var options = {
     "method" : "POST",
     "headers" : {
        "Content-Type" : "application/json"
     }
    }

    var payload =   {
      "jsonrpc": "2.0", "id": 1,
      "method": "getTokenAccountBalance",
      "params": [
        solanaUsdtVaultWalletAddress
      ]
    }

    options.payload = JSON.stringify(payload);

    var request_url = "https://side-clean-replica.solana-mainnet.quiknode.pro/" + quickNodeApiKey + "/";
    var response = UrlFetchApp.fetch(request_url, options);     

    var response = UrlFetchApp.fetch(request_url, options);
    var content = response.getContentText();
    var response_obj = JSON.parse(content);  
    // Logger.log(response_obj);      
    Logger.log("Amount of USDT in vault: " + response_obj.result.value.uiAmount);      

    return response_obj.result.value.uiAmount;
  } catch (error) {
    Logger.log("⚠️  Error fetching USDT balance from Solana vault (endpoint unavailable): " + error.message);
    Logger.log("⚠️  Returning 0 for USDT vault balance. Treasury balance will exclude USDT vault.");
    return 0;
  }
}  

function getAssetBalanceOnWix() {
  var options = getWixRequestHeader();
  var request_url = "https://www.wixapis.com/wix-data/v2/items/" + getWixAssetBalanceDataItemId() + "?dataCollectionId=" + getWixDataCollectionId();  
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  var response_obj = JSON.parse(content);  
  // Logger.log(response_obj);  
  Logger.log("Asset balance record on Wix: " + response_obj.dataItem.data.exchangeRate);  
}


function setAssetBalanceOnWix( latest_asset_balance) {
  // NOTE: If you're not using Wix, you can skip the Wix update and just update Performance Statistics
  // by calling updatePerformanceStatistic() directly, or use updateUSD_TREASURY_BALANCE() instead
  
  // Update Wix (only if using Wix)
  try {
    var options = getWixRequestHeader();  
    var payload = {
      "dataCollectionId": "ExchangeRate",
      "dataItem": {
        "data": {
          "description": "USD_TREASURY_BALANCE",
          "_id": getWixAssetBalanceDataItemId(),
          "_owner": "0e2cde5f-b353-468b-9f4e-36835fc60a0e",
          "exchangeRate": latest_asset_balance,
          "currency": "USD"
        }
      }
    }

    options.payload = JSON.stringify(payload);
    options.method = 'PUT';

    var request_url = "https://www.wixapis.com/wix-data/v2/items/" + getWixAssetBalanceDataItemId();  
    var response = UrlFetchApp.fetch(request_url, options);
    var content = response.getContentText();
    var response_obj = JSON.parse(content);  
    Logger.log("Updated Wix (if using Wix): " + latest_asset_balance);
  } catch (e) {
    Logger.log("⚠️  Wix update failed (this is OK if not using Wix): " + e.message);
  }

  // ALWAYS sync to Performance Statistics sheet (regardless of Wix)
  updatePerformanceStatistic("USD_TREASURY_BALANCE", latest_asset_balance, "USD");
}

function getTDGIssuedOnWix() {
  var options = getWixRequestHeader();
  var request_url = "https://www.wixapis.com/wix-data/v2/items/" + getWixTDGIssuedTdgDataItemId() + "?dataCollectionId=" + getWixDataCollectionId();  
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  var response_obj = JSON.parse(content);  
  // Logger.log(response_obj);  
  Logger.log("TDG issued record on Wix: " + response_obj.dataItem.data.exchangeRate);  
}

function setTDGIssuedOnWix() {
  var tdg_issed = getTdgTokensIssued();

  var options = getWixRequestHeader();  
  var payload = {
    "dataCollectionId": "ExchangeRate",
    "dataItem": {
      "data": {
        "description": "TDG_ISSUED",
        "_id": getWixTDGIssuedTdgDataItemId(),
        "_owner": "0e2cde5f-b353-468b-9f4e-36835fc60a0e",
        "exchangeRate": tdg_issed,
        "currency": "TDG"
      }
    }
  }

  options.payload = JSON.stringify(payload);
  options.method = 'PUT';

  // Logger.log("The Final Payload");
  // Logger.log(options);

  var request_url = "https://www.wixapis.com/wix-data/v2/items/" + getWixTDGIssuedTdgDataItemId();  
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  var response_obj = JSON.parse(content);  
  // Logger.log(response_obj);  

  // Sync to Performance Statistics sheet
  updatePerformanceStatistic("TDG_ISSUED", tdg_issed, "TDG");
}

function getWixTDGIssuedTdgDataItemId() {
  return "4088e994-2c06-42a8-a1cf-8cd77ee73203";
}

function getWixRequestHeader() {
  var options = {
    //  "async": true,
    //  "crossDomain": true,
     "method" : "GET",
     "headers" : {
        "Content-Type" : "application/json",
        "Authorization" : wixAccessToken,
        "wix-account-id" : "0e2cde5f-b353-468b-9f4e-36835fc60a0e",
        "wix-site-id": "d45a189f-d0cc-48de-95ee-30635a95385f"
      //  "cache-control": "no-cache"
     }
  };

  return options;
}

function getWixDataCollectionId() {
  return "ExchangeRate";
}

function getWixAssetBalanceDataItemId() {
  return "a0e7364c-716d-49f3-a795-647d2686a22b";
}

function updateAssetPerIssuedTdg() {
  getAssetPerIssuedTdgBalanceOnWix();  
  var calculated_asset_per_issued_tdg = calculateAssetPerIssuedTdg();
  setAssetPerIssuedTdgBalanceOnWix(calculated_asset_per_issued_tdg);
  getAssetPerIssuedTdgBalanceOnWix();  
}

function calculateAssetPerIssuedTdg() {
  // Calculate total_assets as off-chain assets + USDT vault balance + AGL investment holdings
  Logger.log("Off chain asset: " + getOffChainAssetValue()) 
  Logger.log("USDT in vault: " + getUSDTBalanceInVault()) 
  Logger.log("Investment holdings in AGL: " + getInvestmentHoldingsInAGL()) 

  var total_assets = getOffChainAssetValue() + getUSDTBalanceInVault() + getInvestmentHoldingsInAGL();
  var voting_rights_circulated = getVotingRightsCirculated();
  
  // Calculate asset_per_circulated_voting_right with zero division check
  var asset_per_circulated_voting_right = voting_rights_circulated !== 0 ? total_assets / voting_rights_circulated : 0;
  
  Logger.log("Calculated Asset Per Circulated Voting Right: " + asset_per_circulated_voting_right);    
  return asset_per_circulated_voting_right;
}

function getAssetPerIssuedTdgBalanceOnWix() {
  var options = getWixRequestHeader();
  var request_url = "https://www.wixapis.com/wix-data/v2/items/" + getWixAssetPerIssuedTdgDataItemId() + "?dataCollectionId=" + getWixDataCollectionId();  
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  var response_obj = JSON.parse(content);  
  // Logger.log(response_obj);  
  Logger.log("Asset per issued TDG on Wix: " + response_obj.dataItem.data.exchangeRate);
  return response_obj.dataItem.data.exchangeRate;
}


function setAssetPerIssuedTdgBalanceOnWix( calculated_asset_per_issued_tdg) {
  var options = getWixRequestHeader();  
  var payload = {
    "dataCollectionId": "ExchangeRate",
    "dataItem": {
      "data": {
        "description": "ASSET_PER_TDG_ISSUED",
        "_id": getWixAssetPerIssuedTdgDataItemId(),
        "_owner": "0e2cde5f-b353-468b-9f4e-36835fc60a0e",
        "exchangeRate": calculated_asset_per_issued_tdg,
        "currency": "USD"
      }
    }
  }

  options.payload = JSON.stringify(payload);
  options.method = 'PUT';

  // Logger.log("The Final Payload");
  // Logger.log(options);

  var request_url = "https://www.wixapis.com/wix-data/v2/items/" + getWixAssetPerIssuedTdgDataItemId();  
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  var response_obj = JSON.parse(content);  
  // Logger.log(response_obj);  

  // Sync to Performance Statistics sheet
  updatePerformanceStatistic("ASSET_PER_TDG_ISSUED", calculated_asset_per_issued_tdg, "USD");
}

function getWixAssetPerIssuedTdgDataItemId() {
  return "9b04879b-f06a-419a-9ad3-520ad60ea972";
}





// Add this constant for the new DataItemID (unchanged)
function getWix30DaysSalesDataItemId() {
  return "956fdb46-bc8d-4c71-8e67-79813effbab3";
}

// Method to get 30 days sales from Wix (unchanged)
function get30DaysSalesOnWix() {
  var options = getWixRequestHeader();
  var request_url = "https://www.wixapis.com/wix-data/v2/items/" + getWix30DaysSalesDataItemId() + "?dataCollectionId=" + getWixDataCollectionId();  
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  var response_obj = JSON.parse(content);  
  Logger.log("30 Days Sales record on Wix: " + response_obj.dataItem.data.exchangeRate);  
  return response_obj.dataItem.data.exchangeRate;
}

// Method to set 30 days sales on Wix (unchanged)
function set30DaysSalesOnWix(latest_30days_sales) {
  var options = getWixRequestHeader();  
  var payload = {
    "dataCollectionId": "ExchangeRate",
    "dataItem": {
      "data": {
        "description": "PAST_30_DAYS_SALES",
        "_id": getWix30DaysSalesDataItemId(),
        "_owner": "0e2cde5f-b353-468b-9f4e-36835fc60a0e",
        "exchangeRate": latest_30days_sales,
        "currency": "USD"
      }
    }
  }

  options.payload = JSON.stringify(payload);
  options.method = 'PUT';

  var request_url = "https://www.wixapis.com/wix-data/v2/items/" + getWix30DaysSalesDataItemId();  
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  var response_obj = JSON.parse(content);  
  Logger.log("Updated 30 Days Sales on Wix: " + latest_30days_sales);
  
  // Sync to Performance Statistics sheet
  updatePerformanceStatistic("PAST_30_DAYS_SALES", latest_30days_sales, "USD");
}

// Method to get 30 days sales from Google Sheet (simple version using F1)
function get30DaysSales() {
  var offTransactionsTab = SpreadsheetApp.openById(ledgerDocId).getSheetByName("offchain transactions");
  var sales = offTransactionsTab.getRange("F1").getValue();
  Logger.log("30 Days Sales from Sheet: " + sales);
  return sales;
}

// Alternative version with full query logic
function get30DaysSalesWithQuery() {
  var offTransactionsTab = SpreadsheetApp.openById(ledgerDocId).getSheetByName("offchain transactions");
  // Get the last row to ensure we query all data
  var lastRow = offTransactionsTab.getLastRow();
  // Query starting from row 4 as per your original request
  var query = "SELECT SUM(D) WHERE E = 'USD' AND G = TRUE AND A >= " + Utilities.formatDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), "GMT", "yyyyMMdd") + " LABEL SUM(D) ''";
  var result = offTransactionsTab.getRange("A4:G" + lastRow).getValues();
  
  // Manual filtering and summing since QUERY isn't directly available in Apps Script
  var total = result.reduce(function(sum, row) {
    var date = row[0]; // Column A
    var amount = row[3]; // Column D
    var currency = row[4]; // Column E
    var flag = row[6]; // Column G
    
    if (currency === 'USD' && 
        flag === true && 
        date >= parseInt(Utilities.formatDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), "GMT", "yyyyMMdd"))) {
      return sum + amount;
    }
    return sum;
  }, 0);
  
  Logger.log("30 Days Sales from Sheet (calculated): " + total);
  return total;
}

// Example usage function
function update30DaysSalesOnWix() {
  // Choose which version to use:
  var sales = get30DaysSales();  // Simple F1 version
  // OR
  // var sales = get30DaysSalesWithQuery();  // Full query version
  
  set30DaysSalesOnWix(sales);
  get30DaysSalesOnWix();
}

function getTdgUsdtPriceLaToken() {
  var tdg_id = "cbfd4c19-259c-420b-9bb2-498493265648";
  var usdt_id = "0c3a106d-bde3-4c13-a26e-3fd2394529e5";
  var request_url = "https://api.latoken.com/v2/ticker/" + tdg_id + "/" + usdt_id;
  Logger.log(request_url );
  var response = UrlFetchApp.fetch(request_url);
  var content = response.getContentText();
  // Logger.log(content);
  var response_obj = JSON.parse(content);
  // Logger.log(response_obj);
  var last_price = response_obj.lastPrice;
  // var last_price = response_obj.bestAsk;
  
  Logger.log("The latest price on LATOKEN Exchange: " + last_price);
  return last_price;
}

/**
 * Retrieve the TDG to USDC exchange rate from Wix.
 * @return {number} The TDG to USDC exchange rate stored on Wix.
 */
function getTdgUsdcPriceOnWix() {
  var options = getWixRequestHeader();
  var request_url = "https://www.wixapis.com/wix-data/v2/items/" + getWixTdgUsdcPriceDataItemId() + "?dataCollectionId=" + getWixDataCollectionId();  
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  var response_obj = JSON.parse(content);  
  Logger.log("TDG to USDC exchange rate on Wix: " + response_obj.dataItem.data.exchangeRate);  
  return response_obj.dataItem.data.exchangeRate;
}

/**
 * Get the DataItemId for the TDG to USDC exchange rate.
 * @return {string} The DataItemId for the TDG/USDC exchange rate.
 */
function getWixTdgUsdcPriceDataItemId() {
  return "8edde502-ac79-4e66-ab2d-8ebb99108665";
}


function getUSTreasuryYield() {
  var treasury_yield_url = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=" + new Date().getFullYear();
  Logger.log(treasury_yield_url);
  var xml_response = UrlFetchApp.fetch(treasury_yield_url);
  var document = XmlService.parse(xml_response);
  var root = document.getRootElement();
  var child_nodes = root.getChildren();
  var entry = false;
  var content = false;
  var properties = false;


  for (var i = 0; i < child_nodes.length; i++) {
    // Logger.log(child_nodes[i].getName()); 
    if (child_nodes[i].getName() == "entry" ) {
      entry = child_nodes[i];
    }
  }  
  Logger.log("finding the entry children")
  var entry_child_nodes = entry.getChildren();

  for (var i = 0; i < entry_child_nodes.length; i++) {
    if (entry_child_nodes[i].getName() == "content" && !content) {
      content = entry_child_nodes[i];
    }    
  }
  Logger.log(content.getChildren()[0].getValue()); 

  var interest_rate_date = content.getChildren()[0].getChildren()[1].getValue();
  // Logger.log(content.getChildren()[0].getChildren()[0].getValue()); 
  // Logger.log(content.getChildren()[0].getChildren()[1].getValue()); 
  // Logger.log(content.getChildren()[0].getChildren()[2].getValue()); 

  var interest_rate = content.getChildren()[0].getChildren()[2].getValue() * 1;
  Logger.log("Interest rate on " + interest_rate_date + " is : "+ interest_rate);
  return interest_rate;
  
}



// Constant for the new DataItemID
function getWixDailyTdgBuyBackBudgetDataItemId() {
  return "8f1c08f2-5ff8-4c40-8aee-4f5519e6b8a1";
}

// Method to calculate and set the daily TDG buy-back budget
function setDailyTdgBuyBackBudget() {
  // Calculate the budget using the provided formula
  var last30DaysSales = get30DaysSales();
  var assetPerIssuedTdg = getAssetPerIssuedTdgBalanceOnWix();
  var treasuryYield = getUSTreasuryYield();
  
  // Formula: (Last 30 days sales / 30) * min(Asset Per Issued TDG, 1 - Treasury yield)
  // Using asset per issued TDG instead of market price ensures buy-back budget reflects
  // the intrinsic value backed by DAO assets rather than speculative market pricing
  var dailySalesAverage = last30DaysSales / 30;
  Logger.log("Daily sales average: " + dailySalesAverage);
  var adjustedPrice = Math.min(assetPerIssuedTdg, 1 - treasuryYield / 100);
  var dailyBudget = dailySalesAverage * adjustedPrice;

  Logger.log("Adjusted Price: " + adjustedPrice);
Logger.log("Treasury Yield : " + treasuryYield);  
  Logger.log("Treasury Yield Maximum : " + (1 - treasuryYield/100));

  
  var options = getWixRequestHeader();  
  var payload = {
    "dataCollectionId": "ExchangeRate",
    "dataItem": {
      "data": {
        "description": "TDG_DAILY_BUY_BACK_BUDGET",
        "_id": getWixDailyTdgBuyBackBudgetDataItemId(),
        "_owner": "0e2cde5f-b353-468b-9f4e-36835fc60a0e",
        "exchangeRate": dailyBudget,
        "currency": "USD"
      }
    }
  }

  options.payload = JSON.stringify(payload);
  options.method = 'PUT';

  var request_url = "https://www.wixapis.com/wix-data/v2/items/" + getWixDailyTdgBuyBackBudgetDataItemId();  
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  var response_obj = JSON.parse(content);  
  Logger.log("Updated Daily TDG Buy Back Budget on Wix: " + dailyBudget);
  
  // Sync to Performance Statistics sheet
  updatePerformanceStatistic("TDG_DAILY_BUY_BACK_BUDGET", dailyBudget, "USD");
}

// Method to get the daily TDG buy-back budget
function getDailyTdgBuyBackBudget() {
  var options = getWixRequestHeader();
  var request_url = "https://www.wixapis.com/wix-data/v2/items/" + getWixDailyTdgBuyBackBudgetDataItemId() + "?dataCollectionId=" + getWixDataCollectionId();  
  Logger.log(request_url)
  Logger.log(options)
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  var response_obj = JSON.parse(content);  
  Logger.log("Daily TDG Buy Back Budget on Wix: " + response_obj.dataItem.data.exchangeRate);  
  return response_obj.dataItem.data.exchangeRate;
}

/**
 * Gets Gary Teh's USD balance from the "offchain asset location" sheet.
 * 
 * Searches for rows where:
 * - Column A = "USD"
 * - Column B = "Gary Teh"
 * - Returns Column C (Amount Managed)
 * 
 * @return {number} Gary Teh's USD balance, or 0 if not found
 */
function getGaryTehUSDBalance() {
  try {
    // Get the "offchain asset location" sheet
    var offChainAssetLocationSheet = SpreadsheetApp.openById(ledgerDocId).getSheetByName("offchain asset location");
    if (!offChainAssetLocationSheet) {
      Logger.log("Error: 'offchain asset location' sheet not found");
      return 0;
    }
    
    // Get all data from the sheet
    var data = offChainAssetLocationSheet.getDataRange().getValues();
    
    // Search for Gary Teh's USD balance
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      if (row.length >= 3) {
        var currency = row[0]; // Column A
        var location = row[1]; // Column B
        var amount = row[2];   // Column C
        
        if (currency === "USD" && location === "Gary Teh") {
          var balance = parseFloat(amount) || 0;
          Logger.log("Gary Teh's USD balance: " + balance);
          return balance;
        }
      }
    }
    
    Logger.log("Gary Teh's USD balance not found in offchain asset location sheet");
    return 0;
    
  } catch (e) {
    Logger.log("Error getting Gary Teh's USD balance: " + e.message);
    return 0;
  }
}

/**
 * Creates daily buy-back provision transaction pairs in the "offchain transactions" sheet.
 * This function should be executed daily to provision funds for TDG buy-back operations.
 * 
 * Implements the ledger-based buy-back program as specified in:
 * https://github.com/TrueSightDAO/proposals/blob/main/migration-away-from-raydium-towards-ledger-based-buy-back-program.md
 * 
 * Execution Source: https://script.google.com/home/projects/1ZQjgSZvAXL2PB3e3YW289xY7Ork4S5wV4uKTXJyw83xQT4R0lh_hwNWn/edit
 * Source Code: https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_asset_management/tdg_wix_dashboard.gs
 * 
 * Creates two transactions:
 * 1. Negative transaction: Deducts buy-back budget from off-chain funds
 * 2. Positive transaction: Provisions buy-back budget for voting rights cash-out
 * 
 * @return {boolean} True if transactions were created successfully, false otherwise
 */
function createDailyTdgBuyBackTransactions() {
  try {
    // Get the current date in YYYYMMDD format
    var currentDate = Utilities.formatDate(new Date(), 'GMT', 'yyyyMMdd');
    
    // Get the daily buy-back budget from Wix
    var buyBackBudget = getDailyTdgBuyBackBudget();
    
    if (!buyBackBudget || buyBackBudget <= 0) {
      Logger.log("Invalid buy-back budget: " + buyBackBudget);
      return false;
    }
    
    // Get Gary Teh's USD balance and cap the buy-back budget if necessary
    var garyTehUSDBalance = getGaryTehUSDBalance();
    var actualBuyBackAmount = Math.min(buyBackBudget, garyTehUSDBalance);
    
    if (actualBuyBackAmount <= 0) {
      Logger.log("Insufficient USD balance for buy-back. Gary Teh's balance: " + garyTehUSDBalance + ", Required: " + buyBackBudget);
      return false;
    }
    
    // Log if the amount was capped
    if (actualBuyBackAmount < buyBackBudget) {
      Logger.log("Buy-back amount capped due to insufficient USD balance. Original budget: " + buyBackBudget + ", Actual amount: " + actualBuyBackAmount);
    }
    
    Logger.log("Creating daily buy-back transactions for date: " + currentDate + " with amount: " + actualBuyBackAmount);
    
    // Get the "offchain transactions" sheet
    var offTransactionsSheet = SpreadsheetApp.openById(ledgerDocId).getSheetByName("offchain transactions");
    if (!offTransactionsSheet) {
      Logger.log("Error: 'offchain transactions' sheet not found");
      return false;
    }
    
    // Find the last non-empty row in Column A
    var lastRow = offTransactionsSheet.getLastRow();
    var nextRow = lastRow + 1;
    
    // Get execution timestamp
    var executionTimestamp = Utilities.formatDate(new Date(), 'GMT', 'yyyy-MM-dd HH:mm:ss') + ' UTC';
    
    // Create description with capping information if applicable
    var description = "[DAILY BUYBACK PROVISION]\nDaily Buyback budget: " + buyBackBudget;
    if (actualBuyBackAmount < buyBackBudget) {
      description += "\nActual amount (capped): " + actualBuyBackAmount + "\nGary Teh's USD balance: " + garyTehUSDBalance;
    }
    description += "\n--------\n\nMethod: createDailyTdgBuyBackTransactions";
    description += "\nExecuted: " + executionTimestamp;
    description += "\nProposal: https://github.com/TrueSightDAO/proposals/blob/main/migration-away-from-raydium-towards-ledger-based-buy-back-program.md";
    description += "\nExecution Source: https://script.google.com/home/projects/1ZQjgSZvAXL2PB3e3YW289xY7Ork4S5wV4uKTXJyw83xQT4R0lh_hwNWn/edit";
    description += "\nSource Code: https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_asset_management/tdg_wix_dashboard.gs";
    
    // Transaction #1: Negative transaction (deduct from off-chain funds)
    var transaction1 = [
      currentDate,  // Column A: Transaction Date
      description,  // Column B: Description
      "Gary Teh",  // Column C: Fund Handler
      -actualBuyBackAmount,  // Column D: Amount (negative)
      "USD"  // Column E: Currency
    ];
    
    // Transaction #2: Positive transaction (provision for voting rights cash-out)
    var transaction2 = [
      currentDate,  // Column A: Transaction Date
      description,  // Column B: Description
      "Gary Teh",  // Column C: Fund Handler
      actualBuyBackAmount,  // Column D: Amount (positive)
      "USD - provisions for voting rights cash out"  // Column E: Currency
    ];
    
    // Insert both transactions
    offTransactionsSheet.getRange(nextRow, 1, 1, transaction1.length).setValues([transaction1]);
    offTransactionsSheet.getRange(nextRow + 1, 1, 1, transaction2.length).setValues([transaction2]);
    
    Logger.log("Successfully created daily buy-back transactions:");
    Logger.log("Transaction 1 (Row " + nextRow + "): -" + actualBuyBackAmount + " USD");
    Logger.log("Transaction 2 (Row " + (nextRow + 1) + "): +" + actualBuyBackAmount + " USD");
    
    return true;
    
  } catch (e) {
    Logger.log("Error creating daily buy-back transactions: " + e.message);
    return false;
  }
}

// Constant for the US Treasury Yield DataItemID
function getWixUSTreasuryYieldDataItemId() {
  return "7e8efc84-f212-47ac-a37e-2f32f29c76e0";
}

// Method to set the US Treasury yield on Wix
function setUSTreasuryYieldOnWix() {
  var treasuryYield = getUSTreasuryYield();
  
  var options = getWixRequestHeader();  
  var payload = {
    "dataCollectionId": "ExchangeRate",
    "dataItem": {
      "data": {
        "description": "USD_TREASURY_YIELD_1_MONTH",
        "_id": getWixUSTreasuryYieldDataItemId(),
        "_owner": "0e2cde5f-b353-468b-9f4e-36835fc60a0e",
        "exchangeRate": treasuryYield,
        "currency": "%"
      }
    }
  }

  options.payload = JSON.stringify(payload);
  options.method = 'PUT';

  var request_url = "https://www.wixapis.com/wix-data/v2/items/" + getWixUSTreasuryYieldDataItemId();  
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  var response_obj = JSON.parse(content);  
  Logger.log("Updated US Treasury Yield on Wix: " + treasuryYield);
  
  // Sync to Performance Statistics sheet
  updatePerformanceStatistic("USD_TREASURY_YIELD_1_MONTH", treasuryYield, "%");
}

// Method to get the US Treasury yield from Wix
function getUSTreasuryYieldOnWix() {
  var options = getWixRequestHeader();
  var request_url = "https://www.wixapis.com/wix-data/v2/items/" + getWixUSTreasuryYieldDataItemId() + "?dataCollectionId=" + getWixDataCollectionId();  
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  var response_obj = JSON.parse(content);  
  Logger.log("US Treasury Yield on Wix: " + response_obj.dataItem.data.exchangeRate);  
  return response_obj.dataItem.data.exchangeRate;
}

/**
 * Helper function to update Performance Statistics sheet when updating Wix
 * Call this after updating Wix ExchangeRate collection
 * 
 * @param {string} key - The exchange rate key (e.g., "USD_TREASURY_BALANCE")
 * @param {number} value - The new exchange rate / value
 * @param {string} currency - Optional currency code
 */
function updatePerformanceStatistic(key, value, currency) {
  try {
    var spreadsheet = SpreadsheetApp.openById(ledgerDocId);
    var sheet = spreadsheet.getSheetByName(PERFORMANCE_STATISTICS_SHEET_NAME);
    
    if (!sheet) {
      Logger.log("⚠️  Performance Statistics sheet not found - skipping update");
      return;
    }
    
    // Find the row with this key
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      Logger.log("⚠️  Performance Statistics sheet has no data rows - skipping update");
      return;
    }
    
    var dataRange = sheet.getRange(2, 1, lastRow - 1, 1); // Column 1 (Key column)
    var keys = dataRange.getValues();
    
    var rowIndex = -1;
    for (var i = 0; i < keys.length; i++) {
      if (keys[i][0] === key) {
        rowIndex = i + 2; // +2 because data starts at row 2 (row 1 is header)
        break;
      }
    }
    
    if (rowIndex === -1) {
      // Key not found - add new row
      sheet.appendRow([
        key,
        key, // description
        value !== null && value !== undefined ? value : "",
        currency || "",
        new Date() // Updated Date (Column E)
      ]);
      Logger.log("✅ Added new row to Performance Statistics for key: " + key);
    } else {
      // Update existing row
      sheet.getRange(rowIndex, 3).setValue(value !== null && value !== undefined ? value : ""); // Exchange Rate column
      if (currency) {
        sheet.getRange(rowIndex, 4).setValue(currency); // Currency column
      }
      sheet.getRange(rowIndex, 5).setValue(new Date()); // Updated Date (Column E)
      // Note: Column F (Last Synced) is no longer used - dropped in favor of Updated Date
      Logger.log("✅ Updated Performance Statistics row " + rowIndex + " for key: " + key);
    }
    
  } catch (error) {
    Logger.log("⚠️  Error updating Performance Statistics: " + error.message);
    // Don't throw - allow Wix update to succeed even if sheet update fails
  }
}

/**
 * Web service endpoint (doGet) - returns all Performance Statistics as JSON
 * 
 * This function exposes a web service that returns all Performance Statistics
 * from the Google Sheet. Deploy this script as a web app to expose the endpoint.
 * 
 * Deployment:
 * 1. Deploy as web app: Publish > Deploy as web app
 * 2. Set "Execute as: Me" and "Who has access: Anyone, even anonymous"
 * 3. Copy the web app URL and use it in index.html
 * 
 * URL: https://script.google.com/macros/s/AKfycbzlfOBo9UqKOh7jIqGcmbPAMM1RxCbsJHb-UV_vM6VbvK_HSdT44KyGbbXIeo-_Ovfy/exec
 * 
 * Returns JSON:
 * {
 *   "timestamp": "2025-01-27T12:00:00.000Z",
 *   "data": {
 *     "USDC_EXCHANGE_RATE_RAYDIUM": {
 *       "key": "USDC_EXCHANGE_RATE_RAYDIUM",
 *       "description": "USDC_EXCHANGE_RATE_RAYDIUM",
 *       "exchangeRate": 1.001,
 *       "currency": "USDC",
 *       "updatedDate": "2025-01-27T10:00:00.000Z"
 *     },
 *     ...
 *   }
 * }
 */
function doGet(e) {
  try {
    // Check if shipment ID parameter is provided
    var shipmentId = e.parameter.shipmentId || e.parameter.shipment_id;
    
    if (shipmentId) {
      // Return sold QR codes count for this shipment
      var count = getSoldQRCodesCount(shipmentId);
      
      var response = {
        timestamp: new Date().toISOString(),
        shipmentId: shipmentId,
        treesSold: count
      };
      
      return ContentService
        .createTextOutput(JSON.stringify(response))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // Default: return all performance statistics
    var data = readPerformanceStatistics();
    
    var response = {
      timestamp: new Date().toISOString(),
      data: data
    };
    
    // Return as JSON with proper CORS headers
    return ContentService
      .createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    // Return error as JSON
    var errorResponse = {
      timestamp: new Date().toISOString(),
      error: true,
      message: error.message || "Unknown error occurred"
    };
    
    return ContentService
      .createTextOutput(JSON.stringify(errorResponse))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Read all performance statistics from Google Sheet
 * Returns object keyed by exchange rate key
 * 
 * @return {Object} Object with performance statistics keyed by exchange rate key
 */
function readPerformanceStatistics() {
  try {
    var spreadsheet = SpreadsheetApp.openById(ledgerDocId);
    var sheet = spreadsheet.getSheetByName(PERFORMANCE_STATISTICS_SHEET_NAME);
    
    if (!sheet) {
      throw new Error("Sheet '" + PERFORMANCE_STATISTICS_SHEET_NAME + "' not found. Please run populatePerformanceStatistics() first.");
    }
    
    // Get all data (assuming header is in row 1)
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      throw new Error("No data found in Performance Statistics sheet");
    }
    
    var dataRange = sheet.getRange(2, 1, lastRow - 1, 6); // Start from row 2, get 6 columns
    var values = dataRange.getValues();
    
    // Build object keyed by the Key column (column 1)
    var performanceStats = {};
    
    for (var i = 0; i < values.length; i++) {
      var row = values[i];
      var key = row[0]; // Key column
      var description = row[1]; // Description column
      var exchangeRate = row[2]; // Exchange Rate / Value column
      var currency = row[3]; // Currency column
      var updatedDate = row[4]; // Updated Date column
      
      if (key) {
        performanceStats[key] = {
          key: key,
          description: description || key,
          exchangeRate: exchangeRate !== "" ? exchangeRate : null,
          currency: currency || null,
          updatedDate: updatedDate instanceof Date ? updatedDate.toISOString() : (updatedDate || null)
        };
      }
    }
    
    return performanceStats;
    
  } catch (error) {
    Logger.log("❌ Error reading Performance Statistics: " + error.message);
    throw error;
  }
}

/**
 * Gets the count of sold QR codes for a given shipment ID
 * 
 * Queries "Agroverse QR codes" sheet where:
 * - Column D = "sold" (or marked as sold)
 * - Column C (URL) ends with the shipment ID (lowercase)
 * 
 * @param {string} shipmentId - The shipment ID (e.g., "AGL8", "agl8", "SEF1")
 * @return {number} Count of sold QR codes for this shipment
 */
function getSoldQRCodesCount(shipmentId) {
  try {
    // Normalize shipment ID to lowercase
    var normalizedId = shipmentId.toLowerCase();
    
    // Get the "Agroverse QR codes" sheet
    // NOTE: Update this spreadsheet ID if QR codes are in a different spreadsheet
    var qrCodesSpreadsheetId = ledgerDocId; // Using same spreadsheet as ledger
    var spreadsheet = SpreadsheetApp.openById(qrCodesSpreadsheetId);
    var qrCodesSheet = spreadsheet.getSheetByName("Agroverse QR codes");
    
    if (!qrCodesSheet) {
      Logger.log("⚠️  'Agroverse QR codes' sheet not found");
      return 0;
    }
    
    // Get all data from the sheet
    var lastRow = qrCodesSheet.getLastRow();
    if (lastRow < 2) {
      Logger.log("⚠️  No data in 'Agroverse QR codes' sheet");
      return 0;
    }
    
    var dataRange = qrCodesSheet.getRange(2, 1, lastRow - 1, 4); // Start from row 2, get columns A-D
    var values = dataRange.getValues();
    
    var count = 0;
    
    // Iterate through rows
    for (var i = 0; i < values.length; i++) {
      var row = values[i];
      var url = row[2]; // Column C (0-indexed, so C = index 2)
      var status = row[3]; // Column D (0-indexed, so D = index 3)
      
      // Check if status is "sold" (case-insensitive)
      if (status && status.toString().toLowerCase() === "sold") {
        // Check if URL ends with the shipment ID
        var urlString = url ? url.toString().toLowerCase() : "";
        if (urlString.endsWith("/" + normalizedId) || urlString.endsWith(normalizedId)) {
          count++;
        }
      }
    }
    
    Logger.log("Found " + count + " sold QR codes for shipment: " + shipmentId);
    return count;
    
  } catch (error) {
    Logger.log("❌ Error getting sold QR codes count: " + error.message);
    return 0;
  }
}

/**
 * DIAGNOSTIC FUNCTION: Check why Performance Statistics is not updating
 * 
 * This function checks:
 * 1. If the Performance Statistics sheet exists
 * 2. What keys are currently in the sheet
 * 3. What values should be there based on current calculations
 * 4. Which values are missing or outdated
 * 
 * CALL THIS FUNCTION FIRST to diagnose the issue
 * 
 * @return {Object} Diagnostic report
 */
function diagnosePerformanceStatistics() {
  Logger.log("🔍 Starting Performance Statistics diagnostic...");
  
  var report = {
    sheetExists: false,
    sheetHasData: false,
    currentKeys: [],
    expectedKeys: [],
    missingKeys: [],
    outdatedValues: [],
    updated: [],
    errors: []
  };
  
  try {
    // Check if sheet exists
    var spreadsheet = SpreadsheetApp.openById(ledgerDocId);
    var sheet = spreadsheet.getSheetByName(PERFORMANCE_STATISTICS_SHEET_NAME);
    
    if (!sheet) {
      report.errors.push("❌ Performance Statistics sheet does not exist!");
      Logger.log("❌ Sheet '" + PERFORMANCE_STATISTICS_SHEET_NAME + "' not found");
      return report;
    }
    
    report.sheetExists = true;
    Logger.log("✅ Sheet exists");
    
    // Get current keys from sheet
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      report.errors.push("⚠️  Sheet exists but has no data rows");
      Logger.log("⚠️  Sheet has no data rows");
      return report;
    }
    
    report.sheetHasData = true;
    
    var dataRange = sheet.getRange(2, 1, lastRow - 1, 6);
    var values = dataRange.getValues();
    
    var currentStats = {};
    for (var i = 0; i < values.length; i++) {
      var key = values[i][0];
      if (key) {
        report.currentKeys.push(key);
        currentStats[key] = {
          value: values[i][2],
          currency: values[i][3],
          updatedDate: values[i][4],
          row: i + 2
        };
      }
    }
    
    Logger.log("📊 Current keys in sheet: " + report.currentKeys.join(", "));
    
    // Calculate expected values
    var expectedStats = {};
    
    try {
      var treasuryBalance = getOffChainAssetValue() + getUSDTBalanceInVault() + getInvestmentHoldingsInAGL();
      expectedStats["USD_TREASURY_BALANCE"] = { value: treasuryBalance, currency: "USD" };
      Logger.log("✅ Calculated USD_TREASURY_BALANCE: " + treasuryBalance);
      
      // Update USD_TREASURY_BALANCE in Performance Statistics sheet
      try {
        updatePerformanceStatistic("USD_TREASURY_BALANCE", treasuryBalance, "USD");
        Logger.log("✅ Updated USD_TREASURY_BALANCE in Performance Statistics: " + treasuryBalance);
        report.updated = report.updated || [];
        report.updated.push({ key: "USD_TREASURY_BALANCE", value: treasuryBalance });
      } catch (updateError) {
        Logger.log("⚠️  Calculated value but failed to update sheet: " + updateError.message);
        report.errors.push("Error updating USD_TREASURY_BALANCE in sheet: " + updateError.message);
      }
    } catch (e) {
      report.errors.push("Error calculating USD_TREASURY_BALANCE: " + e.message);
    }
    
    try {
      var tdgIssued = getTdgTokensIssued();
      expectedStats["TDG_ISSUED"] = { value: tdgIssued, currency: "TDG" };
      Logger.log("✅ Calculated TDG_ISSUED: " + tdgIssued);
    } catch (e) {
      report.errors.push("Error calculating TDG_ISSUED: " + e.message);
    }
    
    try {
      var assetPerTdg = calculateAssetPerIssuedTdg();
      expectedStats["ASSET_PER_TDG_ISSUED"] = { value: assetPerTdg, currency: "USD" };
      Logger.log("✅ Calculated ASSET_PER_TDG_ISSUED: " + assetPerTdg);
    } catch (e) {
      report.errors.push("Error calculating ASSET_PER_TDG_ISSUED: " + e.message);
    }
    
    try {
      var sales30Days = get30DaysSales();
      expectedStats["PAST_30_DAYS_SALES"] = { value: sales30Days, currency: "USD" };
      Logger.log("✅ Calculated PAST_30_DAYS_SALES: " + sales30Days);
    } catch (e) {
      report.errors.push("Error calculating PAST_30_DAYS_SALES: " + e.message);
    }
    
    try {
      var assetPerTdg = getAssetPerIssuedTdgBalanceOnWix ? getAssetPerIssuedTdgBalanceOnWix() : calculateAssetPerIssuedTdg();
      var treasuryYield = getUSTreasuryYield();
      var dailySalesAverage = sales30Days / 30;
      var adjustedPrice = Math.min(assetPerTdg, 1 - treasuryYield / 100);
      var dailyBudget = dailySalesAverage * adjustedPrice;
      expectedStats["TDG_DAILY_BUY_BACK_BUDGET"] = { value: dailyBudget, currency: "USD" };
      Logger.log("✅ Calculated TDG_DAILY_BUY_BACK_BUDGET: " + dailyBudget);
    } catch (e) {
      report.errors.push("Error calculating TDG_DAILY_BUY_BACK_BUDGET: " + e.message);
    }
    
    try {
      var treasuryYield = getUSTreasuryYield();
      expectedStats["USD_TREASURY_YIELD_1_MONTH"] = { value: treasuryYield, currency: "%" };
      Logger.log("✅ Calculated USD_TREASURY_YIELD_1_MONTH: " + treasuryYield);
    } catch (e) {
      report.errors.push("Error calculating USD_TREASURY_YIELD_1_MONTH: " + e.message);
    }
    
    report.expectedKeys = Object.keys(expectedStats);
    Logger.log("📋 Expected keys: " + report.expectedKeys.join(", "));
    
    // Find missing keys
    for (var key in expectedStats) {
      if (!currentStats[key]) {
        report.missingKeys.push(key);
        Logger.log("⚠️  Missing key: " + key);
      } else {
        // Check if value is outdated (more than 1 day old or different)
        var currentValue = currentStats[key].value;
        var expectedValue = expectedStats[key].value;
        var isOutdated = false;
        
        if (currentValue != expectedValue) {
          isOutdated = true;
          Logger.log("⚠️  Outdated value for " + key + ": current=" + currentValue + ", expected=" + expectedValue);
        }
        
        if (isOutdated) {
          report.outdatedValues.push({
            key: key,
            current: currentValue,
            expected: expectedValue,
            row: currentStats[key].row
          });
        }
      }
    }
    
    Logger.log("✅ Diagnostic complete!");
    Logger.log("Summary:");
    Logger.log("  - Sheet exists: " + report.sheetExists);
    Logger.log("  - Sheet has data: " + report.sheetHasData);
    Logger.log("  - Current keys: " + report.currentKeys.length);
    Logger.log("  - Expected keys: " + report.expectedKeys.length);
    Logger.log("  - Missing keys: " + report.missingKeys.length);
    Logger.log("  - Outdated values: " + report.outdatedValues.length);
    Logger.log("  - Updated during diagnostic: " + (report.updated ? report.updated.length : 0));
    Logger.log("  - Errors: " + report.errors.length);
    
    return report;
    
  } catch (error) {
    report.errors.push("Fatal error: " + error.message);
    Logger.log("❌ Fatal error in diagnostic: " + error.message);
    return report;
  }
}

/**
 * SYNC FUNCTION: Update all Performance Statistics directly from Google Sheets calculations
 * 
 * This function calculates all values from Google Sheets and updates Performance Statistics
 * WITHOUT going through Wix. Use this to sync all values at once.
 * 
 * CALL THIS FUNCTION to update all Performance Statistics values
 * 
 * @return {Object} Sync report with updated keys and values
 */
function syncAllPerformanceStatistics() {
  Logger.log("🔄 Starting sync of all Performance Statistics...");
  
  var report = {
    updated: [],
    errors: [],
    skipped: []
  };
  
  try {
    // 1. USD_TREASURY_BALANCE
    try {
      var treasuryBalance = getOffChainAssetValue() + getUSDTBalanceInVault() + getInvestmentHoldingsInAGL();
      updatePerformanceStatistic("USD_TREASURY_BALANCE", treasuryBalance, "USD");
      report.updated.push({ key: "USD_TREASURY_BALANCE", value: treasuryBalance });
      Logger.log("✅ Updated USD_TREASURY_BALANCE: " + treasuryBalance);
    } catch (e) {
      report.errors.push({ key: "USD_TREASURY_BALANCE", error: e.message });
      Logger.log("❌ Error updating USD_TREASURY_BALANCE: " + e.message);
    }
    
    // 2. TDG_ISSUED
    try {
      var tdgIssued = getTdgTokensIssued();
      updatePerformanceStatistic("TDG_ISSUED", tdgIssued, "TDG");
      report.updated.push({ key: "TDG_ISSUED", value: tdgIssued });
      Logger.log("✅ Updated TDG_ISSUED: " + tdgIssued);
    } catch (e) {
      report.errors.push({ key: "TDG_ISSUED", error: e.message });
      Logger.log("❌ Error updating TDG_ISSUED: " + e.message);
    }
    
    // 3. ASSET_PER_TDG_ISSUED
    try {
      var assetPerTdg = calculateAssetPerIssuedTdg();
      updatePerformanceStatistic("ASSET_PER_TDG_ISSUED", assetPerTdg, "USD");
      report.updated.push({ key: "ASSET_PER_TDG_ISSUED", value: assetPerTdg });
      Logger.log("✅ Updated ASSET_PER_TDG_ISSUED: " + assetPerTdg);
    } catch (e) {
      report.errors.push({ key: "ASSET_PER_TDG_ISSUED", error: e.message });
      Logger.log("❌ Error updating ASSET_PER_TDG_ISSUED: " + e.message);
    }
    
    // 4. PAST_30_DAYS_SALES
    try {
      var sales30Days = get30DaysSales();
      updatePerformanceStatistic("PAST_30_DAYS_SALES", sales30Days, "USD");
      report.updated.push({ key: "PAST_30_DAYS_SALES", value: sales30Days });
      Logger.log("✅ Updated PAST_30_DAYS_SALES: " + sales30Days);
    } catch (e) {
      report.errors.push({ key: "PAST_30_DAYS_SALES", error: e.message });
      Logger.log("❌ Error updating PAST_30_DAYS_SALES: " + e.message);
    }
    
    // 5. TDG_DAILY_BUY_BACK_BUDGET
    try {
      var sales30Days = get30DaysSales();
      var assetPerTdg = calculateAssetPerIssuedTdg();
      var treasuryYield = getUSTreasuryYield();
      var dailySalesAverage = sales30Days / 30;
      var adjustedPrice = Math.min(assetPerTdg, 1 - treasuryYield / 100);
      var dailyBudget = dailySalesAverage * adjustedPrice;
      updatePerformanceStatistic("TDG_DAILY_BUY_BACK_BUDGET", dailyBudget, "USD");
      report.updated.push({ key: "TDG_DAILY_BUY_BACK_BUDGET", value: dailyBudget });
      Logger.log("✅ Updated TDG_DAILY_BUY_BACK_BUDGET: " + dailyBudget);
    } catch (e) {
      report.errors.push({ key: "TDG_DAILY_BUY_BACK_BUDGET", error: e.message });
      Logger.log("❌ Error updating TDG_DAILY_BUY_BACK_BUDGET: " + e.message);
    }
    
    // 6. USD_TREASURY_YIELD_1_MONTH
    try {
      var treasuryYield = getUSTreasuryYield();
      updatePerformanceStatistic("USD_TREASURY_YIELD_1_MONTH", treasuryYield, "%");
      report.updated.push({ key: "USD_TREASURY_YIELD_1_MONTH", value: treasuryYield });
      Logger.log("✅ Updated USD_TREASURY_YIELD_1_MONTH: " + treasuryYield);
    } catch (e) {
      report.errors.push({ key: "USD_TREASURY_YIELD_1_MONTH", error: e.message });
      Logger.log("❌ Error updating USD_TREASURY_YIELD_1_MONTH: " + e.message);
    }
    
    Logger.log("✅ Sync complete!");
    Logger.log("Summary:");
    Logger.log("  - Updated: " + report.updated.length + " keys");
    Logger.log("  - Errors: " + report.errors.length);
    Logger.log("  - Skipped: " + report.skipped.length);
    
    return report;
    
  } catch (error) {
    report.errors.push({ key: "SYNC", error: error.message });
    Logger.log("❌ Fatal error in sync: " + error.message);
    return report;
  }
}