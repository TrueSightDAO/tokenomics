import 'dotenv/config'
import { Transaction, VersionedTransaction, sendAndConfirmTransaction, sendAndConfirmRawTransaction } from '@solana/web3.js'
import { NATIVE_MINT } from '@solana/spl-token'
import axios from 'axios'
import { connection, owner, fetchTokenAccountData } from './config'
import { API_URLS } from '@raydium-io/raydium-sdk-v2'

console.log('API URLs:', API_URLS);

// ================================
// Script Configuration Parameters
// ================================
// Input/output token mints
const INPUT_MINT = NATIVE_MINT.toBase58();
const OUTPUT_MINT = '3wmsJkKWLdFT4tF4rG8zUZQ8M4hKUDtDuJW8q6i9KbgF';

// Swap settings
const INPUT_DECIMALS = 9;      // Decimal places for SOL (WSOL)
const SLIPPAGE_BPS = 5;        // Slippage in basis points
// Transaction version for swap: 'LEGACY' or 'V0'
const TX_VERSION: 'LEGACY' | 'V0' = 'LEGACY';

// Raydium compute endpoint
const SWAP_BASE_IN_ENDPOINT = `${API_URLS.SWAP_HOST}${API_URLS.SWAP_COMPUTE}swap-base-in`;

// Default amount to swap, in SOL (decimal)
const DEFAULT_AMOUNT_SOL = 0.0012837917230333904;

// ================================
// USDC to SOL conversion settings
// ================================
// WSOL mint address
const WSOL_MINT = NATIVE_MINT.toBase58();
// USDC mint address (override via env or default to mainnet USDC)
const USDC_MINT = process.env.USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
// TDG mint address (override via env or default to mainnet TDG)
const TDG_MINT = process.env.TDG_MINT || '3wmsJkKWLdFT4tF4rG8zUZQ8M4hKUDtDuJW8q6i9KbgF';
// Raydium price endpoint for mint prices
const PRICE_ENDPOINT = `${API_URLS.BASE_HOST}${API_URLS.MINT_PRICE}`;

/**
 * Compute swap quote for a given amount in SOL.
 * @param amountSol - Amount to swap, in SOL (decimal). This function converts to lamports internally.
 */
async function computeSwapQuoteSolToTdg(amountSol: number): Promise<any> {
  if (typeof amountSol !== 'number' || amountSol <= 0) {
    throw new Error(`Invalid amountSol: expected positive number (in SOL), got ${amountSol}`);
  }

  // Convert SOL decimal to integer lamports for WSOL
  const amountRaw = BigInt(Math.floor(amountSol * 10 ** INPUT_DECIMALS)).toString();

  const response = await axios.get(SWAP_BASE_IN_ENDPOINT, {
    params: {
      inputMint: INPUT_MINT,
      outputMint: OUTPUT_MINT,
      amount: amountRaw,
      slippageBps: SLIPPAGE_BPS,
      txVersion: TX_VERSION,
    },
  });
  console.log('Swap compute response:', response.data);
  return response.data;
}

// Helper to print usage instructions
function printHelp(): void {
  console.log(`
Usage: ts-node sandbox.ts <command> [value]

Commands:
  swap [amountSol]    Compute swap quote for given SOL amount (defaults to ${DEFAULT_AMOUNT_SOL})
  wix                 Fetch daily TDG buyback budget from Wix
  usdc2sol [usdcAmt]  Convert USDC amount to equivalent SOL
  tdg2usdc            Checks price of TDG in USDC on Raydium
  savetdg2usdc        Save price of TDG in USDC on Raydium to Wix
  buyback             Fetch daily TDG buyback budget from Wix and convert to SOL equivalent
  help                Show this help message
  `);
}

// Main CLI dispatcher
async function main(): Promise<void> {
  // Parse CLI arguments after script file
  const rawArgs = process.argv.slice(2);
  // If first arg is the script name, remove it
  if (rawArgs[0]?.endsWith('.ts') || rawArgs[0]?.endsWith('.js')) {
    rawArgs.shift();
  }
  const [cmd = 'help', val] = rawArgs;
  switch (cmd.toLowerCase()) {
    case 'swap': {
      const amt = val ? parseFloat(val) : DEFAULT_AMOUNT_SOL;
      await computeSwapQuoteSolToTdg(amt);
      break;
    }
    case 'wix': {
      await getWixDailyTdgBuybackBudget();
      break;
    }
    case 'tdg2usdc': {
      await checkTdgToUsdc();
      break;
    }
    case 'savetdg2usdc': {
      await updateWixTdgUsdcExchangeRate();
      break;
    }    
    case 'usdc2sol': {
      const usdcAmt = val ? parseFloat(val) : 0;
      await checkUsdcToSol(usdcAmt);
      break;
    }    
    case 'buyback': {
      // Execute buyback swap and return transaction IDs
      const txIds = await executeBuyBack();
      console.log('Buyback transaction IDs:', txIds);
      break;
    }
    case 'help':
    default:
      printHelp();
      break;
  }
}

