/**
 * File: google-app-script/agroverse_shop_checkout/agroverse_shop_checkout.gs
 * Repository: https://github.com/TrueSightDAO/agroverse_shop
 * 
 * Description: Handles Stripe + Etsy checkout/order polling and order management
 * for the Agroverse Shop e-commerce platform. Integrates with Google Sheets for order storage
 * and automated tracking email notifications.
 * 
 * Google Sheet Structure (columns A-T):
 * A: Timestamp
 * B: Customer Name
 * C: Stripe Session ID / Etsy Receipt ID
 * D: Wix Order Number (empty for non-Wix orders)
 * E: Wix Order ID (empty for non-Wix orders)
 * F: Items Purchased
 * G: Total Quantity
 * H: Amount (total including shipping/tax)
 * I: Currency
 * J: Shipping Address
 * K: Shipping Cost
 * L: Transaction Fee (Stripe fee / Etsy fee)
 * M: Shipping Provider
 * N: Tracking Number (manually entered by admin)
 * O: Tracking Notification Sent
 * P: Ledger Routed
 * Q: Environment
 * R: Invoice ID (subscription renewals)
 * S: Payment Intent ID (subscription renewals)
 * T: Payment Type (one_time | subscription_renewal)
 * 
 * Deployment URL: https://script.google.com/macros/s/AKfycbyefqjQnWegrXR9y18HyJMxSM2wWCyucsK5qdh5isJICVhonssajEpT4Dt3hq3A7PTA/exec
 * 
 * SETUP INSTRUCTIONS:
 * 1. Set up Script Properties (Project Settings > Script Properties):
 *    - STRIPE_TEST_SECRET_KEY (test mode secret key)
 *    - STRIPE_LIVE_SECRET_KEY (live mode secret key)
 *    - GOOGLE_SHEET_ID (ID of your Google Sheet)
 *    - GOOGLE_SHEET_NAME (optional, defaults to "Stripe Social Media Checkout ID")
 *    - EASYPOST_API_KEY (optional, for real shipping rate calculation via EasyPost)
 *    - ORIGIN_ADDRESS_LINE1 (warehouse/store street address)
 *    - ORIGIN_ADDRESS_CITY (warehouse/store city)
 *    - ORIGIN_ADDRESS_STATE (warehouse/store state, e.g., "CA")
 *    - ORIGIN_ADDRESS_POSTAL_CODE (warehouse/store ZIP code)
 *    - ORIGIN_ADDRESS_COUNTRY (warehouse/store country, default: "US")
 *    - BASE_BOX_WEIGHT_OZ (base box weight in ounces, default: 11.5)
 *    - PER_ITEM_PACKAGING_OZ (per-item packaging weight in ounces, default: 0.65)
 *    - ETSY_KEYSTRING (Etsy API keystring / client ID)
 *    - ETSY_SHARED_SECRET (Etsy API shared secret)
 *    - ETSY_SHOP_ID (your Etsy shop ID number)
 *    - ETSY_REFRESH_TOKEN (set after first OAuth setup — see setupEtsyOAuth())
 * 2. Deploy as Web App:
 *    - Click Deploy > New deployment > Web app
 *    - Set "Execute as: Me" and "Who has access: Anyone"
 *    - Copy the Web App URL to js/config.js
 * 3. Set up Time-Driven Trigger for polling:
 *    - Click Triggers (clock icon) > Add Trigger
 *    - Function: syncAllOrders (runs both Stripe + Etsy sync)
 *    - Event source: Time-driven
 *    - Type: Minutes timer
 *    - Interval: Every 5-15 minutes
 * 
 * 4. Etsy OAuth setup (one-time):
 *    - Run setupEtsyOAuth() from the Apps Script editor
 *    - Visit the URL logged in the console
 *    - Grant access to your Etsy shop
 *    - Copy the authorization code from the redirect URL
 *    - Run completeEtsyOAuth("CODE_FROM_URL") to store the refresh token
 * 
 * Endpoints:
 * - POST /exec?action=createCheckoutSession - Create Stripe checkout session
 * - POST /exec?action=submitQuoteRequest - Submit wholesale quote request
 * - POST /exec?action=calculateShippingRates - Calculate shipping rates (for checkout page display)
 * - GET /exec?action=getOrderStatus&sessionId=cs_xxx - Get order status
 * - GET /exec?action=getGcrContextByQr&qr=CODE - GCR context from Agroverse QR codes + Agroverse SKUs (main ledger)
 * - POST /exec (with stripe-signature header) - Handle Stripe webhook (optional)
 */

// ===== Configuration =====
// Configuration is loaded from Script Properties
// Supports both development and production with a single deployment
function getConfig(environment) {
  var props = PropertiesService.getScriptProperties();
  var env = environment || 'production';
  var isDev = env === 'development';
  
  var stripeSecretKey = isDev 
    ? props.getProperty('STRIPE_TEST_SECRET_KEY') 
    : props.getProperty('STRIPE_LIVE_SECRET_KEY');
  
  // Validate that we have a secret key (starts with "sk_") not a publishable key (starts with "pk_")
  if (stripeSecretKey) {
    if (stripeSecretKey.indexOf('pk_') === 0) {
      Logger.log('ERROR: ' + (isDev ? 'STRIPE_TEST_SECRET_KEY' : 'STRIPE_LIVE_SECRET_KEY') + ' appears to be a publishable key (starts with pk_). Please use a secret key (starts with sk_).');
      stripeSecretKey = null; // Clear invalid key
    } else if (stripeSecretKey.indexOf('sk_') !== 0) {
      Logger.log('WARNING: ' + (isDev ? 'STRIPE_TEST_SECRET_KEY' : 'STRIPE_LIVE_SECRET_KEY') + ' does not start with "sk_". Please verify it is a secret key.');
    }
  }
  
  return {
    stripeSecretKey: stripeSecretKey,
    // Webhook secrets are optional - only needed if using webhooks instead of polling
    stripeWebhookSecret: isDev
      ? props.getProperty('STRIPE_TEST_WEBHOOK_SECRET')
      : props.getProperty('STRIPE_LIVE_WEBHOOK_SECRET'),
    sheetId: props.getProperty('GOOGLE_SHEET_ID'),
    sheetName: props.getProperty('GOOGLE_SHEET_NAME') || 'Stripe Social Media Checkout ID',
    environment: env
  };
}

/**
 * Handles POST requests to this web app.
 * 
 * Expected actions:
 * - createCheckoutSession: Create Stripe checkout session
 * - submitQuoteRequest: Submit wholesale quote request
 * - Webhook: Handle Stripe webhook (if stripe-signature header present)
 * 
 * @param {Object} e Event object containing postData and parameters.
 * @return {ContentService.TextOutput} JSON response with results or error.
 */
function doPost(e) {
  try {
    // Handle Stripe webhook (OPTIONAL - only if using webhooks instead of polling)
    if (e.parameter && e.parameter['stripe-signature']) {
      return handleStripeWebhook(e);
    }

    // Parse payload - support both JSON and form-encoded
    var data = {};
    var action;
    
    if (e.postData && e.postData.contents) {
      try {
        // Try JSON first
        var jsonData = JSON.parse(e.postData.contents);
        data = jsonData;
        action = jsonData.action;
      } catch (jsonError) {
        // If not JSON, try form-encoded
        // Form-encoded data comes as e.parameter
        data = e.parameter || {};
        action = data.action;
        
        // Parse JSON strings from form-encoded fields
        if (data.cart) {
          try {
            data.cart = JSON.parse(data.cart);
          } catch (e) {}
        }
        if (data.shippingAddress) {
          try {
            data.shippingAddress = JSON.parse(data.shippingAddress);
          } catch (e) {}
        }
        if (data.quoteData) {
          try {
            data.quoteData = JSON.parse(data.quoteData);
          } catch (e) {}
        }
        // selectedShippingRateId is a simple string, no need to parse
      }
    } else {
      // Use URL parameters if no POST data (GET request)
      data = e.parameter || {};
      action = data.action;
    }
    
    if (!action) {
      return createCORSResponse({
        status: 'error',
        error: 'Missing action parameter'
      });
    }

    if (action === 'createCheckoutSession') {
      return createCheckoutSession(data);
    }

    if (action === 'submitQuoteRequest') {
      return submitQuoteRequest(data);
    }

    if (action === 'calculateShippingRates') {
      return calculateShippingRates(data);
    }

    return createCORSResponse({
      status: 'error',
      error: 'Invalid action'
    });
  } catch (error) {
    Logger.log('Error in doPost: ' + error.toString());
    return createCORSResponse({
      status: 'error',
      error: error.toString()
    });
  }
}

/**
 * Create JSON response
 * Note: CORS is handled automatically by Google App Script Web App deployment settings
 * Make sure to deploy with "Who has access: Anyone" for CORS to work
 * 
 * @param {Object} data Data to return as JSON
 * @return {ContentService.TextOutput} JSON response
 */
function createCORSResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Handles GET requests to this web app.
 * 
 * Expected query parameters:
 * - action=getOrderStatus&sessionId=cs_xxx - Get order status by Stripe session ID
 * - action=getGcrContextByQr&qr=xxx - Payload for Google Customer Reviews (Owner Email, country, date, optional GTIN)
 * - action=calculateShippingRates&cart={...}&shippingAddress={...}&environment=development - Calculate shipping rates
 * 
 * @param {Object} e Event object containing parameters.
 * @return {ContentService.TextOutput} JSON response with results or error.
 */
function doGet(e) {
  try {
    var action = e.parameter.action;

    if (action === 'getOrderStatus') {
      var sessionId = e.parameter.sessionId;
      if (!sessionId) {
        return createCORSResponse({
          status: 'error',
          error: 'sessionId parameter is required'
        });
      }
      return getOrderStatus(sessionId);
    }

    if (action === 'getGcrContextByQr') {
      var qrParam = e.parameter.qr;
      return getGcrContextByQrCode(qrParam);
    }

    if (action === 'calculateShippingRates') {
      // Parse weight and shippingAddress from URL parameters (simplified payload)
      var weightOz = parseFloat(e.parameter.weightOz);
      var shippingAddress = null;
      var environment = e.parameter.environment || 'production';
      
      if (!weightOz || weightOz <= 0) {
        return createCORSResponse({
          status: 'error',
          error: 'weightOz parameter is required and must be greater than 0'
        });
      }
      
      if (e.parameter.shippingAddress) {
        try {
          shippingAddress = JSON.parse(e.parameter.shippingAddress);
        } catch (parseError) {
          Logger.log('Warning: Invalid shippingAddress JSON: ' + parseError.toString());
        }
      }
      
      // Call simplified calculateShippingRates function
      return calculateShippingRatesSimple(weightOz, shippingAddress, environment);
    }

    if (action === 'createCheckoutSession') {
      // Parse cart, shippingAddress, and selectedShippingRateId from URL parameters
      var cart = null;
      var shippingAddress = null;
      var selectedShippingRateId = null;
      var environment = e.parameter.environment || 'production';
      
      if (e.parameter.cart) {
        try {
          cart = JSON.parse(e.parameter.cart);
        } catch (parseError) {
          return createCORSResponse({
            status: 'error',
            error: 'Invalid cart JSON: ' + parseError.toString()
          });
        }
      } else {
        return createCORSResponse({
          status: 'error',
          error: 'cart parameter is required'
        });
      }
      
      if (e.parameter.shippingAddress) {
        try {
          shippingAddress = JSON.parse(e.parameter.shippingAddress);
        } catch (parseError) {
          Logger.log('Warning: Invalid shippingAddress JSON: ' + parseError.toString());
        }
      }
      
      if (e.parameter.selectedShippingRateId) {
        selectedShippingRateId = e.parameter.selectedShippingRateId;
      }
      
      // Call the same createCheckoutSession function used by POST
      return createCheckoutSession({
        cart: cart,
        shippingAddress: shippingAddress,
        selectedShippingRateId: selectedShippingRateId,
        environment: environment
      });
    }

    if (action === 'createSubscriptionPortalSession') {
      var sessionId = e.parameter.sessionId;
      var environment = e.parameter.environment || 'production';
      
      if (!sessionId) {
        return createCORSResponse({
          status: 'error',
          error: 'sessionId parameter is required'
        });
      }
      
      return createSubscriptionPortalSession({
        sessionId: sessionId,
        environment: environment
      });
    }

    if (action === 'createSubscriptionCheckoutSession') {
      // Parse subscription parameters from URL
      var sku = e.parameter.sku;
      var quantity = parseInt(e.parameter.quantity, 10) || 6;
      var shippingAddress = null;
      var environment = e.parameter.environment || 'production';
      
      if (e.parameter.shippingAddress) {
        try {
          shippingAddress = JSON.parse(e.parameter.shippingAddress);
        } catch (parseError) {
          Logger.log('Warning: Invalid shippingAddress JSON: ' + parseError.toString());
        }
      }
      
      // Call createSubscriptionCheckoutSession
      return createSubscriptionCheckoutSession({
        sku: sku,
        quantity: quantity,
        shippingAddress: shippingAddress,
        environment: environment,
        name: e.parameter.name || '',
        price: e.parameter.price || '',
        weight: e.parameter.weight || '',
        image: e.parameter.image || ''
      });
    }

    if (action === 'triggerSync') {
      syncStripeOrdersForEnvironment('production');
      return createCORSResponse({
        status: 'success',
        message: 'Sync triggered for production environment'
      });
    }

    return createCORSResponse({
      status: 'error',
      error: 'Invalid action. Use: action=getOrderStatus&sessionId=cs_xxx | action=getGcrContextByQr&qr=... | action=calculateShippingRates&... | action=createSubscriptionPortalSession&sessionId=... | action=triggerSync'
    });
  } catch (error) {
    Logger.log('Error in doGet: ' + error.toString());
    return createCORSResponse({
      status: 'error',
      error: error.toString()
    });
  }
}

/**
 * Create Stripe Checkout Session
 * 
 * @param {Object} data Request data containing cart, shippingAddress, and environment
 * @return {ContentService.TextOutput} JSON response with checkout URL or error
 */
function createCheckoutSession(data) {
  try {
    var cart = data.cart;
    var shippingAddress = data.shippingAddress;
    var environment = data.environment || 'production';
    
    // Get environment-specific configuration
    var CONFIG = getConfig(environment);

    if (!cart || !cart.items || cart.items.length === 0) {
      return createCORSResponse({
        status: 'error',
        error: 'Cart is empty'
      });
    }
    
    // Validate Stripe key is configured
    if (!CONFIG.stripeSecretKey) {
      var keyType = environment === 'development' ? 'STRIPE_TEST_SECRET_KEY' : 'STRIPE_LIVE_SECRET_KEY';
      return createCORSResponse({
        status: 'error',
        error: 'Stripe ' + environment + ' secret key not configured. Please set ' + keyType + ' in Script Properties.'
      });
    }

    // Build line items for Stripe using price_data (like sentiment_importer)
    // This creates products dynamically without needing pre-created Price IDs
    var lineItems = [];
    for (var i = 0; i < cart.items.length; i++) {
      var item = cart.items[i];
      
      // Validate price
      var priceAmount = parseFloat(item.price) || 0;
      if (priceAmount <= 0) {
        return createCORSResponse({
          status: 'error',
          error: 'Invalid price for product: ' + (item.name || item.productId) + '. Price must be greater than 0.'
        });
      }
      
      // Convert price to cents
      var unitAmount = Math.round(priceAmount * 100);
      
      // Build product image URL (if relative, make it absolute)
      // Stripe requires absolute HTTPS URLs for images (even in test mode)
      var imageUrl = item.image || '';
      
      // Log original image value for debugging
      Logger.log('Processing image for product: ' + item.name);
      Logger.log('  Original image value: ' + (imageUrl || '(empty)'));
      Logger.log('  Product ID: ' + (item.productId || 'N/A'));
      
      if (imageUrl) {
        // Make relative URLs absolute based on environment
        // For localhost development, use beta.agroverse.shop so Stripe can access images
        // Stripe requires publicly accessible HTTPS URLs for images
        var baseUrl;
        if (environment === 'development') {
          // Local development - use beta.agroverse.shop for images (Stripe can't access localhost)
          baseUrl = 'https://beta.agroverse.shop';
        } else {
          // Production - use main domain
          baseUrl = 'https://www.agroverse.shop';
        }
        
        // Ensure image path starts with /
        // Handle both '/assets/...' and 'assets/...' formats
        var imagePath = imageUrl.indexOf('/') === 0 ? imageUrl : '/' + imageUrl;
        imageUrl = baseUrl + imagePath;
        
        // Ensure HTTPS (Stripe requirement - all image URLs must be HTTPS)
        if (imageUrl.indexOf('http://') === 0) {
          imageUrl = imageUrl.replace('http://', 'https://');
        }
        
        // Validate URL format
        if (imageUrl.indexOf('https://') !== 0) {
          Logger.log('  ERROR: Invalid image URL format: ' + imageUrl);
          imageUrl = ''; // Clear invalid URL
        } else {
          Logger.log('  Final image URL: ' + imageUrl);
        }
      } else {
        Logger.log('  WARNING: No image URL for product: ' + item.name + ' (productId: ' + (item.productId || 'N/A') + ')');
        Logger.log('  Cart item data: ' + JSON.stringify({
          productId: item.productId,
          name: item.name,
          hasImage: !!item.image,
          imageValue: item.image
        }));
      }
      
      // Build line item with price_data (dynamic product creation)
      var productData = {
        name: item.name || 'Product',
        description: item.name || 'Product'
      };
      
      // Only include images if we have a valid image URL
      // Stripe will ignore empty arrays, so we only add the field if there's an image
      if (imageUrl) {
        productData.images = [imageUrl];
        Logger.log('  Adding image to Stripe product: ' + imageUrl);
      } else {
        Logger.log('  WARNING: No image URL for product "' + item.name + '" - images array will be empty');
      }
      
      var lineItem = {
        quantity: parseInt(item.quantity) || 1,
        price_data: {
          currency: 'usd',
          unit_amount: unitAmount,
          product_data: productData
        }
      };
      
      lineItems.push(lineItem);
      Logger.log('  Line item created for: ' + item.name + ' (quantity: ' + lineItem.quantity + ', price: $' + (unitAmount / 100).toFixed(2) + ')');
    }

    // Determine success and cancel URLs based on environment
    var baseUrl = environment === 'development' 
      ? 'https://beta.agroverse.shop' 
      : 'https://www.agroverse.shop';

    var successUrl = baseUrl + '/order-status?session_id={CHECKOUT_SESSION_ID}';
    var cancelUrl = baseUrl + '/checkout';

    // Calculate package weight (product weights + packaging)
    // Note: Product weights should be in cart.items[].weight (in ounces)
    var totalWeightOz = calculatePackageWeight(cart);
    
    // Calculate shipping rates via EasyPost only (no fallback)
    var shippingOptions = [];
    if (totalWeightOz > 0) {
      shippingOptions = calculateShippingRatesViaEasyPost(totalWeightOz, shippingAddress);
    }
    
    // Return error if no shipping rates available (don't use fallback)
    if (shippingOptions.length === 0) {
      return createCORSResponse({
        status: 'error',
        error: 'Unable to calculate shipping rates. Please ensure EasyPost API is configured and address is valid.'
      });
    }

    // Create Stripe checkout session
    var payload = {
      mode: 'payment',
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      shipping_address_collection: {
        allowed_countries: ['US']
      },
      billing_address_collection: 'required',
      phone_number_collection: {
        enabled: true
      },
      metadata: {
        cartSessionId: cart.sessionId || '',
        environment: environment,
        source: 'agroverse_shop'
      }
    };

    // Add shipping options if we have them
    if (shippingOptions && shippingOptions.length > 0) {
      payload.shipping_options = shippingOptions;
      
      // If user selected a specific shipping rate, pre-select it
      var selectedShippingRateId = data.selectedShippingRateId;
      if (selectedShippingRateId) {
        // Find the matching shipping rate in our options
        // Note: The selectedShippingRateId from frontend is like "rate_0", "rate_1"
        // We need to map it to the actual Stripe shipping rate ID
        // For now, we'll use the index to find the matching option
        var rateIndex = null;
        if (selectedShippingRateId.indexOf('rate_') === 0) {
          rateIndex = parseInt(selectedShippingRateId.replace('rate_', ''));
          if (!isNaN(rateIndex) && rateIndex >= 0 && rateIndex < shippingOptions.length) {
            // Pre-select the shipping rate by using shipping_rate instead of shipping_options
            // But we still include shipping_options so user can change it in Stripe
            // Actually, Stripe doesn't support pre-selection via API, so we'll just
            // include all options and let Stripe show them. The user's selection
            // on our page is for their awareness, but Stripe will still show options.
            // We could potentially use shipping_rate (singular) to force a specific one,
            // but that would prevent users from changing it in Stripe.
            // For now, we'll pass all options and let Stripe handle the selection.
          }
        }
      }
    }

    // Note: We keep shipping_address_collection enabled so Stripe can show shipping options
    // The address collected on our form is used for metadata, but Stripe will collect
    // the shipping address during checkout to calculate/display shipping rates properly

    // Log payload for debugging (especially line items with images)
    Logger.log('Creating Stripe checkout session with ' + lineItems.length + ' line items');
    for (var li = 0; li < lineItems.length; li++) {
      var liItem = lineItems[li];
      Logger.log('  Line item ' + (li + 1) + ': ' + (liItem.price_data.product_data.name || 'Unknown'));
      if (liItem.price_data.product_data.images && liItem.price_data.product_data.images.length > 0) {
        Logger.log('    Image: ' + liItem.price_data.product_data.images[0]);
      } else {
        Logger.log('    Image: (none)');
      }
    }
    
    var formData = buildFormData(payload);
    Logger.log('Form data length: ' + formData.length + ' characters');
    Logger.log('Form data preview (first 500 chars): ' + formData.substring(0, 500));
    
    var response = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'post',
      headers: {
        'Authorization': 'Bearer ' + CONFIG.stripeSecretKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      payload: formData,
      muteHttpExceptions: true // Get full error messages
    });
    
    // Check for errors
    var responseText = response.getContentText();
    if (response.getResponseCode() !== 200) {
      Logger.log('Stripe API Error Response: ' + responseText);
      var errorData = JSON.parse(responseText);
      throw new Error('Stripe API error: ' + (errorData.error ? errorData.error.message : responseText));
    }

    var session = JSON.parse(responseText);

    if (session.error) {
      return createCORSResponse({
        status: 'error',
        error: session.error.message
      });
    }

    return createCORSResponse({
      status: 'success',
      checkoutUrl: session.url,
      sessionId: session.id
    });
  } catch (error) {
    Logger.log('Error creating checkout session: ' + error.toString());
    return createCORSResponse({
      status: 'error',
      error: error.toString()
    });
  }
}

