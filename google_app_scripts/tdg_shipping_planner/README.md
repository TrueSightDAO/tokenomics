# Shipping Planner Module

## Overview

The Shipping Planner module provides a web-based interface for planning and estimating shipping costs for DAO inventory shipments. It supports both local shipping (via EasyPost/USPS) and freight shipping (via freight cost Google Sheet).

## Features

- **Member Selection**: Select a member/manager to view their inventory across all ledgers
- **Inventory Selection**: Multi-select inventory items with quantity specification
- **Weight Calculation**: Automatic weight calculation including product weights and packaging
- **Packaging Options**: Support for both box and pallet packaging
- **Shipping Types**: 
  - **Local Shipping**: USPS rates via EasyPost API (requires destination address)
  - **Freight**: Cost estimation from freight cost Google Sheet
- **Real-time Cost Estimation**: Get shipping cost estimates based on weight and shipping type

## Files

- `shipping_planner_api.gs`: Google Apps Script backend API
- `../dapp/shipping_planner.html`: Frontend web interface

## Deployment URL

The API is deployed at:
**https://script.google.com/macros/s/AKfycbz5Tt_vz1X26i82yqlGUSI_OtCUEO31jImZH2tXfNaxMbfmJ01dkwUIEZDjsnd10xMbcg/exec**

The frontend HTML file is already configured to use this URL.

## Setup

### 1. Google Apps Script Configuration

1. Create a new Google Apps Script project
2. Copy the contents of `shipping_planner_api.gs` into the script
3. Go to **Project Settings** > **Script Properties** and add the following:

#### Required Properties:
- `EASYPOST_API_KEY`: Your EasyPost API key (for local shipping)

#### Optional Properties (with defaults):
- `ORIGIN_ADDRESS_LINE1`: "1423 Hayes St" (origin address for EasyPost)
- `ORIGIN_ADDRESS_LINE2`: "" (optional address line 2)
- `ORIGIN_ADDRESS_CITY`: "San Francisco"
- `ORIGIN_ADDRESS_STATE`: "CA"
- `ORIGIN_ADDRESS_POSTAL_CODE`: "94117"
- `ORIGIN_ADDRESS_COUNTRY`: "US"
- `BASE_BOX_WEIGHT_OZ`: "11.5" (base box weight in ounces)
- `PER_ITEM_PACKAGING_OZ`: "0.65" (per-item packaging weight in ounces)
- `PALLET_WEIGHT_KG`: "35" (pallet weight in kilograms)

### 2. Deploy as Web App

1. Click **Deploy** > **New deployment**
2. Select type: **Web app**
3. Execute as: **Me**
4. Who has access: **Anyone**
5. Click **Deploy**
6. Copy the deployment URL

### 3. Frontend Configuration

1. Open `../dapp/shipping_planner.html`
2. Find the line: `const API_BASE_URL = 'YOUR_GOOGLE_APPS_SCRIPT_DEPLOYMENT_URL_HERE';`
3. Replace with your deployment URL from step 2

### 4. Currencies Sheet Setup

Ensure the **Currencies** sheet in the main spreadsheet (`1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU`) has:
- **Column A**: Product/Currency name
- **Column K**: Unit weight in **grams** (numeric, float) - Optional
- **Column L**: Unit weight in **ounces** (numeric, float) - Optional

**Weight Data Requirements:**
- At least one of Column K (grams) or Column L (ounces) must have weight data
- If both are present, Column K (grams) takes precedence
- If only Column L (ounces) is present, it will be converted to grams automatically
- Items without weight data in either column will be excluded from shipping calculations and will show a warning when attempting to select them

### 5. Freight Cost Sheet

The module reads freight costs from:
- **Spreadsheet ID**: `10Ps8BYcTa3sIqtoLwlQ13upuxIG_DgJIpfzchLjm9og`
- **Sheet Name**: "Totals by Weight" (preferred) or "Cost Breakdown"

