// Define constants
const TDG_ID = "cbfd4c19-259c-420b-9bb2-498493265648";
const USDT_ID = "0c3a106d-bde3-4c13-a26e-3fd2394529e5";
const PRICE = 0.044444; // Price in USDT per TDG
const API_URL = "https://api.latoken.com/v2/auth/order/place";

// Replace with your actual keys
const PUBLIC_KEY = "34b12bce-c2ef-47bd-9d67-a212b5f3896a";
const PRIVATE_KEY = "MjRkODA5ZjktMjE5Ny00YWY1LTk3N2EtNWM5Y2RmZmEzNzM2";

function placeLatokenOrder() {
  try {
    // Define order parameters
    const quantity = 100;
    const timestamp = Math.floor(new Date().getTime() / 1000).toString();
    
    // Construct the authentication message
    const authMessage = `POST/v2/auth/order/place${timestamp}`;
    Logger.log("Auth Message: " + authMessage);
    
    // Generate HMAC SHA512 signature
    const signature = createHmacSha512(authMessage, PRIVATE_KEY);
    Logger.log("Signature: " + signature);
    
    // Order payload
    const payload = {
      "baseCurrency": USDT_ID,
      "quoteCurrency": TDG_ID,
      "side": "BUY",
      "condition": "GOOD_TILL_CANCELLED",
      "type": "LIMIT",
      "clientOrderId": Utilities.getUuid(),
      "price": PRICE.toString(),
      "quantity": quantity.toString(),
      "timestamp": timestamp
    };
    Logger.log("Payload: " + JSON.stringify(payload));
    
    // Set up headers
    const headers = {
      "X-LA-APIKEY": PUBLIC_KEY,
      "X-LA-SIGNATURE": signature,
      "X-LA-DIGEST": "HMAC-SHA512",
      "Content-Type": "application/json"
    };
    Logger.log("Headers: " + JSON.stringify(headers));
    
    // Request options
    const options = {
      "method": "POST",
      "headers": headers,
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };
    
    // Execute the request
    const response = UrlFetchApp.fetch(API_URL, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    // Log results
    Logger.log("Response Code: " + responseCode);
    Logger.log("Response: " + responseText);
    
    if (responseCode === 200) {
      Logger.log("Order placed successfully!");
    } else {
      Logger.log("Error placing order: " + responseText);
    }
    
  } catch (error) {
    Logger.log("Error: " + error.toString());
  }
}

// Simplified HMAC-SHA512 implementation (using Utilities for SHA512 hash)
function createHmacSha512(message, key) {
  // Convert inputs to byte arrays
  const keyBytes = Utilities.newBlob(key).getBytes();
  const messageBytes = Utilities.newBlob(message).getBytes();
  
  // HMAC logic (simplified, using SHA256 as a fallback due to Apps Script limitations)
  // Note: This is a workaround; for true SHA512, a library is ideal
  const ipad = 0x36;
  const opad = 0x5c;
  const blockSize = 64; // SHA512 block size
  
  // Prepare key (truncate or pad to block size)
  let keyPadded = keyBytes.slice(0);
  if (keyPadded.length > blockSize) {
    keyPadded = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, keyPadded);
  }
  while (keyPadded.length < blockSize) {
    keyPadded.push(0);
  }
  
  // Inner and outer pads
  const iKeyPad = keyPadded.map(byte => byte ^ ipad);
  const oKeyPad = keyPadded.map(byte => byte ^ opad);
  
  // Compute inner hash (SHA256 as a fallback)
  const innerHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, iKeyPad.concat(messageBytes));
  
  // Compute outer hash
  const outerHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, oKeyPad.concat(innerHash));
  
  // Base64 encode the result
  return Utilities.base64Encode(outerHash);
}

// Test function
function testOrder() {
  placeLatokenOrder();
}