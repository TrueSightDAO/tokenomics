# Google Apps Scripts for TrueSight DAO Ecosystem

This repository contains Google Apps Script projects that power the TrueSight DAO Decentralized Governance ecosystem. Each folder contains specialized scripts for different aspects of the DAO operations, from asset management to content scheduling.

## 📁 Repository Structure

### Core DAO Management
- **[tdg_asset_management](./tdg_asset_management/)** - Manages DAO asset data, including off-chain and on-chain balances, sales, and token buy-back budgets
- **[tdg_inventory_management](./tdg_inventory_management/)** - Handles inventory movements, warehouse management, and asset tracking across ledgers
- **[tdg_proposal](./tdg_proposal/)** - Manages proposal workflows and governance processes

### Content & Communication
- **[tdg_scoring](./tdg_scoring/)** - Processes and scores Telegram and WhatsApp chat logs to assign TDG tokens based on contributions
- **[agroverse_qr_codes](./agroverse_qr_codes/)** - Manages QR code generation and tracking for agricultural products
- **[webhooks](./webhooks/)** - Handles webhook integrations for external service communications

### External Services
- **[agroverse_qr_code_web_service](./agroverse_qr_code_web_service/)** - Standalone web service for QR code operations and currency management

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

   - **Core DAO Management**:
     - [tdg_asset_management/README.md](./tdg_asset_management/README.md) - Asset management and financial tracking
     - [tdg_inventory_management/README.md](./tdg_inventory_management/README.md) - Inventory and warehouse management
     - [tdg_proposal/README.md](./tdg_proposal/README.md) - Proposal and governance workflows
   
   - **Content & Communication**:
     - [tdg_scoring/README.md](./tdg_scoring/README.md) - Chat log scoring and TDG token assignment
     - [agroverse_qr_codes/README.md](./agroverse_qr_codes/README.md) - QR code management for agricultural products
     - [webhooks/README.md](./webhooks/README.md) - Webhook integrations
   
   - **External Services**:
     - [agroverse_qr_code_web_service/README.md](./agroverse_qr_code_web_service/README.md) - QR code web service and currency management

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
