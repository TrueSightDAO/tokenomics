function fetchHelloCashArticles() {
  // Define API endpoint and authentication token
  var token = getApiKey();
  
  // Set up headers for the API request
  var headers = {
    "Authorization": "Bearer " + token,
    "Content-Type": "application/json",
    "Accept": "application/json"
  };
  
  // Set up options for the fetch request
  var options = {
    "method": "GET",
    "headers": headers,
    "muteHttpExceptions": true
  };
  
  try {
    var allArticles = [];
    var limit = 250;
    var offset = 1;
    var articles;
    
    do {
      var apiUrl = "https://api.hellocash.business/api/v1/articles?limit=" + limit + "&offset=" + offset + "&caid=&name=&code=";
      // Make the API request
      var response = UrlFetchApp.fetch(apiUrl, options);
      var responseCode = response.getResponseCode();
      var responseText = response.getContentText();
      
      Logger.log("Articles Response Code: " + responseCode);
      Logger.log("Articles Response Text: " + responseText);
      
      if (responseCode === 200) {
        // Parse the JSON response
        var json = JSON.parse(responseText);
        
        // Check for error in response
        if (json.error) {
          throw new Error("Articles API returned an error: " + json.error);
        }
        
        articles = json.articles || [];
        allArticles = allArticles.concat(articles);
        offset += 1;
      } else {
        throw new Error("Articles API request failed with status code: " + responseCode + " - " + responseText);
      }
    } while (articles.length === limit);
    
    // Get the spreadsheet and sheet
    var spreadsheetId = "1YFuNAX3ZnUA5RaNezeiERHUxkTg0MnoHWA1zmbyFXvE";
    var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    var sheet = spreadsheet.getSheetByName("Articles");
    
    if (!sheet) {
      throw new Error("Sheet 'Articles' not found in the spreadsheet.");
    }
    
    // Prepare headers based on API response fields
    var articleHeaders = [
      "Article ID",
      "Name",
      "Code",
      "EAN Code",
      "Tax Rate",
      "Net Selling Price",
      "Gross Selling Price",
      "Stock",
      "Category ID",
      "Comment"
    ];
    
    // Set headers if not present
    if (sheet.getRange(1, 1).getValue() === "") {
      sheet.getRange(1, 1, 1, articleHeaders.length).setValues([articleHeaders]);
    }
    
    // Get existing Article IDs
    var lastRow = sheet.getLastRow();
    var idSet = new Set();
    if (lastRow > 1) {
      var existingIds = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
      existingIds.forEach(function(id) {
        if (id) idSet.add(String(id));
      });
    }
    
    // Prepare new data array
    var newData = [];
    allArticles.forEach(function(article) {
      Logger.log(article)
      var id = String(article.article_id || "");
      if (id && !idSet.has(id)) {
        newData.push([
          id,
          article.article_name || "",
          article.article_code || "",
          article.article_eanCode || "",
          article.article_taxRate || "",
          article.article_net_sellingPrice || 0,
          article.article_gross_sellingPrice || 0,
          article.article_stock || 0,
          article.article_category_id || "",
          article.article_comment || ""
        ]);
        idSet.add(id);
      }
    });
    
    // Write new data to sheet
    if (newData.length > 0) {
      var startRow = lastRow + 1;
      sheet.getRange(startRow, 1, newData.length, articleHeaders.length).setValues(newData);
      Logger.log("Successfully appended " + newData.length + " new articles to the sheet.");
    } else {
      Logger.log("No new articles to append.");
    }
  } catch (error) {
    Logger.log("Articles Error: " + error.message);
  }
}

