/**
 * File: google_app_scripts/tdg_inventory_management/stripe_sales_sync.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * 
 * Description: Fetches Stripe transactions for a specific product and writes sales 
 * and transaction fees directly to the offchain transactions sheet. 
 * 
 * IMPORTANT: This script ONLY processes Stripe charges that are NOT already handled 
 * by existing flows. It checks both:
 * - "QR Code Sales" sheet (Agroverse QR code checkout via Edgar)
 * - "Stripe Social Media Checkout ID" sheet (Meta Checkout orders)
 * This ensures no duplicates and avoids interfering with existing sales processing flows.
 * 
 * This provides a direct Stripe API → offchain transactions route for non-QR-code 
 * sales of the target product, bypassing intermediate sheets.
 * 
 * Deployment URL: [To be added after deployment]
 */

// Load API keys and configuration settings from Credentials.gs
// - setApiKeys(): Stores sensitive API keys in Google Apps Script's Script Properties for security.
// - getCredentials(): Retrieves all configuration details (API keys, URLs, IDs) as an object.
// - These steps ensure keys and settings are centralized and not hardcoded here.

// Stripe Secret API Key
// - Used to authenticate requests to the Stripe API.
// - Set your Stripe secret key in Credentials.gs or Script Properties.
// - Obtain this from Stripe Dashboard > Developers > API keys
const STRIPE_API_KEY = PropertiesService.getScriptProperties().getProperty('STRIPE_API_KEY');

// Configuration Variables
const SHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
const TAB_NAME = 'offchain transactions';
const QR_CODE_SALES_SHEET_ID = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ'; // QR Code Sales spreadsheet
const QR_CODE_SALES_SHEET_NAME = 'QR Code Sales'; // Sheet name for QR Code Sales
const STRIPE_CHECKOUT_LOG_SHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU'; // Same as SHEET_ID
const STRIPE_CHECKOUT_LOG_SHEET_NAME = 'Stripe Social Media Checkout ID'; // Meta Checkout log sheet
// Product IDs to filter Stripe charges (Edgar's market sell-off dashboard SaaS subscriptions)
const TARGET_PRODUCT_IDS = [
  'prod_K9izwu3PecrVcP',
  'prod_K7dFIFFWeThYtD',
  'prod_JvDl9TO5bj44ud'
];
const FUND_HANDLER = 'Gary Teh'; // Column C: Fund Handler name
const DAYS_BACK = 30; // Number of days to look back for transactions

// Function to check if a Stripe charge is already processed by existing flows
// Checks both:
// 1. QR Code Sales sheet (Agroverse QR code checkout via Edgar)
// 2. Stripe Social Media Checkout ID sheet (Meta Checkout orders)
function isChargeAlreadyProcessed(chargeId, sessionId) {
  // Check QR Code Sales sheet (Agroverse QR code checkout)
  if (isChargeInQrCodeSales(chargeId, sessionId)) {
    return true;
  }
  
  // Check Stripe Social Media Checkout ID sheet (Meta Checkout)
  if (isChargeInStripeCheckoutLog(chargeId, sessionId)) {
    return true;
  }
  
  return false;
}

// Function to check if a Stripe charge is already in QR Code Sales sheet
// QR code checkout writes to "QR Code Sales" sheet with Stripe session IDs
function isChargeInQrCodeSales(chargeId, sessionId) {
  try {
    const qrSalesSpreadsheet = SpreadsheetApp.openById(QR_CODE_SALES_SHEET_ID);
    const qrSalesSheet = qrSalesSpreadsheet.getSheetByName(QR_CODE_SALES_SHEET_NAME);
    
    if (!qrSalesSheet) {
      Logger.log(`Warning: QR Code Sales sheet not found, skipping duplicate check`);
      return false;
    }
    
    const qrSalesData = qrSalesSheet.getDataRange().getValues();
    
    // Check each row in QR Code Sales sheet
    // Column A (index 0): Telegram Update ID (may contain "stripe_#{session_id}")
    // Column B (index 1): Telegram Message ID (may contain "stripe_#{session_id}")
    // Column C (index 2): Message (may contain charge ID or session ID)
    for (let i = 1; i < qrSalesData.length; i++) {
      const row = qrSalesData[i];
      const colA = String(row[0] || ''); // Column A
      const colB = String(row[1] || ''); // Column B
      const colC = String(row[2] || ''); // Column C (Message)
      
      // Check if this row contains the Stripe session ID or charge ID
      if (sessionId && (colA.includes(sessionId) || colB.includes(sessionId) || colC.includes(sessionId))) {
        return true;
      }
      
      // Check if message contains the charge ID
      if (chargeId && colC.includes(chargeId)) {
        return true;
      }
      
      // Check if this is a Stripe checkout entry (starts with "stripe_")
      if (colA.startsWith('stripe_') || colB.startsWith('stripe_')) {
        // Extract session ID from "stripe_#{session_id}" format
        const extractedSessionId = colA.replace('stripe_', '') || colB.replace('stripe_', '');
        if (sessionId && extractedSessionId === sessionId) {
          return true;
        }
      }
    }
    
    return false;
  } catch (e) {
    Logger.log(`Error checking QR Code Sales sheet: ${e.message}`);
    return false; // If error, don't block processing (fail open)
  }
}