/**
 * Create a Stripe Customer Portal session for subscription management.
 * Called from the success page when user clicks "Manage Subscription".
 *
 * @param {Object} data Request data containing sessionId and environment
 * @return {ContentService.TextOutput} JSON response with portal URL or error
 */
function createSubscriptionPortalSession(data) {
  try {
    var sessionId = data.sessionId;
    var environment = data.environment || 'production';

    if (!sessionId) {
      return createCORSResponse({
        status: 'error',
        error: 'sessionId parameter is required'
      });
    }

    var CONFIG = getConfig(environment);

    if (!CONFIG.stripeSecretKey) {
      var keyType = environment === 'development' ? 'STRIPE_TEST_SECRET_KEY' : 'STRIPE_LIVE_SECRET_KEY';
      return createCORSResponse({
        status: 'error',
        error: 'Stripe ' + environment + ' secret key not configured. Please set ' + keyType + ' in Script Properties.'
      });
    }

    // Step 1: Retrieve the Checkout Session to get the Customer ID
    var sessionResponse = UrlFetchApp.fetch(
      'https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(sessionId),
      {
        method: 'get',
        headers: {
          'Authorization': 'Bearer ' + CONFIG.stripeSecretKey
        },
        muteHttpExceptions: true
      }
    );

    var sessionCode = sessionResponse.getResponseCode();
    var sessionBody = JSON.parse(sessionResponse.getContentText());

    if (sessionCode >= 400) {
      throw new Error(sessionBody.error ? sessionBody.error.message : 'Failed to retrieve session: ' + sessionCode);
    }

    var customerId = sessionBody.customer;
    if (!customerId) {
      throw new Error('No customer found for this session');
    }

    // Step 2: Create a Customer Portal session
    var baseUrl = environment === 'development'
      ? 'https://beta.agroverse.shop'
      : 'https://www.agroverse.shop';
    var returnUrl = baseUrl + '/subscribe/chocolate-bar/?manage=true';

    var portalPayload = {
      customer: customerId,
      return_url: returnUrl
    };

    var portalResponse = UrlFetchApp.fetch(
      'https://api.stripe.com/v1/billing_portal/sessions',
      {
        method: 'post',
        headers: {
          'Authorization': 'Bearer ' + CONFIG.stripeSecretKey,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        payload: buildFormData(portalPayload),
        muteHttpExceptions: true
      }
    );

    var portalCode = portalResponse.getResponseCode();
    var portalBody = JSON.parse(portalResponse.getContentText());

    if (portalCode >= 400) {
      throw new Error(portalBody.error ? portalBody.error.message : 'Failed to create portal session: ' + portalCode);
    }

    return createCORSResponse({
      status: 'success',
      portalUrl: portalBody.url
    });

  } catch (error) {
    Logger.log('Error creating portal session: ' + error.toString());
    return createCORSResponse({
      status: 'error',
      error: error.toString()
    });
  }
}


/**
 * Create Stripe Subscription Checkout Session
 * Purely additive — does NOT touch the existing createCheckoutSession.
 *
 * Input: sku (productId), quantity, shippingAddress, environment
 * Creates a subscription-mode checkout session with:
 *   - Recurring unit line (monthly)
 *   - Recurring shipping line (EasyPost, one tier)
 *
 * @param {Object} data Request data containing sku, quantity, shippingAddress, environment
 * @return {ContentService.TextOutput} JSON response with checkout URL or error
 */
function createSubscriptionCheckoutSession(data) {
  try {
    var sku = data.sku;
    var quantity = parseInt(data.quantity, 10) || 6;
    var shippingAddress = data.shippingAddress;
    var environment = data.environment || 'production';

    var CONFIG = getConfig(environment);

    // Validate SKU
    if (!sku) {
      return createCORSResponse({
        status: 'error',
        error: 'sku parameter is required'
      });
    }

    // Validate Stripe key
    if (!CONFIG.stripeSecretKey) {
      var keyType = environment === 'development' ? 'STRIPE_TEST_SECRET_KEY' : 'STRIPE_LIVE_SECRET_KEY';
      return createCORSResponse({
        status: 'error',
        error: 'Stripe ' + environment + ' secret key not configured. Please set ' + keyType + ' in Script Properties.'
      });
    }

    // Resolve product info from the catalog (passed via data or looked up)
    // The frontend sends sku, name, price, weight, image in the data
    var productName = data.name || 'Ceremonial Cacao Chocolate Bar';
    var unitPrice = parseFloat(data.price) || 10.00;
    var unitWeight = parseFloat(data.weight) || 1.76; // 50g bar in oz
    var productImage = data.image || '';

    // Clamp quantity to reasonable bounds
    quantity = Math.max(1, Math.min(24, quantity));

    // Convert price to cents
    var unitAmount = Math.round(unitPrice * 100);

    // Build product image URL (absolute HTTPS for Stripe)
    if (productImage) {
      var baseUrl = environment === 'development' ? 'https://beta.agroverse.shop' : 'https://www.agroverse.shop';
      var imagePath = productImage.indexOf('/') === 0 ? productImage : '/' + productImage;
      productImage = baseUrl + imagePath;
      if (productImage.indexOf('http://') === 0) {
        productImage = productImage.replace('http://', 'https://');
      }
    }

    // Build line items
    var lineItems = [];

    // Line 1: Recurring unit line
    var productData = {
      name: productName,
      description: productName
    };
    if (productImage) {
      productData.images = [productImage];
    }

    lineItems.push({
      quantity: quantity,
      price_data: {
        currency: 'usd',
        unit_amount: unitAmount,
        recurring: {
          interval: 'month'
        },
        product_data: productData
      }
    });

    // Line 2: Recurring shipping line
    // Calculate total weight: product weight + packaging
    var props = PropertiesService.getScriptProperties();
    var baseBoxWeight = parseFloat(props.getProperty('BASE_BOX_WEIGHT_OZ')) || 11.5;
    var perItemWeight = parseFloat(props.getProperty('PER_ITEM_PACKAGING_OZ')) || 0.65;
    var totalWeightOz = (unitWeight * quantity) + baseBoxWeight + (perItemWeight * quantity);

    // Get shipping rate via EasyPost (one tier, e.g. Ground Advantage)
    var shippingOptions = [];
    if (totalWeightOz > 0) {
      shippingOptions = calculateShippingRatesViaEasyPost(totalWeightOz, shippingAddress);
    }

    // Pick the cheapest USPS rate for the recurring shipping line
    var shippingAmountCents = 500; // Fallback $5.00
    var shippingDisplayName = 'Ground Advantage - USPS';
    if (shippingOptions.length > 0) {
      // Sort by price and pick the cheapest
      shippingOptions.sort(function(a, b) {
        return (a.shipping_rate_data.fixed_amount.amount || 0) - (b.shipping_rate_data.fixed_amount.amount || 0);
      });
      shippingAmountCents = shippingOptions[0].shipping_rate_data.fixed_amount.amount || 500;
      shippingDisplayName = shippingOptions[0].shipping_rate_data.display_name || 'Ground Advantage - USPS';
    }

    // Add shipping as a recurring line item (subscription mode doesn't support
    // interactive shipping_options picker, so we lock the shipping amount)
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: shippingAmountCents,
        recurring: {
          interval: 'month'
        },
        product_data: {
          name: 'Shipping (' + shippingDisplayName + ')',
          description: 'Monthly shipping — ' + shippingDisplayName
        }
      }
    });

    // Determine success and cancel URLs
    var baseUrl = environment === 'development'
      ? 'https://beta.agroverse.shop'
      : 'https://www.agroverse.shop';

    var successUrl = baseUrl + '/subscribe/chocolate-bar/?success=true&session_id={CHECKOUT_SESSION_ID}';
    var cancelUrl = baseUrl + '/subscribe/chocolate-bar/?canceled=true';

    // Build Stripe payload
    var payload = {
      mode: 'subscription',
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      billing_address_collection: 'required',
      phone_number_collection: {
        enabled: true
      },
      metadata: {
        sku: sku,
        quantity: quantity.toString(),
        environment: environment,
        source: 'agroverse_shop_subscription'
      }
    };

    // Add shipping address collection for subscription
    // Note: In subscription mode, shipping_address_collection is not supported
    // on the session level. The shipping address is collected via the customer
    // portal or managed separately. We pass it in metadata for fulfillment.
    if (shippingAddress) {
      payload.metadata.shippingName = shippingAddress.fullName || shippingAddress.name || '';
      payload.metadata.shippingAddress = shippingAddress.address || '';
      payload.metadata.shippingCity = shippingAddress.city || '';
      payload.metadata.shippingState = shippingAddress.state || '';
      payload.metadata.shippingZip = shippingAddress.zip || '';
      payload.metadata.shippingCountry = shippingAddress.country || 'US';
    }

    Logger.log('Creating subscription checkout session for sku: ' + sku + ', qty: ' + quantity);
    Logger.log('  Unit price: $' + (unitAmount / 100).toFixed(2));
    Logger.log('  Shipping: $' + (shippingAmountCents / 100).toFixed(2));
    Logger.log('  Total monthly: $' + ((unitAmount * quantity + shippingAmountCents) / 100).toFixed(2));

    var formData = buildFormData(payload);

    var response = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'post',
      headers: {
        'Authorization': 'Bearer ' + CONFIG.stripeSecretKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      payload: formData,
      muteHttpExceptions: true
    });

    var responseText = response.getContentText();
    if (response.getResponseCode() !== 200) {
      Logger.log('Stripe API Error Response: ' + responseText);
      var errorData = JSON.parse(responseText);
      throw new Error('Stripe API error: ' + (errorData.error ? errorData.error.message : responseText));
    }

    var session = JSON.parse(responseText);

    if (session.error) {
      return createCORSResponse({
        status: 'error',
        error: session.error.message
      });
    }

    return createCORSResponse({
      status: 'success',
      checkoutUrl: session.url,
      sessionId: session.id
    });
  } catch (error) {
    Logger.log('Error creating subscription checkout session: ' + error.toString());
    return createCORSResponse({
      status: 'error',
      error: error.toString()
    });
  }
}

/**
 * Handle Stripe webhook (OPTIONAL - not required if using polling)
 * 
 * NOTE: This function is kept for backward compatibility but is not required
 * if you're using the polling approach (syncStripeOrders).
 * 
 * If you want to use webhooks instead of polling:
 * 1. Set up webhook endpoint in Stripe Dashboard
 * 2. Point it to your Google App Script Web App URL
 * 3. Implement proper signature verification
 * 4. This function will then be called automatically
 */
function handleStripeWebhook(e) {
  try {
    var signature = e.parameter['stripe-signature'];
    var payload = e.postData.contents;

    // TODO: Implement webhook signature verification if using webhooks
    // For now, we use polling (syncStripeOrders) instead

    var event = JSON.parse(payload);

    if (event.type === 'checkout.session.completed') {
      var session = event.data.object;
      // Get environment from session metadata or default to production
      var environment = session.metadata && session.metadata.environment ? session.metadata.environment : 'production';
      
      // Retrieve full session with line items for accurate order data
      var CONFIG = getConfig(environment);
      var fullSession = retrieveStripeSession(session.id, CONFIG.stripeSecretKey);
      
      // Use full session if available, otherwise use the session from webhook
      var sessionToSave = fullSession || session;
      saveOrderToSheet(sessionToSave, environment);
    } else if (event.type === 'invoice.paid') {
      var invoice = event.data.object;
      var CONFIG = getConfig('production');
      // Only process subscription renewal invoices
      if (invoice.subscription && invoice.billing_reason === 'subscription_cycle') {
        var subscription = retrieveStripeSubscription(invoice.subscription, CONFIG.stripeSecretKey);
        var originalSessionId = subscription && subscription.metadata && subscription.metadata.checkout_session_id ? subscription.metadata.checkout_session_id : '';
        saveSubscriptionPaymentToSheet(invoice, subscription, originalSessionId, CONFIG);
      }
    }

    return createCORSResponse({
      received: true
    });
  } catch (error) {
    Logger.log('Error handling webhook: ' + error.toString());
    return createCORSResponse({
      error: error.toString()
    });
  }
}

/**
 * Calculate shipping rates (simplified - just weight and address)
 * Returns shipping rates without creating a checkout session
 * 
 * @param {Number} weightOz Total package weight in ounces
 * @param {Object} shippingAddress Customer shipping address (optional)
 * @param {String} environment Environment (development/production)
 * @return {ContentService.TextOutput} JSON response with shipping rates or error
 */
function calculateShippingRatesSimple(weightOz, shippingAddress, environment) {
  try {
    if (!weightOz || weightOz <= 0) {
      return createCORSResponse({
        status: 'error',
        error: 'Invalid weight: ' + weightOz + ' oz'
      });
    }
    
    // Calculate shipping rates via EasyPost only (no fallback)
    var shippingOptions = calculateShippingRatesViaEasyPost(weightOz, shippingAddress);
    
    // Return error if no shipping rates available (don't use fallback)
    if (shippingOptions.length === 0) {
      return createCORSResponse({
        status: 'error',
        error: 'Unable to calculate shipping rates. Please ensure EasyPost API is configured and address is valid. Check Google App Script logs for details.'
      });
    }
    
    // Format rates for display (convert to dollars, add delivery info)
    var formattedRates = [];
    for (var j = 0; j < shippingOptions.length; j++) {
      var rate = shippingOptions[j];
      var amountCents = rate.shipping_rate_data.fixed_amount.amount || 0;
      var amountDollars = (amountCents / 100).toFixed(2);
      var displayName = rate.shipping_rate_data.display_name || 'Shipping';
      var deliveryEstimate = rate.shipping_rate_data.delivery_estimate || {};
      var minDays = deliveryEstimate.minimum ? deliveryEstimate.minimum.value : 3;
      var maxDays = deliveryEstimate.maximum ? deliveryEstimate.maximum.value : 7;
      
      formattedRates.push({
        id: 'rate_' + j,
        name: displayName,
        amount: parseFloat(amountDollars),
        amountCents: amountCents,
        deliveryDays: minDays + '-' + maxDays + ' business days'
      });
    }
    
    return createCORSResponse({
      status: 'success',
      rates: formattedRates,
      totalWeightOz: weightOz
    });
  } catch (error) {
    Logger.log('Error calculating shipping rates: ' + error.toString());
    return createCORSResponse({
      status: 'error',
      error: error.toString()
    });
  }
}

/**
 * Calculate shipping rates (legacy - for backward compatibility with POST requests)
 * Returns shipping rates without creating a checkout session
 * 
 * @param {Object} data Request data containing cart, shippingAddress, and environment
 * @return {ContentService.TextOutput} JSON response with shipping rates or error
 */
function calculateShippingRates(data) {
  try {
    var cart = data.cart;
    var shippingAddress = data.shippingAddress;
    var environment = data.environment || 'production';
    
    if (!cart || !cart.items || cart.items.length === 0) {
      return createCORSResponse({
        status: 'error',
        error: 'Cart is empty'
      });
    }
    
    // Calculate package weight
    var totalWeightOz = calculatePackageWeight(cart);
    
    // Check if products have weights
    var hasProductWeights = false;
    for (var w = 0; w < cart.items.length; w++) {
      if (cart.items[w].weight && parseFloat(cart.items[w].weight) > 0) {
        hasProductWeights = true;
        break;
      }
    }
    
    if (!hasProductWeights) {
      return createCORSResponse({
        status: 'error',
        error: 'Products are missing weight information. Please refresh the checkout page to update cart weights, or clear your cart and re-add items.'
      });
    }
    
    // Use simplified function
    return calculateShippingRatesSimple(totalWeightOz, shippingAddress, environment);
  } catch (error) {
    Logger.log('Error calculating shipping rates: ' + error.toString());
    return createCORSResponse({
      status: 'error',
      error: error.toString()
    });
  }
}

/**
 * Calculate total package weight
 * Includes product weights + base box weight + per-item packaging
 * Similar to sentiment_importer implementation
 * 
 * @param {Object} cart Cart object with items
 * @return {Number} Total weight in ounces
 */
function calculatePackageWeight(cart) {
  var props = PropertiesService.getScriptProperties();
  
  // Base box weight (fixed, regardless of items)
  // Default: 11.5 oz (can be overridden via Script Properties)
  var baseBoxWeight = parseFloat(props.getProperty('BASE_BOX_WEIGHT_OZ')) || 11.5;
  
  // Per-item packaging weight (bubble wrap, padding per item)
  // Default: 0.65 oz (can be overridden via Script Properties)
  var perItemWeight = parseFloat(props.getProperty('PER_ITEM_PACKAGING_OZ')) || 0.65;
  
  // Calculate product weight
  var productWeightOz = 0;
  var totalQuantity = 0;
  
  for (var i = 0; i < cart.items.length; i++) {
    var item = cart.items[i];
    var itemWeight = parseFloat(item.weight) || 0; // Product weight in ounces
    
    // If weight is missing (0), log a warning but continue
    // Note: Frontend should include weights, but this handles legacy cart items
    if (itemWeight <= 0) {
      Logger.log('WARNING: Product ' + (item.productId || item.name) + ' has no weight. Using 0 for this item.');
    }
    
    var quantity = parseInt(item.quantity) || 1;
    productWeightOz += itemWeight * quantity;
    totalQuantity += quantity;
  }
  
  // Package weight = base box + per-item packaging
  var packageWeightOz = baseBoxWeight + (perItemWeight * totalQuantity);
  
  // Total weight = product weight + package weight
  var totalWeightOz = productWeightOz + packageWeightOz;
  
  return totalWeightOz;
}

/**
 * Calculate shipping rates via EasyPost API
 * Similar to sentiment_importer ShippingCalculatorService
 * 
 * @param {Number} weightOz Package weight in ounces
 * @param {Object} shippingAddress Customer shipping address (optional, uses default if not provided)
 * @return {Array} Array of shipping rate objects for Stripe
 */
