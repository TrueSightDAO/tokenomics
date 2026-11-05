#!/bin/bash
# Run script for IRS Tax Compilation

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Virtual environment not found. Running setup..."
    ./setup.sh
fi

# Activate virtual environment
source venv/bin/activate

# Check for credentials
if [ ! -f "credentials.json" ]; then
    echo "ERROR: credentials.json not found!"
    echo "Please copy your service account JSON file to:"
    echo "$SCRIPT_DIR/credentials.json"
    exit 1
fi

# Run the script
echo "Running IRS Tax Compiler..."
echo ""
python3 irs_tax_compiler.py