// Function to check if a Stripe charge is already in Stripe Social Media Checkout ID sheet
// Meta Checkout orders write to this sheet with Stripe session IDs
function isChargeInStripeCheckoutLog(chargeId, sessionId) {
  try {
    const checkoutLogSpreadsheet = SpreadsheetApp.openById(STRIPE_CHECKOUT_LOG_SHEET_ID);
    const checkoutLogSheet = checkoutLogSpreadsheet.getSheetByName(STRIPE_CHECKOUT_LOG_SHEET_NAME);
    
    if (!checkoutLogSheet) {
      Logger.log(`Warning: Stripe Social Media Checkout ID sheet not found, skipping duplicate check`);
      return false;
    }
    
    const checkoutLogData = checkoutLogSheet.getDataRange().getValues();
    
    // Check each row in Stripe Social Media Checkout ID sheet
    // Column C (index 2): Stripe Session ID
    // Headers: Column A (Timestamp), Column B (Customer Name), Column C (Stripe Session ID), 
    //          Column D (Wix Order Number), Column E (Wix Order ID), Column F (Items Purchased), 
    //          Column G (Total Quantity), Column H (Amount), Column I (Currency)
    for (let i = 1; i < checkoutLogData.length; i++) {
      const row = checkoutLogData[i];
      const stripeSessionId = String(row[2] || ''); // Column C: Stripe Session ID
      
      // Check if this row contains the Stripe session ID
      if (sessionId && stripeSessionId === sessionId) {
        return true;
      }
      
      // Also check other columns for charge ID (in case it's stored elsewhere)
      const rowString = row.join(' ').toLowerCase();
      if (chargeId && rowString.includes(chargeId.toLowerCase())) {
        return true;
      }
    }
    
    return false;
  } catch (e) {
    Logger.log(`Error checking Stripe Social Media Checkout ID sheet: ${e.message}`);
    return false; // If error, don't block processing (fail open)
  }
}

