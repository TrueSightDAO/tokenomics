var wixAccessToken = "IST.eyJraWQiOiJQb3pIX2FDMiIsImFsZyI6IlJTMjU2In0.eyJkYXRhIjoie1wiaWRcIjpcImYyNGZjZWY4LTljZDctNGE2ZS04NzdmLThlOWJkOThkZTk5Y1wiLFwiaWRlbnRpdHlcIjp7XCJ0eXBlXCI6XCJhcHBsaWNhdGlvblwiLFwiaWRcIjpcIjQ4MjU1ZDA5LWI5NTUtNGUwNi1iZjYxLTAyN2NiZThkN2MzNFwifSxcInRlbmFudFwiOntcInR5cGVcIjpcImFjY291bnRcIixcImlkXCI6XCIwZTJjZGU1Zi1iMzUzLTQ2OGItOWY0ZS0zNjgzNWZjNjBhMGVcIn19IiwiaWF0IjoxNzIxMzIwNTU5fQ.cLoxDKW5m4TYXdR-820GwrKrOkfkk_8OJZy956XOSwOQ4i1RqE9XjrHOFuZyhiq6FR0Hxy8ZJxmBB_1oTuA09nuYnhrMDJjevBDK0sVqQCCg4bTX1LF65VABEIj7WBCVcklhelmrc_X9_6J09whC8Al-D6Ttq_i-cCGh97EqFqqcQilSz9LjrL7jiMgpYMabjRYEP9FmzPseOXSv_HjU9zxgYzHhdHltENYq5dQiYJIDLbOu4Pp3YU52FtZUd4yrWDhqryjZ_QCtR1ygRI6153xnBRt-WqrD63XhEMiNpTIY7ZDwfuUfS9SFHj8vucp1MCgxgp9DCliDKxavFf-B1g";

function updateWixLandingPagePrice() {
  getCurrentTdgExchangeRateOnWix();
  var latest_price = getTdgUsdtPriceLaToken();
  setTdgExchangeRateOnWix(latest_price);

  Logger.log("==== Exchange rate update value on Wix completed ====\n\n");  
  getCurrentTdgExchangeRateOnWix();
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

function getCurrentTdgExchangeRateOnWix() {
  var options = getWixRequestHeader();
  var request_url = "https://www.wixapis.com/wix-data/v2/items/" + getWixDataItemId() + "?dataCollectionId=" + getWixDataCollectionId();  
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  var response_obj = JSON.parse(content);  
  // Logger.log(response_obj);  
  Logger.log("The current exchange rate on Wix: " + response_obj.dataItem.data.exchangeRate);  
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

function getWixDataItemId() {
  return "86becd2f-1563-4218-a579-e2529ef4480c";
}
