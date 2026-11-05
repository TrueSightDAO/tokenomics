#!/usr/bin/env python3
"""
buyback.py - Script to perform token buyback on Solana via a specified AMM pool.

Requires a .env file with:
    RPC_URL=<QuikNode RPC URL>
    PRIVATE_KEY_BASE58=<base58-encoded secret key> OR
    KEYPAIR_PATH=<path to Solana keypair JSON>
    POOL_ID=<AMM pool address (e.g., Raydium pool ID)>
    TOKEN_MINT=<SPL token mint address to buy>
    WIX_API_KEY=<Wix Data API key>
    WIX_DAILY_TDG_BUYBACK_ITEM_ID=<Wix dataItem ID for daily budget>
    WIX_DATA_COLLECTION_ID=<Wix data collection ID>
    # For Wix authentication, set either an account-scoped or site-scoped ID:
    WIX_ACCOUNT_ID=<Wix account/tenant ID>
    # Or if your API key is site-scoped:
    # WIX_SITE_ID=<Your Wix site ID>

Install dependencies:
    pip install python-dotenv solana
"""

import os
import sys
import json
import urllib.request
import requests

from dotenv import load_dotenv
from solana.rpc.api import Client
from raydium.cpmm import buy as cpmm_buy
from raydium.amm_v4 import buy as v4_buy
from utils.pool_utils import fetch_amm_v4_pool_keys

# from solana.keypair import Keypair
# from solana.publickey import PublicKey

# def load_keypair(path: str) -> Keypair:
#     """
#     Load a Solana keypair from a JSON file containing the secret key array.
#     """
#     with open(path, 'r') as f:
#         data = json.load(f)
#     secret_key = bytes(data)
#     return Keypair.from_secret_key(secret_key)

def buyback():
    budget = get_wix_daily_tdg_buyback_budget()
    sol_to_use = check_usdc_to_sol(budget)

    pair_address = os.getenv("POOL_ID")
    if not pair_address:
        print("Missing POOL_ID environment variable")
        sys.exit(1)

    slippage = int(os.getenv("SLIPPAGE", "5"))

    # Try CLMM (V4) first; if not found, fall back to CPMM
    pool_v4 = fetch_amm_v4_pool_keys(pair_address)
    print("Line 60")
    print(pool_v4)
    if pool_v4 is not None:
        print(f"Detected CLMM V4 pool {pair_address}, using amm_v4.buy")
        success = v4_buy(pair_address, sol_to_use, slippage)
    else:
        print(f"No V4 pool found for {pair_address}, using cpmm.buy")
        success = cpmm_buy(pair_address, sol_to_use, slippage)

    if not success:
        print("Buy transaction failed")
        sys.exit(1)

    print("Buyback buy transaction succeeded")
    return success
    

def get_wix_daily_tdg_buyback_budget() -> float:
    """
    Fetch the daily TDG buy-back budget (in USDC) from Wix Data API.
    """
    api_key = os.getenv("WIX_API_KEY")
    data_item_id = os.getenv("WIX_DAILY_TDG_BUYBACK_ITEM_ID")
    data_collection_id = os.getenv("WIX_DATA_COLLECTION_ID")
    account_id = os.getenv("WIX_ACCOUNT_ID")
    site_id = os.getenv("WIX_SITE_ID")

    missing = []
    if not api_key:
        missing.append("WIX_API_KEY")
    if not data_item_id:
        missing.append("WIX_DAILY_TDG_BUYBACK_ITEM_ID")
    if not data_collection_id:
        missing.append("WIX_DATA_COLLECTION_ID")
    if not (account_id or site_id):
        missing.append("WIX_ACCOUNT_ID or WIX_SITE_ID")
    if missing:
        raise RuntimeError(f"Missing Wix env vars: {', '.join(missing)}")

    # Use the Wix Data API endpoint for fetching a specific item by its collection and item IDs
    url = f"https://www.wixapis.com/wix-data/v2/items/{data_item_id}?dataCollectionId={data_collection_id}"
    
    headers = {
        "Authorization": api_key,
        "Content-Type": "application/json",
        "wix-site-id": site_id,
        "wix-account-id": account_id,
    }

    req = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(req) as resp:
        body = resp.read()
    data = json.loads(body)
    try:
        budget = data["dataItem"]["data"]["exchangeRate"]
    except KeyError:
        raise RuntimeError(f"Unexpected Wix response format: {data}")
    print(f"Daily TDG Buy Back Budget on Wix: {budget}")
    return float(budget)

def check_usdc_to_sol(usdc_amount: float) -> float:
    """
    Check estimated SOL output for a given USDC input by querying Raydium V3 REST API.
    """
    import os, json, urllib.request, urllib.parse

    # Constants
    USDC_MINT = os.getenv("USDC_MINT")
    WSOL_MINT = "So11111111111111111111111111111111111111112"
    url = "https://api-v3.raydium.io/mint/price"
    params = {
        "mints": "So11111111111111111111111111111111111111112"
    }

    response = requests.get(url, params=params)

    # Check if the request was successful
    if response.status_code == 200:
        data = response.json()
        if data.get("success"):
            sol_price = data["data"]["So11111111111111111111111111111111111111112"]
            amount_of_sol = usdc_amount / float(sol_price)
            print(f"To purchase {amount_of_sol} SOL for buyback")
            return amount_of_sol

        else:
            print("Error:", data.get("error"))
    else:
        print(f"Failed to fetch data. Status code: {response.status_code}")
    
    
import argparse
import sys

def cli():
    parser = argparse.ArgumentParser(description="Solana token buyback tool")
    subparsers = parser.add_subparsers(dest="command")

    # Subcommand: budget
    subparsers.add_parser("budget", help="Fetch daily TDG buyback budget from Wix")

    # Subcommand: buyback
    subparsers.add_parser("buyback", help="Execute the buyback via AMM pool using Wix budget")

    # Subcommand: check
    parser_check = subparsers.add_parser("check", help="Check USDC to SOL conversion rate via Raydium API")
    parser_check.add_argument("amount", type=float, help="Amount of USDC to convert to SOL")

    args = parser.parse_args()
    if args.command == "budget":
        load_dotenv()
        try:
            budget = get_wix_daily_tdg_buyback_budget()
            print(budget)
        except Exception as e:
            print(f"Error fetching Wix buyback budget: {e}")
            sys.exit(1)
    elif args.command == "buyback":
        load_dotenv()
        buyback()
    elif args.command == "check":
        load_dotenv()
        try:
            sol_amount = check_usdc_to_sol(args.amount)
            print(sol_amount)
            sys.exit(0)
        except Exception as e:
            print(f"Error checking USDC to SOL rate: {e}")
            sys.exit(1)
    else:
        parser.print_help()

if __name__ == "__main__":
    cli()