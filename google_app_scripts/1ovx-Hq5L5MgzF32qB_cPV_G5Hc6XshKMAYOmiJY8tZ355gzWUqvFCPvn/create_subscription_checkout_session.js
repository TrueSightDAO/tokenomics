/**
 * createSubscriptionCheckoutSession — ADDITIVE GAS action for chocolate bar subscriptions.
 *
 * Called by the subscribe page (js/subscribe.js) when the user clicks "Subscribe Now".
 * Creates a Stripe Checkout Session with mode='subscription' and recurring price_data.
 *
 * This is PR1.4 from CHOCOLATE_SUBSCRIPTION_PLAN.md.
 * It does NOT touch the existing createCheckoutSession or createLedgerCheckoutSession.
 *
 * URL params (GET):
 *   action=createSubscriptionCheckoutSession
 *   environment=development|production
 *   sku=<productId>           — e.g. "generic-premium-dark-chocolate-bar"
 *   quantity=<number>         — bars per month (1-24)
 *   shippingAddress=<json>    — { fullName, email, phone, address, city, state, zip, country }
 *
 * Returns JSON via createCORSResponse (ContentService.TextOutput):
 *   { status: "success", checkoutUrl: "https://checkout.stripe.com/..." }
 *   { status: "error", error: "..." }
 */

// Product catalog for subscribable items (mirrors products.js)
var SUBSCRIPTION_PRODUCTS = {
  'generic-premium-dark-chocolate-bar': {
    name: 'Premium Dark Chocolate Bar — Single-Estate, Monthly Discovery',
    price: 10.00,        // $10 per bar
    weight: 1.76,         // 50g ≈ 1.76 oz
    gtin: '00860010660256',
    currency: 'usd',
    minQty: 1,
    maxQty: 24,
    defaultQty: 6
  }
};

// Origin address for shipping (matches existing checkout config)
var ORIGIN_ADDRESS = {
  line1: '548 Market St',
  city: 'San Francisco',
  state: 'CA',
  postal_code: '94104',
  country: 'US'
};

// Packaging constants (matches checkout-shipping-calculator.js)
var BASE_BOX_WEIGHT_OZ = 11.5;
var PER_ITEM_PACKAGING_OZ = 0.65;


/**
 * Main handler for createSubscriptionCheckoutSession action.
 * Returns ContentService.TextOutput via createCORSResponse.
 */
function createSubscriptionCheckoutSession(params) {
  var environment = params.environment || 'production';
  var sku = params.sku;
  var quantity = parseInt(params.quantity, 10) || 6;
  var shippingAddressRaw = params.shippingAddress;

  // Validate SKU
  var product = SUBSCRIPTION_PRODUCTS[sku];
  if (!product) {
    return createCORSResponse({ status: 'error', error: 'Invalid SKU: ' + sku });
  }

  // Validate quantity
  if (quantity < product.minQty || quantity > product.maxQty) {
    return createCORSResponse({ status: 'error', error: 'Quantity must be between ' + product.minQty + ' and ' + product.maxQty });
  }

  // Parse shipping address (handle both string from direct call and object from doGet)
  var shippingAddress = {};
  if (typeof shippingAddressRaw === 'object' && shippingAddressRaw !== null) {
    shippingAddress = shippingAddressRaw;
  } else {
    try {
      shippingAddress = JSON.parse(shippingAddressRaw || '{}');
    } catch (e) {
      return createCORSResponse({ status: 'error', error: 'Invalid shipping address JSON' });
    }
  }

  // Validate required fields
  if (!shippingAddress.address || !shippingAddress.city || !shippingAddress.state || !shippingAddress.zip) {
    return createCORSResponse({ status: 'error', error: 'Shipping address must include address, city, state, and zip' });
  }

  // Calculate shipping cost
  var shippingAmount;
  try {
    shippingAmount = calculateSubscriptionShipping_(product, quantity, shippingAddress);
  } catch (e) {
    return createCORSResponse({ status: 'error', error: 'Shipping calculation failed: ' + e.message });
  }

  // Create Stripe checkout session
  var result;
  try {
    result = createStripeSubscriptionSession_(product, sku, quantity, shippingAmount, shippingAddress, environment);
  } catch (e) {
    return createCORSResponse({ status: 'error', error: 'Failed to create subscription: ' + e.message });
  }

  return result;
}


/**
 * Calculate shipping cost for a subscription.
 * Uses EasyPost via the existing calculateShippingRates logic.
 * Returns the cheapest USPS rate amount in dollars.
 */
