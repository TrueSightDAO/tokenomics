#!/bin/bash
# Setup script for IRS Tax Compilation

set -e

echo "=========================================="
echo "IRS Tax Compilation - Setup"
echo "=========================================="
echo ""

# Check Python version
echo "Checking Python version..."
python3 --version || { echo "Error: Python 3 is required"; exit 1; }
echo "✅ Python 3 found"
echo ""

# Create virtual environment
echo "Creating virtual environment..."
if [ -d "venv" ]; then
    echo "Virtual environment already exists. Skipping..."
else
    python3 -m venv venv
    echo "✅ Virtual environment created"
fi
echo ""

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate
echo "✅ Virtual environment activated"
echo ""

# Install dependencies
echo "Installing dependencies..."
pip install --upgrade pip
pip install -r requirements.txt
echo "✅ Dependencies installed"
echo ""

# Check for credentials
echo "Checking for credentials file..."
if [ -f "credentials.json" ]; then
    echo "✅ credentials.json found"
else
    echo "⚠️  WARNING: credentials.json not found!"
    echo "   Please copy your service account JSON file to:"
    echo "   $(pwd)/credentials.json"
    echo ""
    echo "   Expected file: get-data-io-f6d04fa45a1c.json"
    echo "   Service account: irs-tax-filing@get-data-io.iam.gserviceaccount.com"
fi
echo ""

echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
echo ""
echo "To run the script:"
echo "  1. Activate virtual environment: source venv/bin/activate"
echo "  2. Run script: python3 irs_tax_compiler.py"
echo ""
echo "Or use the run script: ./run.sh"
echo ""
