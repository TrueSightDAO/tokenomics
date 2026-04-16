/**
 * Apps Script editor:
 * N/A — deprecated reference only (not bound to a live clasp project).
 * Index of live projects: tokenomics/clasp_mirrors/PROJECT_INDEX.md
 * DEPRECATED - Wix Landing Page Price Update Script
 * 
 * This script was used to update TDG exchange rate on Wix landing page using LATOKEN exchange prices.
 * 
 * STATUS: DEPRECATED - DO NOT EXECUTE
 * - Wix integration is no longer used
 * - LATOKEN market making is on hold (see tokenomics/README.md)
 * - LATOKEN API returns 503 Service Unavailable errors
 * - This code is preserved for reference only
 * 
 * ERROR OBSERVED:
 * Exception: Request failed for https://api.latoken.com returned code 503.
 * Truncated server response: {"message":"service unavailable","error":"SERVICE_UNAVAILABLE","status":"FAILURE"}
 * 
 * Original location: Google Apps Script platform (time-based trigger)
 * Date archived: 2026-02-17
 * 
 * This script caused 503 errors from LATOKEN API and should not be executed.
 * The function updateWixLandingPagePrice() calls getTdgUsdtPriceLaToken() which hits LATOKEN API.
 * 
 * ACTION REQUIRED:
 * 1. Disable the time-based trigger for updateWixLandingPagePrice() in Google Apps Script
 * 2. Go to: Apps Script Editor > Triggers (clock icon) > Delete trigger for updateWixLandingPagePrice
 * 
 * NOTE: Hardcoded Wix access token removed for security - use getCredentials() pattern if needed.
 */

// Wix API key - REMOVED: Use getCredentials() pattern instead
// var wixAccessToken = "[REMOVED - Use getCredentials().WIX_API_KEY]";

/**
 * Updates TDG exchange rate on Wix landing page using LATOKEN price.
 * 
 * DEPRECATED - Do not execute. LATOKEN API returns 503 errors.
 */
function updateWixLandingPagePrice() {
  getCurrentTdgExchangeRateOnWix();
  var latest_price = getTdgUsdtPriceLaToken();
  setTdgExchangeRateOnWix(latest_price);

  Logger.log("==== Exchange rate update value on Wix completed ====\n\n");  
  getCurrentTdgExchangeRateOnWix();
}

/**
 * Get TDG/USDT price from LATOKEN Exchange.
 * 
 * DEPRECATED - LATOKEN API returns 503 Service Unavailable errors.
 * This function should not be called.
 * 
 * @return {number} The TDG/USDT price from LATOKEN (or throws 503 error)
 */
function getTdgUsdtPriceLaToken() {
  var tdg_id = "cbfd4c19-259c-420b-9bb2-498493265648";
  var usdt_id = "0c3a106d-bde3-4c13-a26e-3fd2394529e5";
  var request_url = "https://api.latoken.com/v2/ticker/" + tdg_id + "/" + usdt_id;
  Logger.log(request_url );
  
  // NOTE: This call fails with 503 Service Unavailable
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
 * Sets TDG exchange rate on Wix.
 * 
 * DEPRECATED - Wix integration no longer used.
 */
function setTdgExchangeRateOnWix( latoken_last_price) {
  var options = getWixRequestHeader();  
  var payload = {
    "dataCollectionId": "ExchangeRate",
    "dataItem": {
      "data": {
        "description": "USDT_EXCHANGE_RATE_LATOKENS",
        "_id": getWixDataItemId(),
        "_owner": "0e2cde5f-b353-468b-9f4e-36835fc60a0e",
        "exchangeRate": latoken_last_price,
        "currency": "USDT"
      }
    }
  }

  options.payload = JSON.stringify(payload);
  options.method = 'PUT';

  // Logger.log("The Final Payload");
  // Logger.log(options);

  var request_url = "https://www.wixapis.com/wix-data/v2/items/" + getWixDataItemId();  
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  var response_obj = JSON.parse(content);  
  // Logger.log(response_obj);  

}

/**
 * Gets current TDG exchange rate from Wix.
 * 
 * DEPRECATED - Wix integration no longer used.
 */
function getCurrentTdgExchangeRateOnWix() {
  var options = getWixRequestHeader();
  var request_url = "https://www.wixapis.com/wix-data/v2/items/" + getWixDataItemId() + "?dataCollectionId=" + getWixDataCollectionId();  
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  var response_obj = JSON.parse(content);  
  // Logger.log(response_obj);  
  Logger.log("The current exchange rate on Wix: " + response_obj.dataItem.data.exchangeRate);  
}

/**
 * Gets Wix API request headers.
 * 
 * DEPRECATED - Wix integration no longer used.
 * NOTE: wixAccessToken should use getCredentials().WIX_API_KEY pattern.
 */
function getWixRequestHeader() {
  var options = {
    //  "async": true,
    //  "crossDomain": true,
     "method" : "GET",
     "headers" : {
        "Content-Type" : "application/json",
        "Authorization" : "[REMOVED - Use getCredentials().WIX_API_KEY]",
        "wix-account-id" : "0e2cde5f-b353-468b-9f4e-36835fc60a0e",
        "wix-site-id": "d45a189f-d0cc-48de-95ee-30635a95385f"       
      //  "cache-control": "no-cache"
     }
  };

  return options;
}

/**
 * Gets Wix ExchangeRate collection ID.
 * 
 * @return {string} The ExchangeRate collection ID
 */
function getWixDataCollectionId() {
  return "ExchangeRate";
}

/**
 * Gets Wix data item ID for TDG exchange rate.
 * 
 * @return {string} The data item ID
 */
function getWixDataItemId() {
  return "86becd2f-1563-4218-a579-e2529ef4480c";
}
