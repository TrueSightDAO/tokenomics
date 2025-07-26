const creds = getCredentials();
var wixAccessToken =  creds.WIX_API_KEY;

// Site IDs
function getAgroverseSiteId() { // Agroverse
  return "508217b2-8792-4ab2-b733-2784b4886a9c";
}

function getTrueSightSiteId() { // TrueSight
  return "d45a189f-d0cc-48de-95ee-30635a95385f";
}

// Request header with configurable site ID
function getWixRequestHeader(siteId) {
  var options = {
    "method": "GET",
    "headers": {
      "Content-Type": "application/json",
      "Authorization": wixAccessToken,
      "wix-account-id": "0e2cde5f-b353-468b-9f4e-36835fc60a0e",
      "wix-site-id": siteId
    }
  };
  return options;
}

// Get count of published events from Wix Events API (Agroverse)
function getPublishedEventsCount() {
  var options = getWixRequestHeader(getAgroverseSiteId());
  options.method = "POST";
  
  var payload = {
    "query": {
      "filter": {
        "status": "PUBLISHED"
      },
      "paging": {
        "limit": 1000
      }
    }
  };
  
  options.payload = JSON.stringify(payload);
  
  var request_url = "https://www.wixapis.com/events/v1/events/query";
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  Logger.log("Events API Response (Agroverse): " + content);

  var response_obj = JSON.parse(content);
  var totalCount = response_obj.total;
  Logger.log("Total Published Events (Agroverse): " + totalCount);
  return totalCount;
}

// Get current data item from Statistics collection (Agroverse)
function getCurrentDataItem(dataItemId) {
  var options = getWixRequestHeader(getAgroverseSiteId());
  var dataCollectionId = "Statistics";
  var request_url = "https://www.wixapis.com/wix-data/v2/items/" + dataItemId + "?dataCollectionId=" + dataCollectionId;
  
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  var response_obj = JSON.parse(content);
  Logger.log(response_obj.dataItem.data);
  return response_obj.dataItem.data;
}

// Update Statistics collection with value while preserving existing fields (Agroverse)
function updateStatisticsCollection(value, dataItemId, fieldName) {
  var options = getWixRequestHeader(getAgroverseSiteId());
  var dataCollectionId = "Statistics";
  
  // Get current data to preserve existing fields
  var currentData = getCurrentDataItem(dataItemId);
  
  var payload = {
    "dataCollectionId": dataCollectionId,
    "dataItem": {
      "data": {
        "_id": dataItemId,
        "_owner": "0e2cde5f-b353-468b-9f4e-36835fc60a0e",
        "VALUE": value,
        "FIELD_NAME": fieldName,
        "HEADER": currentData.HEADER || "EMPTY HEADER",
        "DESCRIPTION": currentData.DESCRIPTION || "EMPTY DESCRIPTION",
        "ICON": currentData.ICON || "EMPTY ICON",
        "ORDER": currentData.ORDER || "EMPTY ORDER"
      }
    }
  };

  options.payload = JSON.stringify(payload);
  options.method = 'PUT';

  var request_url = "https://www.wixapis.com/wix-data/v2/items/" + dataItemId;
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  var response_obj = JSON.parse(content);
  Logger.log("Updated Statistics Collection (Agroverse, Item " + dataItemId + "): VALUE = " + value + ", FIELD_NAME = " + fieldName);
}

// Verify the updated value (Agroverse)
function getValueFromCollection(dataItemId) {
  var options = getWixRequestHeader(getAgroverseSiteId());
  var dataCollectionId = "Statistics";
  var request_url = "https://www.wixapis.com/wix-data/v2/items/" + dataItemId + "?dataCollectionId=" + dataCollectionId;
  
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  var response_obj = JSON.parse(content);
  Logger.log("Current Value (Agroverse, Item " + dataItemId + "): " + response_obj.dataItem.data.VALUE + " (" + response_obj.dataItem.data.FIELD_NAME + ")");
  return response_obj.dataItem.data.VALUE;
}

// Get sum of cacao_kg from AgroverseShipments (TrueSight), excluding SUSPENDED shipments
function getCacaoKgTotal() {
  var options = getWixRequestHeader(getTrueSightSiteId());
  options.method = "POST";
  
  var payload = {
    "query": {
      "filter": {
        "shipment_status": {
          "$ne": "SUSPENDED"
        }
      },
      "paging": {
        "limit": 1000
      }
    }
  };
  
  options.payload = JSON.stringify(payload);
  
  var request_url = "https://www.wixapis.com/wix-data/v2/items/query?dataCollectionId=AgroverseShipments";
  var response = UrlFetchApp.fetch(request_url, options);
  var content = response.getContentText();
  
  var response_obj = JSON.parse(content);
  var totalCacaoKg = response_obj.dataItems.reduce((sum, item) => {
    Logger.log("AgroverseShipments Item (TrueSight) - Status: " + item.data.shipment_status + ", Cacao KG: " + item.data.cacao_kg);
    return sum + (item.data.cacao_kg * 1 || 0);
  }, 0);
  
  Logger.log("Total Cacao KG (TrueSight, excluding SUSPENDED): " + totalCacaoKg);
  return totalCacaoKg;
}

// New function to get count of rows where status = SOLD from Agroverse QR codes Google Sheet
function getSoldRowsCount() {
  var spreadsheetId = "1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU";
  var sheetName = "Agroverse QR codes";
  var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  var sheet = spreadsheet.getSheetByName(sheetName);
  var data = sheet.getDataRange().getValues();
  
  // Assuming Column D (index 3) is 'status'
  var soldCount = data.slice(1).filter(row => row[3] === "SOLD" || row[3] === "ASSIGNED_TO_TREE").length; // Skip header row
  Logger.log("Total SOLD Rows (Agroverse QR codes): " + soldCount);
  return soldCount;
}

// Main function to execute the process
function updateStatistics() {
  try {
    // Get the count of published events from Agroverse
    var publishedEventsCount = getPublishedEventsCount();
    
    // Update events count on Agroverse
    updateStatisticsCollection(publishedEventsCount, "aa763e84-4e24-4e43-ba13-0b7129be5351", "CACAO_CIRCLE");
    
    // Get total cacao kg from TrueSight
    var totalCacaoKg = getCacaoKgTotal();
    
    // Update cacao_kg on Agroverse
    updateStatisticsCollection(totalCacaoKg, "55135f73-903c-4551-b511-2a8f22a1ec59", "CACAO_KG");
    
    // Get count of SOLD rows from Agroverse QR codes Google Sheet
    var soldRowsCount = getSoldRowsCount();
    
    // Update TREES_FINANCED on Agroverse (replace with actual dataItemId)
    updateStatisticsCollection(soldRowsCount, "2d031e89-3418-469f-b47d-97c2a4b6425b", "TREES_FINANCED");
    
    // Update hectares (cacao_kg / 1000, rounded to 3 decimal places) on Agroverse
    var hectares = (soldRowsCount / 1000).toFixed(3) * 1;
    updateStatisticsCollection(hectares, "8350b66e-0fdd-4b91-ba14-7eaf1893f824", "HECTARES");

    // Verify all updates on Agroverse
    getValueFromCollection("aa763e84-4e24-4e43-ba13-0b7129be5351");
    getValueFromCollection("55135f73-903c-4551-b511-2a8f22a1ec59");
    getValueFromCollection("8350b66e-0fdd-4b91-ba14-7eaf1893f824");
    getValueFromCollection("2d031e89-3418-469f-b47d-97c2a4b6425b");

  } catch (error) {
    Logger.log("Error: " + error.message);
  }
}