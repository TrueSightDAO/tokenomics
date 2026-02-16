/**
 * DEPRECATED - Wix Gas Fee Management Script
 * 
 * This script was used to set gas fees on Wix platform using LATOKEN exchange prices.
 * 
 * STATUS: DEPRECATED
 * - Wix integration is no longer used
 * - LATOKEN market making is on hold (see tokenomics/README.md)
 * - This code is preserved for reference only
 * 
 * Original location: Google Apps Script platform
 * Date archived: 2026-02-16
 * 
 * This script caused 503 errors from LATOKEN API and should not be executed.
 * The function setEcosystemGasFees() calls getTdgUsdtPriceLaToken() which hits LATOKEN API.
 */

var wixAccessToken = "IST.eyJraWQiOiJQb3pIX2FDMiIsImFsZyI6IlJTMjU2In0.eyJkYXRhIjoie1wiaWRcIjpcImYyNGZjZWY4LTljZDctNGE2ZS04NzdmLThlOWJkOThkZTk5Y1wiLFwiaWRlbnRpdHlcIjp7XCJ0eXBlXCI6XCJhcHBsaWNhdGlvblwiLFwiaWRcIjpcIjQ4MjU1ZDA5LWI5NTUtNGUwNi1iZjYxLTAyN2NiZThkN2MzNFwifSxcInRlbmFudFwiOntcInR5cGVcIjpcImFjY291bnRcIixcImlkXCI6XCIwZTJjZGU1Zi1iMzUzLTQ2OGItOWY0ZS0zNjgzNWZjNjBhMGVcIn19IiwiaWF0IjoxNzIxMzIwNTU5fQ.cLoxDKW5m4TYXdR-820GwrKrOkfkk_8OJZy956XOSwOQ4i1RqE9XjrHOFuZyhiq6FR0Hxy8ZJxmBB_1oTuA09nuYnhrMDJjevBDK0sVqQCCg4bTX1LF65VABEIj7WBCVcklhelmrc_X9_6J09whC8Al-D6Ttq_i-cCGh97EqFqqcQilSz9LjrL7jiMgpYMabjRYEP9FmzPseOXSv_HjU9zxgYzHhdHltENYq5dQiYJIDLbOu4Pp3YU52FtZUd4yrWDhqryjZ_QCtR1ygRI6153xnBRt-WqrD63XhEMiNpTIY7ZDwfuUfS9SFHj8vucp1MCgxgp9DCliDKxavFf-B1g";

var exchangeRateCollectionId = "ExchangeRate";
var agroverseTokenomicsCollectionId = "AgroverseTokenomics";


var gasFeeDataItemId = "33252bd3-13b1-469b-bb1a-18b3116e939e";

// 1 Ton
var manufacturingDataItemId = "d6cde782-d694-4f75-9c19-16bfd77c6e59"; 

var agroverseDirectManufacturerCollectionId = "AgroverseDirectManufacturerPurcha";
var manufacturing_tier_4 = "216c216d-5720-4cf2-8a3d-5928554a755a";
var manufacturing_tier_3 = "25def04f-1f80-42f8-bfeb-0b6187efa5e0";
var manufacturing_tier_2 = "9131275d-dbf4-413f-b258-3b2f146691f0";
var manufacturing_tier_1 = "6c8fd43f-34bd-4d4c-91e1-032eef0b6fd1";

var prefinancingDataItemId = "fab1548d-28bf-474c-a4b7-f9c6f9121942";

var gasFeeGoogleSheetId = "1cdE6s3EZBUb4A8H03Wb9yoeDkH5EOkbUb80pRan8BXY";
var GasFeeCalculationTab = SpreadsheetApp.openById(gasFeeGoogleSheetId).getSheetByName("Gas Fee Calculation");


