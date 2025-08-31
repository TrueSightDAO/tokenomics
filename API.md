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

## Google Apps Script Webhook Endpoints

### 4. Asset Management API
**Endpoint**: `https://script.google.com/macros/s/AKfycbygmwRbyqse-dpCYMco0rb93NSgg-Jc1QIw7kUiBM7CZK6jnWnMB5DEjdoX_eCsvVs7/exec`
**Description**: Retrieve voting rights and asset information based on digital signature
**Source Code**: [tdg_asset_management/web_app.gs](./google_app_scripts/tdg_asset_management/web_app.gs)

**Parameters**:
- `signature` (required): Base64 encoded public key
- `full` (optional): If `true`, returns full asset details; if `false` or omitted, returns only contributor name

**Response Format**:
```json
// Success response (contributor name only)
{
  "contributor_name": "John Doe"
}

// Success response (full details with full=true parameter)
{
  "contributor_name": "John Doe",
  "voting_rights": 1000,
  "voting_rights_circulated": 750,
  "total_assets": 15000.00000,
  "asset_per_circulated_voting_right": 20.00000
}

// Error response
{
  "error": "No matching signature found in the database"
}
```

**Example**:
```javascript
// Get contributor name only
const response = await fetch('https://script.google.com/macros/s/AKfycbygmwRbyqse-dpCYMco0rb93NSgg-Jc1QIw7kUiBM7CZK6jnWnMB5DEjdoX_eCsvVs7/exec?signature=' + encodeURIComponent(publicKey));
const data = await response.json();

// Get full asset details
const fullResponse = await fetch('https://script.google.com/macros/s/AKfycbygmwRbyqse-dpCYMco0rb93NSgg-Jc1QIw7kUiBM7CZK6jnWnMB5DEjdoX_eCsvVs7/exec?signature=' + encodeURIComponent(publicKey) + '&full=true');
const fullData = await fullResponse.json();

// Handle response
if (data.error) {
  console.error('Error:', data.error);
} else {
  console.log('Contributor:', data.contributor_name);
  if (fullData.total_assets) {
    console.log('Total assets:', fullData.total_assets);
  }
}
```

### 5. QR Code Management API
**Endpoint**: `https://script.google.com/macros/s/AKfycbxigq4-J0izShubqIC5k6Z7fgNRyVJLakfQ34HPuENiSpxuCG-wSq0g-wOAedZzzgaL/exec`
**Description**: Manage Agroverse QR codes and retrieve minted codes
**Source Code**: [agroverse_qr_codes/web_app.gs](./google_app_scripts/agroverse_qr_codes/web_app.gs)

**Parameters**:
- `list=true`: Returns array of minted QR codes
- `qr_code`: QR code identifier for updating email
- `email_address`: Email address to associate with QR code

**Response Format**:
```json
// Success response for list=true
{
  "status": "success",
  "qr_codes": [
    "2025BF_20250521_PROPANE_1",
    "2025BF_20250522_COFFEE_1",
    "2025BF_20250523_CORN_1",
    "2025BF_20250524_SOYBEAN_1"
  ]
}

// Error response
{
  "status": "error",
  "message": "Failed to retrieve QR codes"
}

// Success response for email update
{
  "status": "success",
  "message": "QR code email updated successfully"
}
```

**Example**:
```javascript
// Get list of minted QR codes
const response = await fetch('https://script.google.com/macros/s/AKfycbxigq4-J0izShubqIC5k6Z7fgNRyVJLakfQ34HPuENiSpxuCG-wSq0g-wOAedZzzgaL/exec?list=true');
const data = await response.json();

if (data.status === 'error') {
  throw new Error(data.message);
}

// Process QR codes
data.qr_codes.forEach(qrCode => {
  console.log('QR Code:', qrCode);
});

// Update QR code email
const updateResponse = await fetch('https://script.google.com/macros/s/AKfycbxigq4-J0izShubqIC5k6Z7fgNRyVJLakfQ34HPuENiSpxuCG-wSq0g-wOAedZzzgaL/exec?qr_code=2025BF_20250521_PROPANE_1&email_address=user@example.com');
const updateData = await updateResponse.json();
```

### 6. Inventory Management API
**Endpoint**: `https://script.google.com/macros/s/AKfycbztpV3TUIRn3ftNW1aGHAKw32OBJrp_p1Pr9mMAttoyWFZyQgBRPU2T6eGhkmJtz7xV/exec`
**Description**: List inventory managers and fetch asset data for specific managers
**Source Code**: [tdg_inventory_management/web_app.gs](./google_app_scripts/tdg_inventory_management/web_app.gs)

**Parameters**:
- `list=true`: Returns array of inventory managers
- `recipients=true`: Returns array of recipient managers
- `manager=<key>`: Returns asset data for specific manager (URL-encoded manager name)

**Response Format**:
```json
// For list=true - List of inventory managers
{
  "managers": [
    {"key": "john_doe_manager", "name": "John Doe"},
    {"key": "jane_smith_manager", "name": "Jane Smith"},
    {"key": "bob_wilson_manager", "name": "Bob Wilson"}
  ]
}

// For recipients=true - List of recipient managers
{
  "recipients": [
    {"key": "recipient_1", "name": "Recipient One"},
    {"key": "recipient_2", "name": "Recipient Two"},
    {"key": "recipient_3", "name": "Recipient Three"}
  ]
}

// For manager=<key> - Assets for specific manager
{
  "assets": [
    {"currency": "USD", "amount": 15000.00},
    {"currency": "BRL", "amount": 75000.00},
    {"currency": "EUR", "amount": 12000.00}
  ]
}

// Error response
{
  "error": "Manager not found"
}
```

