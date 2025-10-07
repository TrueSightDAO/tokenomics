# TrueSight DAO - Tokenomics Automation & Infrastructure

This repository contains the complete automation infrastructure for managing TrueSight DAO's tokenomics, including contribution scoring, inventory management, market making, and ledger updates.

## 📚 Documentation

### Essential References
- **[SCHEMA.md](./SCHEMA.md)** - Complete Google Sheets schema documentation with column definitions, data types, and script references
- **[API.md](./API.md)** - Comprehensive API documentation for all DApp endpoints and webhooks
- **Schema Validation** - Automated testing to verify schema accuracy: `python_scripts/schema_validation/`

## 🏗️ Repository Structure

### Active Development

#### 1. **[google_app_scripts](./google_app_scripts/)** - Core DAO Automation
Modern Google Apps Scripts for managing all DAO operations:
- **Asset Management** (`tdg_asset_management/`) - Expense processing, digital signatures
- **Inventory Management** (`tdg_inventory_management/`) - Sales, movements, QR code generation
- **Grok Scoring** (`tdg_grok_scoring/`) - AI-powered contribution scoring from Telegram/WhatsApp
- **Proposal System** (`tdg_proposal/`) - DAO proposal management and voting
- **Dashboard Updates** (`tdg_wix_dashboard/`) - Wix metrics and exchange rate updates

See [google_app_scripts/README.md](./google_app_scripts/README.md) for details.

#### 2. **[python_scripts](./python_scripts/)** - Python Utilities & Tools
Python-based tools and utilities:
- **Schema Validation** (`schema_validation/`) - Validates SCHEMA.md accuracy against live data
- **QR Code Generation** (`agroverse_qr_code_generator/`) - Batch QR code generator with branding
- **Asset Management** (`tdg_asset_management/`) - AWS cost tokenization scripts
- **Analysis Tools** (`analysis/`) - Contribution analysis and metrics

See [python_scripts/README.md](./python_scripts/README.md) for setup.

#### 3. **[raydium_market_making](./raydium_market_making/)** - Solana Market Making
Market making strategies for TDG token on Raydium AMM (Solana):
- **TypeScript Implementation** (`raydium_type_script/`) - Primary active implementation
- **Python Implementation** (`raydium_py/`) - Experimental (not maintained)

See [raydium_market_making/README.md](./raydium_market_making/README.md) for configuration.

### On Hold

#### 4. **[la_token_market_making_python](./la_token_market_making_python/)** - LATOKEN Market Making
Python-based market making bot for LATOKEN exchange.  
**Status**: On hold pending LATOKEN engineering team response to trade execution issues.

See [la_token_market_making_python/README.md](./la_token_market_making_python/README.md) for details.

---

## 🚀 Quick Start

### Prerequisites
- **Google Apps Script**: Google account with access to TrueSight DAO spreadsheets
- **Python Scripts**: Python 3.11+, virtual environment
- **Market Making**: Node.js 18+ (Raydium), Python 3.11+ (LATOKEN)

### Clone Repository
```bash
git clone https://github.com/TrueSightDAO/tokenomics.git
cd tokenomics
```

### Schema Validation Setup
Verify your Google Sheets schema matches documentation:
```bash
cd python_scripts
pip install -r requirements.txt
cd schema_validation
# Add your credentials.json file
python test_schema_validation.py
```

See [python_scripts/schema_validation/README.md](./python_scripts/schema_validation/README.md) for detailed setup.

---

## 🔐 Security & Configuration

### Credential Management
- **Google Apps Script**: Use Properties Service for API keys
- **Python Scripts**: Use `.env` files (see `.env.example` in each directory)
- **Never commit credentials** - All credential files are in `.gitignore`