// Function to process Scored Chatlogs and update offchain transactions
function fetchStripeTransactions() {
  // Validate Stripe API key
  if (!STRIPE_API_KEY) {
    Logger.log('Error: STRIPE_API_KEY not set in Credentials.gs or Script Properties');
    return;
  }

  // Get the spreadsheet and sheet
  const spreadsheet = SpreadsheetApp.openById(SHEET_ID);
  const sheet = spreadsheet.getSheetByName(TAB_NAME);
  
  if (!sheet) {
    Logger.log(`Error: Sheet "${TAB_NAME}" not found in spreadsheet ${SHEET_ID}`);
    return;
  }
  
  // Get existing descriptions to avoid duplicates in offchain transactions
  const existingData = sheet.getDataRange().getValues();
  const existingDescriptions = existingData.slice(1).map(row => row[1]); // Column B: Description
  
  // Calculate timestamp for N days ago (in seconds)
  const daysAgoTimestamp = Math.floor((Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000) / 1000);
  
  // Stripe API endpoint for charges
  const url = 'https://api.stripe.com/v1/charges?limit=100';
  const options = {
    method: 'get',
    headers: {
      'Authorization': 'Bearer ' + STRIPE_API_KEY
    },
    muteHttpExceptions: true
  };

  // Fetch data from Stripe
  let response;
  try {
    response = UrlFetchApp.fetch(url, options);
  } catch (e) {
    Logger.log(`Error fetching from Stripe API: ${e.message}`);
    return;
  }

  const responseCode = response.getResponseCode();
  if (responseCode !== 200) {
    Logger.log(`Stripe API error: ${responseCode} - ${response.getContentText()}`);
    return;
  }

  let json;
  try {
    json = JSON.parse(response.getContentText());
  } catch (e) {
    Logger.log(`Error parsing Stripe API response: ${e.message}`);
    return;
  }
  
  if (!json.data || json.data.length === 0) {
    Logger.log('No transactions found');
    return;
  }

  const totalChargesFetched = json.data.length;
  Logger.log(`Fetched ${totalChargesFetched} charges from Stripe API`);

  let processedCount = 0;
  let skippedCount = 0;
  let skippedQrCodeSalesCount = 0;
  let agroverseTransactionsDetected = 0; // Track Agroverse-related transactions detected
  let chargesPassingInitialFilter = 0; // Track charges that pass paid/succeeded/time window filter
  let chargesMatchingProductId = 0; // Track charges that match target product ID

  // Process each charge
  json.data.forEach(charge => {
    // Filter: only process paid, succeeded charges within the time window
    if (charge.paid && charge.status === 'succeeded' && charge.created >= daysAgoTimestamp) {
      chargesPassingInitialFilter++;
      // IMPORTANT: Skip charges that are already handled by QR code checkout flow
      // QR code checkout writes to "QR Code Sales" which is then processed to offchain transactions
      // We need to check the checkout session ID from payment intent metadata
      let checkoutSessionId = null;
      if (charge.payment_intent) {
        try {
          const paymentIntentUrl = `https://api.stripe.com/v1/payment_intents/${charge.payment_intent}`;
          const paymentIntentResponse = UrlFetchApp.fetch(paymentIntentUrl, options);
          if (paymentIntentResponse.getResponseCode() === 200) {
            const paymentIntentJson = JSON.parse(paymentIntentResponse.getContentText());
            // Check metadata for checkout_session_id (common in Stripe Checkout sessions)
            checkoutSessionId = paymentIntentJson.metadata?.checkout_session_id || 
                                paymentIntentJson.metadata?.['checkout_session_id'] ||
                                paymentIntentJson.metadata?.session_id;
          }
        } catch (e) {
          Logger.log(`Error fetching payment intent for session ID: ${e.message}`);
        }
      }
      
      // Also check charge metadata for session ID
      if (!checkoutSessionId && charge.metadata) {
        checkoutSessionId = charge.metadata.checkout_session_id || 
                          charge.metadata['checkout_session_id'] ||
                          charge.metadata.session_id;
      }
      
      // Check if this charge is already processed by existing flows
      // This prevents duplicate processing of:
      // 1. Agroverse QR code sales via Edgar (QR Code Sales sheet)
      // 2. Meta Checkout orders (Stripe Social Media Checkout ID sheet)
      const isInQrCodeSales = isChargeInQrCodeSales(charge.id, checkoutSessionId);
      const isInStripeCheckoutLog = isChargeInStripeCheckoutLog(charge.id, checkoutSessionId);
      
      if (isInQrCodeSales || isInStripeCheckoutLog) {
        skippedQrCodeSalesCount++;
        
        // Track Agroverse transactions specifically
        if (isInQrCodeSales) {
          agroverseTransactionsDetected++;
          Logger.log(`Skipping charge ${charge.id} - Agroverse transaction detected (already in QR Code Sales)`);
        } else {
          Logger.log(`Skipping charge ${charge.id} - already processed by existing flow (Meta Checkout)`);
        }
        
        return; // Skip this charge - let existing flow handle it
      }
      
      // Check if the charge is tied to any of the target product IDs
      let hasTargetProduct = false;
      
      // If there's an invoice, fetch its line items
      if (charge.invoice) {
        try {
          const invoiceUrl = `https://api.stripe.com/v1/invoices/${charge.invoice}`;
          const invoiceResponse = UrlFetchApp.fetch(invoiceUrl, options);
          const invoiceJson = JSON.parse(invoiceResponse.getContentText());
          
          if (invoiceJson.lines && invoiceJson.lines.data) {
            hasTargetProduct = invoiceJson.lines.data.some(line => 
              line.price && line.price.product && TARGET_PRODUCT_IDS.includes(line.price.product)
            );
          }
        } catch (e) {
          Logger.log(`Error fetching invoice ${charge.invoice}: ${e.message}`);
        }
      } 
      // If no invoice but a payment intent exists, check its line items
      else if (charge.payment_intent) {
        try {
          const paymentIntentUrl = `https://api.stripe.com/v1/payment_intents/${charge.payment_intent}`;
          const paymentIntentResponse = UrlFetchApp.fetch(paymentIntentUrl, options);
          const paymentIntentJson = JSON.parse(paymentIntentResponse.getContentText());
          
          if (paymentIntentJson.charges && paymentIntentJson.charges.data) {
            const chargeDetails = paymentIntentJson.charges.data[0];
            if (chargeDetails.invoice) {
              const invoiceUrl = `https://api.stripe.com/v1/invoices/${chargeDetails.invoice}`;
              const invoiceResponse = UrlFetchApp.fetch(invoiceUrl, options);
              const invoiceJson = JSON.parse(invoiceResponse.getContentText());
              
              if (invoiceJson.lines && invoiceJson.lines.data) {
                hasTargetProduct = invoiceJson.lines.data.some(line => 
                  line.price && line.price.product && TARGET_PRODUCT_IDS.includes(line.price.product)
                );
              }
            }
          }
        } catch (e) {
          Logger.log(`Error fetching payment intent ${charge.payment_intent}: ${e.message}`);
        }
      }

      // Only process if the product ID matches
      if (hasTargetProduct) {
        chargesMatchingProductId++;
        // Format date to YYYYMMDD
        const transactionDate = new Date(charge.created * 1000); // Convert Unix timestamp
        const formattedDate = Utilities.formatDate(transactionDate, Session.getScriptTimeZone(), 'yyyyMMdd');
        
        // Fetch customer email if customer ID exists
        let customerEmail = 'No email';
        if (charge.customer) {
          try {
            const customerUrl = `https://api.stripe.com/v1/customers/${charge.customer}`;
            const customerResponse = UrlFetchApp.fetch(customerUrl, options);
            const customerJson = JSON.parse(customerResponse.getContentText());
            customerEmail = customerJson.email || 'No email';
          } catch (e) {
            Logger.log(`Error fetching customer ${charge.customer}: ${e.message}`);
          }
        }
        
        // Construct description
        const description = `Google App Script Generated - Stripe ${charge.description || 'Sale'} - ${charge.id} - Customer Email: ${customerEmail}`;
        
        // Check for duplicates based on description
        if (!existingDescriptions.includes(description)) {
          // Sale record
          const saleRow = [
            formattedDate,                    // Column A: Transaction Date
            description,                      // Column B: Description
            FUND_HANDLER,                     // Column C: Fund Handler
            charge.amount / 100,              // Column D: Amount (convert cents to dollars)
            charge.currency.toUpperCase() || 'USD', // Column E: Currency
            '',                              // Column F: Ledger Line (empty)
            'TRUE'                           // Column G: Is Revenue
          ];
          
          // Append sale row
          sheet.appendRow(saleRow);
          existingDescriptions.push(description); // Add to list to prevent duplicate fees
          processedCount++;

          // Check for transaction fee (via balance transaction)
          if (charge.balance_transaction) {
            try {
              const balanceUrl = `https://api.stripe.com/v1/balance_transactions/${charge.balance_transaction}`;
              const balanceResponse = UrlFetchApp.fetch(balanceUrl, options);
              const balanceJson = JSON.parse(balanceResponse.getContentText());
              
              if (balanceJson.fee > 0) {
                const feeDescription = `Google App Script Generated - Stripe Transaction Fee - ${charge.id} - Customer Email: ${customerEmail}`;
                
                // Check if fee already recorded
                if (!existingDescriptions.includes(feeDescription)) {
                  const feeRow = [
                    formattedDate,                    // Column A: Transaction Date
                    feeDescription,                  // Column B: Description
                    FUND_HANDLER,                     // Column C: Fund Handler
                    -balanceJson.fee / 100,          // Column D: Amount (negative, convert cents to dollars)
                    balanceJson.currency.toUpperCase() || 'USD', // Column E: Currency
                    '',                              // Column F: Ledger Line (empty)
                    ''                              // Column G: Is Revenue (empty for fees)
                  ];
                  
                  // Append fee row
                  sheet.appendRow(feeRow);
                  existingDescriptions.push(feeDescription); // Add to list
                  processedCount++;
                }
              }
            } catch (e) {
              Logger.log(`Error fetching balance transaction ${charge.balance_transaction}: ${e.message}`);
            }
          }
        } else {
          skippedCount++;
        }
      }
    }
  });
  
  Logger.log('=== Stripe transactions sync completed ===');
  Logger.log(`Total fetched from Stripe: ${totalChargesFetched}`);
  Logger.log(`Charges passing initial filter (paid/succeeded/${DAYS_BACK}days): ${chargesPassingInitialFilter}`);
  Logger.log(`Charges matching product IDs (${TARGET_PRODUCT_IDS.join(', ')}): ${chargesMatchingProductId}`);
  Logger.log(`Processed: ${processedCount}`);
  Logger.log(`Skipped (duplicates in offchain): ${skippedCount}`);
  Logger.log(`Skipped (already in QR Code Sales or Stripe Checkout Log): ${skippedQrCodeSalesCount}`);
  Logger.log(`Agroverse transactions detected: ${agroverseTransactionsDetected}`);
}

// Function to run the script manually or set up a trigger
function createTrigger() {
  // Delete existing triggers for this function first
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'fetchStripeTransactions') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // Create new trigger
  ScriptApp.newTrigger('fetchStripeTransactions')
    .timeBased()
    .everyHours(1) // Adjust frequency as needed (e.g., every hour)
    .create();
  
  Logger.log('Trigger created successfully');
}

// Function to remove the trigger (useful for testing or disabling)
function removeTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'fetchStripeTransactions') {
      ScriptApp.deleteTrigger(trigger);
      Logger.log('Trigger removed');
    }
  });
}