function calculateShippingRatesViaEasyPost(weightOz, shippingAddress) {
  try {
    var props = PropertiesService.getScriptProperties();
    var easypostApiKey = props.getProperty('EASYPOST_API_KEY');
    
    if (!easypostApiKey) {
      Logger.log('ERROR: EasyPost API key not configured. Set EASYPOST_API_KEY in Script Properties.');
      return [];
    }
    
    if (weightOz <= 0) {
      Logger.log('ERROR: Invalid weight for EasyPost calculation: ' + weightOz + ' oz. Products may be missing weight data.');
      return [];
    }
    
    // Get origin address from Script Properties with hardcoded defaults
    // Similar to sentiment_importer: ENV.fetch('KEY', 'default')
    var originAddress = {
      street1: props.getProperty('ORIGIN_ADDRESS_LINE1') || '1423 Hayes St',
      street2: props.getProperty('ORIGIN_ADDRESS_LINE2') || '',
      city: props.getProperty('ORIGIN_ADDRESS_CITY') || 'San Francisco',
      state: props.getProperty('ORIGIN_ADDRESS_STATE') || 'CA',
      zip: props.getProperty('ORIGIN_ADDRESS_POSTAL_CODE') || '94117',
      country: props.getProperty('ORIGIN_ADDRESS_COUNTRY') || 'US'
    };
    
    Logger.log('Origin address: ' + originAddress.street1 + ', ' + originAddress.city + ', ' + originAddress.state + ' ' + originAddress.zip);
    
    // Use customer address if provided, otherwise use default (center of US)
    var destinationAddress;
    if (shippingAddress && shippingAddress.address) {
      destinationAddress = {
        street1: shippingAddress.address || '',
        city: shippingAddress.city || '',
        state: shippingAddress.state || '',
        zip: shippingAddress.zip || '',
        country: shippingAddress.country || 'US'
      };
    } else {
      // Default destination for initial rate calculation
      destinationAddress = {
        street1: '1600 Pennsylvania Avenue NW',
        city: 'Washington',
        state: 'DC',
        zip: '20500',
        country: 'US'
      };
    }
    
    // Create shipment with parcel included directly (no need for separate parcel creation)
    var shipmentPayload = {
      to_address: destinationAddress,
      from_address: originAddress,
      parcel: {
        weight: weightOz,
        length: 10, // Default dimensions
        width: 10,
        height: 10
      }
    };
    
    Logger.log('Creating shipment with payload: ' + JSON.stringify(shipmentPayload));
    
    var shipmentResponse = UrlFetchApp.fetch('https://api.easypost.com/v2/shipments', {
      method: 'post',
      headers: {
        'Authorization': 'Basic ' + Utilities.base64Encode(easypostApiKey + ':'),
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({ shipment: shipmentPayload }),
      muteHttpExceptions: true
    });
    
    var shipmentResponseCode = shipmentResponse.getResponseCode();
    var shipmentResponseText = shipmentResponse.getContentText();
    
    Logger.log('EasyPost shipment API response code: ' + shipmentResponseCode);
    Logger.log('EasyPost shipment API response (first 500 chars): ' + shipmentResponseText.substring(0, 500));
    
    if (shipmentResponseCode !== 201) {
      Logger.log('ERROR: EasyPost shipment creation failed (code ' + shipmentResponseCode + '): ' + shipmentResponseText);
      return [];
    }
    
    var shipmentData;
    try {
      shipmentData = JSON.parse(shipmentResponseText);
      Logger.log('Shipment response keys: ' + Object.keys(shipmentData).join(', '));
    } catch (parseError) {
      Logger.log('ERROR: Failed to parse EasyPost shipment response: ' + parseError.toString());
      Logger.log('Response text: ' + shipmentResponseText);
      return [];
    }
    
    // Check for error in response
    if (shipmentData.error) {
      Logger.log('ERROR: EasyPost API error: ' + JSON.stringify(shipmentData.error));
      return [];
    }
    
    // EasyPost returns shipment data directly at root level (not nested under 'shipment')
    // Handle both formats: shipmentData.shipment (nested) or shipmentData (root)
    var shipment = shipmentData.shipment || shipmentData;
    if (!shipment || !shipment.rates) {
      Logger.log('ERROR: No shipment object or rates in response. Response keys: ' + Object.keys(shipmentData).join(', '));
      Logger.log('Response structure (first 1000 chars): ' + JSON.stringify(shipmentData).substring(0, 1000));
      return [];
    }
    
    var rates = shipment.rates || [];
    
    Logger.log('EasyPost returned ' + rates.length + ' total rates');
    
    // Filter for USPS rates only
    var uspsRates = [];
    for (var i = 0; i < rates.length; i++) {
      if (rates[i].carrier === 'USPS') {
        uspsRates.push(rates[i]);
      }
    }
    
    Logger.log('Found ' + uspsRates.length + ' USPS rates');
    
    if (uspsRates.length === 0) {
      Logger.log('WARNING: No USPS rates found. Available carriers: ' + rates.map(function(r) { return r.carrier; }).join(', '));
    }
    
    // Convert to Stripe shipping rate format
    var shippingOptions = [];
    for (var j = 0; j < uspsRates.length; j++) {
      var rate = uspsRates[j];
      var rateValue = parseFloat(rate.rate || rate.price || 0);
      var serviceName = rate.service || 'Standard';
      
      shippingOptions.push({
        shipping_rate_data: {
          type: 'fixed_amount',
          fixed_amount: {
            amount: Math.round(rateValue * 100), // Convert to cents
            currency: 'usd'
          },
          display_name: serviceName + ' - USPS',
          delivery_estimate: estimateFromService(serviceName)
        }
      });
    }
    
    // Sort by price (cheapest first)
    shippingOptions.sort(function(a, b) {
      var amountA = a.shipping_rate_data.fixed_amount.amount || Infinity;
      var amountB = b.shipping_rate_data.fixed_amount.amount || Infinity;
      return amountA - amountB;
    });
    
    Logger.log('Returning ' + shippingOptions.length + ' shipping options from EasyPost');
    return shippingOptions;
  } catch (error) {
    Logger.log('ERROR: Exception in calculateShippingRatesViaEasyPost: ' + error.toString());
    Logger.log('Stack trace: ' + (error.stack || 'N/A'));
    return [];
  }
}

/**
 * Estimate delivery time from USPS service name
 * 
 * @param {String} serviceName USPS service name
 * @return {Object} Delivery estimate object
 */
function estimateFromService(serviceName) {
  var service = serviceName.toLowerCase();
  
  if (service.indexOf('priority mail express') !== -1) {
    return { minimum: { unit: 'business_day', value: 1 }, maximum: { unit: 'business_day', value: 2 } };
  } else if (service.indexOf('priority mail') !== -1) {
    return { minimum: { unit: 'business_day', value: 2 }, maximum: { unit: 'business_day', value: 3 } };
  } else if (service.indexOf('first-class') !== -1) {
    return { minimum: { unit: 'business_day', value: 3 }, maximum: { unit: 'business_day', value: 5 } };
  } else if (service.indexOf('parcel select') !== -1) {
    return { minimum: { unit: 'business_day', value: 5 }, maximum: { unit: 'business_day', value: 7 } };
  } else {
    return { minimum: { unit: 'business_day', value: 3 }, maximum: { unit: 'business_day', value: 7 } };
  }
}

/**
 * Build shipping rates based on order total (FALLBACK)
 * Similar to sentiment_importer implementation
 * 
 * @param {Number} orderTotalCents Order total in cents
 * @return {Array} Array of shipping rate objects for Stripe
 */
function buildShippingRates(orderTotalCents) {
  var currency = 'usd';
  var rates = [];
  
  // Standard shipping: $5.00 (500 cents)
  rates.push({
    shipping_rate_data: {
      type: 'fixed_amount',
      fixed_amount: {
        amount: 500, // $5.00 in cents
        currency: currency
      },
      display_name: 'Standard Shipping',
      delivery_estimate: {
        minimum: { unit: 'business_day', value: 3 },
        maximum: { unit: 'business_day', value: 7 }
      }
    }
  });
  
  // Express shipping
  rates.push({
    shipping_rate_data: {
      type: 'fixed_amount',
      fixed_amount: {
        amount: 1500, // $15.00 in cents
        currency: currency
      },
      display_name: 'Express Shipping',
      delivery_estimate: {
        minimum: { unit: 'business_day', value: 1 },
        maximum: { unit: 'business_day', value: 3 }
      }
    }
  });
  
  // Sort by price (cheapest first) - Stripe will auto-select the first option
  rates.sort(function(a, b) {
    var amountA = a.shipping_rate_data.fixed_amount.amount || Infinity;
    var amountB = b.shipping_rate_data.fixed_amount.amount || Infinity;
    return amountA - amountB;
  });
  
  return rates;
}

/**
 * Save order to Google Sheet
 * Matches existing "Stripe Social Media Checkout ID" sheet structure
 * Columns: Timestamp | Customer Name | Stripe Session ID | Wix Order Number | Wix Order ID | Items Purchased | Total Quantity | Amount | Currency
 */
function saveOrderToSheet(session, environment) {
  try {
    // Get config - use environment if provided, otherwise default to production
    var CONFIG = getConfig(environment || 'production');
    var sheet = SpreadsheetApp.openById(CONFIG.sheetId).getSheetByName(CONFIG.sheetName);
    
    // Check if order already exists (idempotency) - check by Stripe Session ID
    var existingRow = findOrderRowBySessionId(sheet, session.id);
    if (existingRow > 0) {
      Logger.log('Order already exists: ' + session.id);
      return;
    }

    // Extract order data
    var customerName = (session.customer_details && session.customer_details.name) || 
                        (session.shipping_details && session.shipping_details.name) || 
                        session.customer_email || 
                        'Unknown';
    var customerEmail = (session.customer_details && session.customer_details.email) || session.customer_email || '';
    
    // Get line items from session
    // Note: In checkout.session.completed webhook, we need to retrieve line items separately
    var lineItems = (session.line_items && session.line_items.data) || [];
    
    // Calculate totals
    var totalQuantity = 0;
    var totalAmount = 0;
    var itemsList = [];
    
    if (lineItems && lineItems.length > 0) {
      for (var i = 0; i < lineItems.length; i++) {
        var item = lineItems[i];
        var quantity = item.quantity || 1;
        var amount = (item.amount_total || 0) / 100; // Convert from cents
        totalQuantity += quantity;
        totalAmount += amount;
        itemsList.push((item.description || 'Product') + ' (x' + quantity + ')');
      }
    } else {
      // Fallback if line items not available
      totalQuantity = 1;
      totalAmount = (session.amount_total || 0) / 100;
      itemsList.push('Product');
    }

    // Format items purchased as comma-separated list
    var itemsPurchased = itemsList.join(', ');

    // Get currency
    var currency = (session.currency && session.currency.toUpperCase()) || 'USD';

    // Calculate shipping cost
    var amountSubtotal = (session.amount_subtotal || 0) / 100;
    var amountTotal = (session.amount_total || 0) / 100;
    var shippingCost = amountTotal - amountSubtotal;
    if (shippingCost < 0) {
      shippingCost = 0;
    }

    // Extract shipping address
    var shippingAddressFormatted = '';
    if (session.shipping_details && session.shipping_details.address) {
      var addr = session.shipping_details.address;
      var addressParts = [];
      if (addr.line1) addressParts.push(addr.line1);
      if (addr.line2) addressParts.push(addr.line2);
      if (addr.city) addressParts.push(addr.city);
      if (addr.state) addressParts.push(addr.state);
      if (addr.postal_code) addressParts.push(addr.postal_code);
      if (addr.country) addressParts.push(addr.country);
      shippingAddressFormatted = addressParts.join(', ');
    } else if (session.shipping && session.shipping.address) {
      var addr = session.shipping.address;
      var addressParts = [];
      if (addr.line1) addressParts.push(addr.line1);
      if (addr.line2) addressParts.push(addr.line2);
      if (addr.city) addressParts.push(addr.city);
      if (addr.state) addressParts.push(addr.state);
      if (addr.postal_code) addressParts.push(addr.postal_code);
      if (addr.country) addressParts.push(addr.country);
      shippingAddressFormatted = addressParts.join(', ');
    }

    // Get Stripe transaction fee
    var stripeFee = 0;
    try {
      if (session.payment_intent) {
        var paymentIntentId = typeof session.payment_intent === 'string' 
          ? session.payment_intent 
          : session.payment_intent.id;
        
        // Retrieve payment intent to get charges
        var paymentIntentUrl = 'https://api.stripe.com/v1/payment_intents/' + paymentIntentId;
        var paymentIntentResponse = UrlFetchApp.fetch(paymentIntentUrl, {
          method: 'get',
          headers: {
            'Authorization': 'Bearer ' + CONFIG.stripeSecretKey
          },
          muteHttpExceptions: true
        });
        
        if (paymentIntentResponse.getResponseCode() === 200) {
          var paymentIntent = JSON.parse(paymentIntentResponse.getContentText());
          
          // Get the charge ID from payment intent
          if (paymentIntent.latest_charge) {
            var chargeId = typeof paymentIntent.latest_charge === 'string' 
              ? paymentIntent.latest_charge 
              : paymentIntent.latest_charge.id;
            
            // Retrieve charge to get balance transaction
            var chargeUrl = 'https://api.stripe.com/v1/charges/' + chargeId;
            var chargeResponse = UrlFetchApp.fetch(chargeUrl, {
              method: 'get',
              headers: {
                'Authorization': 'Bearer ' + CONFIG.stripeSecretKey
              },
              muteHttpExceptions: true
            });
            
            if (chargeResponse.getResponseCode() === 200) {
              var charge = JSON.parse(chargeResponse.getContentText());
              
              // Get balance transaction to get fee
              if (charge.balance_transaction) {
                var balanceTransactionId = typeof charge.balance_transaction === 'string' 
                  ? charge.balance_transaction 
                  : charge.balance_transaction.id;
                
                // Retrieve balance transaction
                var balanceTransactionUrl = 'https://api.stripe.com/v1/balance_transactions/' + balanceTransactionId;
                var balanceTransactionResponse = UrlFetchApp.fetch(balanceTransactionUrl, {
                  method: 'get',
                  headers: {
                    'Authorization': 'Bearer ' + CONFIG.stripeSecretKey
                  },
                  muteHttpExceptions: true
                });
                
                if (balanceTransactionResponse.getResponseCode() === 200) {
                  var balanceTransaction = JSON.parse(balanceTransactionResponse.getContentText());
                  stripeFee = (balanceTransaction.fee || 0) / 100; // Convert from cents
                }
              }
            }
          }
        }
      }
    } catch (feeError) {
      Logger.log('Error retrieving Stripe fee: ' + feeError.toString());
      // Continue without fee - not critical
    }

    // Extract shipping provider from Stripe session
    // Log shipping-related fields for debugging
    Logger.log('=== DEBUGGING SHIPPING PROVIDER EXTRACTION ===');
    Logger.log('Session ID: ' + session.id);
    Logger.log('Session keys: ' + Object.keys(session).join(', '));
    
    // Check shipping_cost
    if (session.shipping_cost) {
      Logger.log('✓ session.shipping_cost exists');
      Logger.log('  shipping_cost keys: ' + Object.keys(session.shipping_cost).join(', '));
      Logger.log('  shipping_cost JSON: ' + JSON.stringify(session.shipping_cost));
      
      if (session.shipping_cost.shipping_rate) {
        Logger.log('  ✓ shipping_cost.shipping_rate exists');
        Logger.log('    shipping_rate keys: ' + Object.keys(session.shipping_cost.shipping_rate).join(', '));
        Logger.log('    shipping_rate JSON: ' + JSON.stringify(session.shipping_cost.shipping_rate));
      } else {
        Logger.log('  ✗ shipping_cost.shipping_rate does NOT exist');
      }
    } else {
      Logger.log('✗ session.shipping_cost does NOT exist');
    }
    
    // Check shipping_options
    if (session.shipping_options) {
      Logger.log('✓ session.shipping_options exists');
      Logger.log('  shipping_options type: ' + typeof session.shipping_options);
      Logger.log('  shipping_options is array: ' + Array.isArray(session.shipping_options));
      if (Array.isArray(session.shipping_options)) {
        Logger.log('  shipping_options length: ' + session.shipping_options.length);
        for (var optIdx = 0; optIdx < session.shipping_options.length; optIdx++) {
          Logger.log('    Option ' + optIdx + ': ' + JSON.stringify(session.shipping_options[optIdx]));
        }
      } else {
        Logger.log('  shipping_options JSON: ' + JSON.stringify(session.shipping_options));
      }
    } else {
      Logger.log('✗ session.shipping_options does NOT exist');
    }
    
    // Check shipping_details
    if (session.shipping_details) {
      Logger.log('✓ session.shipping_details exists');
      Logger.log('  shipping_details keys: ' + Object.keys(session.shipping_details).join(', '));
    }
    
    // Check session.shipping_rate (the selected shipping rate ID)
    if (session.shipping_rate) {
      Logger.log('✓ session.shipping_rate exists');
      Logger.log('  shipping_rate type: ' + typeof session.shipping_rate);
      Logger.log('  shipping_rate value: ' + (typeof session.shipping_rate === 'string' ? session.shipping_rate : JSON.stringify(session.shipping_rate)));
    } else {
      Logger.log('✗ session.shipping_rate does NOT exist');
    }
    
    // Try to extract shipping provider
    var shippingProvider = '';
    
    // Method 1: Check session.shipping_rate (the selected rate ID at session level)
    if (session.shipping_rate) {
      var shippingRateId = typeof session.shipping_rate === 'string' 
        ? session.shipping_rate 
        : (session.shipping_rate.id || session.shipping_rate);
      
      Logger.log('Attempting to extract from session.shipping_rate...');
      Logger.log('  shipping_rate ID: ' + shippingRateId);
      
      // If it's an object (expanded), extract display_name directly
      if (typeof session.shipping_rate === 'object' && session.shipping_rate.display_name) {
        shippingProvider = session.shipping_rate.display_name;
        Logger.log('  ✓ Found display_name from expanded shipping_rate: ' + shippingProvider);
      } 
      // If it's a string ID, fetch the shipping rate details
      else if (typeof shippingRateId === 'string') {
        Logger.log('  shipping_rate is a string ID, fetching shipping rate details...');
        try {
          var shippingRateUrl = 'https://api.stripe.com/v1/shipping_rates/' + shippingRateId;
          var shippingRateResponse = UrlFetchApp.fetch(shippingRateUrl, {
            method: 'get',
            headers: {
              'Authorization': 'Bearer ' + CONFIG.stripeSecretKey
            },
            muteHttpExceptions: true
          });
          
          if (shippingRateResponse.getResponseCode() === 200) {
            var shippingRateData = JSON.parse(shippingRateResponse.getContentText());
            Logger.log('  Fetched shipping_rate JSON: ' + JSON.stringify(shippingRateData));
            if (shippingRateData.display_name) {
              shippingProvider = shippingRateData.display_name;
              Logger.log('  ✓ Found display_name from fetched rate: ' + shippingProvider);
            } else if (shippingRateData.id) {
              shippingProvider = shippingRateData.id;
              Logger.log('  ✓ Found id from fetched rate: ' + shippingProvider);
            }
          } else {
            Logger.log('  ✗ Failed to fetch shipping rate: ' + shippingRateResponse.getContentText());
          }
        } catch (fetchError) {
          Logger.log('  ✗ Error fetching shipping rate: ' + fetchError.toString());
        }
      }
    }
    
    // Method 2: Check shipping_cost.shipping_rate (if it exists)
    if (!shippingProvider && session.shipping_cost && session.shipping_cost.shipping_rate) {
      var shippingRate = session.shipping_cost.shipping_rate;
      Logger.log('Attempting to extract from shipping_cost.shipping_rate...');
      Logger.log('  shipping_rate type: ' + typeof shippingRate);
      
      // If shipping_rate is a string (ID), we need to fetch it separately
      if (typeof shippingRate === 'string') {
        Logger.log('  shipping_rate is a string ID, fetching shipping rate details...');
        try {
          var shippingRateUrl = 'https://api.stripe.com/v1/shipping_rates/' + shippingRate;
          var shippingRateResponse = UrlFetchApp.fetch(shippingRateUrl, {
            method: 'get',
            headers: {
              'Authorization': 'Bearer ' + CONFIG.stripeSecretKey
            },
            muteHttpExceptions: true
          });
          
          if (shippingRateResponse.getResponseCode() === 200) {
            var shippingRateData = JSON.parse(shippingRateResponse.getContentText());
            Logger.log('  Fetched shipping_rate JSON: ' + JSON.stringify(shippingRateData));
            if (shippingRateData.display_name) {
              shippingProvider = shippingRateData.display_name;
              Logger.log('  ✓ Found display_name from fetched rate: ' + shippingProvider);
            } else if (shippingRateData.id) {
              shippingProvider = shippingRateData.id;
              Logger.log('  ✓ Found id from fetched rate: ' + shippingProvider);
            }
          } else {
            Logger.log('  ✗ Failed to fetch shipping rate: ' + shippingRateResponse.getContentText());
          }
        } catch (fetchError) {
          Logger.log('  ✗ Error fetching shipping rate: ' + fetchError.toString());
        }
      } 
      // If shipping_rate is an object (expanded), extract directly
      else if (typeof shippingRate === 'object') {
        Logger.log('  shipping_rate is an object (expanded)');
        // Try display_name first, then id, then type
        if (shippingRate.display_name) {
          shippingProvider = shippingRate.display_name;
          Logger.log('  ✓ Found display_name: ' + shippingProvider);
        } else if (shippingRate.id) {
          shippingProvider = shippingRate.id;
          Logger.log('  ✓ Found id: ' + shippingProvider);
        } else if (shippingRate.type) {
          shippingProvider = shippingRate.type;
          Logger.log('  ✓ Found type: ' + shippingProvider);
        } else {
          Logger.log('  ✗ No display_name, id, or type found in shipping_rate object');
          Logger.log('  shipping_rate keys: ' + Object.keys(shippingRate).join(', '));
        }
      }
    }
    
    // Method 3: Match shipping_amount from shipping_options with calculated shipping cost
    if (!shippingProvider && session.shipping_options && Array.isArray(session.shipping_options) && session.shipping_options.length > 0) {
      Logger.log('Attempting to match shipping_amount from shipping_options...');
      Logger.log('  Calculated shipping cost (cents): ' + (shippingCost * 100));
      
      for (var optIdx = 0; optIdx < session.shipping_options.length; optIdx++) {
        var option = session.shipping_options[optIdx];
        var optionAmount = option.shipping_amount || 0;
        Logger.log('  Option ' + optIdx + ' shipping_amount: ' + optionAmount);
        
        // Match by shipping amount (within 1 cent tolerance)
        if (Math.abs(optionAmount - (shippingCost * 100)) < 1) {
          Logger.log('  ✓ Matched shipping_amount for option ' + optIdx);
          var rateId = option.shipping_rate;
          if (typeof rateId === 'string') {
            Logger.log('    Fetching shipping rate: ' + rateId);
            try {
              var shippingRateUrl = 'https://api.stripe.com/v1/shipping_rates/' + rateId;
              var shippingRateResponse = UrlFetchApp.fetch(shippingRateUrl, {
                method: 'get',
                headers: {
                  'Authorization': 'Bearer ' + CONFIG.stripeSecretKey
                },
                muteHttpExceptions: true
              });
              
              if (shippingRateResponse.getResponseCode() === 200) {
                var shippingRateData = JSON.parse(shippingRateResponse.getContentText());
                if (shippingRateData.display_name) {
                  shippingProvider = shippingRateData.display_name;
                  Logger.log('    ✓ Found display_name: ' + shippingProvider);
                  break;
                }
              }
            } catch (fetchError) {
              Logger.log('    ✗ Error fetching shipping rate: ' + fetchError.toString());
            }
          }
        }
      }
      
      if (!shippingProvider) {
        Logger.log('  ✗ No matching shipping option found by amount');
      }
    }
    
    Logger.log('Final shippingProvider value: "' + shippingProvider + '"');
    Logger.log('=== END SHIPPING PROVIDER DEBUG ===');

    // Map to extended sheet structure:
    // Timestamp | Customer Name | Stripe Session ID | Wix Order Number | Wix Order ID | Items Purchased | Total Quantity | Amount | Currency | Shipping Address | Shipping Cost | Stripe Fee | Shipping Provider | Tracking Number
    var row = [
      new Date().toISOString(), // Timestamp
      customerName, // Customer Name
      session.id, // Stripe Session ID
      '', // Wix Order Number (empty - not using Wix)
      '', // Wix Order ID (empty - not using Wix)
      itemsPurchased, // Items Purchased
      totalQuantity, // Total Quantity
      amountTotal, // Amount (total including shipping)
      currency, // Currency
      shippingAddressFormatted, // Shipping Address
      shippingCost.toFixed(2), // Shipping Cost
      stripeFee.toFixed(2), // Stripe Transaction Fee
      shippingProvider, // Shipping Provider (Column M)
      '' // Tracking Number (Column N - empty initially, to be filled by admin)
    ];

    sheet.appendRow(row);
    Logger.log('Order saved: ' + session.id);
    Logger.log('  Shipping Address: ' + (shippingAddressFormatted || 'N/A'));
    Logger.log('  Shipping Cost: $' + shippingCost.toFixed(2));
    Logger.log('  Shipping Provider: ' + (shippingProvider || 'N/A'));
    Logger.log('  Stripe Fee: $' + stripeFee.toFixed(2));

    // Send notification email to admin
    try {
      sendOrderNotificationEmail(session, customerName, customerEmail, itemsPurchased, totalQuantity, amountTotal, shippingCost, shippingAddressFormatted, stripeFee, currency);
    } catch (emailError) {
      Logger.log('Error sending notification email (non-critical): ' + emailError.toString());
      // Continue - order is saved successfully
    }
  } catch (error) {
    Logger.log('Error saving order: ' + error.toString());
    throw error;
  }
}

/**
 * Send order notification email to admin
 */
function sendOrderNotificationEmail(session, customerName, customerEmail, itemsPurchased, totalQuantity, amountTotal, shippingCost, shippingAddress, stripeFee, currency) {
  try {
    var currencySymbol = currency === 'USD' ? '$' : (currency + ' ');
    var orderDate = new Date(session.created * 1000).toLocaleString();
    
    var subject = 'New Order: ' + customerName + ' - ' + currencySymbol + amountTotal.toFixed(2);
    
    var body = 'New order received!\n\n' +
      '=== ORDER DETAILS ===\n' +
      'Order Date: ' + orderDate + '\n' +
      'Stripe Session ID: ' + session.id + '\n' +
      'Payment Status: ' + (session.payment_status || 'N/A') + '\n\n' +
      
      '=== CUSTOMER INFORMATION ===\n' +
      'Name: ' + customerName + '\n' +
      'Email: ' + customerEmail + '\n\n' +
      
      '=== SHIPPING ADDRESS ===\n' +
      (shippingAddress || 'No shipping address provided') + '\n\n' +
      
      '=== ORDER ITEMS ===\n' +
      itemsPurchased + '\n' +
      'Total Quantity: ' + totalQuantity + '\n\n' +
      
      '=== PRICING BREAKDOWN ===\n' +
      'Subtotal: ' + currencySymbol + (amountTotal - shippingCost).toFixed(2) + '\n' +
      'Shipping: ' + currencySymbol + shippingCost.toFixed(2) + '\n' +
      'Total: ' + currencySymbol + amountTotal.toFixed(2) + '\n' +
      'Stripe Fee: ' + currencySymbol + stripeFee.toFixed(2) + '\n' +
      'Net Amount: ' + currencySymbol + (amountTotal - stripeFee).toFixed(2) + '\n\n' +
      
      '=== LINKS ===\n' +
      'View in Stripe Dashboard: https://dashboard.stripe.com/payments?status%5B%5D=successful\n' +
      'Search for Session ID: ' + session.id + '\n\n' +
      
      '---\n' +
      'This is an automated notification from Agroverse Shop.';

    MailApp.sendEmail({
      to: 'garyjob@agroverse.shop',
      subject: subject,
      body: body
    });

    Logger.log('Order notification email sent to garyjob@agroverse.shop');
  } catch (error) {
    Logger.log('Error sending order notification email: ' + error.toString());
    throw error;
  }
}

/** Main ledger (Agroverse QR codes + Agroverse SKUs). Override with Script Property GCR_LEDGER_SPREADSHEET_ID if needed. */
var GCR_LEDGER_SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
var GCR_QR_SHEET_NAME = 'Agroverse QR codes';
var GCR_SKUS_SHEET_NAME = 'Agroverse SKUs';

function normalizeGcrCountryCode(countryRaw) {
  if (!countryRaw || String(countryRaw).trim() === '') {
    return 'US';
  }
  var c = String(countryRaw).trim().toUpperCase();
  if (c === 'USA' || c === 'UNITED STATES' || c === 'UNITED STATES OF AMERICA') {
    return 'US';
  }
  if (c === 'BRAZIL' || c === 'BRASIL') {
    return 'BR';
  }
  if (c.length === 2) {
    return c;
  }
  return 'US';
}

/**
 * Convert sheet cell YYYYMMDD or Date to ISO-ish string for GCR orderDateIso.
 * @param {*} dateCell
 * @return {?string}
 */
function qrCreationDateToOrderDateIso(dateCell) {
  if (dateCell instanceof Date && !isNaN(dateCell.getTime())) {
    return dateCell.toISOString();
  }
  var s = String(dateCell || '').trim().replace(/\D/g, '');
  if (s.length !== 8) {
    return null;
  }
  var y = s.substring(0, 4);
  var m = s.substring(4, 6);
  var d = s.substring(6, 8);
  return y + '-' + m + '-' + d + 'T12:00:00.000Z';
}

/**
 * If sheet column J is empty, try first YYYYMMDD in the qr id (e.g. 2024SJ_20250508_3 → 20250508).
 * @param {string} qrId
 * @return {?string}
 */
function orderDateIsoFallbackFromQrId(qrId) {
  var m = String(qrId || '').match(/\d{8}/);
  return m ? qrCreationDateToOrderDateIso(m[0]) : null;
}

/**
 * Match Agroverse SKUs row by Product ID (A) or Product Name (B); return GTIN (J).
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @param {string} productKey Value from QR sheet column I (Currency / product label)
 * @return {?string}
 */
function findGtinByProductKeyForGcr(spreadsheet, productKey) {
  if (!productKey || String(productKey).trim() === '') {
    return null;
  }
  var sh = spreadsheet.getSheetByName(GCR_SKUS_SHEET_NAME);
  if (!sh) {
    Logger.log('getGcrContextByQr: sheet not found: ' + GCR_SKUS_SHEET_NAME);
    return null;
  }
  var lastRow = sh.getLastRow();
  if (lastRow < 2) {
    return null;
  }
  var data = sh.getRange(2, 1, lastRow, 10).getValues();
  var key = String(productKey).trim().toLowerCase();
  for (var i = 0; i < data.length; i++) {
    var pid = data[i][0] ? String(data[i][0]).trim().toLowerCase() : '';
    var pname = data[i][1] ? String(data[i][1]).trim().toLowerCase() : '';
    if (key && (key === pid || key === pname)) {
      var gtin = data[i][9];
      if (gtin != null && String(gtin).trim() !== '') {
        return String(gtin).trim();
      }
      return null;
    }
  }
  return null;
}

/**
 * Public GET: action=getGcrContextByQr&qr=CODE
 * Reads Agroverse QR codes: A=qr_code, G=country, I=product, J=QR creation date,
 * L=Owner Email, M=Onboarding email sent date (preferred for GCR orderDateIso).
 * Optional GTIN from Agroverse SKUs by matching column I to SKU A or B.
 *
 * @param {string} qrCode
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function getGcrContextByQrCode(qrCode) {
  try {
    if (!qrCode || String(qrCode).trim() === '') {
      return createCORSResponse({
        status: 'error',
        error: 'qr parameter is required'
      });
    }
    var q = String(qrCode).trim();
    var props = PropertiesService.getScriptProperties();
    var sheetId = props.getProperty('GCR_LEDGER_SPREADSHEET_ID') || GCR_LEDGER_SPREADSHEET_ID;

    var ss = SpreadsheetApp.openById(sheetId);
    var qrSheet = ss.getSheetByName(GCR_QR_SHEET_NAME);
    if (!qrSheet) {
      return createCORSResponse({
        status: 'error',
        error: 'QR sheet not found: ' + GCR_QR_SHEET_NAME
      });
    }

    var lastRow = qrSheet.getLastRow();
    if (lastRow < 2) {
      return createCORSResponse({
        status: 'error',
        error: 'No QR rows in sheet'
      });
    }

    var rows = qrSheet.getRange(2, 1, lastRow, 13).getValues();
    var row = null;
    for (var r = 0; r < rows.length; r++) {
      var code = rows[r][0] ? String(rows[r][0]).trim() : '';
      if (code === q) {
        row = rows[r];
        break;
      }
    }

    if (!row) {
      return createCORSResponse({
        status: 'error',
        error: 'QR code not found'
      });
    }

    var email = row[11] ? String(row[11]).trim() : '';
    if (!email) {
      return createCORSResponse({
        status: 'error',
        error: 'Owner email not set for this QR code'
      });
    }

    var deliveryCountry = normalizeGcrCountryCode(row[6]);
    // M (index 12) = Onboarding email sent date; then J creation date; then YYYYMMDD in qr id
    var orderDateIso = qrCreationDateToOrderDateIso(row[12]);
    if (!orderDateIso) {
      orderDateIso = qrCreationDateToOrderDateIso(row[9]);
    }
    if (!orderDateIso) {
      orderDateIso = orderDateIsoFallbackFromQrId(q);
    }
    var productKey = row[8] ? String(row[8]).trim() : '';
    var gtinRaw = productKey ? findGtinByProductKeyForGcr(ss, productKey) : null;
    var gtinDigits = gtinRaw ? String(gtinRaw).replace(/\D/g, '') : '';

    var payload = {
      orderId: q,
      email: email,
      deliveryCountry: deliveryCountry,
      orderDateIso: orderDateIso
    };
    if (gtinDigits) {
      payload.products = [{ gtin: gtinDigits }];
    }

    return createCORSResponse({
      status: 'success',
      gcr: payload
    });
  } catch (err) {
    Logger.log('getGcrContextByQrCode error: ' + err.toString());
    return createCORSResponse({
      status: 'error',
      error: err.toString()
    });
  }
}

/**
 * Get order status - pull from Stripe first, then augment with Google Sheet data
 * This ensures we always have the most complete order information
 */
function getOrderStatus(sessionId) {
  try {
    // Try both environments (development and production)
    var environments = ['development', 'production'];
    var stripeSession = null;
    var foundEnvironment = null;
    
    // First, try to fetch from Stripe (primary source of truth)
    Logger.log('Looking for session: ' + sessionId);
    Logger.log('Trying environments: ' + environments.join(', '));
    
    for (var envIdx = 0; envIdx < environments.length; envIdx++) {
      var env = environments[envIdx];
      var CONFIG = getConfig(env);
      
      Logger.log('Checking ' + env + ' environment...');
      
      if (!CONFIG.stripeSecretKey) {
        Logger.log('  Skipping ' + env + ' - Stripe key not configured');
        continue; // Skip if Stripe key not configured for this environment
      }
      
      Logger.log('  Stripe key configured (length: ' + CONFIG.stripeSecretKey.length + ')');
      
      try {
        // Try to retrieve session from Stripe
        stripeSession = retrieveStripeSession(sessionId, CONFIG.stripeSecretKey);
        
        if (stripeSession) {
          Logger.log('  ✓ Found session in ' + env + ' environment');
          Logger.log('  Session ID: ' + stripeSession.id);
          Logger.log('  Payment Status: ' + (stripeSession.payment_status || 'N/A'));
          foundEnvironment = env;
          break; // Found it, stop searching
        } else {
          Logger.log('  ✗ Session not found in ' + env + ' environment');
        }
      } catch (stripeError) {
        Logger.log('  ✗ Error fetching from Stripe (' + env + '): ' + stripeError.toString());
        Logger.log('  Stack: ' + stripeError.stack);
        continue;
      }
    }
    
    // If not found in Stripe, return error with more details
    if (!stripeSession) {
      Logger.log('Order not found in Stripe: ' + sessionId);
      Logger.log('Searched in environments: ' + environments.join(', '));
      return createCORSResponse({
        status: 'error',
        error: 'Order not found. Please verify the order number is correct.'
      });
    }
    
    // Extract order data from Stripe session
    var customerName = (stripeSession.customer_details && stripeSession.customer_details.name) || 
                        (stripeSession.shipping_details && stripeSession.shipping_details.name) || 
                        stripeSession.customer_email || 
                        'Unknown';
    
    var customerEmail = (stripeSession.customer_details && stripeSession.customer_details.email) || 
                        stripeSession.customer_email || '';
    
    // Get line items
    var lineItems = (stripeSession.line_items && stripeSession.line_items.data) || [];
    var items = [];
    var totalQuantity = 0;
    var totalAmount = 0;
    
    // Get the Stripe secret key for fetching product details
    var stripeSecretKey = null;
    if (foundEnvironment) {
      var envConfig = getConfig(foundEnvironment);
      stripeSecretKey = envConfig.stripeSecretKey;
    }
    
    for (var i = 0; i < lineItems.length; i++) {
      var item = lineItems[i];
      var quantity = item.quantity || 1;
      var amount = (item.amount_total || 0) / 100; // Convert from cents
      var description = item.description || 'Product';
      
      // Extract product image from Stripe line item
      // When using price_data, product might be a string ID (not expanded) or an object
      var productImage = null;
      var productData = null;
      var productId = null;
      
      // Check if product is expanded (object) or just an ID (string)
      if (item.price && item.price.product) {
        if (typeof item.price.product === 'string') {
          // Product is just an ID, need to fetch it separately
          productId = item.price.product;
          Logger.log('  Item ' + (i + 1) + ': Product is ID string: ' + productId + ', fetching product details...');
          
          if (stripeSecretKey) {
            try {
              // Fetch product details from Stripe API
              var productUrl = 'https://api.stripe.com/v1/products/' + productId;
              var productResponse = UrlFetchApp.fetch(productUrl, {
                method: 'get',
                headers: {
                  'Authorization': 'Bearer ' + stripeSecretKey
                },
                muteHttpExceptions: true
              });
              
              if (productResponse.getResponseCode() === 200) {
                var productResponseText = productResponse.getContentText();
                productData = JSON.parse(productResponseText);
                Logger.log('  ✓ Fetched product: ' + (productData.name || 'N/A'));
                
                if (productData.images && Array.isArray(productData.images) && productData.images.length > 0) {
                  productImage = productData.images[0];
                  Logger.log('  ✓ Found product image: ' + productImage);
                } else {
                  Logger.log('  ✗ Product has no images');
                  Logger.log('  Product keys: ' + Object.keys(productData || {}).join(', '));
                }
              } else {
                Logger.log('  ✗ Failed to fetch product (code ' + productResponse.getResponseCode() + ')');
                Logger.log('  Response: ' + productResponse.getContentText());
              }
            } catch (fetchError) {
              Logger.log('  ✗ Error fetching product: ' + fetchError.toString());
            }
          } else {
            Logger.log('  ✗ No Stripe secret key available to fetch product');
          }
        } else if (typeof item.price.product === 'object') {
          // Product is expanded (object)
          productData = item.price.product;
          // Handle if product is an array (unexpected but possible)
          if (Array.isArray(productData) && productData.length > 0) {
            productData = productData[0];
          }
          if (productData && typeof productData === 'object' && productData.images && Array.isArray(productData.images) && productData.images.length > 0) {
            productImage = productData.images[0];
            Logger.log('  ✓ Found expanded product image: ' + productImage);
          } else {
            Logger.log('  ✗ Expanded product has no images');
            Logger.log('  Product keys: ' + Object.keys(productData || {}).join(', '));
          }
        }
      }
      
      // Fallback: try item.product (sometimes product is at item level)
      if (!productImage && item.product) {
        if (typeof item.product === 'string' && stripeSecretKey) {
          // Fetch product by ID
          productId = item.product;
          try {
            var productUrl = 'https://api.stripe.com/v1/products/' + productId;
            var productResponse = UrlFetchApp.fetch(productUrl, {
              method: 'get',
              headers: {
                'Authorization': 'Bearer ' + stripeSecretKey
              },
              muteHttpExceptions: true
            });
            
            if (productResponse.getResponseCode() === 200) {
              productData = JSON.parse(productResponse.getContentText());
              if (productData.images && Array.isArray(productData.images) && productData.images.length > 0) {
                productImage = productData.images[0];
                Logger.log('  ✓ Found image in item.product: ' + productImage);
              }
            }
          } catch (fetchError) {
            Logger.log('  ✗ Error fetching product from item.product: ' + fetchError.toString());
          }
        } else if (typeof item.product === 'object') {
          productData = item.product;
          if (Array.isArray(productData) && productData.length > 0) {
            productData = productData[0];
          }
          if (productData && typeof productData === 'object' && productData.images && Array.isArray(productData.images) && productData.images.length > 0) {
            productImage = productData.images[0];
            Logger.log('  ✓ Found image in item.product: ' + productImage);
          }
        }
      }
      
      items.push({
        name: description,
        quantity: quantity,
        price: amount / quantity, // Price per item
        image: productImage || null // Product image URL
      });
      
      totalQuantity += quantity;
      totalAmount += amount;
    }
    
    // If no line items, use session totals
    if (items.length === 0) {
      totalAmount = (stripeSession.amount_total || 0) / 100;
      totalQuantity = 1;
      items.push({
        name: 'Product',
        quantity: 1,
        price: totalAmount
      });
    }
    
    // Extract pricing breakdown from Stripe session
    // amount_subtotal = product costs only (before shipping)
    // amount_total = total including shipping
    // shipping cost = amount_total - amount_subtotal
    var amountSubtotal = (stripeSession.amount_subtotal || 0) / 100; // Convert from cents
    var amountTotal = (stripeSession.amount_total || 0) / 100; // Convert from cents
    var shippingCost = amountTotal - amountSubtotal;
    
    // If we calculated totalAmount from line items, use that for subtotal
    // and calculate shipping from the difference
    if (items.length > 0 && totalAmount > 0) {
      amountSubtotal = totalAmount;
      // Recalculate total from session (includes shipping)
      amountTotal = (stripeSession.amount_total || 0) / 100;
      shippingCost = amountTotal - amountSubtotal;
    }
    
    // Ensure shipping cost is not negative (safety check)
    if (shippingCost < 0) {
      shippingCost = 0;
    }
    
    Logger.log('Pricing breakdown:');
    Logger.log('  Subtotal: $' + amountSubtotal.toFixed(2));
    Logger.log('  Shipping: $' + shippingCost.toFixed(2));
    Logger.log('  Total: $' + amountTotal.toFixed(2));
    
    // Extract shipping address from Stripe
    // Check multiple possible locations for shipping address
    var shippingAddress = null;
    
    // Log available shipping-related fields for debugging
    Logger.log('Checking for shipping address in session: ' + sessionId);
    Logger.log('  shipping_details exists: ' + !!stripeSession.shipping_details);
    Logger.log('  shipping exists: ' + !!stripeSession.shipping);
    Logger.log('  payment_status: ' + (stripeSession.payment_status || 'N/A'));
    
    // Try shipping_details first (most common for checkout sessions)
    if (stripeSession.shipping_details && stripeSession.shipping_details.address) {
      var shipping = stripeSession.shipping_details;
      shippingAddress = {
        fullName: shipping.name || customerName || '',
        address: shipping.address.line1 + (shipping.address.line2 ? ', ' + shipping.address.line2 : ''),
        city: shipping.address.city || '',
        state: shipping.address.state || '',
        zip: shipping.address.postal_code || '',
        country: shipping.address.country || 'US'
      };
      Logger.log('  ✓ Found shipping address in shipping_details');
    } 
    // Try shipping field (alternative location)
    else if (stripeSession.shipping && stripeSession.shipping.address) {
      var shipping = stripeSession.shipping;
      shippingAddress = {
        fullName: shipping.name || customerName || '',
        address: shipping.address.line1 + (shipping.address.line2 ? ', ' + shipping.address.line2 : ''),
        city: shipping.address.city || '',
        state: shipping.address.state || '',
        zip: shipping.address.postal_code || '',
        country: shipping.address.country || 'US'
      };
      Logger.log('  ✓ Found shipping address in shipping field');
    }
    // Try customer_details.shipping (sometimes used)
    else if (stripeSession.customer_details && stripeSession.customer_details.shipping && stripeSession.customer_details.shipping.address) {
      var shipping = stripeSession.customer_details.shipping;
      shippingAddress = {
        fullName: shipping.name || customerName || '',
        address: shipping.address.line1 + (shipping.address.line2 ? ', ' + shipping.address.line2 : ''),
        city: shipping.address.city || '',
        state: shipping.address.state || '',
        zip: shipping.address.postal_code || '',
        country: shipping.address.country || 'US'
      };
      Logger.log('  ✓ Found shipping address in customer_details.shipping');
    }
    else {
      Logger.log('  ✗ No shipping address found in session');
      Logger.log('  Session keys: ' + Object.keys(stripeSession).join(', '));
      if (stripeSession.shipping_details) {
        Logger.log('  shipping_details keys: ' + Object.keys(stripeSession.shipping_details).join(', '));
      }
    }
    
    // Now try to augment with Google Sheet data (tracking number, status updates, etc.)
    var sheetData = null;
    var trackingNumber = null;
    var shippingProviderFromSheet = null;
    var orderStatus = 'Placed'; // Default status
    
    try {
      var CONFIG_SHEET = getConfig(foundEnvironment);
      var sheet = SpreadsheetApp.openById(CONFIG_SHEET.sheetId).getSheetByName(CONFIG_SHEET.sheetName);
      var row = findOrderRowBySessionId(sheet, sessionId);
      
      if (row > 0) {
        // Order found in sheet - get additional data
        // Read up to column N (14 columns) to get tracking number
        var data = sheet.getRange(row, 1, 1, 14).getValues()[0];
        sheetData = {
          timestamp: data[0],
          customerName: data[1],
          wixOrderNumber: data[3] || '',
          wixOrderId: data[4] || ''
        };
        
        // Column M (index 12): Shipping Provider
        if (data[12] && data[12].toString().trim()) {
          shippingProviderFromSheet = data[12].toString().trim();
        }
        
        // Column N (index 13): Tracking Number
        if (data[13] && data[13].toString().trim()) {
          trackingNumber = data[13].toString().trim();
          Logger.log('  ✓ Found tracking number in sheet: ' + trackingNumber);
        }
      }
    } catch (sheetError) {
      Logger.log('Error checking sheet for additional data: ' + sheetError.toString());
      // Continue without sheet data - Stripe data is sufficient
    }
    
    // If order is paid and not yet in sheet, save it (idempotent - won't duplicate)
    if (stripeSession.payment_status === 'paid') {
      try {
        saveOrderToSheet(stripeSession, foundEnvironment);
      } catch (saveError) {
        Logger.log('Error saving order to sheet (non-critical): ' + saveError.toString());
        // Continue - order data from Stripe is still valid
      }
    }
    
    // Determine order status based on payment status
    if (stripeSession.payment_status === 'paid') {
      orderStatus = 'Placed';
    } else if (stripeSession.payment_status === 'unpaid') {
      orderStatus = 'Pending';
    }
    
    // Get shipping provider (from sheet if available, otherwise from Stripe session)
    var finalShippingProvider = shippingProviderFromSheet;
    if (!finalShippingProvider && stripeSession.shipping_cost && stripeSession.shipping_cost.shipping_rate) {
      var shippingRate = stripeSession.shipping_cost.shipping_rate;
      if (shippingRate.display_name) {
        finalShippingProvider = shippingRate.display_name;
      } else if (shippingRate.id) {
        finalShippingProvider = shippingRate.id;
      }
    }
    
    // Format order for frontend
    var order = {
      sessionId: stripeSession.id,
      date: new Date(stripeSession.created * 1000).toISOString(), // Convert Unix timestamp to ISO string
      status: orderStatus,
      customerName: customerName,
      customerEmail: customerEmail,
      items: items,
      amount: amountTotal, // Total including shipping
      subtotal: amountSubtotal, // Subtotal before shipping
      shippingCost: shippingCost, // Shipping cost
      currency: (stripeSession.currency && stripeSession.currency.toUpperCase()) || 'USD',
      shippingAddress: shippingAddress,
      shippingProvider: finalShippingProvider || null, // Shipping provider from Stripe or sheet
      trackingNumber: trackingNumber || null, // Tracking number from Google Sheet (Column N)
      paymentStatus: stripeSession.payment_status || 'unknown',
      mode: stripeSession.mode || 'payment' // 'subscription' or 'payment'
    };
    
    return createCORSResponse({
      status: 'success',
      order: order
    });
  } catch (error) {
    Logger.log('Error getting order status: ' + error.toString());
    return createCORSResponse({
      status: 'error',
      error: error.toString()
    });
  }
}

/**
 * Parse items purchased string into array of item objects
 * Format: "Product Name (x2), Another Product (x1)"
 */
function parseItemsPurchased(itemsPurchased, totalAmount, totalQuantity) {
  if (!itemsPurchased) {
    return [];
  }
  
  var items = [];
  var itemStrings = itemsPurchased.split(',');
  
  for (var i = 0; i < itemStrings.length; i++) {
    var itemStr = itemStrings[i].trim();
    // Parse format: "Product Name (x2)"
    var match = itemStr.match(/^(.+?)\s*\(x(\d+)\)$/);
    
    if (match) {
      var name = match[1].trim();
      var quantity = parseInt(match[2]) || 1;
      // Estimate price per item (divide total by quantity)
      var price = totalQuantity > 0 ? (totalAmount / totalQuantity) : 0;
      
      items.push({
        name: name,
        quantity: quantity,
        price: price
      });
    } else {
      // Fallback: treat entire string as product name
      var price = totalQuantity > 0 ? (totalAmount / totalQuantity) : 0;
      items.push({
        name: itemStr,
        quantity: 1,
        price: price
      });
    }
  }
  
  return items;
}

/**
 * Retrieve full Stripe session with line items
 */
function retrieveStripeSession(sessionId, stripeSecretKey) {
  try {
    // Expand line_items and product data to get complete product information including images
    // Also expand shipping_cost.shipping_rate to get the display_name
    // Note: shipping_details cannot be expanded, but it's included by default in checkout sessions
    // Try expanding with the full path notation
    var url = 'https://api.stripe.com/v1/checkout/sessions/' + sessionId + '?expand[]=line_items.data&expand[]=line_items.data.price.product&expand[]=shipping_cost.shipping_rate';
    var response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {
        'Authorization': 'Bearer ' + stripeSecretKey
      },
      muteHttpExceptions: true // Get full error response
    });

    var responseCode = response.getResponseCode();
    var responseText = response.getContentText();
    
    if (responseCode !== 200) {
      Logger.log('Stripe API error (code ' + responseCode + '): ' + responseText);
      var errorData;
      try {
        errorData = JSON.parse(responseText);
        if (errorData.error && errorData.error.message) {
          Logger.log('Stripe error message: ' + errorData.error.message);
        }
      } catch (parseError) {
        Logger.log('Could not parse error response');
      }
      return null;
    }

    var session = JSON.parse(responseText);
    
    // Debug: Log line items structure to understand product data format
    if (session.line_items && session.line_items.data && session.line_items.data.length > 0) {
      var firstItem = session.line_items.data[0];
      Logger.log('DEBUG retrieveStripeSession: First line item structure:');
      Logger.log('  Item keys: ' + Object.keys(firstItem).join(', '));
      if (firstItem.price) {
        Logger.log('  Price keys: ' + Object.keys(firstItem.price).join(', '));
        if (firstItem.price.product) {
          Logger.log('  Product type: ' + typeof firstItem.price.product);
          Logger.log('  Product is array: ' + Array.isArray(firstItem.price.product));
          if (typeof firstItem.price.product === 'object' && !Array.isArray(firstItem.price.product)) {
            Logger.log('  Product keys: ' + Object.keys(firstItem.price.product).join(', '));
            if (firstItem.price.product.images) {
              Logger.log('  Product.images type: ' + typeof firstItem.price.product.images);
              Logger.log('  Product.images is array: ' + Array.isArray(firstItem.price.product.images));
              if (Array.isArray(firstItem.price.product.images)) {
                Logger.log('  Product.images length: ' + firstItem.price.product.images.length);
                if (firstItem.price.product.images.length > 0) {
                  Logger.log('  First image URL: ' + firstItem.price.product.images[0]);
                }
              }
            }
          } else if (Array.isArray(firstItem.price.product)) {
            Logger.log('  WARNING: Product is an array! Length: ' + firstItem.price.product.length);
            if (firstItem.price.product.length > 0) {
              Logger.log('  First element type: ' + typeof firstItem.price.product[0]);
              Logger.log('  First element keys: ' + Object.keys(firstItem.price.product[0] || {}).join(', '));
            }
          }
        } else {
          Logger.log('  No product in price object');
        }
      } else {
        Logger.log('  No price in item');
      }
    }
    
    // Check if response contains an error
    if (session.error) {
      Logger.log('Stripe session error: ' + JSON.stringify(session.error));
      return null;
    }
    
    // Validate session has required fields
    if (!session.id) {
      Logger.log('Warning: Session response missing id field');
      return null;
    }
    
    return session;
  } catch (error) {
    Logger.log('Error retrieving Stripe session: ' + error.toString());
    Logger.log('Stack trace: ' + error.stack);
    return null;
  }
}

