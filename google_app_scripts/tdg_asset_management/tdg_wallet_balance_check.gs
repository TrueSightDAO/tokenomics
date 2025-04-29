/**
 * TDG Wallet Balance Check
 *
 * Provides functions to fetch the balance of a TDG token account on Solana using QuickNode RPC,
 * and to batch-process wallet addresses listed in a Google Sheet.
 */

const creds = getCredentials();

// QuickNode API key and RPC endpoint
var SOLANA_API_KEY = creds.QUICKNODE_API_KEY;

// RPC endpoint via QuickNode
var SOLANA_RPC_URL = "https://side-clean-replica.solana-mainnet.quiknode.pro/" + SOLANA_API_KEY + "/";

// TDG token mint address
var TDG_MINT_ADDRESS = "3wmsJkKWLdFT4tF4rG8zUZQ8M4hKUDtDuJW8q6i9KbgF";

// SANDBOX: URL of the Google Sheet containing wallet addresses (column D) and target balances (column F)
// var WALLET_SHEET_URL = "https://docs.google.com/spreadsheets/d/1E7QDK-0HJtS6i-IZBmI8iOkuHpMmsc4Cab-ysdbJmdY/edit?gid=950541536#gid=950541536";

// PRODUCTION: URL of the Google Sheet containing wallet addresses (column D) and target balances (column F)
var WALLET_SHEET_URL = "https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=950541536#gid=950541536";


/**
 * Fetches the TDG token balance for a given wallet address by querying all token accounts
 * owned by the wallet that match the TDG mint, then summing their UI amounts.
 * @param {string} walletAddress - The public key of the owner's wallet.
 * @return {number} The total TDG token balance in UI units.
 */
function getTdgWalletBalance(walletAddress) {
  var rpcPayload = {
    jsonrpc: "2.0",
    id: 1,
    method: "getTokenAccountsByOwner",
    params: [
      walletAddress,
      { mint: TDG_MINT_ADDRESS },
      { encoding: "jsonParsed" }
    ]
  };
  var options = {
    method: "POST",
    contentType: "application/json",
    payload: JSON.stringify(rpcPayload)
  };
  var response = UrlFetchApp.fetch(SOLANA_RPC_URL, options);
  var data = JSON.parse(response.getContentText());
  var accounts = data.result.value;
  var balance = accounts.reduce(function(sum, acct) {
    return sum + acct.account.data.parsed.info.tokenAmount.uiAmount;
  }, 0);
  Logger.log("TDG Wallet balance for " + walletAddress + ": " + balance);
  return balance;
}

/**
 * Reads wallet addresses from column D of the sheet accessed via WALLET_SHEET_URL,
 * starting at row 5 (row 4 is header), and writes their TDG balances to column F.
 * If the wallet address is blank, clears the corresponding balance cell in column F.
 */
function updateTdgWalletBalancesFromSheet() {
  var ss = SpreadsheetApp.openByUrl(WALLET_SHEET_URL);
  // Select the "Contributors voting weight" sheet by name
  var sheet = ss.getSheetByName("Contributors voting weight");
  if (!sheet) {
    throw new Error('Sheet "Contributors voting weight" not found');
  }
  var lastRow = sheet.getLastRow();
  // Only process rows starting from row 5 (row 4 is header)
  if (lastRow < 5) {
    Logger.log("No wallet addresses found in column D starting at row 5");
    return;
  }
  var numRows = lastRow - 4;
  // Read addresses from column D, rows 5 through lastRow
  var addresses = sheet.getRange(5, 4, numRows, 1).getValues();
  for (var j = 0; j < addresses.length; j++) {
    var addr = addresses[j][0];
    var targetCell = sheet.getRange(j + 5, 6); // column F
    if (addr && typeof addr === "string" && addr.trim() !== "") {
      var bal = getTdgWalletBalance(addr);
      targetCell.setValue(bal);
      Logger.log("Address (row " + (j + 5) + "): " + addr + " => Balance: " + bal);
    } else {
      // No wallet address; clear balance cell
      targetCell.setValue("");
    }
  }
}

/**
 * Prompts for a Solana wallet address and displays the TDG balance.
 */
function testGetTdgBalance() {
  var address = "h6HDCz49qbSinytFj1p3GyxkD4QxwWhKZawDzZ2NyTW";
  var balance = getTdgWalletBalance(address);
  Logger.log("TDG balance for " + address + ": " + balance);
}