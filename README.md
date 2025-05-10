# TrueSight DAO Governance Ecosystem Automation

This repository contains scripts for automating data management and contribution scoring within the TrueSight DAO Governance (TDG) ecosystem. The project is divided into three main subfolders, each focusing on a specific aspect of the TDG ecosystem:

 - **[python_scripts](/python_scripts)**: Legacy Python-based scripts for scoring DAO member contributions and updating Agroverse AGL contracts.
 - **[google_app_scripts](./google_app_scripts)**: Modern Google Apps Scripts for managing DAO assets and scoring Telegram/WhatsApp chat logs.
 - **[la_token_market_making_python](./la_token_market_making_python)**: Python-based market making bot for LA_TOKEN tokens, including the main script and a sandbox notebook. Work on this project is currently on hold as the LA_TOKEN internal engineering team has been unresponsive to our outreach to resolve trade execution issues. See la_token_market_making_python/README.md for setup and usage instructions.
 - **[raydium_market_making](./raydium_market_making)**: Market making strategies for the Raydium AMM on Solana. Contains both a Python-based experimental implementation (`raydium_py/`) and a TypeScript-based implementation (`raydium_type_script/`). The Python approach did not work reliably; the TypeScript version is the default working implementation. See raydium_market_making/README.md for details.

## Repository Structure

- **[python_scripts](./python_scripts)**\
  **Legacy System**: Contains Python scripts and Jupyter Notebooks for scoring TDG member contributions from WhatsApp chat logs using OpenAI's API. It also handles updates to Agroverse AGL contracts. The scripts process chat logs stored in a `data` folder and output results to an `analysis` folder. This represents an older implementation of the contribution scoring system.\
  See python_scripts/README.md for setup and usage instructions.

- **[google_app_scripts](./google_app_scripts)**\
  Contains Google Apps Scripts organized into two submodules: [tdg_asset_management](./google_app_scripts/tdg_asset_management) for managing TDG asset data (off-chain and on-chain balances, sales, and token buy-back budgets) and [tdg_scoring](./google_app_scripts/tdg_scoring) for processing and scoring Telegram/WhatsApp chat logs using xAI's Grok and OpenAI APIs. Data is stored in Google Sheets, with notifications sent via Telegram.\
  See google_app_scripts/README.md for setup and usage instructions.
 
- **[la_token_market_making_python](./la_token_market_making_python)**\\
  Python-based market making bot for LA_TOKEN tokens, including the main script and a sandbox notebook. Work on this project is currently on hold as the LA_TOKEN internal engineering team has been unresponsive to our outreach to resolve trade execution issues. See la_token_market_making_python/README.md for setup and usage instructions.

- **[raydium_market_making](./raydium_market_making)**\\
  Market making strategies for the Raydium AMM on Solana. Contains both a Python-based experimental implementation (`raydium_py`) and a TypeScript-based implementation (`raydium_type_script`). The Python approach did not work reliably; the TypeScript version is the default working implementation. See raydium_market_making/README.md for details.

## Getting Started

### Prerequisites

- **Python Environment** (for [python_scripts](./python_scripts)):
  - Python 3.11.6
  - Virtualenv for dependency management
  - OpenAI API key (`OPENAI_API_KEY`)
- **Google Account** (for [google_app_scripts](./google_app_scripts)):
  - Access to Google Apps Script, Google Sheets, and Google Drive
  - API keys: `WIX_API_KEY`, `XAI_API_KEY`, `OPENAI_API_KEY`, `TELEGRAM_API_TOKEN`
- **External Services**:
  - Solana RPC endpoint and LATOKEN API (for [google_app_scripts/tdg_asset_management](./google_app_scripts/tdg_asset_management))
  - Telegram Bot setup via BotFather (for [google_app_scripts/tdg_scoring](./google_app_scripts/tdg_scoring))

### Setup Instructions

1. **Clone the Repository**:

   ```bash
   git clone <repository-url>
   ```

   Alternatively, download the repository as a ZIP file and extract it.

2. **Navigate to Subfolders**:

   - For legacy Python-based contribution scoring and AGL contract updates, refer to python_scripts/README.md.
    - For modern Google Apps Script-based asset management and chat log scoring, refer to google_app_scripts/README.md.
    - For the LA_TOKEN market making bot and sandbox, refer to la_token_market_making_python/README.md.

3. **Follow Subfolder-Specific Instructions**:

   - Each subfolder contains a detailed `README.md` with setup, configuration, and usage instructions specific to its scripts.

## Security Considerations

- Store API keys securely (e.g., using environment variables for [python_scripts](./python_scripts) or Google Apps Script's Properties Service for [google_app_scripts](./google_app_scripts)).
- Be aware of rate limits for external APIs (OpenAI, Wix, Solana, LATOKEN, xAI, Telegram).
- Validate all external data to prevent processing errors or security issues.

## Contributing

Contributions are welcome! Please submit pull requests or open issues for bug reports, feature requests, or improvements. Ensure changes are tested and documented in the relevant subfolder's `README`. Note that [python_scripts](./python_scripts) is a legacy system, and new development should focus on [google_app_scripts](./google_app_scripts) unless maintaining legacy functionality.

## License

This project is unlicensed. Use and modify at your own risk.