/**
 * Find order row by Stripe Session ID or Etsy Receipt ID
 * Matches existing sheet structure where ID is in column C (index 2)
 * Handles both string IDs (Stripe cs_xxx) and numeric IDs (Etsy receipt IDs)
 */
function findOrderRowBySessionId(sheet, sessionId) {
  var data = sheet.getDataRange().getValues();
  // Skip header row (index 0)
  for (var i = 1; i < data.length; i++) {
    // Column C (index 2) — compare as strings to handle both types
    if (String(data[i][2]) === String(sessionId)) {
      return i + 1; // Return 1-based row number
    }
  }
  return 0;
}

/**
 * Find order row by session ID (legacy function for backward compatibility)
 */
function findOrderRow(sheet, sessionId) {
  return findOrderRowBySessionId(sheet, sessionId);
}

/**
 * Poll Stripe for completed checkout sessions and update Google Sheet
 * This replaces webhooks - runs periodically via time-driven trigger
 * 
 * NOTE: For a unified trigger covering both Stripe + Etsy, use syncAllOrders().
 * 
 * SETUP: Create a time-driven trigger to run this function every 5-15 minutes
 * 1. Go to Triggers (clock icon) in Google App Script
 * 2. Add Trigger
 * 3. Function: syncStripeOrders
 * 4. Event source: Time-driven
 * 5. Type: Minutes timer
 * 6. Interval: Every 5 minutes (or 10-15 minutes)
 */
