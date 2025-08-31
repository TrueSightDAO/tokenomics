# Sacred Earth Farms - TrueSight DAO API Integration Guide

This guide provides specific instructions for Sacred Earth Farms to integrate programmatically with the TrueSight DAO ecosystem for QR code sales reporting and inventory management.

## Overview

Sacred Earth Farms can automate their sales reporting process by implementing API calls to report QR code sales and update inventory movements. This guide covers the complete workflow from QR code sale to inventory transfer.

## Prerequisites

1. **Digital Signature**: Sacred Earth Farms needs a registered digital signature in the TrueSight DAO system
2. **QR Code List**: Access to the list of minted QR codes for their products
3. **Stripe Integration**: Ability to programmatically access Stripe transaction data

## API Endpoints

> **📚 For complete API documentation including all available endpoints, request formats, and response examples, see the [Main API Documentation](../API.md)**

### 1. QR Code Management API
**Endpoint**: `https://script.google.com/macros/s/AKfycbxigq4-J0izShubqIC5k6Z7fgNRyVJLakfQ34HPuENiSpxuCG-wSq0g-wOAedZzzgaL/exec`

**Purpose**: Retrieve available QR codes for Sacred Earth Farms products

**Request**:
```javascript
const response = await fetch('https://script.google.com/macros/s/AKfycbxigq4-J0izShubqIC5k6Z7fgNRyVJLakfQ34HPuENiSpxuCG-wSq0g-wOAedZzzgaL/exec?list=true');
const data = await response.json();

// Filter QR codes for Sacred Earth Farms (assuming they have a specific prefix)
const sefQrCodes = data.qr_codes.filter(qr => qr.startsWith('SEF'));
```

**Response**:
```json
{
  "status": "success",
  "qr_codes": [
    "SEF_20250521_COCOA_1",
    "SEF_20250522_COCOA_1",
    "SEF_20250523_COCOA_1"
  ]
}
```

### 2. Sales Reporting API
**Endpoint**: `https://edgar.truesight.me/dao/submit_contribution`

**Purpose**: Report QR code sales with transaction details

## Implementation Workflow

### Step 1: Generate Digital Signature

Sacred Earth Farms needs to create and register a digital signature:

```javascript
// Generate RSA key pair
async function generateDigitalSignature() {
  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["sign", "verify"]
  );

  const publicKey = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
  const privateKey = await window.crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  
  return {
    publicKey: arrayBufferToBase64(publicKey),
    privateKey: arrayBufferToBase64(privateKey)
  };
}

function arrayBufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}
```

### Step 2: Register Digital Signature

Send the public key to TrueSight DAO for registration:

```javascript
const registrationText = `[DIGITAL SIGNATURE EVENT]
This is my digital signature which you can use to verify my request

DIGITAL SIGNATURE: ${publicKey}

This submission was generated programmatically by Sacred Earth Farms`;

// Send via email to admin@truesight.me or via Telegram/WhatsApp
```

### Step 3: Report QR Code Sale

When a sale occurs, create and sign the sales report:

```javascript
async function reportQrCodeSale(qrCode, salePrice, stripeTransactionId) {
  const requestText = `[SALES EVENT]
- Item: ${qrCode}
- Sales price: $${salePrice}
- Sold by: Sacred Earth Farms
- Attached Filename: None
- Submission Source: https://dapp.truesight.me/report_sales.html
--------`;

  // Sign the request
  const privateKeyObj = await window.crypto.subtle.importKey(
    "pkcs8",
    base64ToArrayBuffer(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const encoder = new TextEncoder();
  const signature = await window.crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKeyObj,
    encoder.encode(requestText)
  );
  const requestHash = arrayBufferToBase64(signature);

  const shareText = `${requestText}

My Digital Signature: ${publicKey}

Request Transaction ID: ${requestHash}

This submission was generated programmatically by Sacred Earth Farms`;

  // Submit to API
  const formData = new FormData();
  formData.append('text', shareText);

  const response = await fetch("https://edgar.truesight.me/dao/submit_contribution", {
    method: 'POST',
    body: formData
  });

  return response.ok;
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
```

### Step 4: Report Inventory Movement (Fund Transfer)

After the sale, report the inventory movement for fund transfer:

```javascript
async function reportInventoryMovement(amount, stripeTransactionId) {
  const requestText = `[INVENTORY MOVEMENT]
Contributor: Sacred Earth Farms
Movement type: Transfer
Product: USD
Quantity: ${amount}
From location: Sacred Earth Farms
To location: Gary Teh
Date: ${new Date().toISOString().split('T')[0]}
Reason: Stripe payment transfer
Stripe Transaction ID: ${stripeTransactionId}
--------`;

  // Sign the request
  const privateKeyObj = await window.crypto.subtle.importKey(
    "pkcs8",
    base64ToArrayBuffer(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const encoder = new TextEncoder();
  const signature = await window.crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKeyObj,
    encoder.encode(requestText)
  );
  const requestHash = arrayBufferToBase64(signature);

  const shareText = `${requestText}

