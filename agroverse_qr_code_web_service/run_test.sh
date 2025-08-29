#!/bin/bash

# Agroverse QR Code Test Script
# This script activates the virtual environment and runs QR code generation tests

echo "🎯 Agroverse QR Code Test Script"
echo "=================================="

# Check if local_config.py exists
if [ ! -f "local_config.py" ]; then
    echo "⚠️  Warning: local_config.py not found"
    echo "   Copy local_config_template.py to local_config.py and add your GitHub token"
    echo "   cp local_config_template.py local_config.py"
    echo "   Then edit local_config.py with your actual token"
    echo ""
fi

# Check if QR_CODE_REPOSITORY_TOKEN is set (fallback)
if [ -z "$QR_CODE_REPOSITORY_TOKEN" ] && [ ! -f "local_config.py" ]; then
    echo "⚠️  Warning: No GitHub token found"
    echo "   Either:"
    echo "   1. Create local_config.py from template, or"
    echo "   2. Set QR_CODE_REPOSITORY_TOKEN environment variable"
    echo "   GitHub upload functionality will not work without it"
    echo ""
fi

# Activate virtual environment
echo "📦 Activating virtual environment..."
source /Users/garyjob/Applications/tokenomics/python_scripts/venv/bin/activate

if [ $? -eq 0 ]; then
    echo "✅ Virtual environment activated successfully"
else
    echo "❌ Failed to activate virtual environment"
    exit 1
fi

# Check if arguments are provided
if [ $# -eq 0 ]; then
    echo "🧪 Running default test..."
    python test_qr_generation.py
else
    echo "🧪 Running custom test with parameters: $@"
    python github_webhook_handler.py --test "$@"
fi

echo ""
echo "✅ Test completed!"
echo "📁 Check the current directory for generated QR code images (*.png)"