function syncStripeOrders() {
  try {
    // Check both environments
    syncStripeOrdersForEnvironment('production');
    syncStripeOrdersForEnvironment('development');
  } catch (error) {
    Logger.log('Error in syncStripeOrders: ' + error.toString());
  }
}

/**
 * Sync orders for a specific environment
 */
function syncStripeOrdersForEnvironment(environment) {
  try {
    var CONFIG = getConfig(environment);
    
    if (!CONFIG.stripeSecretKey) {
      Logger.log('Skipping ' + environment + ' - Stripe key not configured');
      return;
    }

    var sheet = SpreadsheetApp.openById(CONFIG.sheetId).getSheetByName(CONFIG.sheetName);
    if (!sheet) {
      Logger.log('Sheet not found: ' + CONFIG.sheetName);
      return;
    }

    // Get all existing session IDs from sheet (for idempotency)
    var existingSessionIds = getExistingSessionIds(sheet);

    // Poll Stripe for completed checkout sessions from the last hour
    // Adjust time range as needed (e.g., last 24 hours for less frequent polling)
    var oneHourAgo = Math.floor(Date.now() / 1000) - (60 * 60); // Unix timestamp
    var oneDayAgo = Math.floor(Date.now() / 1000) - (24 * 60 * 60); // Unix timestamp for last 24 hours
    
    Logger.log('Polling Stripe for ' + environment + ' environment');
    Logger.log('Current time: ' + new Date().toISOString());
    Logger.log('Looking for sessions created after: ' + new Date(oneHourAgo * 1000).toISOString() + ' (1 hour ago)');
    Logger.log('Google Sheet URL: https://docs.google.com/spreadsheets/d/' + CONFIG.sheetId + '/edit#gid=0');
    Logger.log('Sheet Name: ' + CONFIG.sheetName);
    
    // Try last 24 hours instead of just 1 hour to catch more sessions
    var sessions = retrieveCompletedSessions(CONFIG.stripeSecretKey, oneDayAgo);
    
    Logger.log('Found ' + sessions.length + ' completed sessions from Stripe');
    
    var newOrdersCount = 0;
    
    for (var i = 0; i < sessions.length; i++) {
      var session = sessions[i];
      // Skip if already in sheet
      if (existingSessionIds.has(session.id)) {
        continue;
      }

      // Retrieve full session with line items
      var fullSession = retrieveStripeSession(session.id, CONFIG.stripeSecretKey);
      if (fullSession) {
        saveOrderToSheet(fullSession, environment);
        newOrdersCount++;
      }
    }

    if (newOrdersCount > 0) {
      Logger.log('Synced ' + newOrdersCount + ' new orders from ' + environment + ' environment');
    }

    // Poll for subscription invoice payments (7-day lookback)
    ensureSubscriptionColumns_(sheet);
    var sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
    var recentInvoices = retrievePaidSubscriptionInvoices(CONFIG.stripeSecretKey, sevenDaysAgo);
    Logger.log('Found ' + recentInvoices.length + ' paid subscription invoices from Stripe');

    var newInvoiceCount = 0;
    for (var j = 0; j < recentInvoices.length; j++) {
      var invoice = recentInvoices[j];
      // Dedup by Invoice ID (col R, index 17)
      if (findOrderRowByColumn(sheet, 17, invoice.id) > 0) continue;
      // Dedup by Payment Intent ID (col S, index 18)
      if (invoice.payment_intent && findOrderRowByColumn(sheet, 18, invoice.payment_intent) > 0) continue;

      try {
        var subscription = retrieveStripeSubscription(invoice.subscription, CONFIG.stripeSecretKey);
        var originalSessionId = subscription && subscription.metadata && subscription.metadata.checkout_session_id ? subscription.metadata.checkout_session_id : '';
        saveSubscriptionPaymentToSheet(invoice, subscription, originalSessionId, CONFIG);
        newInvoiceCount++;
      } catch (invErr) {
        Logger.log('Error processing invoice ' + invoice.id + ': ' + invErr.toString());
      }
    }
    if (newInvoiceCount > 0) {
      Logger.log('Synced ' + newInvoiceCount + ' subscription renewals from ' + environment + ' environment');
    }
  } catch (error) {
    Logger.log('Error syncing ' + environment + ' orders: ' + error.toString());
  }
}

/**
 * Retrieve completed checkout sessions from Stripe
 */
function retrieveCompletedSessions(stripeSecretKey, createdAfter) {
  try {
    // Stripe API: List checkout sessions
    // Filter by status=complete and created timestamp
    // Stripe uses created[gte] format for "greater than or equal to"
    var params = [
      'limit=100', // Max 100 per request
      'status=complete',
      'created[gte]=' + createdAfter
    ].join('&');

    var url = 'https://api.stripe.com/v1/checkout/sessions?' + params;
    Logger.log('Calling Stripe API: ' + url);
    
    var response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {
        'Authorization': 'Bearer ' + stripeSecretKey
      }
    });

    var responseCode = response.getResponseCode();
    Logger.log('Stripe API response code: ' + responseCode);
    
    var responseText = response.getContentText();
    var data = JSON.parse(responseText);
    
    // Log response details
    if (data.data) {
      Logger.log('Retrieved ' + data.data.length + ' sessions from Stripe API');
      if (data.data.length > 0) {
        Logger.log('First session ID: ' + data.data[0].id);
        Logger.log('First session created: ' + new Date(data.data[0].created * 1000).toISOString());
      }
    } else {
      Logger.log('No data array in response. Response keys: ' + Object.keys(data).join(', '));
      if (data.error) {
        Logger.log('Stripe API error: ' + JSON.stringify(data.error));
      }
    }
    
    return data.data || [];
  } catch (error) {
    Logger.log('Error retrieving completed sessions: ' + error.toString());
    Logger.log('Stack trace: ' + error.stack);
    Logger.log('URL attempted: https://api.stripe.com/v1/checkout/sessions?limit=100&status=complete&created[gte]=' + createdAfter);
    return [];
  }
}

/**
 * Get all existing session IDs from the sheet
 */
function getExistingSessionIds(sheet) {
  var sessionIds = {};
  var data = sheet.getDataRange().getValues();
  
  // Skip header row, check column C (index 2) for Stripe Session ID
  for (var i = 1; i < data.length; i++) {
    var sessionId = data[i][2]; // Column C
    if (sessionId && sessionId.trim) {
      sessionIds[sessionId.trim()] = true;
    }
  }
  
  // Return object with has() method for compatibility
  return {
    has: function(id) {
      return sessionIds.hasOwnProperty(id);
    }
  };
}

/**
 * Find order row by a specific column value (for dedup beyond session ID).
 * @param {Sheet} sheet
 * @param {number} colIndex 0-based column index
 * @param {string} value Value to match
 * @return {number} 1-based row number, or 0 if not found
 */
function findOrderRowByColumn(sheet, colIndex, value) {
  if (!value) return 0;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i].length > colIndex && String(data[i][colIndex]) === String(value)) {
      return i + 1;
    }
  }
  return 0;
}

/**
 * Ensure the sheet has subscription renewal columns (R/S/T).
 * Adds headers if they don't already exist.
 * R = Invoice ID, S = Payment Intent ID, T = Payment Type
 */
function ensureSubscriptionColumns_(sheet) {
  var headers = sheet.getRange(1, 1, 1, 20).getValues()[0];
  if (!headers[17] || String(headers[17]).trim() === '') {
    sheet.getRange(1, 18).setValue('Invoice ID');
  }
  if (!headers[18] || String(headers[18]).trim() === '') {
    sheet.getRange(1, 19).setValue('Payment Intent ID');
  }
  if (!headers[19] || String(headers[19]).trim() === '') {
    sheet.getRange(1, 20).setValue('Payment Type');
  }
}

