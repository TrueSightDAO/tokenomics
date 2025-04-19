# TDG Ecosystem Scripts

This repository contains Google Apps Script projects for managing and analyzing data within the TDG (Token-based Decentralized Governance) ecosystem. The repository is organized into two main subfolders, each focusing on a distinct aspect of the ecosystem:

- [tdg_asset_management](./tdg_asset_management)`: Manages DAO asset data, including off-chain and on-chain balances, sales, and token buy-back budgets.
- [tdg_scoring](./tdg_scoring): Processes and scores Telegram and WhatsApp chat logs to assign TDG tokens based on contributions.

## Repository Structure

- [tdg_asset_management](./tdg_asset_management)\
  Contains a Google Apps Script for managing Decentralized Autonomous Organization (DAO) assets. It integrates with Google Sheets, Wix APIs, Solana blockchain, LATOKEN exchange, and U.S. Treasury yield data to track and update asset balances, TDG token issuance, sales, and buy-back budgets.\
  See detailed README for setup and usage instructions.

- [tdg_scoring](./tdg_scoring)`\
  Contains Google Apps Scripts for importing and scoring chat logs from Telegram and WhatsApp. It uses AI APIs (xAI's Grok and OpenAI) to evaluate contributions and assign TDG tokens, with data stored in Google Sheets and notifications sent via Telegram.\
  See detailed README for setup and usage instructions.

## Getting Started

### Prerequisites

- **Google Account**: Required for Google Apps Script, Google Sheets, and Google Drive access.
- **API Keys**:
  - `WIX_API_KEY` (for `tdg_asset_management`).
  - `XAI_API_KEY` and `OPENAI_API_KEY` (for `tdg_scoring`).
  - `TELEGRAM_API_TOKEN` (for `tdg_scoring`).
- **External Services**:
  - Access to Solana RPC endpoint and LATOKEN API (for `tdg_asset_management`).
  - Telegram Bot setup via BotFather (for `tdg_scoring`).

### Setup Instructions

1. **Clone the Repository**:

   ```bash
   git clone <repository-url>
   ```

   Alternatively, download the repository as a ZIP file and extract it.

2. **Navigate to Subfolders**:

   - For asset management, refer to [tdg_asset_management/README.md](./tdg_asset_management/README.md).
   - For chat log scoring, refer to [tdg_scoring/README.md](./tdg_scoring/README.md).

3. **Follow Subfolder-Specific Instructions**: Each subfolder contains a detailed `README.md` with setup, configuration, and usage instructions specific to its scripts.

### Google Apps Script Deployment

- Open the Google Apps Script editor from a Google Sheet or at script.google.com.
- Copy the relevant `.gs` files from the respective subfolder into your project.
- Configure API keys and other settings as described in the subfolder's `README`.

## Security Considerations

- Store API keys securely using Google Apps Script's Properties Service or an external configuration method.
- Be aware of rate limits for external APIs (Wix, Solana, LATOKEN, xAI, OpenAI, Telegram).
- Validate all external data to prevent processing errors or security issues.

## Contributing

Contributions are welcome! Please submit pull requests or open issues for bug reports, feature requests, or improvements. Ensure changes are tested and documented in the relevant subfolder's `README`.

## License

This project is unlicensed. Use and modify at your own risk.