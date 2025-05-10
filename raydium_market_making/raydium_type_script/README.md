
Usage
------
Run the sandbox script with a specific command:

```bash
yarn dev sandbox.ts <command> [value]
```

Commands:
  swap [amountSol]    Compute swap quote for given SOL amount (defaults to 0.0012837917230333904)
  wix                 Fetch daily TDG buyback budget from Wix
  usdc2sol [usdcAmt]  Convert USDC amount to equivalent SOL
  buyback             Fetch daily TDG buyback budget from Wix and convert to SOL equivalent
  help                Show this help message

Examples:
```bash
# Compute swap quote for 0.002 SOL
yarn dev sandbox.ts swap 0.002

# Fetch the Wix daily TDG buyback budget
yarn dev sandbox.ts wix

# Convert 100 USDC into SOL
yarn dev sandbox.ts usdc2sol 100

# Fetch the Wix daily TDG buyback budget and convert to SOL                                                                    │
yarn dev sandbox.ts buyback 
```


Pre-requisites
- NodeJs version v20.19.1 (pinned in .nvmrc)

To automatically switch Node versions when entering this directory:

1. Install nvm if you haven't already: https://github.com/nvm-sh/nvm
2. Run:
   ```bash
   nvm install      # installs node@20.19.1 per .nvmrc
   nvm use          # switches to node@20.19.1
   ```

Setting up
```bash
yarn add @raydium-io/raydium-sdk-v2
```

## Environment Configuration
1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` and set your values:
   - SECRET_KEY: your wallet secret key in base58
   - RPC_URL: your Solana RPC endpoint URL
   - WIX_API_KEY: your Wix Data API key
   - WIX_DAILY_TDG_BUYBACK_ITEM_ID: the Wix data item ID for daily TDG buy-back
   - WIX_DATA_COLLECTION_ID: the Wix data collection ID
   - WIX_ACCOUNT_ID: your Wix account ID
   - WIX_SITE_ID: your Wix site ID
   - USDC_MINT (optional): USDC mint address (defaults to mainnet USDC)

`.env` is listed in `.gitignore` and will not be committed to git.

### Associated Token Account (ATA) Setup
For swaps that receive a non-native token (e.g. WSOL or other SPL tokens), you must have an associated token account (ATA) in your wallet for the output mint.
If you do not already have one, create it manually:
```bash
spl-token create-account <OUTPUT_MINT_ADDRESS>
```
Replace `<OUTPUT_MINT_ADDRESS>` with the mint address of the token you will receive (the `OUTPUT_MINT` in `sandbox.ts`).
Without this ATA, the buyback command will fail with:
```
Error: No token account found for output mint <OUTPUT_MINT_ADDRESS>
```