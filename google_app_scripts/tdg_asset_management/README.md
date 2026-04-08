# DAO Asset Management Script

This Google Apps Script manages and updates asset-related data for a Decentralized Autonomous Organization (DAO) by interacting with Google Sheets, Wix APIs, Solana blockchain, LATOKEN exchange, and U.S. Treasury yield data. It is an implementation of the policy outlined in the Realms proposal: [TDG Buyback and Asset Management Policy](https://app.realms.today/dao/2yH36PrWii3RthpHtdJVYaPgBzfcSLe7oevvGRavrut7/proposal/8swdcY3CMx13BfVcx3ffEtHEHVHaUZJxxfrAF7f1HHrc).

## Overview

The script performs the following key functions:

- Retrieves and updates off-chain asset balances and transactions from a Google Spreadsheet.
- Fetches USDT balance from a Solana vault.
- Manages TDG token issuance and asset balances via Wix APIs.
- Calculates and updates asset per issued TDG.
- Tracks and updates 30-day sales data.
- Calculates daily TDG buy-back budget based on sales, TDG price, and U.S. Treasury yield.
- Fetches and stores U.S. Treasury yield data.
- Reads a list of TDG wallet addresses from the "Contributors voting weight" sheet and updates their TDG token balances via Solana RPC (QuickNode).

## Prerequisites

- **Google Account**: Access to Google Sheets and Google Apps Script.
- **Wix Account**: Wix API key (`WIX_API_KEY`) for authentication.
- **Solana Node**: Access to a Solana RPC endpoint (e.g., QuickNode).
- **LATOKEN API**: Access to LATOKEN's public API for TDG/USDT price.
- **Google Spreadsheet**: A spreadsheet based on the template available at https://www.truesight.me/ledger, containing the following sheets:
  - `off chain asset balance`
  - `offchain transactions`
  - `Ledger history`
- **Credentials**: A `getCredentials()` function that returns an object containing `WIX_API_KEY`.

## Setup

1. **Google Spreadsheet**:

   - Create a spreadsheet using the template at https://www.truesight.me/ledger.
   - Copy the spreadsheet and note its ID (replace `1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU` in the script if different).
   - Ensure the required sheets (`off chain asset balance`, `offchain transactions`, `Ledger history`) are present with appropriate data formats.

2. **Google Apps Script**:

   - Open the Google Apps Script editor from your spreadsheet.
   - Copy and paste the provided code.
   - Define the `getCredentials()` function to return your `WIX_API_KEY`.

3. **Wix Configuration**:

   - Set up a Wix data collection named `ExchangeRate`.
   - Ensure the data item IDs match those defined in the script (e.g., `getWixAssetBalanceDataItemId`, `getWixDailyTdgBuyBackBudgetDataItemId`, etc.).

4. **Solana Configuration**:

   - Ensure the Solana vault address (`BkcbCEnD14C7cYiN6VwpYuGmpVrjfoRwobhQQScBugqQ`) is correct.
   - Use a valid Solana RPC endpoint.

5. **LATOKEN API**:

   - Verify the TDG and USDT IDs for the LATOKEN API.

## Usage

### Key Functions

- `updateTotalDAOAssetOnWix()`: Updates the total DAO asset value on Wix by combining off-chain assets and USDT vault balance.
- `getOffChainAssetValue()`: Retrieves the off-chain asset value from the Google Spreadsheet.
- `getUSDTBalanceInVault()`: Fetches the USDT balance from the Solana vault.
- `setAssetBalanceOnWix(latest_asset_balance)`: Updates the asset balance on Wix.
- `getTdgTokensIssued()`: Retrieves the total TDG tokens issued from the spreadsheet.
- `updateAssetPerIssuedTdg()`: Calculates and updates the asset value per issued TDG on Wix.
- `update30DaysSalesOnWix()`: Updates the 30-day sales data on Wix using either a simple value or a calculated sum.
- `setDailyTdgBuyBackBudget()`: Calculates and sets the daily TDG buy-back budget based on sales, TDG price, and Treasury yield.
- `setUSTreasuryYieldOnWix()`: Fetches and updates the U.S. Treasury 1-month yield on Wix.

### Running the Script

1. **Manually**:
   - Run specific functions (e.g., `updateTotalDAOAssetOnWix`) from the Apps Script editor.
2. **Automated**:
   - Set up triggers in Google Apps Script to run functions periodically (e.g., daily).

## Data Flow

1. **Google Spreadsheet**:

   - Stores off-chain asset balances, transactions, and TDG issuance data.
   - Used as the primary data source for calculations.

2. **Solana Blockchain**:

   - Provides USDT balance in the vault via RPC calls.

3. **Wix APIs**:

   - Stores and retrieves asset balances, TDG issuance, sales, buy-back budgets, and Treasury yields.
   - Uses the `ExchangeRate` data collection.

4. **LATOKEN API**:

   - Provides the latest TDG/USDT price.

5. **U.S. Treasury API**:

   - Fetches the 1-month Treasury yield for budget calculations.

## Security Considerations

- **Credentials**: Store `WIX_API_KEY` securely and avoid hardcoding it.
- **API Limits**: Be aware of rate limits for Wix, Solana, and LATOKEN APIs.
- **Data Validation**: Ensure data retrieved from external sources is validated before processing.
- **Error Handling**: Add try-catch blocks for robust error management (not fully implemented in the provided code).

## Limitations

- The script assumes the spreadsheet structure matches the template at https://www.truesight.me/ledger.
- No error handling for failed API requests or invalid data.
- The `getCredentials()` function is not defined in the provided code.
- The Treasury yield parsing assumes a specific XML structure.

## Future Improvements

- Add comprehensive error handling and logging.
- Implement data validation for API responses.
- Support multiple currencies or vaults.
- Add unit tests for critical functions.
- Optimize API calls to reduce latency and stay within rate limits.

## License

This project is unlicensed. Use and modify at your own risk.

## Stripe Subscription Sales Sync to Offchain Transactions

This Google Apps Script (`stripe_sales_sync.gs`) provides a **direct route** from Stripe API to the "offchain transactions" sheet for **Edgar's market sell-off dashboard SaaS subscription** revenue. It polls Stripe for charges associated with a specific product ID and writes both subscription sales revenue and transaction fees directly to the offchain transactions sheet, bypassing intermediate sheets.

### ⚠️ Important: Non-Interference with Existing Flows

**This script ONLY processes Stripe charges that are NOT already handled by existing flows.** It automatically checks both sheets and skips any charges that are already being processed by:
- **QR Code Sales sheet**: 
  - QR code checkout via Edgar (`qr_code_check_controller.rb` → "QR Code Sales" → `sales_update_main_dao_offchain_ledger.gs`)
  - Telegram sales events (`process_sales_telegram_logs.gs` → "QR Code Sales")
- **Stripe Social Media Checkout ID sheet**:
  - Meta Checkout orders (`MetaCheckoutOrderSync` → "Stripe Social Media Checkout ID" → Wix Store API)

This ensures that **Agroverse sales via Edgar and Meta Checkout orders are handled exclusively by their respective flows** and this script only processes Edgar's market sell-off dashboard SaaS subscription sales for the target product that don't go through these existing flows.

### Features
- **Direct Integration**: Stripe API → offchain transactions (no intermediate sheets)
- **Product Filtering**: Only processes charges for a specific Stripe product ID (Edgar's market sell-off dashboard SaaS subscription)
- **Duplicate Prevention**: 
  - Checks existing descriptions in offchain transactions to avoid duplicates
  - **Checks "QR Code Sales" sheet** to skip charges already handled by QR code checkout flow
  - **Checks "Stripe Social Media Checkout ID" sheet** to skip charges already handled by Meta Checkout flow
- **Fee Tracking**: Automatically records Stripe transaction fees as separate negative entries
- **Time Window**: Configurable lookback period (default: 30 days)
- **Non-Interference**: Automatically skips charges already in existing sheets to prevent duplicate processing

### Spreadsheet Requirements
- **Target Sheet**: `offchain transactions` in spreadsheet `1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU`
- **Sheet Structure**:
  - Column A: Transaction Date (YYYYMMDD format)
  - Column B: Description
  - Column C: Fund Handler
  - Column D: Amount (positive for sales, negative for fees)
  - Column E: Currency
  - Column F: Ledger Line (empty)
  - Column G: Is Revenue (TRUE for sales, empty for fees)

### Installation & Setup

1. **Add the Script**:
   - In your Apps Script project, add a new script file named `stripe_sales_sync.gs`
   - Copy the contents from the repository

2. **Configure Credentials**:
   - Update your `Credentials.gs` file to include Stripe API key:
   ```js
   function setApiKeys() {
     PropertiesService.getScriptProperties()
       .setProperty('STRIPE_API_KEY', 'sk_live_...'); // Your Stripe secret key
   }
   
   function getCredentials() {
     return {
       STRIPE_API_KEY: PropertiesService.getScriptProperties().getProperty('STRIPE_API_KEY'),
       // ... other credentials
     };
   }
   ```
   - Run `setApiKeys()` once to initialize the Stripe API key

3. **Configure Product ID**:
   - Update `TARGET_PRODUCT_ID` in `stripe_sales_sync.gs` to match your Stripe product ID for Edgar's market sell-off dashboard SaaS subscriptions
   - Update `FUND_HANDLER` if needed (default: "Gary Teh")
   - Adjust `DAYS_BACK` to change the lookback period (default: 30 days)

### Execution

- **Manual Run**: In the Apps Script editor, select the function `fetchStripeTransactions` and click **Run**
- **Automated Trigger**: 
  - Run `createTrigger()` once to set up an hourly trigger
  - Or manually create a time-based trigger in Apps Script > Triggers
  - To remove the trigger, run `removeTrigger()`

### How It Works

1. Fetches the last 100 charges from Stripe API
2. Filters charges that:
   - Are paid and succeeded
   - Were created within the lookback period (default: 30 days)
   - Are associated with the target product ID (via invoice or payment intent)
3. **Checks existing sheets** to skip charges already handled by existing flows:
   - **QR Code Sales sheet**: Looks for Stripe session IDs in Columns A, B, or C, and charge IDs in messages
   - **Stripe Social Media Checkout ID sheet**: Looks for Stripe session IDs in Column C (Stripe Session ID)
   - Skips any matches to prevent duplicate processing
4. For each matching charge (not in existing sheets):
   - Creates a sale record (positive amount, marked as revenue)
   - Creates a fee record (negative amount, if transaction fee exists)
5. Checks for duplicates in offchain transactions by comparing descriptions
6. Appends new records to the offchain transactions sheet

### Notes

- This script provides a **direct** Stripe → offchain transactions route for **Edgar's market sell-off dashboard SaaS subscription revenue**, unlike other sales processing scripts that go through intermediate sheets
- **The script will NOT process charges that are already in "QR Code Sales" or "Stripe Social Media Checkout ID"** - this ensures:
  - Agroverse sales via Edgar continue to be handled by the existing QR code checkout flow
  - Meta Checkout orders continue to be handled by the Meta Checkout sync flow
- The script handles both invoice-based and payment intent-based charges
- Customer email is included in the description for traceability
- Transaction fees are automatically calculated from Stripe balance transactions
- Use this script specifically for Edgar's market sell-off dashboard SaaS subscription Stripe sales that need direct recording to offchain transactions

## TDG Wallet Balance Script

This new Google Apps Script file (`tdg_wallet_balance_check.gs`) fetches the TDG token balances for wallet addresses listed in the `Contributors voting weight` sheet and updates the latest TDG holdings in your Google Spreadsheet. Since TDG is now trading, this script ensures your sheet reflects on-chain TDG balances after trading.

Key functions:

- `getTdgWalletBalance(walletAddress)`: Fetch the TDG token balance for a given Solana wallet address via QuickNode RPC.
- `updateTdgWalletBalancesFromSheet()`: Read wallet addresses from column D of the `Contributors voting weight` sheet (starting at row 5) and write their latest balances to column F.
- `testGetTdgBalance()`: Utility function to log the TDG balance for a sample wallet address.