/**
 * Retrieve paid subscription invoices from Stripe.
 * Filters to only billing_reason === 'subscription_cycle'.
 * @param {string} stripeSecretKey
 * @param {number} createdAfter Unix timestamp
 * @return {Array} Array of invoice objects
 */
function retrievePaidSubscriptionInvoices(stripeSecretKey, createdAfter) {
  try {
    var params = [
      'status=paid',
      'limit=100',
      'created[gte]=' + createdAfter
    ].join('&');

    var url = 'https://api.stripe.com/v1/invoices?' + params;
    Logger.log('Calling Stripe invoices API: ' + url);

    var response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {
        'Authorization': 'Bearer ' + stripeSecretKey
      },
      muteHttpExceptions: true
    });

    var data = JSON.parse(response.getContentText());
    var invoices = data.data || [];

    // Filter to only subscription_cycle billing reasons
    var subscriptionInvoices = [];
    for (var i = 0; i < invoices.length; i++) {
      if (invoices[i].billing_reason === 'subscription_cycle') {
        subscriptionInvoices.push(invoices[i]);
      }
    }

    Logger.log('Retrieved ' + invoices.length + ' paid invoices, ' + subscriptionInvoices.length + ' subscription cycles');
    return subscriptionInvoices;
  } catch (error) {
    Logger.log('Error retrieving paid invoices: ' + error.toString());
    return [];
  }
}

/**
 * Retrieve a Stripe subscription by ID.
 * @param {string} subscriptionId
 * @param {string} secretKey
 * @return {Object|null} Subscription object or null
 */
function retrieveStripeSubscription(subscriptionId, secretKey) {
  try {
    if (!subscriptionId) return null;
    var url = 'https://api.stripe.com/v1/subscriptions/' + encodeURIComponent(subscriptionId);
    var response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {
        'Authorization': 'Bearer ' + secretKey
      },
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      Logger.log('Failed to retrieve subscription ' + subscriptionId + ': ' + response.getContentText());
      return null;
    }

    return JSON.parse(response.getContentText());
  } catch (error) {
    Logger.log('Error retrieving subscription: ' + error.toString());
    return null;
  }
}

/**
 * Save a subscription renewal payment to the sheet.
 * Uses columns A-N (same as one-time), plus R/S/T for renewal metadata.
 * Column C = original checkout session ID (from subscription metadata).
 *
 * Columns: A Timestamp | B Customer Name | C Stripe Session ID | D Wix Order Number
 * | E Wix Order ID | F Items Purchased | G Total Quantity | H Amount | I Currency
 * | J Shipping Address | K Shipping Cost | L Stripe Transaction Fee
 * | M Shipping Provider | N Tracking Number | R Invoice ID | S Payment Intent ID | T Payment Type
 *
 * @param {Object} invoice Stripe invoice object
 * @param {Object} subscription Stripe subscription object
 * @param {string} originalSessionId Original checkout session ID from subscription metadata
 * @param {Object} CONFIG Configuration object
 */
function saveSubscriptionPaymentToSheet(invoice, subscription, originalSessionId, CONFIG) {
  try {
    var sheet = SpreadsheetApp.openById(CONFIG.sheetId).getSheetByName(CONFIG.sheetName);
    ensureSubscriptionColumns_(sheet);

    // Dedup
    if (findOrderRowByColumn(sheet, 17, invoice.id) > 0) {
      Logger.log('Invoice already in sheet: ' + invoice.id);
      return;
    }
    if (invoice.payment_intent && findOrderRowByColumn(sheet, 18, invoice.payment_intent) > 0) {
      Logger.log('Payment intent already in sheet: ' + invoice.payment_intent);
      return;
    }

    // Extract customer info
    var customerName = 'Unknown';
    var customerEmail = '';
    if (invoice.customer_details) {
      customerName = invoice.customer_details.name || invoice.customer_details.email || 'Unknown';
      customerEmail = invoice.customer_details.email || '';
    } else if (invoice.customer_email) {
      customerName = invoice.customer_email;
      customerEmail = invoice.customer_email;
    }

    // Extract line items from invoice
    var itemsList = [];
    var totalQuantity = 0;
    var totalAmount = 0;
    var lines = (invoice.lines && invoice.lines.data) || [];

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var qty = line.quantity || 1;
      var amount = (line.amount || 0) / 100;
      var description = line.description || 'Product';

      totalQuantity += qty;
      totalAmount += amount;
      itemsList.push(description + ' (x' + qty + ')');
    }

    if (itemsList.length === 0) {
      totalAmount = (invoice.total || 0) / 100;
      totalQuantity = 1;
      itemsList.push('Subscription Renewal');
    }

    var itemsPurchased = itemsList.join(', ');
    var currency = (invoice.currency && invoice.currency.toUpperCase()) || 'USD';

    // Shipping cost from invoice
    var shippingCost = 0;
    if (lines.length > 0) {
      for (var s = 0; s < lines.length; s++) {
        var lineItem = lines[s];
        if (lineItem.proration_details || (lineItem.description && lineItem.description.toLowerCase().indexOf('shipping') >= 0)) {
          shippingCost += (lineItem.amount || 0) / 100;
        }
      }
    }

    // Shipping address from invoice or subscription metadata
    var shippingAddressFormatted = '';
    if (invoice.shipping_details && invoice.shipping_details.address) {
      var addr = invoice.shipping_details.address;
      var parts = [];
      if (addr.line1) parts.push(addr.line1);
      if (addr.line2) parts.push(addr.line2);
      if (addr.city) parts.push(addr.city);
      if (addr.state) parts.push(addr.state);
      if (addr.postal_code) parts.push(addr.postal_code);
      if (addr.country) parts.push(addr.country);
      shippingAddressFormatted = parts.join(', ');
    } else if (subscription && subscription.metadata) {
      var meta = subscription.metadata;
      var metaParts = [];
      if (meta.shippingAddress) metaParts.push(meta.shippingAddress);
      if (meta.shippingCity) metaParts.push(meta.shippingCity);
      if (meta.shippingState) metaParts.push(meta.shippingState);
      if (meta.shippingZip) metaParts.push(meta.shippingZip);
      if (meta.shippingCountry) metaParts.push(meta.shippingCountry);
      shippingAddressFormatted = metaParts.join(', ');
    }

    // Get Stripe transaction fee from payment intent
    var stripeFee = 0;
    if (invoice.payment_intent) {
      try {
        var piId = typeof invoice.payment_intent === 'string' ? invoice.payment_intent : invoice.payment_intent.id;
        var piResponse = UrlFetchApp.fetch('https://api.stripe.com/v1/payment_intents/' + piId, {
          method: 'get',
          headers: { 'Authorization': 'Bearer ' + CONFIG.stripeSecretKey },
          muteHttpExceptions: true
        });
        if (piResponse.getResponseCode() === 200) {
          var pi = JSON.parse(piResponse.getContentText());
          if (pi.latest_charge) {
            var chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge.id;
            var chargeResponse = UrlFetchApp.fetch('https://api.stripe.com/v1/charges/' + chargeId, {
              method: 'get',
              headers: { 'Authorization': 'Bearer ' + CONFIG.stripeSecretKey },
              muteHttpExceptions: true
            });
            if (chargeResponse.getResponseCode() === 200) {
              var charge = JSON.parse(chargeResponse.getContentText());
              if (charge.balance_transaction) {
                var btId = typeof charge.balance_transaction === 'string' ? charge.balance_transaction : charge.balance_transaction.id;
                var btResponse = UrlFetchApp.fetch('https://api.stripe.com/v1/balance_transactions/' + btId, {
                  method: 'get',
                  headers: { 'Authorization': 'Bearer ' + CONFIG.stripeSecretKey },
                  muteHttpExceptions: true
                });
                if (btResponse.getResponseCode() === 200) {
                  stripeFee = (JSON.parse(btResponse.getContentText()).fee || 0) / 100;
                }
              }
            }
          }
        }
      } catch (feeErr) {
        Logger.log('Error retrieving subscription fee: ' + feeErr.toString());
      }
    }

    // Build row: A-N + R/S/T
    var row = [
      new Date().toISOString(),           // A: Timestamp
      customerName,                        // B: Customer Name
      originalSessionId,                   // C: Stripe Session ID (original checkout session)
      '',                                  // D: Wix Order Number
      '',                                  // E: Wix Order ID
      itemsPurchased,                      // F: Items Purchased
      totalQuantity,                       // G: Total Quantity
      totalAmount,                         // H: Amount
      currency,                            // I: Currency
      shippingAddressFormatted,            // J: Shipping Address
      shippingCost.toFixed(2),             // K: Shipping Cost
      stripeFee.toFixed(2),                // L: Stripe Transaction Fee
      '',                                  // M: Shipping Provider
      '',                                  // N: Tracking Number
      '',                                  // O: Tracking Notification Sent
      '',                                  // P: Ledger Routed
      '',                                  // Q: Environment
      invoice.id,                          // R: Invoice ID
      invoice.payment_intent || '',        // S: Payment Intent ID
      'subscription_renewal'               // T: Payment Type
    ];

    // Pad row to 20 columns before appending
    while (row.length < 20) {
      row.push('');
    }

    sheet.appendRow(row);
    Logger.log('Subscription renewal saved: invoice ' + invoice.id + ' for ' + customerName + ' $' + totalAmount.toFixed(2));
  } catch (error) {
    Logger.log('Error saving subscription payment: ' + error.toString());
    throw error;
  }
}

/**
 * Send tracking emails (scheduled function)
 * Set up a time-driven trigger to run this function periodically
 * 
 * Current sheet structure (columns A-N):
 * A: Timestamp, B: Customer Name, C: Stripe Session ID, D: Wix Order Number, E: Wix Order ID,
 * F: Items Purchased, G: Total Quantity, H: Amount, I: Currency, J: Shipping Address,
 * K: Shipping Cost, L: Stripe Transaction Fee, M: Shipping Provider, N: Tracking Number
 */
function sendTrackingEmails() {
  try {
    // Check both environments - use the same sheet for both
    var environments = ['production', 'development'];
    
    for (var envIdx = 0; envIdx < environments.length; envIdx++) {
      var environment = environments[envIdx];
      var CONFIG = getConfig(environment);
      
      if (!CONFIG.stripeSecretKey) {
        Logger.log('Skipping ' + environment + ' - Stripe key not configured');
        continue;
      }
      
    var sheet = SpreadsheetApp.openById(CONFIG.sheetId).getSheetByName(CONFIG.sheetName);
      if (!sheet) {
        Logger.log('Sheet not found for ' + environment + ': ' + CONFIG.sheetName);
        continue;
      }
      
    var data = sheet.getDataRange().getValues();
      Logger.log('Processing ' + environment + ' environment: ' + (data.length - 1) + ' rows');

    // Skip header row
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
        
        // Current sheet structure:
        // Column C (index 2): Stripe Session ID
        // Column N (index 13): Tracking Number
        var sessionId = row[2]; // Column C
        
        if (!sessionId || !sessionId.toString().trim()) {
          continue; // Skip rows without session ID
        }
        
        sessionId = sessionId.toString().trim();
        
        // Determine if this session belongs to this environment
        // Test sessions start with "cs_test_", live sessions start with "cs_live_"
        var isTestSession = sessionId.indexOf('cs_test_') === 0;
        var isLiveSession = sessionId.indexOf('cs_live_') === 0;
        
        // Skip if session doesn't match environment
        if (environment === 'production' && isTestSession) {
          continue; // Production environment, but this is a test session
        }
        if (environment === 'development' && isLiveSession) {
          continue; // Development environment, but this is a live session
        }
        
        var trackingNumber = row[13]; // Column N (Tracking Number)
        
        // Check if tracking number exists
        if (!trackingNumber || !trackingNumber.toString().trim()) {
          continue; // Skip rows without tracking numbers
        }
        
        trackingNumber = trackingNumber.toString().trim();
        
        // Check if email was already sent (Column O - index 14, if it exists)
        var emailSent = row[14] || '';
        if (emailSent && emailSent.toString().trim() === 'Yes') {
          continue; // Skip if email already sent
        }
        
        // Get customer email and order details from Stripe session
        var customerEmail = null;
        var orderItems = [];
        var shippingAddress = null;
        try {
          var stripeSession = retrieveStripeSession(sessionId, CONFIG.stripeSecretKey);
          if (stripeSession) {
            customerEmail = (stripeSession.customer_details && stripeSession.customer_details.email) 
              || stripeSession.customer_email 
              || null;
            
            // Extract order items
            var lineItems = (stripeSession.line_items && stripeSession.line_items.data) || [];
            for (var itemIdx = 0; itemIdx < lineItems.length; itemIdx++) {
              var item = lineItems[itemIdx];
              orderItems.push({
                name: item.description || 'Product',
                quantity: item.quantity || 1,
                amount: ((item.amount_total || 0) / 100).toFixed(2)
              });
            }
            
            // Extract shipping address
            if (stripeSession.shipping_details && stripeSession.shipping_details.address) {
              var addr = stripeSession.shipping_details.address;
              shippingAddress = {
                name: stripeSession.shipping_details.name || '',
                line1: addr.line1 || '',
                line2: addr.line2 || '',
                city: addr.city || '',
                state: addr.state || '',
                postal_code: addr.postal_code || '',
                country: addr.country || ''
              };
            } else if (stripeSession.shipping && stripeSession.shipping.address) {
              var addr = stripeSession.shipping.address;
              shippingAddress = {
                name: stripeSession.shipping.name || '',
                line1: addr.line1 || '',
                line2: addr.line2 || '',
                city: addr.city || '',
                state: addr.state || '',
                postal_code: addr.postal_code || '',
                country: addr.country || ''
              };
            }
          }
        } catch (stripeError) {
          Logger.log('Error retrieving Stripe session ' + sessionId + ' from ' + environment + ': ' + stripeError.toString());
          continue; // Skip if we can't get email
        }
        
        if (!customerEmail) {
          Logger.log('No email found for session ' + sessionId + ' in ' + environment + ', skipping');
          continue;
        }
        
        // Determine base URL based on environment
        var baseUrl = environment === 'development' 
          ? 'https://beta.agroverse.shop'
          : 'https://www.agroverse.shop';
        var orderStatusUrl = baseUrl + '/order-status?session_id=' + sessionId;
        
        // Send tracking email
        try {
          sendTrackingEmail(customerEmail, sessionId, trackingNumber, orderItems, shippingAddress, orderStatusUrl, environment);
          
          // Mark email as sent in Column O (index 14)
          // If Column O doesn't exist, we'll create it
          var emailSentColumn = 15; // Column O (1-based)
          sheet.getRange(i + 1, emailSentColumn).setValue('Yes');
          sheet.getRange(i + 1, emailSentColumn + 1).setValue(new Date().toISOString()); // Column P: Timestamp
          
          Logger.log('Tracking email sent for session: ' + sessionId + ' (' + environment + ')');
        } catch (emailError) {
          Logger.log('Error sending tracking email for session ' + sessionId + ': ' + emailError.toString());
        }
      }
    }
  } catch (error) {
    Logger.log('Error sending tracking emails: ' + error.toString());
  }
}

/**
 * Send tracking email to customer
 * @param {string} email Customer email address
 * @param {string} sessionId Stripe session ID
 * @param {string} trackingNumber Tracking number
 * @param {Array} orderItems Array of order items with {name, quantity, amount}
 * @param {Object} shippingAddress Shipping address object
 * @param {string} orderStatusUrl URL to view order details
 * @param {string} environment Environment (development/production)
 */
function sendTrackingEmail(email, sessionId, trackingNumber, orderItems, shippingAddress, orderStatusUrl, environment) {
  try {
    var trackingUrl = getTrackingUrl(trackingNumber);
    
    var subject = 'Your Agroverse Order Has Shipped!';
    
    // Build items list
    var itemsList = '';
    if (orderItems && orderItems.length > 0) {
      for (var i = 0; i < orderItems.length; i++) {
        var item = orderItems[i];
        itemsList += '  • ' + item.name + ' (Qty: ' + item.quantity + ') - $' + item.amount + '\n';
      }
    } else {
      itemsList = '  (Items not available)\n';
    }
    
    // Build shipping address
    var addressText = '';
    if (shippingAddress) {
      addressText = (shippingAddress.name ? shippingAddress.name + '\n' : '') +
        (shippingAddress.line1 ? shippingAddress.line1 + '\n' : '') +
        (shippingAddress.line2 ? shippingAddress.line2 + '\n' : '') +
        (shippingAddress.city || shippingAddress.state || shippingAddress.postal_code 
          ? (shippingAddress.city || '') + 
            (shippingAddress.city && shippingAddress.state ? ', ' : '') + 
            (shippingAddress.state || '') + 
            ' ' + (shippingAddress.postal_code || '') + '\n'
          : '') +
        (shippingAddress.country ? shippingAddress.country + '\n' : '');
    } else {
      addressText = 'Address not available\n';
    }
    
    var body = 'Hello,\n\n' +
      'Great news! Your Agroverse order has been shipped.\n\n' +
      
      '=== ORDER INFORMATION ===\n' +
      'Order Number: ' + sessionId + '\n\n' +
      
      '=== ITEMS SHIPPED ===\n' +
      itemsList + '\n' +
      
      '=== SHIPPING ADDRESS ===\n' +
      addressText + '\n' +
      
      '=== TRACKING INFORMATION ===\n' +
      'Tracking Number: ' + trackingNumber + '\n' +
      (trackingUrl ? 'Track your package: ' + trackingUrl + '\n' : '') + '\n' +
      
      '=== VIEW ORDER DETAILS ===\n' +
      'View your complete order details: ' + orderStatusUrl + '\n\n' +
      
      'Thank you for your purchase! We appreciate your business.\n\n' +
      'If you have any questions, please don\'t hesitate to reach out.\n\n' +
      'Best regards,\n' +
      'Agroverse Team';

    MailApp.sendEmail({
      to: email,
      subject: subject,
      body: body
    });

    Logger.log('Tracking email sent to: ' + email);
  } catch (error) {
    Logger.log('Error sending email: ' + error.toString());
    throw error; // Re-throw so caller can handle it
  }
}

/**
 * Get tracking URL based on tracking number format
 */
function getTrackingUrl(trackingNumber) {
  var trimmed = trackingNumber.trim().toUpperCase();

  // USPS
  if (/^\d+[A-Z]{2}\d+US$/.test(trimmed)) {
    return 'https://tools.usps.com/go/TrackConfirmAction?tLabels=' + trimmed;
  }

  // UPS
  if (trimmed.indexOf('1Z') === 0) {
    return 'https://www.ups.com/track?tracknum=' + trimmed;
  }

  // FedEx
  if (/^\d{12}$/.test(trimmed)) {
    return 'https://www.fedex.com/fedextrack/?trknbr=' + trimmed;
  }

  // Default: USPS
  return 'https://tools.usps.com/go/TrackConfirmAction?tLabels=' + trimmed;
}

/**
 * Submit quote request
 * Sends email notification to garyjob@agroverse.shop with all quote request details
 */
