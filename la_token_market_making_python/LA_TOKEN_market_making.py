#!/usr/bin/env python3
"""
LA_TOKEN Market Making Bot

This script implements a basic market making strategy for LA_TOKEN tokens.
"""

import argparse
import logging
import time
import os
import sys
# Load environment variables from a .env file in this directory
from dotenv import load_dotenv
local_env = os.path.join(os.path.dirname(__file__), '.env')
load_dotenv(dotenv_path=local_env)
# allow importing local modules in this folder
sys.path.append(os.path.dirname(__file__))
from la_token_market_making_python.wix_client import get_daily_budget
from la_token_market_making_python.latoken_client import LatokenClient

def parse_args():
    parser = argparse.ArgumentParser(
        description="LA_TOKEN Market Making Bot"
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=5.0,
        help="Time between market making cycles in seconds",
    )
    parser.add_argument(
        "--config",
        type=str,
        default=None,
        help="Path to configuration file (optional)",
    )
    return parser.parse_args()

class MarketMaker:
    """Core market making logic for LA_TOKEN."""

    def __init__(self, interval: float):
        self.interval = interval
        # Initialize LATOKEN client (uses LATOKEN_API_KEY and LATOKEN_API_SECRET from env or config)
        self.latoken = LatokenClient()
        # TODO: Initialize other exchange/API clients and strategy parameters here

    def get_daily_budget(self):
        """
        Retrieve the daily budget allocated from WIX.
        """
        try:
            budget = get_daily_budget()
            logging.info("Retrieved daily budget from WIX: %s", budget)
            return budget
        except Exception as e:
            logging.error("Failed to retrieve daily budget from WIX: %s", e)
            return None
    
    def fetch_order_book(self, pair: str = "TDG_USDT", limit: int = 50):
        """
        Fetch the order book for a given trading pair from LATOKEN.
        """
        try:
            book = self.latoken.get_order_book(pair=pair, limit=limit)
            bids = book.get("bids", [])
            asks = book.get("asks", [])
            logging.info(
                "Fetched order book for %s: %d bids, %d asks", pair, len(bids), len(asks)
            )
            return book
        except Exception as e:
            logging.error("Error fetching order book from LATOKEN: %s", e)
            return None

    def run_cycle(self):
        """
        Run a single market making cycle:
        - Fetch order book
        - Compute bid and ask prices
        - Place limit orders
        """
        logging.info("Running market making cycle")
        # fetch the DAO-approved daily budget from WIX
        budget = self.get_daily_budget()
        if budget is not None:
            logging.info("Daily budget is %s", budget)
        # fetch the current order book from LATOKEN
        order_book = self.fetch_order_book()
        # TODO: Implement strategy steps using budget and order book data
        pass

    def start(self):
        """Begin the continuous market making loop."""
        logging.info(
            "Starting LA_TOKEN market making bot with interval %s seconds", self.interval
        )
        try:
            while True:
                self.run_cycle()
                time.sleep(self.interval)
        except KeyboardInterrupt:
            logging.info("Market making bot stopped by user.")

def main():
    args = parse_args()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s: %(message)s",
    )
    mm = MarketMaker(interval=args.interval)
    mm.start()

if __name__ == "__main__":
    main()