function calculateSubscriptionShipping_(product, quantity, shippingAddress) {
  // Calculate total weight
  var totalWeightOz = (product.weight * quantity) + BASE_BOX_WEIGHT_OZ + (PER_ITEM_PACKAGING_OZ * quantity);

  // Build destination address
  var toAddress = {
    line1: shippingAddress.address,
    line2: shippingAddress.line2 || '',
    city: shippingAddress.city,
    state: shippingAddress.state,
    postal_code: shippingAddress.zip,
    country: shippingAddress.country || 'US'
  };

  // Try EasyPost first (via the existing calculateShippingRatesViaEasyPost helper)
  // Note: calculateShippingRatesViaEasyPost(weightOz, shippingAddress) takes
  // weight + destination address. The origin is read from Script Properties internally.
  var rates = [];
  try {
    var easypostAddress = {
      address: shippingAddress.address,
      city: shippingAddress.city,
      state: shippingAddress.state,
      zip: shippingAddress.zip,
      country: shippingAddress.country || 'US'
    };
    rates = calculateShippingRatesViaEasyPost(totalWeightOz, easypostAddress);
  } catch (e) {
    console.warn('EasyPost shipping failed, using fallback: ' + e.message);
  }

  // Fallback: use a flat rate if EasyPost fails
  if (!rates || rates.length === 0) {
    // Flat rate estimate based on weight
    if (totalWeightOz <= 16) {
      return 5.50;  // ~1 lb
    } else if (totalWeightOz <= 32) {
      return 8.00;  // ~2 lb
    } else if (totalWeightOz <= 64) {
      return 12.00; // ~4 lb
    } else {
      return 15.00; // 4+ lb
    }
  }

  // Find cheapest rate (rates are in Stripe format: shipping_rate_data.fixed_amount.amount in cents)
  var cheapest = rates[0];
  for (var i = 1; i < rates.length; i++) {
    var a = rates[i].shipping_rate_data && rates[i].shipping_rate_data.fixed_amount ? rates[i].shipping_rate_data.fixed_amount.amount || 0 : 0;
    var b = cheapest.shipping_rate_data && cheapest.shipping_rate_data.fixed_amount ? cheapest.shipping_rate_data.fixed_amount.amount || 0 : 0;
    if (a < b) {
      cheapest = rates[i];
    }
  }

  // Return amount in dollars (EasyPost returns cents in fixed_amount.amount)
  var cheapestCents = cheapest.shipping_rate_data && cheapest.shipping_rate_data.fixed_amount ? cheapest.shipping_rate_data.fixed_amount.amount || 0 : 0;
  return cheapestCents / 100;
}


/**
 * Create a Stripe Checkout Session for a subscription.
 * Uses UrlFetchApp directly (no Stripe library dependency).
 * Returns ContentService.TextOutput via createCORSResponse.
 */
function createStripeSubscriptionSession_(product, sku, quantity, shippingAmount, shippingAddress, environment) {
  // Select API key based on environment
  var stripeKey;
  if (environment === 'development') {
    stripeKey = PropertiesService.getScriptProperties().getProperty('STRIPE_TEST_SECRET_KEY');
  } else {
    stripeKey = PropertiesService.getScriptProperties().getProperty('STRIPE_LIVE_SECRET_KEY');
  }

  if (!stripeKey) {
    throw new Error('Stripe API key not configured for environment: ' + environment);
  }

  // Calculate amounts in cents
  var unitAmountCents = Math.round(product.price * 100);          // $10.00 → 1000
  var shippingAmountCents = Math.round(shippingAmount * 100);     // e.g. $6.65 → 665

  // Build success/cancel URLs
  var domain = (environment === 'development' ? 'https://beta.agroverse.shop' : 'https://agroverse.shop');
  var successUrl = domain + '/subscribe/chocolate-bar/?success=true&session_id={CHECKOUT_SESSION_ID}';
  var cancelUrl = domain + '/subscribe/chocolate-bar/?canceled=true';

  // Build the Stripe API request payload
  var payload = {
    'mode': 'subscription',
    'customer_email': shippingAddress.email || '',
    'line_items[0][price_data][currency]': product.currency || 'usd',
    'line_items[0][price_data][product_data][name]': product.name,
    'line_items[0][price_data][product_data][description]': quantity + ' bars per month',
    'line_items[0][price_data][product_data][metadata][sku]': sku,
    'line_items[0][price_data][product_data][metadata][gtin]': product.gtin,
    'line_items[0][price_data][product_data][images][0]': 'https://beta.agroverse.shop/assets/images/products/81-dark-chocolate-bar-50g-packaging.jpg',
    'line_items[0][price_data][unit_amount]': String(unitAmountCents),
    'line_items[0][price_data][recurring][interval]': 'month',
    'line_items[0][quantity]': String(quantity),
    'metadata[sku]': sku,
    'metadata[quantity]': String(quantity),
    'metadata[source]': 'subscription',
    'shipping_address_collection[allowed_countries][0]': 'US',
    'success_url': successUrl,
    'cancel_url': cancelUrl
  };

  // Add shipping as a separate recurring line item
  if (shippingAmountCents > 0) {
    payload['line_items[1][price_data][currency]'] = product.currency || 'usd';
    payload['line_items[1][price_data][product_data][name]'] = 'Shipping';
    payload['line_items[1][price_data][product_data][description]'] = 'Monthly shipping (locked at signup)';
    payload['line_items[1][price_data][unit_amount]'] = String(shippingAmountCents);
    payload['line_items[1][price_data][recurring][interval]'] = 'month';
    payload['line_items[1][quantity]'] = '1';
  }

  // Convert payload to URL-encoded string
  var payloadParts = [];
  for (var key in payload) {
    if (payload.hasOwnProperty(key)) {
      payloadParts.push(encodeURIComponent(key) + '=' + encodeURIComponent(payload[key]));
    }
  }
  var payloadStr = payloadParts.join('&');

  // Make the Stripe API call
  var options = {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + stripeKey,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    payload: payloadStr,
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions', options);
  var responseCode = response.getResponseCode();
  var responseText = response.getContentText();

  if (responseCode >= 400) {
    var errorData = JSON.parse(responseText);
    throw new Error(errorData.error ? errorData.error.message : 'Stripe API error: ' + responseCode);
  }

  var sessionData = JSON.parse(responseText);

  return createCORSResponse({
    status: 'success',
    checkoutUrl: sessionData.url
  });
}