function submitQuoteRequest(data) {
  try {
    var quoteData = data.quoteData;
    var environment = data.environment || 'production';
    var CONFIG = getConfig(environment);

    // Send email notification to admin
    try {
      var subject = 'New Wholesale Quote Request - ' + (quoteData.businessName || 'Unknown Business');
      
      // Build products list with more details
      var productsList = [];
      var products = quoteData.products || [];
      if (products.length > 0) {
      for (var p = 0; p < products.length; p++) {
        var product = products[p];
          var productLine = '- Product ID: ' + (product.productId || 'N/A');
          if (product.quantity) {
            productLine += ' | Quantity: ' + product.quantity + ' kg';
          }
          if (product.productName) {
            productLine += ' | Name: ' + product.productName;
          }
          productsList.push(productLine);
        }
      } else {
        productsList.push('No products specified');
      }
      
      // Format shipping address (handle both string and object)
      var shippingAddressFormatted = '';
      if (quoteData.shippingAddress) {
        if (typeof quoteData.shippingAddress === 'string') {
          shippingAddressFormatted = quoteData.shippingAddress;
        } else if (typeof quoteData.shippingAddress === 'object') {
          // If it's an object, format it nicely
          var addr = quoteData.shippingAddress;
          var addressParts = [];
          if (addr.line1 || addr.addressLine1) addressParts.push(addr.line1 || addr.addressLine1);
          if (addr.line2 || addr.addressLine2) addressParts.push(addr.line2 || addr.addressLine2);
          if (addr.city) addressParts.push(addr.city);
          if (addr.state || addr.stateProvince) addressParts.push(addr.state || addr.stateProvince);
          if (addr.postalCode || addr.zipCode) addressParts.push(addr.postalCode || addr.zipCode);
          if (addr.country) addressParts.push(addr.country);
          shippingAddressFormatted = addressParts.join(', ');
        }
      }
      
      var body = '=== NEW WHOLESALE QUOTE REQUEST ===\n\n' +
        'Submitted: ' + new Date().toLocaleString() + '\n\n' +
        
        '=== BUSINESS INFORMATION ===\n' +
        'Business Name: ' + (quoteData.businessName || 'Not provided') + '\n' +
        'Contact Name: ' + (quoteData.contactName || 'Not provided') + '\n' +
        'Email: ' + (quoteData.email || 'Not provided') + '\n' +
        'Phone: ' + (quoteData.phone || 'Not provided') + '\n' +
        'Company Type: ' + (quoteData.companyType || 'Not specified') + '\n\n' +
        
        '=== PRODUCTS REQUESTED ===\n' +
        productsList.join('\n') + '\n\n' +
        
        '=== SHIPPING INFORMATION ===\n' +
        (shippingAddressFormatted || 'Not provided') + '\n\n' +
        
        '=== ORDER DETAILS ===\n' +
        'Expected Frequency: ' + (quoteData.expectedFrequency || 'Not specified') + '\n\n' +
        
        '=== ADDITIONAL NOTES ===\n' +
        (quoteData.notes || 'None') + '\n\n' +
        
        '=== CONTACT INFORMATION ===\n' +
        'Reply to: ' + (quoteData.email || 'No email provided') + '\n' +
        (quoteData.phone ? 'Phone: ' + quoteData.phone + '\n' : '') +
        '\n---\n' +
        'This is an automated notification from Agroverse Shop.\n' +
        'Quote request submitted via: ' + (environment === 'development' ? 'Development' : 'Production') + ' environment';

      MailApp.sendEmail({
        to: 'garyjob@agroverse.shop',
        subject: subject,
        body: body,
        replyTo: quoteData.email || undefined // Set reply-to to customer email if available
      });
      
      Logger.log('Quote request email sent to garyjob@agroverse.shop for: ' + quoteData.email);
    } catch (emailError) {
      Logger.log('Error sending email notification: ' + emailError.toString());
      // Return error if email fails - this is critical
      return createCORSResponse({
        status: 'error',
        error: 'Failed to send quote request notification: ' + emailError.toString()
      });
    }

    Logger.log('Quote request processed: ' + quoteData.email);

    return createCORSResponse({
      status: 'success',
      message: 'Quote request submitted successfully. We will contact you soon!'
    });
  } catch (error) {
    Logger.log('Error submitting quote request: ' + error.toString());
    return createCORSResponse({
      error: error.toString()
    });
  }
}

// Legacy CONFIG for backward compatibility (will use production by default)
// This is only used if getConfig() isn't called first
var CONFIG = getConfig('production');

/**
 * Helper: Build form data for Stripe API
 * Converts object to URL-encoded form data
 */
/**
 * Build form-encoded data for Stripe API
 * Handles nested objects and arrays using bracket notation
 * 
 * @param {Object} data Data object to encode
 * @param {string} prefix Prefix for nested keys (used recursively)
 * @return {string} Form-encoded string
 */
function buildFormData(data, prefix) {
  var params = [];
  prefix = prefix || '';
  
  for (var key in data) {
    if (data.hasOwnProperty(key) && data[key] !== undefined && data[key] !== null) {
      var value = data[key];
      var fullKey = prefix ? prefix + '[' + key + ']' : key;
      
      if (Array.isArray(value)) {
        // Handle arrays: 
        // - Arrays of objects use indexed brackets: key[0][field]=value
        // - Arrays of primitives use empty brackets: key[]=value
        for (var i = 0; i < value.length; i++) {
          if (typeof value[i] === 'object' && value[i] !== null) {
            // Object in array - use indexed brackets for Stripe API
            var nestedParams = buildFormData(value[i], fullKey + '[' + i + ']');
            if (nestedParams) {
              params.push(nestedParams);
            }
          } else {
            // Simple value in array - use empty brackets for Stripe API
            params.push(fullKey + '[]=' + encodeURIComponent(String(value[i])));
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        // Handle nested objects: recurse with bracket notation
        var nestedParams = buildFormData(value, fullKey);
        if (nestedParams) {
          params.push(nestedParams);
        }
      } else {
        // Simple value
        params.push(fullKey + '=' + encodeURIComponent(String(value)));
      }
    }
  }
  return params.join('&');
}

/**
 * Test function to verify EasyPost API integration
 * Run this function from the Google App Script editor to test EasyPost
 * 
 * Usage: Run testEasyPostShipping() from the script editor
 */
function testEasyPostShipping() {
  Logger.log('=== Testing EasyPost Shipping Calculation ===');
  
  // Test parameters
  var testWeightOz = 19.2; // 1 item (7.05 oz) + base box (11.5 oz) + packaging (0.65 oz)
  var testShippingAddress = {
    address: '1327 Columbus Avenue',
    city: 'San Francisco',
    state: 'CA',
    zip: '94133',
    country: 'US'
  };
  
  Logger.log('Test weight: ' + testWeightOz + ' oz');
  Logger.log('Test address: ' + JSON.stringify(testShippingAddress));
  
  // Check Script Properties
  var props = PropertiesService.getScriptProperties();
  var easypostApiKey = props.getProperty('EASYPOST_API_KEY');
  
  // Get origin address (with hardcoded defaults)
  var originLine1 = props.getProperty('ORIGIN_ADDRESS_LINE1') || '1423 Hayes St';
  var originLine2 = props.getProperty('ORIGIN_ADDRESS_LINE2') || '';
  var originCity = props.getProperty('ORIGIN_ADDRESS_CITY') || 'San Francisco';
  var originState = props.getProperty('ORIGIN_ADDRESS_STATE') || 'CA';
  var originZip = props.getProperty('ORIGIN_ADDRESS_POSTAL_CODE') || '94117';
  var originCountry = props.getProperty('ORIGIN_ADDRESS_COUNTRY') || 'US';
  
  Logger.log('EasyPost API Key configured: ' + (easypostApiKey ? 'YES (length: ' + easypostApiKey.length + ')' : 'NO'));
  Logger.log('Origin address: ' + originLine1 + ', ' + originCity + ', ' + originState + ' ' + originZip);
  Logger.log('  (Using defaults if not set in Script Properties)');
  
  if (!easypostApiKey) {
    Logger.log('ERROR: EASYPOST_API_KEY not set in Script Properties');
    return;
  }
  
  // Call EasyPost function
  Logger.log('\n--- Calling calculateShippingRatesViaEasyPost ---');
  var shippingOptions = calculateShippingRatesViaEasyPost(testWeightOz, testShippingAddress);
  
  Logger.log('\n--- Results ---');
  Logger.log('Number of shipping options returned: ' + shippingOptions.length);
  
  if (shippingOptions.length === 0) {
    Logger.log('ERROR: No shipping options returned. Check logs above for EasyPost API errors.');
  } else {
    Logger.log('SUCCESS: Shipping options found!');
    for (var i = 0; i < shippingOptions.length; i++) {
      var option = shippingOptions[i];
      var rateData = option.shipping_rate_data;
      var amount = rateData.fixed_amount.amount / 100;
      var name = rateData.display_name;
      Logger.log('  Option ' + (i + 1) + ': ' + name + ' - $' + amount.toFixed(2));
    }
  }
  
  Logger.log('\n=== Test Complete ===');
  return shippingOptions;
}

/**
 * Test function with minimal parameters (just weight, no address)
 */
function testEasyPostMinimal() {
  Logger.log('=== Testing EasyPost with Minimal Parameters ===');
  
  var testWeightOz = 19.2;
  Logger.log('Test weight: ' + testWeightOz + ' oz');
  Logger.log('No shipping address provided (will use default)');
  
  var shippingOptions = calculateShippingRatesViaEasyPost(testWeightOz, null);
  
  Logger.log('Results: ' + shippingOptions.length + ' options');
  return shippingOptions;
}

/**
 * Test function to pull order details from Stripe by session ID
 * 
 * Usage:
 * 1. Replace 'YOUR_STRIPE_SESSION_ID' below with your actual Stripe session ID
 * 2. Or call: testGetOrderStatus('cs_test_xxxxx')
 * 3. Run from the Google App Script editor
 * 4. Check the Execution log for detailed output
 * 
 * @param {String} sessionId (optional) Stripe checkout session ID (e.g., 'cs_test_xxxxx')
 * @return {Object} Order details object
 */
function testGetOrderStatus(sessionId) {
  // Default test session ID - replace with your actual session ID
  var testSessionId = sessionId || 'cs_test_a1TWwFuLbhfyXHroNy3OCAzPEWctusgYf3gBzAF8RbXxN4FIbMQF76Xh57';
  
  Logger.log('=== Testing Order Status Retrieval ===');
  Logger.log('Stripe Session ID: ' + testSessionId);
  Logger.log('');
  
  // Try both environments
  var environments = ['development', 'production'];
  var foundSession = null;
  var foundEnvironment = null;
  
  Logger.log('--- Step 1: Fetching from Stripe ---');
  for (var i = 0; i < environments.length; i++) {
    var env = environments[i];
    var CONFIG = getConfig(env);
    
    if (!CONFIG.stripeSecretKey) {
      Logger.log('Skipping ' + env + ' - Stripe key not configured');
      continue;
    }
    
    Logger.log('Trying ' + env + ' environment...');
    
    try {
      var stripeSession = retrieveStripeSession(testSessionId, CONFIG.stripeSecretKey);
      
      if (stripeSession) {
        foundSession = stripeSession;
        foundEnvironment = env;
        Logger.log('✓ Found session in ' + env + ' environment');
        Logger.log('  Payment Status: ' + (stripeSession.payment_status || 'N/A'));
        Logger.log('  Created: ' + new Date(stripeSession.created * 1000).toISOString());
        Logger.log('  Amount Total: $' + ((stripeSession.amount_total || 0) / 100).toFixed(2));
        Logger.log('  Currency: ' + (stripeSession.currency || 'N/A'));
        break;
      }
    } catch (error) {
      Logger.log('  ✗ Error in ' + env + ': ' + error.toString());
      continue;
    }
  }
  
  if (!foundSession) {
    Logger.log('✗ ERROR: Session not found in either environment');
    Logger.log('  Make sure the session ID is correct and the Stripe keys are configured');
    return null;
  }
  
  Logger.log('');
  Logger.log('--- Step 2: Extracting Order Details ---');
  
  // Extract customer info
  var customerName = (foundSession.customer_details && foundSession.customer_details.name) || 
                      (foundSession.shipping_details && foundSession.shipping_details.name) || 
                      foundSession.customer_email || 
                      'Unknown';
  var customerEmail = (foundSession.customer_details && foundSession.customer_details.email) || 
                      foundSession.customer_email || '';
  
  Logger.log('Customer Name: ' + customerName);
  Logger.log('Customer Email: ' + customerEmail);
  
  // Extract line items
  var lineItems = (foundSession.line_items && foundSession.line_items.data) || [];
  Logger.log('Line Items Count: ' + lineItems.length);
  
  var items = [];
  var totalQuantity = 0;
  var totalAmount = 0;
  
  for (var j = 0; j < lineItems.length; j++) {
    var item = lineItems[j];
    var quantity = item.quantity || 1;
    var amount = (item.amount_total || 0) / 100;
    var description = item.description || 'Product';
    
    // Extract product image from Stripe line item
    // When using price_data, product might be in different locations
    var productImage = null;
    var productData = null;
    
    Logger.log('  Item ' + (j + 1) + ' - Debugging Product Data:');
    Logger.log('    Item keys: ' + Object.keys(item).join(', '));
    Logger.log('    Item type: ' + typeof item);
    Logger.log('    Item is array: ' + Array.isArray(item));
    
    if (item.price) {
      Logger.log('    Price exists, keys: ' + Object.keys(item.price).join(', '));
      Logger.log('    Price type: ' + typeof item.price);
      Logger.log('    Price.product exists: ' + !!item.price.product);
      Logger.log('    Price.product type: ' + typeof item.price.product);
      Logger.log('    Price.product is array: ' + Array.isArray(item.price.product));
      
      // Try different locations for product data
      if (item.price.product) {
        productData = item.price.product;
        Logger.log('    Found product in item.price.product');
        Logger.log('    Product type: ' + (Array.isArray(productData) ? 'Array' : typeof productData));
        
        // Handle if product is an array (unexpected but possible)
        if (Array.isArray(productData)) {
          Logger.log('    WARNING: product is an array, length: ' + productData.length);
          if (productData.length > 0) {
            productData = productData[0]; // Use first element
            Logger.log('    Using first element of product array');
          }
        }
        
        if (productData && typeof productData === 'object') {
          Logger.log('    Product keys: ' + Object.keys(productData).join(', '));
          Logger.log('    Product ID: ' + (productData.id || 'N/A'));
          Logger.log('    Product Name: ' + (productData.name || 'N/A'));
          
          if (productData.images && Array.isArray(productData.images) && productData.images.length > 0) {
            productImage = productData.images[0];
            Logger.log('    ✓ Product Image Found: ' + productImage);
            Logger.log('    Total Images: ' + productData.images.length);
          } else {
            Logger.log('    ✗ No images array in product');
            Logger.log('    Product.images type: ' + typeof productData.images);
          }
        }
      } else {
        Logger.log('    ✗ No product in item.price');
      }
    } else {
      Logger.log('    ✗ No price in item');
    }
    
    // Also try item.product (sometimes product is at item level)
    if (!productImage && item.product) {
      Logger.log('    Trying item.product...');
      productData = item.product;
      if (Array.isArray(productData)) {
        if (productData.length > 0) {
          productData = productData[0];
        }
      }
      if (productData && productData.images && Array.isArray(productData.images) && productData.images.length > 0) {
        productImage = productData.images[0];
        Logger.log('    ✓ Found image in item.product: ' + productImage);
      }
    }
    
    Logger.log('  Item ' + (j + 1) + ': ' + description);
    Logger.log('    Quantity: ' + quantity);
    Logger.log('    Amount: $' + amount.toFixed(2));
    Logger.log('    Image URL: ' + (productImage || '(none)'));
    
    items.push({
      name: description,
      quantity: quantity,
      price: amount / quantity,
      image: productImage || null
    });
    
    totalQuantity += quantity;
    totalAmount += amount;
  }
  
  if (items.length === 0) {
    totalAmount = (foundSession.amount_total || 0) / 100;
    totalQuantity = 1;
    items.push({
      name: 'Product',
      quantity: 1,
      price: totalAmount
    });
    Logger.log('  No line items found, using session total: $' + totalAmount.toFixed(2));
  }
  
  Logger.log('Total Quantity: ' + totalQuantity);
  Logger.log('Total Amount: $' + totalAmount.toFixed(2));
  
  // Extract shipping address
  var shippingAddress = null;
  if (foundSession.shipping_details && foundSession.shipping_details.address) {
    var shipping = foundSession.shipping_details;
    shippingAddress = {
      fullName: shipping.name || customerName || '',
      address: shipping.address.line1 + (shipping.address.line2 ? ', ' + shipping.address.line2 : ''),
      city: shipping.address.city || '',
      state: shipping.address.state || '',
      zip: shipping.address.postal_code || '',
      country: shipping.address.country || 'US'
    };
    
    Logger.log('');
    Logger.log('Shipping Address:');
    Logger.log('  Name: ' + shippingAddress.fullName);
    Logger.log('  Address: ' + shippingAddress.address);
    Logger.log('  ' + shippingAddress.city + ', ' + shippingAddress.state + ' ' + shippingAddress.zip);
    Logger.log('  Country: ' + shippingAddress.country);
  } else {
    Logger.log('No shipping address found');
  }
  
  Logger.log('');
  Logger.log('--- Step 3: Checking Google Sheet ---');
  
  // Check if order exists in sheet
  try {
    var CONFIG_SHEET = getConfig(foundEnvironment);
    var sheet = SpreadsheetApp.openById(CONFIG_SHEET.sheetId).getSheetByName(CONFIG_SHEET.sheetName);
    var row = findOrderRowBySessionId(sheet, testSessionId);
    
    if (row > 0) {
      Logger.log('✓ Order found in Google Sheet (row ' + row + ')');
      var data = sheet.getRange(row, 1, 1, 9).getValues()[0];
      Logger.log('  Timestamp: ' + data[0]);
      Logger.log('  Customer Name: ' + data[1]);
      Logger.log('  Items: ' + data[5]);
      Logger.log('  Total: $' + data[7]);
    } else {
      Logger.log('✗ Order NOT found in Google Sheet');
      Logger.log('  (This is normal if the order was just placed and polling hasn\'t run yet)');
    }
  } catch (sheetError) {
    Logger.log('✗ Error checking sheet: ' + sheetError.toString());
  }
  
  Logger.log('');
  Logger.log('--- Step 4: Testing getOrderStatus Function ---');
  
  // Test the actual getOrderStatus function
  try {
    var orderStatusResult = getOrderStatus(testSessionId);
    
    // Check if result is ContentService.TextOutput
    if (orderStatusResult && typeof orderStatusResult.getContentText === 'function') {
      var orderStatusText = orderStatusResult.getContentText();
      var orderStatusData = JSON.parse(orderStatusText);
      
      if (orderStatusData.status === 'success') {
        Logger.log('✓ getOrderStatus returned success');
        Logger.log('  Order Status: ' + (orderStatusData.order.status || 'N/A'));
        Logger.log('  Items Count: ' + (orderStatusData.order.items ? orderStatusData.order.items.length : 0));
        if (orderStatusData.order.items && orderStatusData.order.items.length > 0) {
          Logger.log('  First Item Image: ' + (orderStatusData.order.items[0].image || '(none)'));
          for (var itemIdx = 0; itemIdx < orderStatusData.order.items.length; itemIdx++) {
            var testItem = orderStatusData.order.items[itemIdx];
            Logger.log('  Item ' + (itemIdx + 1) + ' "' + testItem.name + '" image: ' + (testItem.image || '(none)'));
          }
        }
      } else {
        Logger.log('✗ getOrderStatus returned error: ' + (orderStatusData.error || 'Unknown'));
      }
    } else {
      Logger.log('✗ getOrderStatus did not return ContentService.TextOutput');
      Logger.log('  Result type: ' + typeof orderStatusResult);
      Logger.log('  Result keys: ' + (orderStatusResult && typeof orderStatusResult === 'object' ? Object.keys(orderStatusResult).join(', ') : 'N/A'));
    }
  } catch (testError) {
    Logger.log('✗ Error testing getOrderStatus: ' + testError.toString());
    Logger.log('  Stack: ' + (testError.stack || 'N/A'));
  }
  
  Logger.log('');
  Logger.log('=== Test Complete ===');
  Logger.log('');
  Logger.log('--- Step 5: Product Images Summary ---');
  var itemsWithImages = 0;
  var itemsWithoutImages = 0;
  for (var imgCheck = 0; imgCheck < items.length; imgCheck++) {
    if (items[imgCheck].image) {
      itemsWithImages++;
      Logger.log('  ✓ Item "' + items[imgCheck].name + '" has image: ' + items[imgCheck].image);
    } else {
      itemsWithoutImages++;
      Logger.log('  ✗ Item "' + items[imgCheck].name + '" has NO image');
    }
  }
  Logger.log('  Items with images: ' + itemsWithImages + ' / ' + items.length);
  Logger.log('  Items without images: ' + itemsWithoutImages + ' / ' + items.length);
  
  Logger.log('');
  Logger.log('=== Summary ===');
  Logger.log('  Session ID: ' + testSessionId);
  Logger.log('  Environment: ' + foundEnvironment);
  Logger.log('  Payment Status: ' + (foundSession.payment_status || 'N/A'));
  Logger.log('  Customer: ' + customerName + ' (' + customerEmail + ')');
  Logger.log('  Total: $' + totalAmount.toFixed(2) + ' ' + (foundSession.currency || 'USD').toUpperCase());
  Logger.log('  Items: ' + totalQuantity);
  Logger.log('  Items with Images: ' + itemsWithImages + ' / ' + items.length);
  
  // Return formatted order object
  return {
    sessionId: foundSession.id,
    environment: foundEnvironment,
    paymentStatus: foundSession.payment_status,
    customerName: customerName,
    customerEmail: customerEmail,
    items: items,
    totalAmount: totalAmount,
    currency: foundSession.currency || 'USD',
    shippingAddress: shippingAddress,
    created: new Date(foundSession.created * 1000).toISOString()
  };
}

/**
 * Helper function to get the Google Sheet URL
 * Run this function to see the sheet URL in the logs
 */
function getSheetUrl() {
  var configs = ['production', 'development'];
  configs.forEach(function(env) {
    var CONFIG = getConfig(env);
    if (CONFIG.sheetId) {
      var url = 'https://docs.google.com/spreadsheets/d/' + CONFIG.sheetId + '/edit';
      Logger.log(env.toUpperCase() + ' Sheet URL: ' + url);
      Logger.log('Sheet Name: ' + CONFIG.sheetName);
    } else {
      Logger.log(env.toUpperCase() + ': GOOGLE_SHEET_ID not configured');
    }
  });
}

// ====================================================================
// ETSY ORDER MONITORING
// ====================================================================
// Polls Etsy for new receipts (orders) and logs them to the same
// "Stripe Social Media Checkout ID" sheet with Channel = "Etsy".
//
// Setup:
// 1. Set Script Properties: ETSY_KEYSTRING, ETSY_SHARED_SECRET, ETSY_SHOP_ID
// 2. Run setupEtsyOAuth() once to get the redirect URL
// 3. Visit the URL, authorize, copy the auth code from redirect
// 4. Run completeEtsyOAuth("CODE") to store the refresh token
// 5. Create time-driven trigger for syncAllOrders() or syncEtsyOrders()
// 6. Ensure column O ("Channel") header exists in the sheet

var ETSY_API_BASE = 'https://api.etsy.com/v3';
var ETSY_AUTH_URL = 'https://www.etsy.com/oauth/connect';
var ETSY_TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token';
var ETSY_TOKEN_CACHE_KEY = 'etsy_access_token';
var ETSY_TOKEN_CACHE_SECONDS = 3000; // 50 minutes (token expires in 1 hour)

/**
 * Unified sync dispatcher — calls both Stripe and Etsy sync functions.
 * Use this as the single time-driven trigger function.
 */
function syncAllOrders() {
  try {
    syncStripeOrders();
  } catch (e) {
    Logger.log('Stripe sync error: ' + e.toString());
  }
  try {
    syncEtsyOrders();
  } catch (e) {
    Logger.log('Etsy sync error: ' + e.toString());
  }
}

// ── Etsy OAuth ────────────────────────────────────────────────────────

/**
 * Step 1 of Etsy OAuth: Generate the authorization URL.
 * Run this manually from the Apps Script editor, then visit the URL
 * in your browser to grant Etsy access.
 */
function setupEtsyOAuth() {
  var props = PropertiesService.getScriptProperties();
  var keystring = props.getProperty('ETSY_KEYSTRING');
  
  if (!keystring) {
    Logger.log('ERROR: ETSY_KEYSTRING not set in Script Properties.');
    return;
  }

  // PKCE code verifier + challenge
  var codeVerifier = generatePkceCodeVerifier_();
  var codeChallenge = generatePkceCodeChallenge_(codeVerifier);

  // Store code_verifier for step 2
  var userProps = PropertiesService.getUserProperties();
  userProps.setProperty('ETSY_CODE_VERIFIER', codeVerifier);

  var redirectUri = 'https://agroverse.shop/etsy/callback';
  var scopes = 'transactions_r listings_r listings_w';
  
  var authUrl = ETSY_AUTH_URL +
    '?response_type=code' +
    '&client_id=' + keystring +
    '&redirect_uri=' + encodeURIComponent(redirectUri) +
    '&scope=' + encodeURIComponent(scopes) +
    '&state=etsy_setup' +
    '&code_challenge=' + codeChallenge +
    '&code_challenge_method=S256';

  Logger.log('=== ETSY OAUTH SETUP ===');
  Logger.log('Visit this URL in your browser to authorize:');
  Logger.log(authUrl);
  Logger.log('');
  Logger.log('After authorizing, you will be redirected to:');
  Logger.log(redirectUri + '?code=XXXXX&state=etsy_setup');
  Logger.log('');
  Logger.log('Copy the "code" parameter from the URL and run:');
  Logger.log('completeEtsyOAuth("CODE_VALUE_HERE")');
}

/**
 * Step 2 of Etsy OAuth: Exchange the authorization code for tokens.
 * @param {string} authCode - The "code" query parameter from the redirect URL.
 */
function completeEtsyOAuth(authCode) {
  var props = PropertiesService.getScriptProperties();
  var keystring = props.getProperty('ETSY_KEYSTRING');
  var sharedSecret = props.getProperty('ETSY_SHARED_SECRET');
  var userProps = PropertiesService.getUserProperties();
  var codeVerifier = userProps.getProperty('ETSY_CODE_VERIFIER');

  if (!keystring || !sharedSecret) {
    Logger.log('ERROR: ETSY_KEYSTRING or ETSY_SHARED_SECRET not set.');
    return;
  }
  if (!codeVerifier) {
    Logger.log('ERROR: No code_verifier found. Run setupEtsyOAuth() first.');
    return;
  }
  if (!authCode) {
    Logger.log('ERROR: No auth code provided. Pass it as: completeEtsyOAuth("CODE")');
    return;
  }

  var redirectUri = 'https://agroverse.shop/etsy/callback';
  var payload = {
    grant_type: 'authorization_code',
    client_id: keystring,
    client_secret: sharedSecret,
    redirect_uri: redirectUri,
    code: authCode,
    code_verifier: codeVerifier
  };

  var response = UrlFetchApp.fetch(ETSY_API_BASE + '/public/oauth/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: payload,
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    Logger.log('ERROR: Token exchange failed: ' + response.getContentText());
    return;
  }

  var tokenData = JSON.parse(response.getContentText());
  props.setProperty('ETSY_REFRESH_TOKEN', tokenData.refresh_token);
  userProps.deleteProperty('ETSY_CODE_VERIFIER');

  // Cache the access token
  var cache = CacheService.getScriptCache();
  cache.put(ETSY_TOKEN_CACHE_KEY, tokenData.access_token, ETSY_TOKEN_CACHE_SECONDS);

  Logger.log('=== ETSY OAUTH COMPLETE ===');
  Logger.log('Access token obtained (expires in ' + tokenData.expires_in + 's)');
  Logger.log('Refresh token stored in Script Properties.');
  Logger.log('You can now run syncEtsyOrders() to test order polling.');
}

/**
 * Get a valid Etsy access token (from cache or via refresh).
 * @return {string|null} Access token, or null if not configured.
 */
function getEtsyAccessToken_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(ETSY_TOKEN_CACHE_KEY);
  if (cached) return cached;

  var props = PropertiesService.getScriptProperties();
  var keystring = props.getProperty('ETSY_KEYSTRING');
  var sharedSecret = props.getProperty('ETSY_SHARED_SECRET');
  var refreshToken = props.getProperty('ETSY_REFRESH_TOKEN');

  if (!keystring || !sharedSecret) {
    Logger.log('Etsy: Missing credentials (keystring/shared_secret)');
    return null;
  }
  if (!refreshToken) {
    Logger.log('Etsy: No refresh token — run setupEtsyOAuth() + completeEtsyOAuth() first');
    return null;
  }

  var payload = {
    grant_type: 'refresh_token',
    client_id: keystring,
    client_secret: sharedSecret,
    refresh_token: refreshToken
  };

  try {
  var response = UrlFetchApp.fetch(ETSY_TOKEN_URL, {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      payload: payload,
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      Logger.log('Etsy: Token refresh failed: ' + response.getContentText());
      // Refresh token may have expired — need re-auth
      props.deleteProperty('ETSY_REFRESH_TOKEN');
      return null;
    }

    var tokenData = JSON.parse(response.getContentText());
    var accessToken = tokenData.access_token;

    // Store new refresh token if provided
    if (tokenData.refresh_token) {
      props.setProperty('ETSY_REFRESH_TOKEN', tokenData.refresh_token);
    }

    // Cache access token for 50 minutes
    cache.put(ETSY_TOKEN_CACHE_KEY, accessToken, ETSY_TOKEN_CACHE_SECONDS);
    return accessToken;
  } catch (e) {
    Logger.log('Etsy: Token refresh error: ' + e.toString());
    return null;
  }
}

// ── PKCE helpers ──────────────────────────────────────────────────────

function generatePkceCodeVerifier_() {
  var charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  var verifier = '';
  for (var i = 0; i < 128; i++) {
    verifier += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return verifier;
}

function generatePkceCodeChallenge_(verifier) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, verifier);
  return Utilities.base64EncodeWebSafe(digest);
}

// ── Etsy Order Polling ────────────────────────────────────────────────

/**
 * Poll Etsy for new receipts (orders) and log them to the sheet.
 * Runs via time-driven trigger. Safe to call repeatedly — dedups by receipt ID.
 */
function syncEtsyOrders() {
  var props = PropertiesService.getScriptProperties();
  var shopId = props.getProperty('ETSY_SHOP_ID');
  
  if (!shopId) {
    Logger.log('Etsy: No ETSY_SHOP_ID configured — skipping');
    return;
  }

  var accessToken = getEtsyAccessToken_();
  if (!accessToken) {
    Logger.log('Etsy: No access token — skipping. Run setupEtsyOAuth() first.');
    return;
  }

  var keystring = props.getProperty('ETSY_KEYSTRING');

  try {
    // Fetch receipts from the last 24 hours
    var oneDayAgo = Math.floor(Date.now() / 1000) - (24 * 60 * 60);
    var receipts = fetchEtsyReceipts_(keystring, accessToken, shopId, oneDayAgo);

    if (!receipts || receipts.length === 0) {
      Logger.log('Etsy: No receipts found in window');
      return;
    }

    Logger.log('Etsy: Found ' + receipts.length + ' receipts to process');

    // Get existing receipt IDs from sheet for dedup
    var CONFIG = getConfig('production');
    var sheet = SpreadsheetApp.openById(CONFIG.sheetId).getSheetByName(CONFIG.sheetName);
    if (!sheet) {
      Logger.log('Etsy: Sheet not found: ' + CONFIG.sheetName);
      return;
    }

    // Ensure Channel column header exists
    ensureEtsySheetHeaders_(sheet);

    var newOrdersCount = 0;
    for (var i = 0; i < receipts.length; i++) {
      var receipt = receipts[i];
      var receiptId = String(receipt.receipt_id);

      // Dedup — check if receipt ID is already in column C
      if (findOrderRowBySessionId(sheet, receiptId) > 0) {
        continue;
      }

      // Fetch full receipt with transactions
      var fullReceipt = fetchEtsyReceiptDetail_(keystring, accessToken, shopId, receiptId);
      if (!fullReceipt) continue;

      saveEtsyOrderToSheet_(fullReceipt, sheet);
      newOrdersCount++;
    }

    if (newOrdersCount > 0) {
      Logger.log('Etsy: Synced ' + newOrdersCount + ' new orders');
    }
  } catch (e) {
    Logger.log('Etsy: sync error: ' + e.toString());
    Logger.log('Stack: ' + e.stack);
  }
}

/**
 * Fetch receipts from Etsy API (paginated).
 */
function fetchEtsyReceipts_(keystring, accessToken, shopId, minCreated) {
  var allReceipts = [];
  var limit = 100;
  var offset = 0;
  var maxPages = 10; // safety limit

  while (offset < maxPages * limit) {
    var url = ETSY_API_BASE + '/application/shops/' + shopId + '/receipts' +
      '?limit=' + limit +
      '&offset=' + offset +
      '&min_created=' + minCreated +
      '&sort_on=created&sort_order=desc';

    Logger.log('Etsy: Fetching receipts page ' + (offset / limit + 1));
    
    var response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {
        'x-api-key': keystring,
        'Authorization': 'Bearer ' + accessToken
      },
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      Logger.log('Etsy: API error ' + response.getResponseCode() + ': ' + response.getContentText());
      break;
    }

    var data = JSON.parse(response.getContentText());
    var results = data.results || [];

    if (results.length === 0) break;

    allReceipts = allReceipts.concat(results);
    offset += limit;

    // Stop if we got fewer than limit (last page)
    if (results.length < limit) break;
  }

  return allReceipts;
}

