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
 * Returns JSON:
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
 */
function createSubscriptionCheckoutSession(params) {
  var environment = params.environment || 'production';
  var sku = params.sku;
  var quantity = parseInt(params.quantity, 10) || 6;
  var shippingAddressRaw = params.shippingAddress;

  // Validate SKU
  var product = SUBSCRIPTION_PRODUCTS[sku];
  if (!product) {
    return { status: 'error', error: 'Invalid SKU: ' + sku };
  }

  // Validate quantity
  if (quantity < product.minQty || quantity > product.maxQty) {
    return { status: 'error', error: 'Quantity must be between ' + product.minQty + ' and ' + product.maxQty };
  }

  // Parse shipping address
  var shippingAddress = {};
  try {
    shippingAddress = JSON.parse(shippingAddressRaw || '{}');
  } catch (e) {
    return { status: 'error', error: 'Invalid shipping address JSON' };
  }

  // Validate required fields
  if (!shippingAddress.address || !shippingAddress.city || !shippingAddress.state || !shippingAddress.zip) {
    return { status: 'error', error: 'Shipping address must include address, city, state, and zip' };
  }

  // Calculate shipping cost
  var shippingAmount;
  try {
    shippingAmount = calculateSubscriptionShipping_(product, quantity, shippingAddress);
  } catch (e) {
    return { status: 'error', error: 'Shipping calculation failed: ' + e.message };
  }

  // Create Stripe checkout session
  var result;
  try {
    result = createStripeSubscriptionSession_(product, quantity, shippingAmount, shippingAddress, environment);
  } catch (e) {
    return { status: 'error', error: 'Failed to create subscription: ' + e.message };
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
  var rates = [];
  try {
    rates = calculateShippingRatesViaEasyPost(totalWeightOz, ORIGIN_ADDRESS, toAddress);
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

  // Find cheapest rate
  var cheapest = rates[0];
  for (var i = 1; i < rates.length; i++) {
    if (rates[i].amount < cheapest.amount) {
      cheapest = rates[i];
    }
  }

  return cheapest.amount;
}


/**
 * Create a Stripe Checkout Session for a subscription.
 */
function createStripeSubscriptionSession_(product, quantity, shippingAmount, shippingAddress, environment) {
  // Select API key based on environment
  var stripeKey;
  if (environment === 'development') {
    stripeKey = PropertiesService.getScriptProperties().getProperty('STRIPE_TEST_SECRET_KEY');
  } else {
    stripeKey = PropertiesService.getScriptProperties().getProperty('STRIPE_SECRET_KEY');
  }

  if (!stripeKey) {
    throw new Error('Stripe API key not configured for environment: ' + environment);
  }

  // Set up Stripe
  var stripe = requireStripe_();
  stripe.api_key = stripeKey;

  // Calculate amounts in cents
  var unitAmountCents = Math.round(product.price * 100);          // $10.00 → 1000
  var shippingAmountCents = Math.round(shippingAmount * 100);     // e.g. $6.65 → 665
  var subtotalCents = unitAmountCents * quantity;                 // e.g. 6000

  // Build line items
  var lineItems = [
    {
      price_data: {
        currency: product.currency || 'usd',
        product_data: {
          name: product.name,
          description: quantity + ' bars per month',
          metadata: {
            sku: sku,
            gtin: product.gtin
          }
        },
        unit_amount: unitAmountCents,
        recurring: {
          interval: 'month'
        }
      },
      quantity: quantity
    }
  ];

  // Add shipping as a separate recurring line item
  if (shippingAmountCents > 0) {
    lineItems.push({
      price_data: {
        currency: product.currency || 'usd',
        product_data: {
          name: 'Shipping',
          description: 'Monthly shipping (locked at signup)'
        },
        unit_amount: shippingAmountCents,
        recurring: {
          interval: 'month'
        }
      },
      quantity: 1
    });
  }

  // Build customer data
  var customerData = {
    email: shippingAddress.email || '',
    name: shippingAddress.fullName || '',
    phone: shippingAddress.phone || '',
    address: {
      line1: shippingAddress.address || '',
      line2: shippingAddress.line2 || '',
      city: shippingAddress.city || '',
      state: shippingAddress.state || '',
      postal_code: shippingAddress.zip || '',
      country: shippingAddress.country || 'US'
    }
  };

  // Create the checkout session
  var session = stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: shippingAddress.email || '',
    line_items: lineItems,
    metadata: {
      sku: sku,
      quantity: quantity.toString(),
      source: 'subscription'
    },
    shipping_address_collection: {
      allowed_countries: ['US']
    },
    shipping_options: [
      {
        shipping_rate_data: {
          type: 'fixed_amount',
          fixed_amount: {
            amount: shippingAmountCents,
            currency: product.currency || 'usd'
          },
          display_name: 'Shipping',
          delivery_estimate: {
            minimum: { unit: 'business_day', value: 3 },
            maximum: { unit: 'business_day', value: 7 }
          }
        }
      }
    ],
    success_url: 'https://' + (environment === 'development' ? 'beta.' : '') + 'agroverse.shop/subscribe/chocolate-bar/?success=true&session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'https://' + (environment === 'development' ? 'beta.' : '') + 'agroverse.shop/subscribe/chocolate-bar/?canceled=true'
  });

  return {
    status: 'success',
    checkoutUrl: session.url
  };
}