The sheet should have weight tiers (200, 300, 500, 750, 1000 kg) with corresponding costs.

## Usage

### Web Interface

1. Open `shipping_planner.html` in a web browser
2. Select a member/manager from the dropdown
3. Check inventory items you want to ship
4. Enter quantities for each selected item
5. Select packaging type (Box or Pallet)
6. Select shipping type (Local or Freight)
7. If local shipping, enter destination address
8. Click "Calculate Shipping Cost"
9. View estimated costs

### API Endpoints

#### List Managers
```
GET ?action=list_managers
```
Returns list of all managers with inventory.

#### Get Manager Inventory
```
GET ?action=get_inventory&manager=<manager_key>
```
Returns inventory items for a specific manager, including weights.

#### Calculate Shipping
```
POST (JSON body)
{
  "action": "calculate_shipping",
  "selected_items": [
    {
      "currency": "Product Name",
      "quantity": 10,
      "weight_grams": 200
    }
  ],
  "packaging_type": "box" | "pallet",
  "shipping_type": "local" | "freight",
  "destination_address": {
    "street1": "123 Main St",
    "city": "San Francisco",
    "state": "CA",
    "zip": "94117",
    "country": "US"
  }
}
```

Returns weight summary and shipping cost options.

## Weight Calculation

### Product Weight
- Sum of: `(item_weight_grams × quantity)` for all selected items
- Only items with weight data in Column K are included

### Packaging Weight

**Box:**
- Base box: 11.5 oz (default, configurable)
- Per-item packaging: 0.65 oz per item (default, configurable)
- Total = base + (per-item × quantity)

**Pallet:**
- Fixed weight: 35 kg (default, configurable)

### Total Weight
- Total = Product Weight + Packaging Weight
- Converted to grams, kilograms, and ounces as needed

## Shipping Cost Calculation

### Local Shipping (EasyPost)
- Uses EasyPost API to get USPS rates
- Requires destination address
- Returns multiple service options sorted by price
- Filters for USPS carrier only

### Freight Shipping
- Reads from freight cost Google Sheet
- Uses weight tiers with linear interpolation
- Returns estimated cost based on total weight

## Data Sources

- **Main Inventory**: `offchain asset location` sheet in main spreadsheet
- **External Ledgers**: Fetched via Wix API (if configured)
- **Product Weights**: `Currencies` sheet, Column K
- **Freight Costs**: Freight cost Google Sheet

## Notes

- **Weight Data**: Items must have weight data in either Column K (grams) or Column L (ounces)
  - If both columns have data, Column K (grams) is used
  - If only Column L (ounces) is present, it is converted to grams automatically
  - Items without weight data in either column are excluded from calculations and show a warning
- **Weight Units**: 
  - Column K: grams (preferred)
  - Column L: ounces (converted to grams internally)
  - All internal calculations use grams, converted to oz/kg as needed
- **Packaging weights** are converted as needed (oz for EasyPost, kg for freight)
- The module follows the same conventions as other Google Apps Scripts in the tokenomics repository

## Troubleshooting

### "No shipping options available"
- Check EasyPost API key is set correctly
- Verify destination address is valid
- Check weight calculation (should be > 0)

### "Freight cost sheet not found"
- Verify freight cost spreadsheet ID is correct
- Check sheet name ("Totals by Weight" or "Cost Breakdown")
- Ensure sheet has weight tier data

### "No inventory found"
- Verify manager name matches exactly
- Check inventory sheet structure
- Ensure manager has inventory in main sheet or external ledgers

### "Item has no weight data" warning
- Check Currencies sheet for the product name
- Ensure either Column K (grams) or Column L (ounces) has weight data
- Verify the weight value is numeric and greater than 0
- Items without weight cannot be included in shipping calculations

## Future Enhancements

- Support for multiple packaging types in one shipment
- Save shipping plans for later reference
- Export shipping estimates to PDF/CSV
- Integration with shipment tracking
- Support for additional carriers (FedEx, UPS, etc.)