function setEcosystemGasFees() {
  // var gas_fee = getComputedGasFeeOnGoogleSheet() ;
  var gas_fee = 0;
  // var us_treasury_yield = getUSTreasuryYield();
  var last_price_on_latoken = getTdgUsdtPriceLaToken();
  var computed_price_based_on_latoken = getTdgUsdtPriceLaToken() * 100;

  // Logger.log("Latest Treasury Yield: " + us_treasury_yield );
  Logger.log("Last Price on LATOKEN : " + last_price_on_latoken);
  Logger.log("Computed Price based on LATOKEN : " + computed_price_based_on_latoken);

  gas_fee = 100;
  if(computed_price_based_on_latoken < gas_fee ) {
    gas_fee = computed_price_based_on_latoken;
  }

  setCurrentGasFeeOnWix(gas_fee);  
  setManufacturingGasFeeOnWix(gas_fee);
  setPreFinanceGasFeeOnWix(gas_fee);

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


function getComputedGasFeeOnGoogleSheet() {
  var gas_fees = GasFeeCalculationTab.getRange(1,2).getValues().map(function(valueArray) {
    return valueArray[0] * 100;
  });
  var gas_fee = gas_fees[0]
  // gas_fee = Math.ceil(gas_fee * 1000) / 1000
  Logger.log("Tabulated Gas Fee on Google Sheet: " + gas_fee);  
  return gas_fee;  
}

function getCurrentGasFeeOnWix() {
  var options = getWixRequestHeader();
  var request_url = "https://www.wixapis.com/wix-data/v2/items/" + gasFeeDataItemId + "?dataCollectionId=" + exchangeRateCollectionId;  
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  var response_obj = JSON.parse(content);  
  // Logger.log(response_obj);  
  Logger.log("The current exchange rate on Wix: " + response_obj.dataItem.data.exchangeRate);  
  return response_obj.dataItem.data
}

function setCurrentGasFeeOnWix(new_gas_fee) {
  var options = getWixRequestHeader();  
  var original_data_obj = getCurrentGasFeeOnWix();
  original_data_obj.exchangeRate = new_gas_fee;
  var payload = {
    "dataCollectionId": exchangeRateCollectionId,
    "dataItem": {
      "data": original_data_obj
    }
  }

  options.payload = JSON.stringify(payload);
  options.method = 'PUT';

  var request_url = "https://www.wixapis.com/wix-data/v2/items/" + gasFeeDataItemId;  
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  var response_obj = JSON.parse(content); 

  var new_data_obj = getCurrentGasFeeOnWix();  
}

/****
 * Direct Manufacturer Purchases
 */

function getManufacturingTierDataItemId(tier_number) {
  
  switch(tier_number) {
    case 1: 
      // Logger.log("Returning " + manufacturing_tier_1);
      return manufacturing_tier_1;

    case 2: 
      // Logger.log("Returning " + manufacturing_tier_2);
      return manufacturing_tier_2;

    case 3: 
      // Logger.log("Returning " + manufacturing_tier_3);
      return manufacturing_tier_3;

    case 4: 
      // Logger.log("Returning " + manufacturing_tier_4);
      return manufacturing_tier_4;
  }
}

function getManufacturingTierGasFee(tier_number, base_gas_fee) {
  switch(tier_number) {
    case 1: return base_gas_fee * 10;

    case 2: return base_gas_fee * 7.5;

    case 3: return base_gas_fee * 5;

    case 4: return base_gas_fee;
  }
}

function getManufacturingGasFeeOnWix(tier_number) {
  var data_item_id = getManufacturingTierDataItemId(tier_number);
  Logger.log("Tier number: " +tier_number + " Data Item ID: " + data_item_id)
  
  var options = getWixRequestHeader();
  var request_url = "https://www.wixapis.com/wix-data/v2/items/" + data_item_id + "?dataCollectionId=" + agroverseDirectManufacturerCollectionId;  

  // Logger.log(request_url);
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  var response_obj = JSON.parse(content);  
  Logger.log("The current gas fee for direct manufacturer purchases tier " + tier_number + " on Wix: " + response_obj.dataItem.data.gas_fee_per_kg);
  return response_obj.dataItem.data
}

function setManufacturingGasFeeOnWix(new_gas_fee) {
  var options = getWixRequestHeader();  

  var pricing_tiers = [1,2,3,4];
  pricing_tiers.forEach(function(tier_number) {
    Logger.log("\n\nProcessing Tier number " + tier_number);
    var original_data_obj = getManufacturingGasFeeOnWix(tier_number);
    var new_tier_gas_fee = getManufacturingTierGasFee(tier_number, new_gas_fee)

    original_data_obj.gas_fee_per_kg = Math.ceil(new_tier_gas_fee * 1000) / 100000 ;

    var payload = {
      "dataCollectionId": agroverseDirectManufacturerCollectionId,
      "dataItem": {
        "data": original_data_obj
      }
    }

    options.payload = JSON.stringify(payload);
    options.method = 'PUT';

    var request_url = "https://www.wixapis.com/wix-data/v2/items/" + getManufacturingTierDataItemId(tier_number);  
    var response = UrlFetchApp.fetch(request_url, options);
    var content = response.getContentText();
    var response_obj = JSON.parse(content); 
    
    var new_data_obj = getManufacturingGasFeeOnWix(tier_number);  
  })

}



/****
 * Defi Pre-finance gas fees
 */


function getPreFinanceGasFeeOnWix() {
  var options = getWixRequestHeader();
  var request_url = "https://www.wixapis.com/wix-data/v2/items/" + prefinancingDataItemId + "?dataCollectionId=" + agroverseTokenomicsCollectionId;  
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  var response_obj = JSON.parse(content);  
  Logger.log("The current gas fee for defi pre-financed purchases on Wix: " + response_obj.dataItem.data.price);  
  return response_obj.dataItem.data
}

function setPreFinanceGasFeeOnWix(new_gas_fee) {
  var options = getWixRequestHeader();  
  var original_data_obj = getPreFinanceGasFeeOnWix();
  original_data_obj.price = Math.ceil(new_gas_fee * 1000) / 1000;

  var payload = {
    "dataCollectionId": agroverseTokenomicsCollectionId,
    "dataItem": {
      "data": original_data_obj
    }
  }

  options.payload = JSON.stringify(payload);
  options.method = 'PUT';

  var request_url = "https://www.wixapis.com/wix-data/v2/items/" + prefinancingDataItemId;  
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  var response_obj = JSON.parse(content); 
   
  var new_data_obj = getPreFinanceGasFeeOnWix();  
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

function test() {
  setManufacturingGasFeeOnWix(0.99);
}
