#!/usr/bin/env python3
"""
Simple sandbox script replicating LA_TOKEN_sandbox.ipynb steps:
  - Load environment variables from .env
  - Retrieve daily budget via WIX
  - Fetch LATOKEN order book
  - Display top bids/asks
  - Compute TDG purchase plan based on budget
"""
import os
import sys
from dotenv import load_dotenv

# allow importing local modules
sys.path.append(os.path.dirname(__file__))

# load environment variables from .env in this folder
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '.env'))

from wix_client import get_daily_budget
from latoken_client import LatokenClient, get_order_book

def main():
    # Show which WIX data item ID is configured
    print("WIX_DAILY_BUDGET_DATA_ITEM_ID =", os.getenv("WIX_DAILY_BUDGET_DATA_ITEM_ID"))

    # Retrieve and display daily budget from WIX
    budget = get_daily_budget()
    print("Daily budget from WIX:", budget)

    # Fetch order book from LATOKEN (no proxy)
    book = get_order_book(limit=10)
    bids = book.get('bids', [])[:5]
    asks = book.get('asks', [])[:5]

    print("Top 5 bids:")
    for bid in bids:
        print(bid)
    print("Top 5 asks:")
    for ask in asks:
        print(ask)

    # Compute purchase plan for TDG based on budget
    client = LatokenClient()  # uses env creds, no proxy
    plan = client.calculate_purchase_amount(budget, limit=50)
    qty = plan['total_quantity']
    cost = plan['total_cost']
    avg = plan['average_price']
    print(f"Daily budget (USD): {budget:.6f}")
    print(f"Total TDG purchasable: {qty:.4f} TDG")
    print(f"Total cost (USD): {cost:.4f} USD")
    print(f"Average price (USD/TDG): {avg:.6f}")
    print("Purchase breakdown per ask level:")
    for entry in plan.get('purchases', []):
        price = entry['price']
        q = entry['quantity']
        c = entry['cost']
        print(f" - {q:.4f} TDG @ {price:.8f} USD = {c:.4f} USD")

if __name__ == '__main__':
    main()