/**
 * Fetch a single receipt with full transaction details.
 */
function fetchEtsyReceiptDetail_(keystring, accessToken, shopId, receiptId) {
  try {
    // Get receipt with transactions
    var url = ETSY_API_BASE + '/application/shops/' + shopId + '/receipts/' + receiptId +
      '?includes=transactions,listings';

    var response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {
        'x-api-key': keystring,
        'Authorization': 'Bearer ' + accessToken
      },
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      Logger.log('Etsy: Failed to fetch receipt ' + receiptId + ': ' + response.getContentText());
      return null;
    }

    return JSON.parse(response.getContentText());
  } catch (e) {
    Logger.log('Etsy: Error fetching receipt detail: ' + e.toString());
    return null;
  }
}

/**
 * Ensure the sheet has the Channel column header (column O).
 * Skips if header already exists.
 */
function ensureEtsySheetHeaders_(sheet) {
  var headers = sheet.getRange(1, 1, 1, 15).getValues()[0];
  if (headers[14] && headers[14].trim() !== '') return; // Column O already set

  sheet.getRange(1, 15).setValue('Channel');
  Logger.log('Etsy: Added "Channel" header to column O');
}

/**
 * Save an Etsy receipt to the sheet.
 * Uses same column layout as Stripe orders, with Channel = "Etsy" in column O.
 */
function saveEtsyOrderToSheet_(receipt, sheet) {
  try {
    var receiptId = String(receipt.receipt_id);

    // ── Customer name ──
    var buyerName = 'Unknown';
    if (receipt.buyer_name) {
      buyerName = receipt.buyer_name;
    } else if (receipt.name) {
      buyerName = receipt.name;
    }

    // ── Buyer email ──
    var buyerEmail = receipt.buyer_email || '';

    // ── Line items from transactions ──
    var transactions = receipt.transactions || [];
    var itemsList = [];
    var totalQuantity = 0;

    for (var t = 0; t < transactions.length; t++) {
      var tx = transactions[t];
      var qty = tx.quantity || 1;
      var title = tx.title || 'Etsy Item';
      var variation = '';
      if (tx.variations && tx.variations.length > 0) {
        var varStr = tx.variations.map(function(v) {
          return v.formatted_name + ': ' + v.formatted_value;
        }).join(', ');
        variation = ' (' + varStr + ')';
      }
      totalQuantity += qty;
      itemsList.push(title + variation + ' (x' + qty + ')');
    }

    var itemsPurchased = itemsList.join(', ');

    // ── Amounts ──
    var totalAmount = parseFloat(receipt.grandtotal && receipt.grandtotal.amount || 0) / (receipt.grandtotal && receipt.grandtotal.divisor || 100);
    var subtotalAmount = parseFloat(receipt.subtotal && receipt.subtotal.amount || 0) / (receipt.subtotal && receipt.subtotal.divisor || 100);
    var shippingCost = parseFloat(receipt.total_shipping_cost && receipt.total_shipping_cost.amount || 0) / (receipt.total_shipping_cost && receipt.total_shipping_cost.divisor || 100);
    var taxAmount = parseFloat(receipt.total_tax_cost && receipt.total_tax_cost.amount || 0) / (receipt.total_tax_cost && receipt.total_tax_cost.divisor || 100);
    var currency = (receipt.grandtotal && receipt.grandtotal.currency_code) || 'USD';

    // ── Shipping address ──
    var shippingAddressFormatted = '';
    if (receipt.formatted_address) {
      shippingAddressFormatted = receipt.formatted_address;
    } else if (receipt.shipping_address) {
      var addr = receipt.shipping_address;
      var parts = [];
      if (addr.name) parts.push(addr.name);
      if (addr.first_line) parts.push(addr.first_line);
      if (addr.second_line) parts.push(addr.second_line);
      if (addr.city) parts.push(addr.city);
      if (addr.state) parts.push(addr.state);
      if (addr.zip) parts.push(addr.zip);
      if (addr.country_name) parts.push(addr.country_name);
      shippingAddressFormatted = parts.join(', ');
    }

    // ── Shipping provider ──
    var shippingProvider = '';
    if (receipt.shipments && receipt.shipments.length > 0) {
      var carrierNames = [];
      for (var s = 0; s < receipt.shipments.length; s++) {
        var shipment = receipt.shipments[s];
        if (shipment.carrier_name) {
          carrierNames.push(shipment.carrier_name);
          if (shipment.tracking_code && shipment.tracking_url) {
            carrierNames[carrierNames.length - 1] += ' (' + shipment.tracking_code + ')';
          }
        }
      }
      shippingProvider = carrierNames.join('; ');
    }

    // ── Etsy fee (approximate — Etsy transaction fee is ~6.5%) ──
    var etsyFee = totalAmount * 0.065;

    // ── Order date ──
    var orderDate = '';
    if (receipt.created_timestamp) {
      orderDate = new Date(receipt.created_timestamp * 1000).toISOString();
    }

    // ── Write row ──
    // Columns: Timestamp | Customer Name | Receipt ID | Wix Order# | Wix Order ID |
    //          Items Purchased | Total Qty | Amount | Currency | Shipping Address |
    //          Shipping Cost | Fee | Shipping Provider | Tracking | Channel
    var row = [
      orderDate || new Date().toISOString(), // A: Timestamp
      buyerName,                              // B: Customer Name
      receiptId,                              // C: Receipt ID (maps to Session ID column)
      '',                                     // D: Wix Order Number
      '',                                     // E: Wix Order ID
      itemsPurchased,                         // F: Items Purchased
      totalQuantity,                          // G: Total Quantity
      totalAmount.toFixed(2),                // H: Amount
      currency,                               // I: Currency
      shippingAddressFormatted,              // J: Shipping Address
      shippingCost.toFixed(2),               // K: Shipping Cost
      etsyFee.toFixed(2),                    // L: Transaction Fee
      shippingProvider,                       // M: Shipping Provider
      '',                                     // N: Tracking Number
      'Etsy'                                  // O: Channel
    ];

    sheet.appendRow(row);
    Logger.log('Etsy order saved: ' + receiptId);

    // ── Send email notification ──
    try {
      sendEtsyOrderNotificationEmail_(receipt, buyerName, buyerEmail, itemsPurchased, totalQuantity, totalAmount, shippingCost, etsyFee, currency);
    } catch (emailError) {
      Logger.log('Etsy: Email notification failed (non-critical): ' + emailError.toString());
    }
  } catch (e) {
    Logger.log('Etsy: Failed to save receipt ' + (receipt && receipt.receipt_id) + ': ' + e.toString());
    Logger.log('Stack: ' + e.stack);
  }
}

/**
 * Send email notification for new Etsy orders.
 */
function sendEtsyOrderNotificationEmail_(receipt, buyerName, buyerEmail, itemsPurchased, totalQuantity, totalAmount, shippingCost, etsyFee, currency) {
  var currencySymbol = currency === 'USD' ? '$' : (currency + ' ');
  var orderDate = receipt.created_timestamp
    ? new Date(receipt.created_timestamp * 1000).toLocaleString()
    : new Date().toLocaleString();
  var receiptId = String(receipt.receipt_id);

  var subject = '[Etsy] New Order: ' + buyerName + ' - ' + currencySymbol + totalAmount.toFixed(2);

  var body = 'New Etsy order received!\n\n' +
    '=== ORDER DETAILS ===\n' +
    'Order Date: ' + orderDate + '\n' +
    'Etsy Receipt ID: ' + receiptId + '\n' +
    'Payment Status: ' + (receipt.was_paid ? 'Paid' : 'Pending') + '\n\n' +

    '=== CUSTOMER INFORMATION ===\n' +
    'Name: ' + buyerName + '\n' +
    'Email: ' + (buyerEmail || 'N/A') + '\n\n' +

    '=== ORDER ITEMS ===\n' +
    itemsPurchased + '\n' +
    'Total Quantity: ' + totalQuantity + '\n\n' +

    '=== PRICING BREAKDOWN ===\n' +
    'Total: ' + currencySymbol + totalAmount.toFixed(2) + '\n' +
    'Shipping: ' + currencySymbol + shippingCost.toFixed(2) + '\n' +
    'Etsy Fee (est): ' + currencySymbol + etsyFee.toFixed(2) + '\n' +
    'Net (est): ' + currencySymbol + (totalAmount - etsyFee).toFixed(2) + '\n\n' +

    '=== LINKS ===\n' +
    'View in Etsy Shop Manager: https://www.etsy.com/your/orders\n' +
    'Receipt URL: https://www.etsy.com/your/orders/sold/completed?order_id=' + receiptId + '\n\n' +

    '---\n' +
    'This is an automated notification from Agroverse Shop.';

  MailApp.sendEmail({
    to: 'garyjob@agroverse.shop',
    subject: subject,
    body: body
  });

  Logger.log('Etsy: Order notification email sent for ' + receiptId);
}

