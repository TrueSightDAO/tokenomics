/**
 * File: market_research/google_apps_scripts/voice_feedback_capture.gs
 * Repository: https://github.com/TrueSightDAO/market_research
 * 
 * Description: Webhook endpoint that receives content feedback from iPhone Siri/Shortcuts
 * or web interface (dapp/submit_feedback.html) and automatically appends to the
 * "Feedback on Content" sheet for content team review and incorporation tracking.
 */

// Deployment URL: https://script.google.com/macros/s/AKfycbz3FQgXLaEc4KNq9fhCCFbf677OIcEMjVq_HjcgttMfCNWk7QWaCeTEq0xc5aRRbduFdg/exec

// ============================================================================
// CONSTANTS
// ============================================================================

// Spreadsheet configuration
const SPREADSHEET_ID = '1ghZXeMqFq97Vl6yLKrtDmMQdQkd-4EN5yQs34NA_sBQ';
const SHEET_NAME = 'Feedback on Content';

// Column indices for Feedback sheet (0-based)
const FEEDBACK_COL = 0;           // Column A - The feedback text
const STATUS_COL = 1;             // Column B - Status (INCORPORATED, PENDING, REJECTED)
const TIMESTAMP_COL = 2;          // Column C - Timestamp when feedback was submitted
const SIGNATURE_COL = 3;          // Column D - Digital signature of submitter

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Handles POST requests from iPhone Shortcuts
 * @param {Object} e - The event parameter containing the request data
 * @return {TextOutput} - Response message
 */