My Digital Signature: ${publicKey}

Request Transaction ID: ${requestHash}

This submission was generated programmatically by Sacred Earth Farms`;

  // Submit to API
  const formData = new FormData();
  formData.append('text', shareText);

  const response = await fetch("https://edgar.truesight.me/dao/submit_contribution", {
    method: 'POST',
    body: formData
  });

  return response.ok;
}
```

## Complete Integration Example

Here's a complete example of how to integrate with Stripe webhooks:

```javascript
// Stripe webhook handler
async function handleStripePayment(event) {
  const paymentIntent = event.data.object;
  
  if (event.type === 'payment_intent.succeeded') {
    const qrCode = paymentIntent.metadata.qr_code; // QR code stored in metadata
    const amount = paymentIntent.amount / 100; // Convert from cents
    const transactionId = paymentIntent.id;
    
    try {
      // Report the QR code sale
      await reportQrCodeSale(qrCode, amount, transactionId);
      
      // Report inventory movement for fund transfer
      await reportInventoryMovement(amount, transactionId);
      
      console.log('Successfully reported sale and inventory movement');
    } catch (error) {
      console.error('Error reporting to TrueSight DAO:', error);
      // Implement retry logic or alert system
    }
  }
}
```

## QR Code Status Update

To update QR code status after sale, use the QR Code Management API:

```javascript
async function updateQrCodeStatus(qrCode, emailAddress) {
  const response = await fetch(
    `https://script.google.com/macros/s/AKfycbxigq4-J0izShubqIC5k6Z7fgNRyVJLakfQ34HPuENiSpxuCG-wSq0g-wOAedZzzgaL/exec?qr_code=${encodeURIComponent(qrCode)}&email_address=${encodeURIComponent(emailAddress)}`
  );
  
  const data = await response.json();
  return data.status === 'success';
}
```

## Error Handling

Implement robust error handling for production use:

```javascript
async function safeApiCall(apiFunction, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await apiFunction();
    } catch (error) {
      console.error(`Attempt ${i + 1} failed:`, error);
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); // Exponential backoff
    }
  }
}
```

## Testing

Test your integration using the verification endpoint:

```javascript
// Verify a submitted request
async function verifySubmission(requestText, signature, transactionId) {
  const verifyUrl = 'https://dapp.truesight.me/verify_request.html';
  console.log('Verify submission at:', verifyUrl);
  console.log('Request text:', requestText);
  console.log('Signature:', signature);
  console.log('Transaction ID:', transactionId);
}
```

## Security Considerations

1. **Private Key Protection**: Store the private key securely (environment variables, secure key management)
2. **Request Validation**: Validate all input data before signing
3. **Rate Limiting**: Implement appropriate delays between API calls
4. **Monitoring**: Log all API interactions for debugging and audit purposes

## Support

For technical support or questions about this integration:
- Email: admin@truesight.me
- Telegram: https://t.me/TrueSightDAO
- GitHub Issues: [TrueSight DAO tokenomics repository](https://github.com/TrueSightDAO/tokenomics/issues)

## AI Code Generation Notes

When using this document with AI code generation systems, consider the following:

### Key Implementation Requirements
1. **Cryptographic Operations**: Use Web Crypto API for RSA-2048 with SHA-256
2. **Base64 Encoding**: Ensure proper base64 encoding/decoding for key storage
3. **Request Formatting**: Exact text formatting is critical for signature verification
4. **Error Handling**: Implement retry logic and proper error responses
5. **Content-Type**: Use `multipart/form-data` for API submissions

### Common AI Generation Pitfalls to Avoid
- **Key Format**: Ensure private keys are in PKCS8 format, public keys in SPKI format
- **Signature Verification**: The exact request text must match what was signed
- **Line Endings**: Preserve exact line breaks in request text
- **Character Encoding**: Use UTF-8 encoding for all text operations
- **API Endpoints**: Verify endpoint URLs are correct and accessible

### Testing Checklist for Generated Code
- [ ] Digital signature generation works correctly
- [ ] Request text formatting matches expected format exactly
- [ ] Signature verification passes on our verification endpoint
- [ ] API submissions return success responses
- [ ] Error handling works for network failures
- [ ] Retry logic functions properly

## Reference

- [Main API Documentation](../API.md)
- [DApp Interface](https://dapp.truesight.me)
- [Request Verification](https://dapp.truesight.me/verify_request.html)
