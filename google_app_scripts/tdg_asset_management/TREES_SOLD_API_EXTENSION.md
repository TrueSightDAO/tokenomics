# Trees Sold Statistics API Extension

## Overview
Extend `tdg_wix_dashboard.gs` to return sold QR code counts (trees sold) for a given shipment ID (AGL code like AGL1, SEF1, etc.).

## Implementation

### 1. Add Function to Get Sold QR Code Count

Add this function to `tdg_wix_dashboard.gs`:

```javascript
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
    // NOTE: Update this spreadsheet ID if it's different from ledgerDocId
    var qrCodesSpreadsheetId = ledgerDocId; // Or use a different ID if QR codes are in a different sheet
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
        if (url && url.toString().toLowerCase().endsWith("/" + normalizedId)) {
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
```

### 2. Extend doGet to Accept Shipment ID Parameter

Modify the `doGet` function to handle shipment ID queries:

```javascript
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
    
    return ContentService
      .createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
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
```

### 3. API Usage

**Get trees sold for a shipment:**
```
GET https://script.google.com/macros/s/AKfycbzlfOBo9UqKOh7jIqGcmbPAMM1RxCbsJHb-UV_vM6VbvK_HSdT44KyGbbXIeo-_Ovfy/exec?shipmentId=AGL8
```

**Response:**
```json
{
  "timestamp": "2025-01-27T12:00:00.000Z",
  "shipmentId": "AGL8",
  "treesSold": 42
}
```

**Get all performance statistics (existing behavior):**
```
GET https://script.google.com/macros/s/AKfycbzlfOBo9UqKOh7jIqGcmbPAMM1RxCbsJHb-UV_vM6VbvK_HSdT44KyGbbXIeo-_Ovfy/exec
```

## Frontend Integration

Update individual shipment/pledge pages to fetch and display trees sold dynamically.

### JavaScript to Add to Generated Pages

```javascript
// Fetch trees sold count dynamically
async function loadTreesSold(shipmentId) {
  try {
    const serviceUrl = 'https://script.google.com/macros/s/AKfycbzlfOBo9UqKOh7jIqGcmbPAMM1RxCbsJHb-UV_vM6VbvK_HSdT44KyGbbXIeo-_Ovfy/exec';
    const response = await fetch(`${serviceUrl}?shipmentId=${encodeURIComponent(shipmentId)}`);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      console.warn('Error fetching trees sold:', data.message);
      return null;
    }
    
    return data.treesSold || 0;
    
  } catch (error) {
    console.warn('Error fetching trees sold count:', error);
    return null;
  }
}

// Update the trees sold display
document.addEventListener('DOMContentLoaded', function() {
  const shipmentId = 'AGL8'; // Extract from page context or URL
  const treesSoldElement = document.querySelector('[data-trees-sold]');
  
  if (treesSoldElement) {
    loadTreesSold(shipmentId).then(function(count) {
      if (count !== null) {
        treesSoldElement.textContent = count;
        treesSoldElement.classList.add('loaded'); // Optional: add loaded class for styling
      }
    });
  }
});
```

## Benefits

1. ✅ **Real-time Updates**: Count updates automatically when QR codes are marked as sold
2. ✅ **No Page Regeneration**: Pages don't need to be regenerated when sales happen
3. ✅ **Single Source of Truth**: Uses the same "Agroverse QR codes" sheet
4. ✅ **Backward Compatible**: Existing doGet behavior (performance statistics) still works
5. ✅ **Flexible**: Can be extended to return more shipment statistics

## Next Steps

1. Add the functions to `tdg_wix_dashboard.gs`
2. Update `generate-shipment-pages.js` to include the dynamic loading script
3. Add `data-trees-sold` attribute to the trees count element in generated pages
4. Test with a known shipment ID




