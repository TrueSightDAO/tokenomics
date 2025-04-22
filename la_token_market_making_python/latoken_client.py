#!/usr/bin/env python3
"""
Client for interacting with the LATOKEN exchange REST API.
"""

import os
import time
import json
import hmac
import hashlib
import requests

# Base URL for LATOKEN API
"""
Client for interacting with the LATOKEN exchange REST API.
"""

"""
Client for interacting with the LATOKEN exchange REST API.
"""
import os
import requests

"""
Client for interacting with the LATOKEN exchange REST API.
"""
# Base URL for LATOKEN API (default)
DEFAULT_BASE_URL = os.getenv("LATOKEN_BASE_URL", "https://api.latoken.com")
# Default asset IDs for TDG/USDT
DEFAULT_CURRENCY_ID = os.getenv("LATOKEN_CURRENCY_ID", "cbfd4c19-259c-420b-9bb2-498493265648")
DEFAULT_QUOTE_ID = os.getenv("LATOKEN_QUOTE_ID", "0c3a106d-bde3-4c13-a26e-3fd2394529e5")

class LatokenClient:
    """Encapsulates LATOKEN API interactions via currency/quote IDs.

    Supports optional proxy settings via:
      - `proxies`: a dict mapping protocol to proxy URL, e.g.
          { 'http': 'socks5://127.0.0.1:1080', 'https': 'socks5://127.0.0.1:1080' }
      - `proxy`: a single proxy URL applied to both HTTP and HTTPS, e.g.
          'socks5://127.0.0.1:1080'
    """

    def __init__(
        self,
        api_key: str = None,
        api_secret: str = None,
        base_url: str = None,
        currency_id: str = None,
        quote_id: str = None,
        proxies: dict = None,
        proxy: str = None,
    ):
        # API credentials (private endpoints; public endpoints do not require auth)
        self.api_key = api_key or os.getenv("LATOKEN_API_KEY")
        self.api_secret = api_secret or os.getenv("LATOKEN_API_SECRET")
        # Base URL for endpoints
        self.base_url = (base_url or DEFAULT_BASE_URL).rstrip('/')
        # Trading pair asset IDs (use defaults if not provided)
        self.currency_id = currency_id or DEFAULT_CURRENCY_ID
        self.quote_id = quote_id or DEFAULT_QUOTE_ID
        # Determine proxies mapping (proxies dict takes precedence)
        if proxies:
            self.proxies = proxies
        elif proxy:
            self.proxies = {'http': proxy, 'https': proxy}
        else:
            self.proxies = {}
        # Create a requests Session to persist settings (e.g., proxies)
        self.session = requests.Session()
        if self.proxies:
            self.session.proxies.update(self.proxies)

    def get_book(self, limit: int = 50) -> dict:
        """
        Retrieve the order book for the configured trading pair IDs.
        """
        url = f"{self.base_url}/v2/book/{self.currency_id}/{self.quote_id}"
        params = {"limit": limit}
        # Use session (with proxies if configured)
        response = self.session.get(url, params=params)
        response.raise_for_status()
        return response.json()
    
    def calculate_purchase_amount(self, budget: float, limit: int = 50) -> dict:
        """
        Simulate purchasing base currency (TDG) with a USD budget based on the current order book asks.

        Args:
            budget: USD amount available for purchases.
            limit: depth limit for the order book (number of levels to fetch).

        Returns:
            A dict with:
              - total_quantity: float, total TDG units purchaseable with the budget.
              - total_cost: float, total USD spent (<= budget).
              - average_price: float, weighted average price (total_cost/total_quantity).
              - purchases: list of dicts, each with keys:
                  'price': float price per TDG,
                  'quantity': float TDG bought at this price,
                  'cost': float USD spent at this level.
        """
        # Ensure positive budget
        remaining = float(budget)
        if remaining <= 0:
            return {
                'total_quantity': 0.0,
                'total_cost': 0.0,
                'average_price': 0.0,
                'purchases': [],
            }
        # Fetch current order book and normalize asks
        book = self.get_book(limit=limit)
        # support both 'ask' and 'asks' keys
        asks = []
        if isinstance(book, dict):
            if 'asks' in book:
                asks = book.get('asks') or []
            elif 'ask' in book:
                asks = book.get('ask') or []
        purchases = []
        remaining = float(budget)
        total_qty = 0.0
        total_cost = 0.0
        # Iterate through asks (ascending price)
        for level in asks:
            if remaining <= 0:
                break
            price = float(level.get('price', 0))
            qty_available = float(level.get('quantity', 0))
            # cost to buy full available quantity at this price
            cost_full = price * qty_available
            if cost_full <= remaining:
                qty = qty_available
                cost = cost_full
            else:
                # buy partial amount
                qty = remaining / price if price > 0 else 0.0
                cost = qty * price
            if qty <= 0:
                continue
            purchases.append({'price': price, 'quantity': qty, 'cost': cost})
            total_qty += qty
            total_cost += cost
            remaining -= cost
        avg_price = (total_cost / total_qty) if total_qty > 0 else 0.0
        return {
            'total_quantity': total_qty,
            'total_cost': total_cost,
            'average_price': avg_price,
            'purchases': purchases,
        }
    
    def print_purchase_plan(self, budget: float, limit: int = 50):
        """
        Print a formatted purchase plan for TDG based on the USD budget and order book asks.
        """
        result = self.calculate_purchase_amount(budget, limit=limit)
        qty = result.get('total_quantity', 0.0)
        cost = result.get('total_cost', 0.0)
        avg = result.get('average_price', 0.0)
        if qty <= 0:
            print("No TDG to purchase today (budget too low or no asks).")
            return
        print(f"Daily budget (USD): {budget:.6f}")
        print(f"Total TDG purchasable: {qty:.4f} TDG")
        print(f"Total cost (USD): {cost:.4f} USD")
        print(f"Average price (USD/TDG): {avg:.6f}")
        print("Purchase breakdown per ask level:")
        for entry in result.get('purchases', []):
            price = entry.get('price')
            q = entry.get('quantity')
            c = entry.get('cost')
            print(f" - {q:.4f} TDG @ {price:.8f} USD = {c:.4f} USD")
    
    def place_order(
        self,
        side: str,
        quantity: float,
        price: float = None,
        condition: str = "GTC",
        client_order_id: str = None,
    ) -> dict:
        """
        Place a new order. LIMIT if price is provided, otherwise MARKET.

        Args:
            side: 'BUY' or 'SELL'
            quantity: quantity of base currency
            price: price per unit for LIMIT orders
            condition: 'GTC', 'IOC', or 'FOK'
            client_order_id: optional client reference
        Returns:
            Response JSON with order id and status.
        """
        # Determine order type
        otype = 'LIMIT' if price is not None else 'MARKET'
        # Construct payload
        payload = {
            'baseCurrency': self.currency_id,
            'quoteCurrency': self.quote_id,
            'side': side.upper(),
            'condition': condition,
            'type': otype,
            'quantity': str(quantity),
            'timestamp': int(time.time()),
        }
        if otype == 'LIMIT':
            payload['price'] = str(price)
        if client_order_id:
            payload['clientOrderId'] = client_order_id
        body = json.dumps(payload, separators=(',', ':'), ensure_ascii=False)
        # Sign the request
        signature = hmac.new(
            self.api_secret.encode('utf-8'),
            body.encode('utf-8'),
            hashlib.sha512,
        ).hexdigest()
        headers = {
            'X-LA-APIKEY': self.api_key,
            'X-LA-SIGNATURE': signature,
            'Content-Type': 'application/json',
        }
        # Send request using session (with proxies if configured)
        url = f"{self.base_url}/v2/order"
        resp = self.session.post(url, headers=headers, data=body)
        resp.raise_for_status()
        print("Line 227")
        print(resp)
        try:
            return resp.json()
        except ValueError:
            return {'result': resp.text}

def get_order_book(limit: int = 50) -> dict:
    """
    Convenience wrapper using environment-variable credentials for currency/quote IDs.
    """
    client = LatokenClient()
    # Fetch raw order book (keys: 'bid', 'ask', etc.)
    book = client.get_book(limit=limit)
    # Normalize keys: use 'bids' and 'asks' for consistency
    if isinstance(book, dict):
        # Rename 'bid' -> 'bids'
        if 'bid' in book:
            book['bids'] = book.pop('bid') or []
        # Rename 'ask' -> 'asks'
        if 'ask' in book:
            book['asks'] = book.pop('ask') or []
    return book