function fetchHelloCashInvoices() {
  // Define API endpoint and authentication token
  var token = getApiKey();
  
  // Set up headers for the API request
  var headers = {
    "Authorization": "Bearer " + token,
    "Content-Type": "application/json",
    "Accept": "application/json"
  };
  
  // Set up options for the fetch request
  var options = {
    "method": "GET",
    "headers": headers,
    "muteHttpExceptions": true
  };
  
  try {
    var allInvoices = [];
    var limit = 250;
    var offset = 1;
    var invoices;
    
    do {
      var apiUrl = "https://api.hellocash.business/api/v1/invoices?limit=" + limit + "&offset=" + offset;
      // Make the API request
      var response = UrlFetchApp.fetch(apiUrl, options);
      var responseCode = response.getResponseCode();
      var responseText = response.getContentText();
      
      // Logger.log("Invoices Response Code: " + responseCode);
      // Logger.log("Invoices Response Text: " + responseText);
      
      if (responseCode === 200) {
        // Parse the JSON response
        var json = JSON.parse(responseText);
        
        // Check for error in response
        if (json.error) {
          throw new Error("Invoices API returned an error: " + json.error);
        }
        
        invoices = json.invoices || [];
        allInvoices = allInvoices.concat(invoices);
        offset += 1;
      } else {
        throw new Error("Invoices API request failed with status code: " + responseCode + " - " + responseText);
      }
    } while (invoices.length === limit);
    
    // Get the spreadsheet and sheet
    var spreadsheetId = "1YFuNAX3ZnUA5RaNezeiERHUxkTg0MnoHWA1zmbyFXvE";
    var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    var sheet = spreadsheet.getSheetByName("Invoices");
    
    if (!sheet) {
      throw new Error("Sheet 'Invoices' not found in the spreadsheet.");
    }
    
    // Prepare headers based on assumed invoice fields
    var invoiceHeaders = [
      "Invoice ID",
      "Timestamp",
      "Invoice Number",
      "Cashier",
      "Payment Method",
      "Total Gross",
      "Discount",
      "Cancellation",
      "Tax Rate",
      "Tax Gross",
      "Tax Net",
      "Tax Amount"
    ];
    
    // Set headers if not present
    if (sheet.getRange(1, 1).getValue() === "") {
      sheet.getRange(1, 1, 1, invoiceHeaders.length).setValues([invoiceHeaders]);
    }
    
    // Get existing Invoice IDs
    var lastRow = sheet.getLastRow();
    var idSet = new Set();
    if (lastRow > 1) {
      var existingIds = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
      existingIds.forEach(function(id) {
        if (id) idSet.add(String(id));
      });
    }
    
    // Prepare new data array
    var newData = [];
    allInvoices.forEach(function(invoice) {
      Logger.log(invoice)
      var id = String(invoice.invoice_id || "");
      if (id && !idSet.has(id)) {
        newData.push([
          id,
          invoice.invoice_timestamp || "",
          invoice.invoice_number || "",
          invoice.invoice_cashier || "",
          invoice.invoice_payment || "",
          invoice.invoice_total || 0,
          invoice.invoice_discount || 0,
          invoice.invoice_cancellation || 0,
          invoice.taxes[0].tax_taxRate || 0,
          invoice.taxes[0].tax_gross || 0,
          invoice.taxes[0].tax_net || 0,
          invoice.taxes[0].tax_tax || 0
        ]);
        idSet.add(id);
      }
    });
    
    // Write new data to sheet
    if (newData.length > 0) {
      var startRow = lastRow + 1;
      sheet.getRange(startRow, 1, newData.length, invoiceHeaders.length).setValues(newData);
      Logger.log("Successfully appended " + newData.length + " new invoices to the sheet.");
    } else {
      Logger.log("No new invoices to append.");
    }
  } catch (error) {
    Logger.log("Invoices Error: " + error.message);
  }
}

