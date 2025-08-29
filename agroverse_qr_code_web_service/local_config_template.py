# Local Configuration Template
# Copy this file to local_config.py and update with your actual values
# DO NOT commit local_config.py to git (it's in .gitignore)

# GitHub Token for QR Code Repository Access
# Get this from: https://github.com/settings/tokens
# Needs 'repo' scope for both tokenomics and qr_codes repositories
GITHUB_TOKEN = "your_github_token_here"

# Google Sheets API Configuration (optional for local testing)
# Path to your Google Sheets service account credentials JSON file
# For GitHub Actions, use GDRIVE_KEY environment variable instead
GOOGLE_SHEETS_CREDENTIALS_PATH = "../python_scripts/agroverse_qr_code_generator/gdrive_key.json"

# Local Development Settings
LOCAL_DEVELOPMENT = True
