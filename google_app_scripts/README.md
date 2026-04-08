# Google Apps Scripts for TrueSight DAO Ecosystem

This repository contains Google Apps Script projects that power the TrueSight DAO Decentralized Governance ecosystem. Each folder contains specialized scripts for different aspects of the DAO operations, from asset management to content scheduling.

## Source of truth for Google (clasp)

**`clasp_mirrors/<scriptId>/` is the canonical working tree on your machine for Apps Script.** Use `clasp pull` / `clasp push` only from that folder. Git tracks each mirror’s **`.clasp.json`**, plus **`PROJECT_INDEX.md`** (Google **project title** → `scriptId` → folder + editor link), **`MIGRATION_CHECKLIST.tsv`** / **`MANIFEST.json`** / **README** — not `*.js` or `appsscript.json` (pull those after clone; see [`clasp_mirrors/README.md`](../clasp_mirrors/README.md)).

**`google_app_scripts/**` here is reference / human-friendly layout** (split `.gs` files, READMEs, headers pointing at GitHub). It is not wired to clasp anymore. Do not add clasp pull artifacts here (`Code.js`, `appsscript.json`, `Credentials*.js`); they are **gitignored** and belong only under **`clasp_mirrors/<scriptId>/`**. When changing production code, edit (or merge into) the corresponding mirror tree, push to Google, and optionally backport split `.gs` files here for readability.

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
- **[holistic_hit_list_store_history](./holistic_hit_list_store_history/)** - Read-only web API for the holistic wellness hit list: store autocomplete and interaction history for the DApp human-in-the-loop email workflow
- **[newsletter_subscriber_sync](./newsletter_subscriber_sync/)** - Daily (time-driven) sync into **Agroverse News Letter Subscribers** from Email Agent Suggestions, Agroverse QR codes, and Hit List rows with Status **Partnered**

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

- Prefer **clasp** from **`clasp_mirrors/<scriptId>/`** (see above). Do not rely on copying only from this folder into the editor unless you are bootstrapping a brand-new project.
- For manual setup: open script.google.com (or the bound script), then align content with the mirror or these reference `.gs` files.
- Configure API keys and other settings as described in each subfolder’s `README` (use Script Properties in production).

## Security Considerations

- Store API keys securely using Google Apps Script's Properties Service or an external configuration method.
- Be aware of rate limits for external APIs (Wix, Solana, LATOKEN, xAI, OpenAI, Telegram).
- Validate all external data to prevent processing errors or security issues.

## Contributing

Contributions are welcome! Please submit pull requests or open issues for bug reports, feature requests, or improvements. Ensure changes are tested and documented in the relevant subfolder's `README`.

## License

This project is unlicensed. Use and modify at your own risk.