function fetchHelloCashEmployees() {
  // Define API endpoint and authentication token
  var token = getApiKey();
  
  // Set up headers for the API request
  var headers = {
    "Authorization": "Bearer " + token,
    "Content-Type": "application/json",
    "Accept": "application/json"
  };
  
  // Set up options for the fetch request
  var options = {
    "method": "GET",
    "headers": headers,
    "muteHttpExceptions": true
  };
  
  try {
    var allEmployees = [];
    var limit = 250;
    var offset = 1;
    var employees;
    
    do {
      var apiUrl = "https://api.hellocash.business/api/v1/employees?limit=" + limit + "&offset=" + offset;
      // Make the API request
      var response = UrlFetchApp.fetch(apiUrl, options);
      var responseCode = response.getResponseCode();
      var responseText = response.getContentText();
      
      Logger.log("Employees Response Code: " + responseCode);
      Logger.log("Employees Response Text: " + responseText);
      
      if (responseCode === 200) {
        // Parse the JSON response
        var json = JSON.parse(responseText);
        
        // Check for error in response
        if (json.error) {
          throw new Error("Employees API returned an error: " + json.error);
        }
        
        employees = json || [];
        allEmployees = allEmployees.concat(employees);
        offset += 1;
      } else {
        throw new Error("Employees API request failed with status code: " + responseCode + " - " + responseText);
      }
    } while (employees.length === limit);
    
    // Get the spreadsheet and sheet
    var spreadsheetId = "1YFuNAX3ZnUA5RaNezeiERHUxkTg0MnoHWA1zmbyFXvE";
    var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    var sheet = spreadsheet.getSheetByName("Employees");
    
    if (!sheet) {
      throw new Error("Sheet 'Employees' not found in the spreadsheet.");
    }
    
    // Prepare headers based on API response fields
    var employeeHeaders = [
      "Employee ID",
      "Name",
      "Updated At"
    ];
    
    // Set headers if not present
    if (sheet.getRange(1, 1).getValue() === "") {
      sheet.getRange(1, 1, 1, employeeHeaders.length).setValues([employeeHeaders]);
    }
    
    // Get existing Employee IDs
    var lastRow = sheet.getLastRow();
    var idSet = new Set();
    if (lastRow > 1) {
      var existingIds = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
      existingIds.forEach(function(id) {
        if (id) idSet.add(String(id));
      });
    }
    
    // Prepare new data array
    var newData = [];
    allEmployees.forEach(function(employee) {
      var id = String(employee.employee_id || "");
      if (id && !idSet.has(id)) {
        newData.push([
          id,
          employee.employee_name || "",
          employee.employee_updated_at || ""
        ]);
        idSet.add(id);
      }
    });
    
    // Write new data to sheet
    if (newData.length > 0) {
      var startRow = lastRow + 1;
      sheet.getRange(startRow, 1, newData.length, employeeHeaders.length).setValues(newData);
      Logger.log("Successfully appended " + newData.length + " new employees to the sheet.");
    } else {
      Logger.log("No new employees to append.");
    }
  } catch (error) {
    Logger.log("Employees Error: " + error.message);
  }
}

// Web app endpoint to retrieve employee or article data
// To get the full list of employees with IDs, names, and updated_at:
//   - Call: https://script.google.com/macros/s/<your-script-id>/exec
//   - Or: https://script.google.com/macros/s/<your-script-id>/exec?mode=employees
//   - Returns JSON array of objects with employee_id, employee_name, and employee_updated_at
// To search for articles by name:
//   - Call: https://script.google.com/macros/s/<your-script-id>/exec?mode=articles&search=<search-string>
//   - Returns JSON array of objects with article_id and article_name where article_name contains the search string (case-insensitive)

