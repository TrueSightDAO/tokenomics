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
## TDG Wallet Balance Script

This new Google Apps Script file (`tdg_wallet_balance_check.gs`) fetches the TDG token balances for wallet addresses listed in the `Contributors voting weight` sheet and updates the latest TDG holdings in your Google Spreadsheet. Since TDG is now trading, this script ensures your sheet reflects on-chain TDG balances after trading.

Key functions:

- `getTdgWalletBalance(walletAddress)`: Fetch the TDG token balance for a given Solana wallet address via QuickNode RPC.
- `updateTdgWalletBalancesFromSheet()`: Read wallet addresses from column D of the `Contributors voting weight` sheet (starting at row 5) and write their latest balances to column F.
- `testGetTdgBalance()`: Utility function to log the TDG balance for a sample wallet address.