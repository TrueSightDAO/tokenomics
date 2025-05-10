# TrueSight DAO Governance Ecosystem Automation

This repository contains scripts for automating data management and contribution scoring within the TrueSight DAO Governance (TDG) ecosystem. The project is divided into three main subfolders, each focusing on a specific aspect of the TDG ecosystem:

 - **[google_app_scripts](./google_app_scripts)**: Modern Google Apps Scripts for managing DAO assets and scoring Telegram/WhatsApp chat logs.
 - **[raydium_market_making](./raydium_market_making)**: Market making strategies for the Raydium AMM on Solana. Contains a TypeScript-based implementation (`raydium_type_script/`) (the default working implementation) and a Python-based experimental implementation (`raydium_py/`) (not maintained). See raydium_market_making/README.md for details.
 - **[la_token_market_making_python](./la_token_market_making_python)**: Python-based market making bot for LA_TOKEN tokens, including the main script and a sandbox notebook. Work on this project is currently on hold as the LA_TOKEN internal engineering team has been unresponsive to our outreach to resolve trade execution issues. See la_token_market_making_python/README.md for setup and usage instructions.
 - **[python_scripts](/python_scripts)**: Legacy Python-based scripts for scoring DAO member contributions and updating Agroverse AGL contracts.

## Repository Structure                                                                                                        │

This project is organized into four main subfolders, ordered by active development focus:                                      │

- [google_app_scripts](./google_app_scripts)                                                                                   │
- [raydium_market_making](./raydium_market_making)                                                                             │
- [la_token_market_making_python](./la_token_market_making_python)                                                             │
- [python_scripts](./python_scripts)                                                                                           │

Each subfolder contains a README with detailed setup and usage instructions.                                                   │

## Getting Started

### Setup & Prerequisites

Clone the repository:

```bash
git clone <repository-url>
```

For detailed setup, configuration, and prerequisites, please see the README in the relevant subfolder:

- [python_scripts](./python_scripts/README.md)
- [google_app_scripts](./google_app_scripts/README.md)
- [la_token_market_making_python](./la_token_market_making_python/README.md)
- [raydium_market_making](./raydium_market_making/README.md)

## Security Considerations

- Store API keys securely (e.g., using environment variables for [python_scripts](./python_scripts) or Google Apps Script's Properties Service for [google_app_scripts](./google_app_scripts)).
- Be aware of rate limits for external APIs (OpenAI, Wix, Solana, LATOKEN, xAI, Telegram).
- Validate all external data to prevent processing errors or security issues.

## Contributing

Contributions are welcome! Please submit pull requests or open issues for bug reports, feature requests, or improvements. Ensure changes are tested and documented in the relevant subfolder's `README`. Note that [python_scripts](./python_scripts) is a legacy system, and new development should focus on [google_app_scripts](./google_app_scripts) unless maintaining legacy functionality.

## License

This project is unlicensed. Use and modify at your own risk.