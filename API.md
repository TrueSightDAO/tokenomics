# Edgar.truesight.me API Documentation

This document describes the various ways to interact with the Edgar.truesight.me API, based on the existing implementations in the TrueSight DAO dapp.

## Base URL
- **API Endpoint**: `https://edgar.truesight.me`
- **Signature Verification Endpoint**: `https://script.google.com/macros/s/AKfycbygmwRbyqse-dpCYMco0rb93NSgg-Jc1QIw7kUiBM7CZK6jnWnMB5DEjdoX_eCsvVs7/exec`

## Authentication & Digital Signatures

All API requests require digital signature authentication using RSA-2048 with SHA-256 hashing.

### Digital Signature Format
- **Algorithm**: RSASSA-PKCS1-v1_5
- **Key Size**: 2048 bits
- **Hash**: SHA-256
- **Format**: Base64 encoded PEM format

### Creating Digital Signatures

1. **Generate Key Pair**:
   ```javascript
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
   ```

2. **Export Keys**:
   ```javascript
   const publicKey = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
   const privateKey = await window.crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
   const publicKeyBase64 = arrayBufferToBase64(publicKey);
   const privateKeyBase64 = arrayBufferToBase64(privateKey);
   ```

3. **Sign Request**:
   ```javascript
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
   ```

## API Endpoints

### 1. Health Check
**Endpoint**: `GET /ping`
**Description**: Check if the Edgar service is online
**Headers**: `method: 'HEAD'`
**Timeout**: 5000ms

**Example**:
```javascript
const response = await fetch('https://edgar.truesight.me/ping', { 
  method: 'HEAD', 
  timeout: 5000 
});
```

### 2. Submit Contribution
**Endpoint**: `POST /dao/submit_contribution`
**Description**: Submit various types of contributions and reports
**Content-Type**: `multipart/form-data`

**Form Data**:
- `text`: The signed request text
- `attachment` (optional): File attachment (image, document, etc.)

**Example**:
```javascript
const formData = new FormData();
formData.append('text', shareText);
if (file) {
  formData.append('attachment', file, fileName);
}

const resp = await fetch("https://edgar.truesight.me/dao/submit_contribution", {
  method: 'POST',
  body: formData
});
```

### 3. Verify Signature
**Endpoint**: `GET` (Google Apps Script)
**Description**: Verify digital signature and get contributor information
**Parameters**: `signature` (Base64 encoded public key)

**Example**:
```javascript
const response = await fetch(`${API_ENDPOINT}?signature=${encodeURIComponent(publicKey)}`);
const data = await response.json();
```

## Request Types and Formats

### 1. Voting Rights Withdrawal Request

**Format**:
```
[VOTING RIGHTS WITHDRAWAL REQUEST]
Contributor: {contributor_name}
Amount to withdraw: {amount}
Value per voting right: ${value_per_right}
Expected total amount (USD): ${expected_total}
Withdrawal method: {method}
{method_specific_fields}
--------

My Digital Signature: {public_key}

Request Transaction ID: {signature_hash}
```

**Method-Specific Fields**:
- **PIX**: `PIX number: {pix_number}`
- **Venmo**: `Venmo number: {venmo_number}`
- **PayPal**: `PayPal ID: {paypal_id}`
- **WiseTransfer**: 
  ```
  Wise email: {wise_email}
  Wise full name: {wise_full_name}
  Wise bank name: {wise_bank_name}
  Wise IBAN: {wise_iban} (optional)
  Wise account number: {wise_account_number} (optional)
  Wise SWIFT/BIC code: {wise_swift_code} (optional)
  ```
- **Zelle**: `Zelle ID: {zelle_id}`

### 2. Tree Planting Report

**Format**:
```
[TREE PLANTING EVENT]
Contributor: {contributor_name}
Latitude: {latitude}
Longitude: {longitude}
Number of trees planted: {tree_count}
Tree species: {species}
Planting date: {date}
Currency: {currency}
Cost per tree: {cost_per_tree}
Total cost: {total_cost}
Additional notes: {notes}
--------

My Digital Signature: {public_key}

Request Transaction ID: {signature_hash}
```

**Attachments**: Photo of the planted trees

### 3. Sales Report

**Format**:
```
[SALES REPORT]
Contributor: {contributor_name}
Product: {product_name}
Quantity: {quantity}
Unit price: {unit_price}
Total amount: {total_amount}
Currency: {currency}
Customer: {customer_info}
Sale date: {date}
Payment method: {payment_method}
Additional notes: {notes}
--------

My Digital Signature: {public_key}

Request Transaction ID: {signature_hash}
```