// Execute main
main().catch(err => {
  console.error('Error:', err);
  printHelp();
});

// ================================
// Wix Data API: get daily TDG buy-back budget
// ================================

/**
 * Fetch the daily TDG buy-back budget (in USDC) from Wix Data API.
 */
async function getWixDailyTdgBuybackBudget(): Promise<number> {
  // Load and validate Wix env vars locally
  const {
    WIX_API_KEY,
    WIX_DAILY_TDG_BUYBACK_ITEM_ID,
    WIX_DATA_COLLECTION_ID,
    WIX_ACCOUNT_ID,
    WIX_SITE_ID,
  } = process.env;
  const missingWixEnv: string[] = [];
  if (!WIX_API_KEY) missingWixEnv.push('WIX_API_KEY');
  if (!WIX_DAILY_TDG_BUYBACK_ITEM_ID) missingWixEnv.push('WIX_DAILY_TDG_BUYBACK_ITEM_ID');
  if (!WIX_DATA_COLLECTION_ID) missingWixEnv.push('WIX_DATA_COLLECTION_ID');
  if (!WIX_ACCOUNT_ID && !WIX_SITE_ID) missingWixEnv.push('WIX_ACCOUNT_ID or WIX_SITE_ID');
  if (missingWixEnv.length) {
    throw new Error(`Missing Wix env vars: ${missingWixEnv.join(', ')}`);
  }
  const url =
    `https://www.wixapis.com/wix-data/v2/items/${WIX_DAILY_TDG_BUYBACK_ITEM_ID}` +
    `?dataCollectionId=${WIX_DATA_COLLECTION_ID}`;
  try {
    const resp = await axios.get(url, {
      headers: {
        Authorization: WIX_API_KEY!,
        'Content-Type': 'application/json',
        'wix-site-id': WIX_SITE_ID || '',
        'wix-account-id': WIX_ACCOUNT_ID || '',
      },
    });
    const data = resp.data;
    const budget = data?.dataItem?.data?.exchangeRate;
    if (budget == null) {
      throw new Error(`Unexpected Wix response format: ${JSON.stringify(data)}`);
    }
    console.log(`Daily TDG Buy Back Budget on Wix: ${budget}`);
    return Number(budget);
  } catch (err) {
    console.error('Error fetching Wix buyback budget:', err);
    throw err;
  }
}

// ================================
// (Moved to top under USDC to SOL conversion settings)
/**
 * Check estimated SOL output for a given USDC input.
 * @param usdcAmount - Input amount in USDC (decimal).
 */
async function checkUsdcToSol(usdcAmount: number): Promise<number> {
  if (typeof usdcAmount !== 'number' || usdcAmount < 0) {
    throw new Error(`Invalid usdcAmount: expected non-negative number, got ${usdcAmount}`);
  }
  try {
    const priceEndpoint = `${API_URLS.BASE_HOST}${API_URLS.MINT_PRICE}`;
    const resp = await axios.get(priceEndpoint, { params: { mints: WSOL_MINT } });
    const body = resp.data;
    if (!body.success) {
      throw new Error(`Price API error: ${body.error || JSON.stringify(body)}`);
    }
    const solPrice = Number(body.data[WSOL_MINT]);
    const amountSol = usdcAmount / solPrice;
    console.log(`To purchase ${amountSol} SOL for buyback`);
    return amountSol;
  } catch (err) {
    console.error('Error checking USDC to SOL conversion:', err);
    throw err;
  }
}

/**
 * Fetch the TDG to USDC exchange rate from Raydium and update it on Wix.
 */