/**
 * Load the Stripe library for Google Apps Script.
 * Uses the Stripe GAS client library.
 */
function requireStripe_() {
  // Try to use the Stripe library if already included
  if (typeof Stripe !== 'undefined') {
    return Stripe;
  }
  
  // Otherwise, use a simple REST-based approach
  // This is a minimal Stripe client for GAS
  var StripeClient = {
    api_key: '',
    
    checkout: {
      sessions: {
        create: function(params) {
          return stripeApiCall_('POST', '/v1/checkout/sessions', params);
        }
      }
    }
  };
  
  return StripeClient;
}


/**
 * Make a Stripe API call.
 */
function stripeApiCall_(method, path, params) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('STRIPE_SECRET_KEY');
  
  var options = {
    method: method,
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    muteHttpExceptions: true
  };

  if (params) {
    // Convert params object to URL-encoded string
    var payload = [];
    for (var key in params) {
      if (params.hasOwnProperty(key)) {
        var value = params[key];
        if (typeof value === 'object') {
          // Handle nested objects (line_items, metadata, etc.)
          payload.push(encodeStripeParams_(key, value));
        } else {
          payload.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
        }
      }
    }
    options.payload = payload.join('&');
  }

  var response = UrlFetchApp.fetch('https://api.stripe.com' + path, options);
  var responseCode = response.getResponseCode();
  var responseText = response.getContentText();
  
  if (responseCode >= 400) {
    var errorData = JSON.parse(responseText);
    throw new Error(errorData.error ? errorData.error.message : 'Stripe API error: ' + responseCode);
  }

  return JSON.parse(responseText);
}


/**
 * Encode nested Stripe parameters (e.g. line_items[0][price_data][currency]=usd).
 */
function encodeStripeParams_(prefix, obj) {
  var parts = [];
  
  if (Array.isArray(obj)) {
    for (var i = 0; i < obj.length; i++) {
      if (typeof obj[i] === 'object') {
        parts.push(encodeStripeParams_(prefix + '[' + i + ']', obj[i]));
      } else {
        parts.push(encodeURIComponent(prefix + '[' + i + ']') + '=' + encodeURIComponent(obj[i]));
      }
    }
  } else {
    for (var key in obj) {
      if (obj.hasOwnProperty(key)) {
        var value = obj[key];
        var fullKey = prefix + '[' + key + ']';
        if (typeof value === 'object') {
          parts.push(encodeStripeParams_(fullKey, value));
        } else {
          parts.push(encodeURIComponent(fullKey) + '=' + encodeURIComponent(value));
        }
      }
    }
  }
  
  return parts.join('&');
}


/**
 * Calculate shipping rates via EasyPost (reuses existing logic from the GAS).
 * This is a simplified version that calls the same EasyPost API.
 */
function calculateShippingRatesViaEasyPost(weightOz, fromAddress, toAddress) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('EASYPOST_API_KEY');
  if (!apiKey) {
    throw new Error('EasyPost API key not configured');
  }

  // Create parcel
  var parcelPayload = {
    weight: weightOz,
    length: 10,
    width: 10,
    height: 10
  };

  var parcelOptions = {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify({ parcel: parcelPayload }),
    muteHttpExceptions: true
  };

  var parcelResponse = UrlFetchApp.fetch('https://api.easypost.com/v2/parcels', parcelOptions);
  var parcelData = JSON.parse(parcelResponse.getContentText());
  
  if (parcelResponse.getResponseCode() >= 400) {
    throw new Error('EasyPost parcel creation failed: ' + (parcelData.error || parcelData.message || 'Unknown error'));
  }

  // Create shipment
  var shipmentPayload = {
    to_address: toAddress,
    from_address: fromAddress,
    parcel: { id: parcelData.id },
    options: { payment: { type: 'SENDER' } }
  };

  var shipmentOptions = {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify({ shipment: shipmentPayload }),
    muteHttpExceptions: true
  };

  var shipmentResponse = UrlFetchApp.fetch('https://api.easypost.com/v2/shipments', shipmentOptions);
  var shipmentData = JSON.parse(shipmentResponse.getContentText());

  if (shipmentResponse.getResponseCode() >= 400) {
    throw new Error('EasyPost shipment creation failed: ' + (shipmentData.error || shipmentData.message || 'Unknown error'));
  }

  // Extract USPS rates
  var rates = [];
  if (shipmentData.rates) {
    for (var i = 0; i < shipmentData.rates.length; i++) {
      var rate = shipmentData.rates[i];
      if (rate.carrier === 'USPS') {
        rates.push({
          id: rate.id,
          name: rate.service,
          amount: parseFloat(rate.rate),
          deliveryDays: rate.delivery_days || '3-7'
        });
      }
    }
  }

  return rates;
}