**Attachments**: Receipt, invoice, or proof of sale

### 4. DAO Expenses Report

**Format**:
```
[DAO EXPENSES REPORT]
Contributor: {contributor_name}
Expense type: {expense_type}
Amount: {amount}
Currency: {currency}
Date: {date}
Description: {description}
Receipt/Proof: {receipt_info}
--------

My Digital Signature: {public_key}

Request Transaction ID: {signature_hash}
```

### 5. Inventory Movement Report

**Format**:
```
[INVENTORY MOVEMENT]
Contributor: {contributor_name}
Movement type: {movement_type}
Product: {product_name}
Quantity: {quantity}
From location: {from_location}
To location: {to_location}
Date: {date}
Reason: {reason}
--------

My Digital Signature: {public_key}

Request Transaction ID: {signature_hash}
```

### 6. Contribution Report

**Format**:
```
[CONTRIBUTION REPORT]
Contributor: {contributor_name}
Contribution type: {contribution_type}
Description: {description}
Value: {value}
Currency: {currency}
Date: {date}
Hours worked: {hours} (if applicable)
--------

My Digital Signature: {public_key}

Request Transaction ID: {signature_hash}
```

### 7. Farm Registration

**Format**:
```
[FARM REGISTRATION]
Contributor: {contributor_name}
Farm name: {farm_name}
Location: {location}
Latitude: {latitude}
Longitude: {longitude}
Farm size: {size}
Crops: {crops}
Registration date: {date}
--------

My Digital Signature: {public_key}

Request Transaction ID: {signature_hash}
```

### 8. Document Notarization

**Format**:
```
[NOTARIZATION EVENT]
Submitter: {contributor_name}
Latitude: {latitude}
Longitude: {longitude}
Document Type: {document_type}
Description: {description}
Attached Filename: {filename}
Destination Notarized File Location: {notarized_location}
Submission Source: {source_url}
--------

My Digital Signature: {public_key}

Request Transaction ID: {signature_hash}
```

**Attachments**: Document or photo to be notarized

## Request Verification

All requests can be verified using the verification endpoint at `https://dapp.truesight.me/verify_request.html`.

**Verification Process**:
1. Extract the message content (everything before the signature)
2. Extract the digital signature (public key)
3. Extract the transaction ID (signature hash)
4. Verify the cryptographic signature using RSA verification
5. Check if the signature belongs to a registered DAO member

**Example Verification Request**:
```javascript
async function verifySignature(message, digitalSignature, signatureBase64) {
  // Convert PEM format to raw base64
  const rawBase64 = digitalSignature
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\s+/g, '');
  
  // Import the public key
  const publicKey = await importPublicKey(rawBase64);
  
  // Convert base64 signature to ArrayBuffer
  const signature = base64ToArrayBuffer(signatureBase64);
  
  // Create text encoder
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  
  // Verify the signature
  return await window.crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    signature,
    data
  );
}
```

## Error Handling

### Common Error Responses

1. **Signature Not Found**: `No matching signature found in the database`
2. **Invalid Signature Format**: `Invalid digital signature format`
3. **Network Error**: `Failed to fetch contributor info`
4. **Server Error**: `The server encountered an error processing your request`

### Offline Mode

When the API is unavailable, requests should be shared via:
- **Telegram**: https://t.me/TrueSightDAO
- **WhatsApp**: Community WhatsApp group
- **Email**: Alternative submission method

## Security Considerations

1. **Private Key Protection**: Never share or transmit private keys
2. **Signature Verification**: Always verify signatures before processing requests
3. **Request Integrity**: Ensure request text matches exactly with signature
4. **Transport Security**: Use HTTPS for all API communications
5. **Rate Limiting**: Implement appropriate rate limiting for API calls

## Implementation Notes

1. **Browser Compatibility**: Requires modern browsers with Web Crypto API support
2. **Mobile Support**: Native sharing APIs are used when available
3. **Offline Capability**: Requests can be generated offline and shared later
4. **File Attachments**: Images and documents can be attached to requests
5. **Location Services**: GPS coordinates are captured when available

## Example Implementations

See the following files in the dapp repository for complete implementations:
- `withdraw_voting_rights.html` - Voting rights withdrawal
- `report_tree_planting.html` - Tree planting reports
- `report_sales.html` - Sales reports
- `report_dao_expenses.html` - DAO expenses
- `report_inventory_movement.html` - Inventory movements
- `report_contribution.html` - General contributions
- `register_farm.html` - Farm registration
- `notarize.html` - Document notarization
- `verify_request.html` - Request verification
- `create_signature.html` - Digital signature creation