async function updateWixTdgUsdcExchangeRate(): Promise<void> {
  try {
    // Fetch Wix configuration from environment variables
    const {
      WIX_API_KEY,
      WIX_ACCOUNT_ID,
      WIX_SITE_ID,
    } = process.env;
    const missingWixEnv: string[] = [];
    if (!WIX_API_KEY) missingWixEnv.push('WIX_API_KEY');
    if (!WIX_ACCOUNT_ID && !WIX_SITE_ID) missingWixEnv.push('WIX_ACCOUNT_ID or WIX_SITE_ID');
    if (missingWixEnv.length) {
      throw new Error(`Missing Wix env vars: ${missingWixEnv.join(', ')}`);
    }

    // Fetch TDG to USDC price from Raydium
    const tdgPriceInUsdc = await checkTdgToUsdc();
    console.log(`Fetched TDG to USDC price from Raydium: ${tdgPriceInUsdc} USDC`);

    // Wix Data API configuration
    const WIX_DATA_ITEM_ID = '8edde502-ac79-4e66-ab2d-8ebb99108665'; // Provided column ID
    const WIX_DATA_COLLECTION_ID = 'ExchangeRate'; // Matches Google Apps Script
    const url = `https://www.wixapis.com/wix-data/v2/items/${WIX_DATA_ITEM_ID}?dataCollectionId=${WIX_DATA_COLLECTION_ID}`;

    // Prepare payload for Wix Data API
    const payload = {
      dataCollectionId: WIX_DATA_COLLECTION_ID,
      dataItem: {
        data: {
          _id: WIX_DATA_ITEM_ID,
          _owner: WIX_ACCOUNT_ID || '0e2cde5f-b353-468b-9f4e-36835fc60a0e', // Fallback to Google Apps Script owner
          description: 'USDC_EXCHANGE_RATE_RAYDIUM',
          exchangeRate: tdgPriceInUsdc,
          currency: 'USDC',
        },
      },
    };

    // Send PUT request to Wix Data API
    const response = await axios.put(url, payload, {
      headers: {
        Authorization: WIX_API_KEY!,
        'Content-Type': 'application/json',
        'wix-site-id': WIX_SITE_ID || 'd45a189f-d0cc-48de-95ee-30635a95385f', // Fallback to Google Apps Script site ID
        'wix-account-id': WIX_ACCOUNT_ID || '0e2cde5f-b353-468b-9f4e-36835fc60a0e',
      },
    });

    console.log('Wix update response:', JSON.stringify(response.data, null, 2));
    console.log('Successfully updated TDG to USDC exchange rate on Wix:', tdgPriceInUsdc);

    // Verify the update by fetching the current rate
    const verifyResponse = await axios.get(url, {
      headers: {
        Authorization: WIX_API_KEY!,
        'Content-Type': 'application/json',
        'wix-site-id': WIX_SITE_ID || 'd45a189f-d0cc-48de-95ee-30635a95385f',
        'wix-account-id': WIX_ACCOUNT_ID || '0e2cde5f-b353-468b-9f4e-36835fc60a0e',
      },
    });
    const currentRate = verifyResponse.data?.dataItem?.data?.exchangeRate;
    console.log(`Verified current TDG to USDC exchange rate on Wix: ${currentRate} USDC`);

  } catch (err) {
    console.error('Error updating TDG to USDC exchange rate on Wix:', err);
    throw err;
  }
}

/**
 * Fetch the price of 1 TDG in USDC using Raydium's price endpoint or swap quote as fallback.
 * @returns Price of 1 TDG in USDC (decimal).
 */
async function checkTdgToUsdc(): Promise<number> {
  try {
    // Validate mint addresses
    if (!TDG_MINT || !USDC_MINT) {
      throw new Error(`Invalid mint addresses: TDG_MINT=${TDG_MINT}, USDC_MINT=${USDC_MINT}`);
    }

    // Step 1: Try the price endpoint
    const priceEndpoint = `${API_URLS.BASE_HOST}${API_URLS.MINT_PRICE}`;
    console.log(`Fetching price from: ${priceEndpoint} with mint: ${TDG_MINT}`);
    const resp = await axios.get(priceEndpoint, { params: { mints: TDG_MINT } });
    const body = resp.data;
    console.log('Price API response:', JSON.stringify(body, null, 2));

    if (!body.success) {
      throw new Error(`Price API error: ${body.error || JSON.stringify(body)}`);
    }

    const tdgPriceInUsdc = Number(body.data[TDG_MINT]);
    if (tdgPriceInUsdc > 0) {
      console.log(`Price of 1 TDG (via price endpoint): ${tdgPriceInUsdc} USDC`);
      return tdgPriceInUsdc;
    }

    console.warn(`Price endpoint returned 0 or invalid price for TDG: ${tdgPriceInUsdc}. Falling back to swap quote...`);

    // Step 2: Fallback to swap quote
    const TDG_DECIMALS = 9; // TDG decimals (confirmed by inputAmount: 1,000,000,000 = 1 TDG)
    const USDC_DECIMALS = 6; // USDC decimals (standard for mainnet USDC)
    const amountRaw = BigInt(10 ** TDG_DECIMALS).toString(); // 1 TDG in smallest units
    const swapEndpoint = `${API_URLS.SWAP_HOST}${API_URLS.SWAP_COMPUTE}swap-base-in`;
    console.log(`Fetching swap quote from: ${swapEndpoint} with inputMint: ${TDG_MINT}, outputMint: ${USDC_MINT}`);
    const swapResp = await axios.get(swapEndpoint, {
      params: {
        inputMint: TDG_MINT,
        outputMint: USDC_MINT,
        amount: amountRaw,
        slippageBps: SLIPPAGE_BPS,
        txVersion: TX_VERSION,
      },
    });
    const swapData = swapResp.data;
    console.log('Swap quote response:', JSON.stringify(swapData, null, 2));

    if (!swapData.success) {
      throw new Error(`Swap quote API error: ${swapData.error || JSON.stringify(swapData)}`);
    }

    // Convert outputAmount to decimal USDC
    const usdcAmount = Number(swapData.data.outputAmount) / 10 ** USDC_DECIMALS;
    console.log(`Price of 1 TDG (via swap quote): ${usdcAmount} USDC`);
    return usdcAmount;
  } catch (err) {
    console.error('Error fetching TDG to USDC price:', err);
    throw err;
  }
}

