#!/usr/bin/env python3
"""
Client for interacting with WIX Data APIs to retrieve stored values like the daily budget.
"""
import os
import requests

# Base configuration
WIX_API_URL = "https://www.wixapis.com/wix-data/v2/items"
DATA_COLLECTION_ID = "ExchangeRate"

class WixClient:
    """Encapsulates Wix Data API interactions."""

    def __init__(
        self,
        api_key: str = None,
        daily_budget_item_id: str = None,
        account_id: str = None,
        site_id: str = None,
    ):
        # API Key
        self.api_key = api_key or os.getenv("WIX_API_KEY")
        if not self.api_key:
            raise RuntimeError("WIX_API_KEY must be provided via constructor or environment")

        # Daily Budget Data Item ID
        self.daily_budget_item_id = (
            daily_budget_item_id
            or os.getenv("WIX_DAILY_BUDGET_DATA_ITEM_ID")
        )
        if not self.daily_budget_item_id:
            raise RuntimeError(
                "WIX_DAILY_BUDGET_DATA_ITEM_ID must be provided via constructor or environment"
            )

        # Account and site identifiers
        self.account_id = (
            account_id or os.getenv("WIX_ACCOUNT_ID")
            or "0e2cde5f-b353-468b-9f4e-36835fc60a0e"
        )
        self.site_id = (
            site_id or os.getenv("WIX_SITE_ID")
            or "d45a189f-d0cc-48de-95ee-30635a95385f"
        )

    def get_request_headers(self) -> dict:
        """Return headers for Wix Data API requests."""
        return {
            "Authorization": self.api_key,
            "Content-Type": "application/json",
            "wix-account-id": self.account_id,
            "wix-site-id": self.site_id,
        }

    def get_daily_budget(self) -> float:
        """Fetch the current daily budget from Wix."""
        url = (
            f"{WIX_API_URL}/{self.daily_budget_item_id}"
            f"?dataCollectionId={DATA_COLLECTION_ID}"
        )
        response = requests.get(url, headers=self.get_request_headers())
        response.raise_for_status()
        data = response.json()
        return data["dataItem"]["data"]["exchangeRate"]

def get_daily_budget():
    """Retrieve the current daily budget using environment variables."""
    client = WixClient()
    return client.get_daily_budget()