// Helper function to create CORS-enabled response
function createCORSResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    var spreadsheetId = "1YFuNAX3ZnUA5RaNezeiERHUxkTg0MnoHWA1zmbyFXvE";
    var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    
    // Get mode parameter, default to 'employees' if not specified
    var mode = (e && e.parameter && e.parameter.mode) ? e.parameter.mode.toLowerCase() : "employees";
    
    if (mode === "articles") {
      // Check for search parameter (required for articles mode)
      var searchTerm = e && e.parameter && e.parameter.search;
      if (!searchTerm) {
        throw new Error("Search parameter is required when mode is 'articles'.");
      }
      
      var sheet = spreadsheet.getSheetByName("Articles");
      if (!sheet) {
        throw new Error("Sheet 'Articles' not found in the spreadsheet.");
      }
      
      var lastRow = sheet.getLastRow();
      if (lastRow <= 1) {
        return createCORSResponse([]);
      }
      
      // Get article IDs (column 1) and names (column 2)
      var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
      var results = data
        .filter(function(row) {
          var name = String(row[1] || "").toLowerCase();
          return name.includes(searchTerm.toLowerCase());
        })
        .map(function(row) {
          return {
            article_id: String(row[0]),
            article_name: String(row[1])
          };
        });
      
      return createCORSResponse(results);
    } else if (mode === "list_articles") {
      // Return full list of articles with ID, name, UPC code, and pricing
      var sheet = spreadsheet.getSheetByName("Articles");
      if (!sheet) {
        throw new Error("Sheet 'Articles' not found in the spreadsheet.");
      }
      
      var lastRow = sheet.getLastRow();
      if (lastRow <= 1) {
        return createCORSResponse([]);
      }
      
      // Get article IDs (column A), names (column B), UPC codes (column K), and pricing columns
      // Gross Selling Price is in column G (index 6) and Net Selling Price is in column F (index 5)
      var data = sheet.getRange(2, 1, lastRow - 1, 11).getValues(); // Get columns A through K
      var results = data.map(function(row) {
        return {
          article_id: String(row[0]),
          article_name: String(row[1]),
          upc_code: String(row[10]), // Column K (index 10)
          gross_selling_price: parseFloat(row[6]) || 0, // Column G (index 6)
          net_selling_price: parseFloat(row[5]) || 0 // Column F (index 5)
        };
      });
      
      return createCORSResponse(results);
    } else if (mode === "employees") {
      // Return full list of employees
      var sheet = spreadsheet.getSheetByName("Employees");
      if (!sheet) {
        throw new Error("Sheet 'Employees' not found in the spreadsheet.");
      }
      
      var lastRow = sheet.getLastRow();
      if (lastRow <= 1) {
        return createCORSResponse([]);
      }
      
      // Get employee IDs (column 1), names (column 2), and updated_at (column 3)
      var data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
      var results = data.map(function(row) {
        return {
          employee_id: String(row[0]),
          employee_name: String(row[1]),
          employee_updated_at: String(row[2])
        };
      });
      
      return createCORSResponse(results);
    } else if (mode === "verify_signature") {
      // Verify digital signature against Employee Digital Signatures sheet
      var signature = e.parameter.signature;
      if (!signature) {
        return createCORSResponse({ 
          valid: false, 
          error: "No signature provided" 
        });
      }
      
      var signatureSheet = spreadsheet.getSheetByName("Employee Digital Signatures");
      if (!signatureSheet) {
        return createCORSResponse({ 
          valid: false, 
          error: "Employee Digital Signatures sheet not found" 
        });
      }
      
      var lastRow = signatureSheet.getLastRow();
      if (lastRow <= 1) {
        return createCORSResponse({ 
          valid: false, 
          error: "No signatures found in sheet" 
        });
      }
      
      // Get all signatures (column B) and employee IDs (column A)
      var signatureData = signatureSheet.getRange(2, 1, lastRow - 1, 2).getValues();
      
      // Look for matching signature
      for (var i = 0; i < signatureData.length; i++) {
        var row = signatureData[i];
        var employeeId = String(row[0]);
        var storedSignature = String(row[1]);
        
        if (storedSignature === signature) {
          // Found matching signature, get employee name
          var employeeSheet = spreadsheet.getSheetByName("Employees");
          if (employeeSheet) {
            var employeeData = employeeSheet.getRange(2, 1, employeeSheet.getLastRow() - 1, 2).getValues();
            for (var j = 0; j < employeeData.length; j++) {
              var empRow = employeeData[j];
              if (String(empRow[0]) === employeeId) {
                return createCORSResponse({
                  valid: true,
                  employee_id: employeeId,
                  employee_name: String(empRow[1]),
                  signature: signature
                });
              }
            }
          }
          
          // If we found signature but couldn't get employee name
          return createCORSResponse({
            valid: true,
            employee_id: employeeId,
            employee_name: "Unknown",
            signature: signature
          });
        }
      }
      
      // Signature not found
      return createCORSResponse({ 
        valid: false, 
        error: "Signature not found in registered devices" 
      });
    } else {
      throw new Error("Invalid mode parameter. Use 'employees', 'articles', 'list_articles', or 'verify_signature'.");
    }
  } catch (error) {
    Logger.log("doGet Error: " + error.message);
    return createCORSResponse({ error: error.message });
  }
}