function doPost(e) {
  try {
    // Log incoming request for debugging
    Logger.log('Received feedback request');
    Logger.log('Parameters: ' + JSON.stringify(e.parameter));
    
    // Get feedback and signature from request
    const feedback = e.parameter.feedback || e.postData?.contents;
    const signature = e.parameter.signature || '';
    
    if (!feedback) {
      return ContentService.createTextOutput(
        JSON.stringify({
          status: 'error',
          message: 'No feedback provided'
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }
    
    // Open spreadsheet and get feedback sheet
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(SHEET_NAME);
    
    if (!sheet) {
      Logger.log('Sheet not found: ' + SHEET_NAME);
      return ContentService.createTextOutput(
        JSON.stringify({
          status: 'error',
          message: 'Feedback sheet not found'
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }
    
    // Prepare data to append
    const timestamp = new Date();
    const status = ''; // Empty status - will be filled manually later
    
    // Append row: [Feedback, Status, Timestamp, Digital Signature]
    sheet.appendRow([feedback, status, timestamp, signature]);
    
    Logger.log('Feedback added successfully: ' + feedback);
    
    // Return success response
    return ContentService.createTextOutput(
      JSON.stringify({
        status: 'success',
        message: '✅ Feedback saved!',
        feedback: feedback,
        timestamp: timestamp.toISOString()
      })
    ).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    Logger.log('Error: ' + error.message);
    
    return ContentService.createTextOutput(
      JSON.stringify({
        status: 'error',
        message: 'Failed to save feedback: ' + error.message
      })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Handles GET requests (for testing)
 * @param {Object} e - The event parameter containing the request data
 * @return {TextOutput} - Response message
 */
function doGet(e) {
  const feedback = e.parameter.feedback;
  
  if (!feedback) {
    return ContentService.createTextOutput(
      'Voice Feedback Capture API\n\n' +
      'Usage: Add ?feedback=YOUR_FEEDBACK to the URL\n' +
      'Example: ?feedback=Test feedback from Siri'
    );
  }
  
  // Use same logic as doPost for GET requests
  return doPost(e);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Initialize the feedback sheet with headers if needed
 * Run this once to set up the sheet structure
 */
function initializeFeedbackSheet() {
  try {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = spreadsheet.getSheetByName(SHEET_NAME);
    
    // Create sheet if it doesn't exist
    if (!sheet) {
      sheet = spreadsheet.insertSheet(SHEET_NAME);
      Logger.log('Created new sheet: ' + SHEET_NAME);
    }
    
    // Check if headers exist
    const firstRow = sheet.getRange(1, 1, 1, 4).getValues()[0];
    
    if (firstRow[0] !== 'Feedback' || firstRow[1] !== 'Status' || firstRow[2] !== 'Timestamp' || firstRow[3] !== 'Digital Signature') {
      // Set headers
      sheet.getRange(1, 1, 1, 4).setValues([['Feedback', 'Status', 'Timestamp', 'Digital Signature']]);
      
      // Format headers
      sheet.getRange(1, 1, 1, 4)
        .setFontWeight('bold')
        .setBackground('#4285f4')
        .setFontColor('#ffffff');
      
      // Set column widths
      sheet.setColumnWidth(1, 500); // Feedback column
      sheet.setColumnWidth(2, 150); // Status column
      sheet.setColumnWidth(3, 180); // Timestamp column
      sheet.setColumnWidth(4, 400); // Digital Signature column
      
      // Freeze header row
      sheet.setFrozenRows(1);
      
      Logger.log('Headers initialized successfully');
    } else {
      Logger.log('Headers already exist');
    }
    
    return ContentService.createTextOutput('✅ Sheet initialized successfully!');
    
  } catch (error) {
    Logger.log('Error initializing sheet: ' + error.message);
    return ContentService.createTextOutput('❌ Error: ' + error.message);
  }
}

// ============================================================================
// TEST METHODS
// ============================================================================

/**
 * Test method for adding feedback via doPost
 * Call this function from Google Apps Script editor to test feedback submission
 */
function testAddFeedback() {
  Logger.log('===== Testing testAddFeedback =====');
  
  const testFeedback = 'Test feedback from script editor - ' + new Date().toLocaleString();
  const testSignature = 'TEST_SIGNATURE_' + Math.random().toString(36).substring(7);
  
  const mockEvent = {
    parameter: {
      feedback: testFeedback,
      signature: testSignature
    }
  };
  
  const result = doPost(mockEvent);
  const response = JSON.parse(result.getContent());
  
  Logger.log('Test result: ' + JSON.stringify(response));
  
  if (response.status === 'success') {
    Logger.log('✅ TEST PASSED - Feedback added successfully');
    Logger.log('Feedback: ' + response.feedback);
    Logger.log('Timestamp: ' + response.timestamp);
  } else {
    Logger.log('❌ TEST FAILED - ' + response.message);
  }
}

/**
 * Test method for GET request (Siri Shortcuts simulation)
 * Call this function from Google Apps Script editor to test GET endpoint
 */
function testGetRequest() {
  Logger.log('===== Testing testGetRequest (Siri Simulation) =====');
  
  const testFeedback = 'Test from Siri - Winter wellness carousel idea';
  const testSignature = 'SIRI_TEST_' + Math.random().toString(36).substring(7);
  
  const mockEvent = {
    parameter: {
      feedback: testFeedback,
      signature: testSignature
    }
  };
  
  const result = doGet(mockEvent);
  const response = JSON.parse(result.getContent());
  
  Logger.log('Test result: ' + JSON.stringify(response));
  
  if (response.status === 'success') {
    Logger.log('✅ TEST PASSED - GET request handled correctly');
  } else {
    Logger.log('❌ TEST FAILED - ' + response.message);
  }
}

/**
 * Test method for sheet initialization
 * Call this function from Google Apps Script editor to verify sheet setup
 */
function testInitializeSheet() {
  Logger.log('===== Testing testInitializeSheet =====');
  
  const result = initializeFeedbackSheet();
  Logger.log('Initialization result: ' + result.getContent());
  
  // Verify headers were created
  try {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(SHEET_NAME);
    const headers = sheet.getRange(1, 1, 1, 4).getValues()[0];
    
    Logger.log('Headers: ' + JSON.stringify(headers));
    
    if (headers[FEEDBACK_COL] === 'Feedback' && 
        headers[STATUS_COL] === 'Status' && 
        headers[TIMESTAMP_COL] === 'Timestamp' &&
        headers[SIGNATURE_COL] === 'Digital Signature') {
      Logger.log('✅ TEST PASSED - Headers initialized correctly');
    } else {
      Logger.log('❌ TEST FAILED - Headers do not match expected values');
    }
  } catch (e) {
    Logger.log('❌ TEST FAILED - Error verifying headers: ' + e.message);
  }
}

// ============================================================================
// END OF TEST METHODS
// ============================================================================