/**
 * Fetch the daily TDG buy-back budget (in USDC) from Wix, convert to SOL, and return the SOL amount.
 * @returns SOL amount equivalent to the daily buy-back budget.
 */
async function executeBuyBack(): Promise<string[]> {
  // Fetch budget in USDC from Wix
  const budgetUsdc = await getWixDailyTdgBuybackBudget();
  // Convert USDC budget to SOL
  const solAmount = await checkUsdcToSol(budgetUsdc);
  console.log(`Daily TDG Buy Back: ${budgetUsdc} USDC ≈ ${solAmount} SOL`);

  // Get swap quote
  const swapResponse = await computeSwapQuoteSolToTdg(solAmount);

  // Fetch priority fee tiers
  const { data: feeData } = await axios.get<{ id: string; success: boolean; data: { default: { vh: number; h: number; m: number } } }>(
    `${API_URLS.BASE_HOST}${API_URLS.PRIORITY_FEE}`
  );
  const computeUnitPriceMicroLamports = feeData.data.default.h;

  // Determine swap settings
  const isInputSol = INPUT_MINT === NATIVE_MINT.toBase58();
  const isOutputSol = OUTPUT_MINT === NATIVE_MINT.toBase58();

  // Fetch token accounts for non-SOL tokens
  const { tokenAccounts: allAccounts } = await fetchTokenAccountData();
  let inputAccount: string | undefined;
  let outputAccount: string | undefined;
  if (!isInputSol) {
    const inputTokenAcc = allAccounts.find(acc => acc.mint.toBase58() === INPUT_MINT);
    if (!inputTokenAcc || !inputTokenAcc.publicKey) throw new Error(`No token account found for input mint ${INPUT_MINT}`);
    inputAccount = inputTokenAcc.publicKey.toBase58();
  }
  if (!isOutputSol) {
    const outputTokenAcc = allAccounts.find(acc => acc.mint.toBase58() === OUTPUT_MINT);
    if (!outputTokenAcc || !outputTokenAcc.publicKey) throw new Error(`No token account found for output mint ${OUTPUT_MINT}`);
    outputAccount = outputTokenAcc.publicKey.toBase58();
  }

  // Request swap transaction payloads
  const { data: swapTxData } = await axios.post<{
    id: string;
    version: string;
    success: boolean;
    data: { transaction: string }[];
  }>(`${API_URLS.SWAP_HOST}/transaction/swap-base-in`, {
    computeUnitPriceMicroLamports: String(computeUnitPriceMicroLamports),
    swapResponse,
    txVersion: TX_VERSION,
    wallet: owner.publicKey.toBase58(),
    wrapSol: isInputSol,
    unwrapSol: isOutputSol,
    inputAccount,
    outputAccount,
  });

  // Deserialize transactions
  const txBuffers = swapTxData.data.map(tx => Buffer.from(tx.transaction, 'base64'));
  const transactions = txBuffers.map(buf =>
    TX_VERSION === 'V0' ? VersionedTransaction.deserialize(buf) : Transaction.from(buf)
  );
  // Collect transaction IDs
  const txIds: string[] = [];

  // Sign and send transactions
  console.log(`Sending ${transactions.length} transaction(s)...`);
  for (const tx of transactions) {
    let txId: string;
    if (TX_VERSION !== 'V0') {
      // Legacy transaction: use sendAndConfirmTransaction
      const legacyTx = tx as Transaction;
      legacyTx.sign(owner);
      txId = await sendAndConfirmTransaction(connection, legacyTx, [owner], { skipPreflight: true });
      console.log(`Transaction confirmed: ${txId}`);
    } else {
      // V0 transaction: sign, serialize, and send raw transaction to support VersionedTransaction
      const v0Tx = tx as VersionedTransaction;
      v0Tx.sign([owner]);
      const rawTx = Buffer.from(v0Tx.serialize());
      txId = await sendAndConfirmRawTransaction(connection, rawTx, { skipPreflight: true });
      console.log(`Transaction confirmed: ${txId}`);
    }
    txIds.push(txId);
  }

  console.log('Buyback swap completed. Transaction IDs:', txIds);
  return txIds;
}