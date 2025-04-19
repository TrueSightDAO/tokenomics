const creds = getCredentials();

var wixAccessToken = creds.WIX_API_KEY;

var ledgerDocId = "1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU";
var offChainAssetBalanceTab = SpreadsheetApp.openById(ledgerDocId).getSheetByName("off chain asset balance");
var offTransactionsTab = SpreadsheetApp.openById(ledgerDocId).getSheetByName("offchain transactions");
var tdgIssuedBalanceTab = SpreadsheetApp.openById(ledgerDocId).getSheetByName("Ledger history");

function updateTotalDAOAssetOnWix() {
  var full_asset_value = getOffChainAssetValue() + getUSDTBalanceInVault();
  Logger.log("Full amount of Asset in USD value managed off chain: " + full_asset_value);      

  setAssetBalanceOnWix( full_asset_value);
  getAssetBalanceOnWix();
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

function getUSDTBalanceInVault() {
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
        "LATOKEN_TOKEN"
      ]
    }

    options.payload = JSON.stringify(payload);

    var request_url = "https://side-clean-replica.solana-mainnet.quiknode.pro/0fe3dc035c4a206089b9407036a56a5fe7bf989f/";
    var response = UrlFetchApp.fetch(request_url, options);     

    var response = UrlFetchApp.fetch(request_url, options);
    var content = response.getContentText();
    var response_obj = JSON.parse(content);  
    // Logger.log(response_obj);      
    Logger.log("Amount of USDT in vault: " + response_obj.result.value.uiAmount);      

    return response_obj.result.value.uiAmount;
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

  // Logger.log("The Final Payload");
  // Logger.log(options);

  var request_url = "https://www.wixapis.com/wix-data/v2/items/" + getWixAssetBalanceDataItemId();  
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  var response_obj = JSON.parse(content);  
  // Logger.log(response_obj);  

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
  var total_assets = getOffChainAssetValue();
  var total_tdg_issed = getTdgTokensIssued();
  var net_assets_per_issued_tdg = total_assets/total_tdg_issed;
  Logger.log("Calculated Net Assets Per TDG issued: " + net_assets_per_issued_tdg);    
  return total_assets/total_tdg_issed;
}

function getAssetPerIssuedTdgBalanceOnWix() {
  var options = getWixRequestHeader();
  var request_url = "https://www.wixapis.com/wix-data/v2/items/" + getWixAssetPerIssuedTdgDataItemId() + "?dataCollectionId=" + getWixDataCollectionId();  
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  var response_obj = JSON.parse(content);  
  // Logger.log(response_obj);  
  Logger.log("Asset per issued TDG on Wix: " + response_obj.dataItem.data.exchangeRate);  
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


function getUSTreasuryYield() {
  var treasury_yield_url = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=" + new Date().getFullYear();
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
    // Logger.log(entry_child_nodes[i].getName()); 
    if (entry_child_nodes[i].getName() == "content" && !content) {
      content = entry_child_nodes[i];
    }    
  }

  var interest_rate_date = content.getChildren()[0].getChildren()[0].getValue();
  var interest_rate = content.getChildren()[0].getChildren()[1].getValue() * 1;
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
  var tdgPrice = getTdgUsdtPriceLaToken();
  var treasuryYield = getUSTreasuryYield();
  
  // Formula: (Last 30 days sales / 30) * min(TDG price, 1 - Treasury yield)
  var dailySalesAverage = last30DaysSales / 30;
  Logger.log("Daily sales average: " + dailySalesAverage);
  var adjustedPrice = Math.min(tdgPrice, 1 - treasuryYield / 100);
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
}

// Method to get the daily TDG buy-back budget
function getDailyTdgBuyBackBudget() {
  var options = getWixRequestHeader();
  var request_url = "https://www.wixapis.com/wix-data/v2/items/" + getWixDailyTdgBuyBackBudgetDataItemId() + "?dataCollectionId=" + getWixDataCollectionId();  
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  var response_obj = JSON.parse(content);  
  Logger.log("Daily TDG Buy Back Budget on Wix: " + response_obj.dataItem.data.exchangeRate);  
  return response_obj.dataItem.data.exchangeRate;
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