### Required Credentials
- **[Google Sheets API](https://console.cloud.google.com/)** - For schema validation and data access
- **[Wix API](https://dev.wix.com/)** - For managed AGL ledger configurations and dashboard updates
- **[Telegram Bot API](https://core.telegram.org/bots/api)** - For chat log imports and bot interactions
- **[OpenAI API](https://platform.openai.com/)** / **[xAI API](https://x.ai/)** - For AI-powered contribution scoring
- **[Solana RPC](https://solana.com/docs/rpc)** - For Raydium market making
- **[LATOKEN API](https://api.latoken.com/)** - For LATOKEN market making (if resuming)

### API Rate Limits
Be mindful of rate limits for:
- [OpenAI API](https://platform.openai.com/docs/guides/rate-limits) (Grok scoring)
- [Wix Data API](https://dev.wix.com/docs/rest/articles/getting-started/rate-limits) (ledger configs)
- [Telegram Bot API](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this) (message imports)
- [Solana RPC](https://docs.solana.com/cluster/rpc-endpoints) (market making)
- [Google Sheets API](https://developers.google.com/sheets/api/limits) (all read/write operations)

---

## 📊 Key Workflows

### Expense Processing
1. Telegram message → `Telegram Chat Logs` sheet
2. `tdg_expenses_processing.gs` validates and scores
3. Insert into `Scored Expense Submissions`
4. Transfer to appropriate ledger (offchain or managed AGL)

### Sales Processing
1. Telegram message → `Telegram Chat Logs` sheet
2. `process_sales_telegram_logs.gs` parses and validates
3. Insert into `QR Code Sales` sheet
4. Update managed AGL ledgers and/or main offchain ledger

### Contribution Scoring
1. Chat logs collected from Telegram/WhatsApp
2. `grok_scoring_for_telegram_and_whatsapp_logs.gs` scores with AI
3. Results stored in `Scored Chatlogs` (Grok spreadsheet)
4. `transfer_scored_contributions_to_main_ledger.gs` transfers approved scores
5. Updates `Ledger history` for token distribution

---

## 🧪 Testing & Validation

### Schema Validation
```bash
cd python_scripts/schema_validation
python test_schema_validation.py
```

Validates:
- ✅ All spreadsheet IDs and sheet names
- ✅ Column structures match documentation
- ✅ Wix collection accessibility
- ✅ Data integrity checks

### Google Apps Script Testing
Each script includes test functions:
- `testParseAndProcessRow()` - Test individual row processing
- `testLedgerResolution()` - Test dynamic ledger resolution
- `test_*()` - Various unit tests per script

---

## 🗂️ Data Architecture

### Google Sheets
- **Main Ledger** (`1GE7PUq...`) - Contributors, transactions, voting, assets
- **Telegram & Submissions** (`1qbZZhf...`) - Chat logs, expenses, sales, movements
- **Grok Scored** (`1Tbj7H5...`) - AI-scored contributions
- **Managed AGL Ledgers** (Dynamic) - Individual shipment/contract ledgers

### Wix Data Collections
- **AgroverseShipments** - Ledger URLs and configurations
- **ExchangeRate** - Financial metrics and exchange rates
- **Statistics** - Website analytics and metrics

See [SCHEMA.md](./SCHEMA.md) for complete data structure documentation.

---

## 🛠️ Development Guidelines

### Adding New Scripts
1. Add file header with path and description
2. Document in SCHEMA.md under relevant sheets
3. Include test functions
4. Update this README if adding new functionality

### Modifying Schemas
1. Update SCHEMA.md immediately
2. Run schema validation tests
3. Check all dependent scripts (use grep or SCHEMA.md references)
4. Test with existing data before deploying

### Code Style
- **Google Apps Script**: Follow existing patterns, use constants for sheet names
- **Python**: Follow PEP 8, use type hints
- **TypeScript**: Follow existing Raydium patterns

---

## 📈 Active Development Focus

Current priorities (as of 2025):
1. ✅ **Schema Documentation** - Complete and validated
2. 🔄 **Expense Processing** - Dynamic ledger resolution
3. 🔄 **Sales Automation** - AGL ledger updates
4. 📋 **Contribution Scoring** - AI-powered automation
5. 💱 **Market Making** - Raydium AMM optimization

---

## 🤝 Contributing

Contributions are welcome! Please:
1. Check [SCHEMA.md](./SCHEMA.md) for data structure
2. Follow existing code patterns
3. Add tests for new functionality
4. Update documentation
5. Submit pull requests with clear descriptions

**Note**: `python_scripts` contains legacy systems. New development should focus on `google_app_scripts` unless maintaining existing Python functionality.

---

## 📝 License

This project is unlicensed. Use and modify at your own risk.

---

## 🔗 Related Projects

- **[TrueSight DAO DApp](https://github.com/TrueSightDAO/dapp)** - Web interface for DAO operations
- **[Agroverse](https://agroverse.shop)** - Sustainable agriculture marketplace  
- **[SunMint](https://truesight.me/sunmint)** - Partner program platform
- **[TrueSight DAO Website](https://truesight.me)** - Main DAO website
- **[Raydium AMM](https://raydium.io/)** - Solana-based automated market maker
- **[LATOKEN Exchange](https://latoken.com/)** - Cryptocurrency exchange platform

---

## 📞 Support

For questions or issues:
1. Check [SCHEMA.md](./SCHEMA.md) for data structure questions
2. Check [API.md](./API.md) for API endpoint documentation
3. Check subfolder READMEs for specific setup questions
4. Open an issue on GitHub for bugs or feature requests

---

**Last Updated**: 2025-10-07  
**Repository**: https://github.com/TrueSightDAO/tokenomics