**Example**:
```javascript
// Get list of inventory managers
const managersResponse = await fetch('https://script.google.com/macros/s/AKfycbztpV3TUIRn3ftNW1aGHAKw32OBJrp_p1Pr9mMAttoyWFZyQgBRPU2T6eGhkmJtz7xV/exec?list=true');
const managers = await managersResponse.json();

// Get recipient managers
const recipientsResponse = await fetch('https://script.google.com/macros/s/AKfycbztpV3TUIRn3ftNW1aGHAKw32OBJrp_p1Pr9mMAttoyWFZyQgBRPU2T6eGhkmJtz7xV/exec?recipients=true');
const recipients = await recipientsResponse.json();

// Get assets for specific manager
const managerKey = encodeURIComponent('John Doe');
const assetsResponse = await fetch('https://script.google.com/macros/s/AKfycbztpV3TUIRn3ftNW1aGHAKw32OBJrp_p1Pr9mMAttoyWFZyQgBRPU2T6eGhkmJtz7xV/exec?manager=' + managerKey);
const assets = await assetsResponse.json();

// Handle responses
if (managers.managers) {
  managers.managers.forEach(manager => {
    console.log('Manager:', manager.name, 'Key:', manager.key);
  });
}

if (assets.assets) {
  assets.assets.forEach(asset => {
    console.log('Asset:', asset.currency, 'Amount:', asset.amount);
  });
}
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
[SALES EVENT]
- Item: {qr_code_or_item_id}
- Sales price: ${amount}
- Sold by: {contributor_name}
- Attached Filename: {filename_or_None}
- Submission Source: {source_url}
--------

My Digital Signature: {public_key}

Request Transaction ID: {signature_hash}
```

**Attachments**: Receipt, invoice, or proof of sale (optional)

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

### HTTP Status Codes

- **200 OK**: Request successful
- **400 Bad Request**: Invalid parameters or malformed request
- **404 Not Found**: Resource not found
- **500 Internal Server Error**: Server-side error

### Common Error Responses

1. **Signature Not Found**: 
   ```json
   {
     "error": "No matching signature found in the database"
   }
   ```

2. **Invalid Signature Format**: 
   ```json
   {
     "error": "Invalid digital signature format"
   }
   ```

3. **Network Error**: 
   ```json
   {
     "error": "Failed to fetch contributor info"
   }
   ```

4. **Server Error**: 
   ```json
   {
     "error": "The server encountered an error processing your request"
   }
   ```

5. **QR Code API Error**:
   ```json
   {
     "status": "error",
     "message": "Failed to retrieve QR codes"
   }
   ```

6. **Manager Not Found**:
   ```json
   {
     "error": "Manager not found"
   }
   ```

### Error Handling Best Practices

```javascript
async function makeApiCall(url) {
  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Check for API-specific error responses
    if (data.error) {
      throw new Error(data.error);
    }
    
    if (data.status === 'error') {
      throw new Error(data.message);
    }
    
    return data;
  } catch (error) {
    console.error('API call failed:', error);
    throw error;
  }
}
```

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

## Google Apps Script Implementation Details

The Google Apps Script endpoints are implemented as web apps that provide RESTful API access to Google Sheets data. Each endpoint is deployed as a separate web app with specific functionality:

### Asset Management API
- **File**: [tdg_asset_management/web_app.gs](./google_app_scripts/tdg_asset_management/web_app.gs)
- **Purpose**: Retrieves voting rights and asset information for DAO members
- **Data Sources**: 
  - Contributors contact information sheet
  - Contributors voting weight sheet
  - Off-chain asset balance sheet
  - Wix API for additional asset data
  - Solana blockchain for USDT vault balance

### QR Code Management API
- **File**: [agroverse_qr_codes/web_app.gs](./google_app_scripts/agroverse_qr_codes/web_app.gs)
- **Purpose**: Manages Agroverse QR codes for cacao bag tracking
- **Data Sources**: Agroverse QR codes sheet
- **Features**: List minted QR codes, update email associations

### Inventory Management API
- **File**: [tdg_inventory_management/web_app.gs](./google_app_scripts/tdg_inventory_management/web_app.gs)
- **Purpose**: Manages inventory movements and asset locations
- **Data Sources**: 
  - Off-chain asset location sheet
  - Contributors contact information sheet
  - Wix API for ledger configurations
- **Features**: List managers, list recipients, fetch asset data per manager

### Related Google Apps Script Files

Additional Google Apps Script files that support the ecosystem but are not directly exposed as API endpoints:

- **tdg_asset_management/**: Asset management and tokenization scripts
  - [tdg_recurring_tokenization_monthly.gs](./google_app_scripts/tdg_asset_management/tdg_recurring_tokenization_monthly.gs) - Monthly tokenization processes
  - [tdg_expenses_processing.gs](./google_app_scripts/tdg_asset_management/tdg_expenses_processing.gs) - Expense processing automation
  - [tdg_wix_dashboard.gs](./google_app_scripts/tdg_asset_management/tdg_wix_dashboard.gs) - Wix dashboard integration

- **tdg_inventory_management/**: Inventory and sales processing
  - [process_sales_telegram_logs.gs](./google_app_scripts/tdg_inventory_management/process_sales_telegram_logs.gs) - Process sales from Telegram logs
  - [process_movement_telegram_logs.gs](./google_app_scripts/tdg_inventory_management/process_movement_telegram_logs.gs) - Process inventory movements from Telegram logs

- **agroverse_qr_codes/**: QR code management
  - [subscription_notification.gs](./google_app_scripts/agroverse_qr_codes/subscription_notification.gs) - QR code subscription notifications

For detailed setup and deployment instructions for these Google Apps Scripts, see the README files in each respective directory.
