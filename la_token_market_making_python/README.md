# LA_TOKEN Market Making

This folder contains Python code and a Jupyter notebook for implementing a basic market making strategy on the LATOKEN exchange for the TDG/USDT trading pair.

## Policy

This implementation follows the DAO-approved policy ([DAO Proposal #8](https://app.realms.today/dao/2yH36PrWii3RthpHtdJVYaPgBzfcSLe7oevvGRavrut7/proposal/8swdcY3CMx13BfVcx3ffEtHEHVHaUZJxxfrAF7f1HHrc)) for the liquidity pool schedule. Key points:

- **Daily Budget** for open market purchases on LATOKEN:

  ```
  (Last 30 days sales figure / 30 days) × min($TDG trading price on LATOKEN, 1 - US 1 Month Treasury Bill rate)
  ```

Criteria considered:
1. Accommodate the prevailing trading price of $TDG on LATOKEN.
2. Tie purchases to contributor-based activity to limit $TDG dilution.
3. Prevent USD liquidity drain due to inactivity in real-world asset aggregation.
4. Incentivize trading price of $TDG to stay within a reasonable range.
5. Encourage aggregation of real-world assets via contributor activities.

## Environment Variables

Before running the bot, set the following environment variables (or populate `.env` in this folder):

- WIX_API_KEY (required): Your Wix Data API Key for reading the daily budget.
- WIX_DAILY_BUDGET_DATA_ITEM_ID (required): The Data Item ID in the `ExchangeRate` collection that holds the daily budget value.
- LATOKEN_API_KEY (required): Your LATOKEN exchange API key.
- LATOKEN_API_SECRET (required): Your LATOKEN exchange API secret.
- LATOKEN_CURRENCY_ID (required): The LATOKEN asset ID for the base currency (TDG) e.g. cbfd4c19-259c-420b-9bb2-498493265648.
- LATOKEN_QUOTE_ID (required): The LATOKEN asset ID for the quote currency (USDT) e.g. 0c3a106d-bde3-4c13-a26e-3fd2394529e5.
- WIX_ACCOUNT_ID (optional, default provided): Wix account ID for API calls.
- WIX_SITE_ID (optional, default provided): Wix site ID for API calls.

### Bypassing Environment Variables

You can also instantiate the WIX client directly with credentials, without relying on environment variables:
```python
from wix_client import WixClient
client = WixClient(
    api_key="<your API key>",
    daily_budget_item_id="<your data item ID>",
    account_id="<your WIX account ID>",
    site_id="<your WIX site ID>"
)
budget = client.get_daily_budget()
print("Daily budget:", budget)
```

### Pre-requisites
- Python version 3.11.6

### Setup

1. (Optional) Pin your local Python version:
   ```bash
   pyenv local 3.11.6
   ```
2. Install `virtualenv` if you don’t have it:
   ```bash
   pip install virtualenv
   ```
3. Create and activate the virtual environment in this folder:
   ```bash
   virtualenv -p 3.11.6 venv
   source ./venv/bin/activate
   ```
4. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```

### Ubuntu on AWS

If you are deploying on an Ubuntu server (e.g., AWS EC2), you may need to install system packages first:
```bash
sudo apt update && sudo apt install python3-venv python3-pip
```

Then create and activate a virtual environment, upgrade pip, and install project requirements:
```bash
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```
5. (If you hit debugger-related file validation errors):
   ```bash
   export PYDEVD_DISABLE_FILE_VALIDATION=1
   ```

### Usage

#### Market Making Bot
Run the Python script to start continuous market making:
```bash
python market_maker.py --interval 5.0 --config path/to/config.yaml
```

#### Sandbox Notebook
Open the Jupyter notebook for development and testing:
```bash
jupyter notebook --NotebookApp.token='' --NotebookApp.password=''
```
Note: the Notebook server will serve the current folder. If you don’t see this folder (e.g. when launched from another directory), start the server from the repository root to browse all subfolders:
```bash
cd ..
jupyter notebook --NotebookApp.token='' --NotebookApp.password=''
```
Then open `LA_TOKEN_sandbox.ipynb`.
  
### SSH/SOCKS Proxy via Local Port

If your network requires routing API traffic over SSH using a SOCKS proxy, you can forward a local port (e.g. 9999) and configure the client. For example, with a host alias `la_tokens_proxy` in your `~/.ssh/config`:

```ssh-config
Host la_tokens_proxy
  HostName 54.151.185.25
  User ubuntu
  IdentityFile /Users/garyjob/Applications/aws_keypairs/LATOKENS_exchange.pem
```

Start the dynamic SOCKS tunnel on port 9999:
```bash
ssh -D 9999 la_tokens_proxy -N
```

Then instantiate `LatokenClient` with a `proxies` dict:
```python
from latoken_client import LatokenClient

proxies = { 'http': 'socks5://127.0.0.1:9999',
            'https': 'socks5://127.0.0.1:9999' }
client = LatokenClient(api_key, api_secret, proxies=proxies)
```
All subsequent REST calls (`get_book`, `place_order`, etc.) will be sent through the SSH SOCKS proxy.

### Calculating Purchase Amount

The `LatokenClient` now includes a method `calculate_purchase_amount(budget: float, limit: int = 50) -> dict` to determine how much TDG can be purchased with a given USD budget based on the current order book asks.

This method fetches the lowest ask levels up to the specified `limit`, then simulates buying sequentially until the budget is exhausted or no more asks are available. It returns a dictionary with:
  - `total_quantity`: total TDG units purchaseable with the budget
  - `total_cost`: total USD spent (≤ budget)
  - `average_price`: weighted average purchase price (USD per TDG)
  - `purchases`: list of dicts for each price level, each containing:
    - `price`: price per TDG
    - `quantity`: TDG bought at this price
    - `cost`: USD spent at this level

Example:
```python
from latoken_client import LatokenClient

client = LatokenClient()
daily_budget_usd = 1000.0
# Calculate how much TDG to purchase
plan = client.calculate_purchase_amount(daily_budget_usd, limit=50)
print(f"You can buy {plan['total_quantity']:.4f} TDG "
      f"for about ${plan['total_cost']:.2f} at an average price of {plan['average_price']:.6f} USD/TDG")
for entry in plan['purchases']:
    print(f" - {entry['quantity']:.4f} TDG @ {entry['price']:.8f} USD = {entry['cost']:.4f} USD")
```

Alternatively, call the helper method to print the plan directly:
```python
client.print_purchase_plan(daily_budget_usd, limit=50)
```