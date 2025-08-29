#!/usr/bin/env python3
"""
Simple test script for QR code generation

Usage:
    python test_qr_generation.py
    python test_qr_generation.py --product-name "My Product" --farm-name "My Farm"
"""

import sys
import os

# Add current directory to path so we can import github_webhook_handler
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from github_webhook_handler import test_qr_generation

def main():
    print("🎯 QR Code Generation Test Script")
    print("=" * 50)
    
    # Example 1: Default test
    print("\n📋 Test 1: Default parameters")
    test_qr_generation()
    
    # Example 2: Cacao product (with agroverse logo)
    print("\n" + "=" * 50)
    print("📋 Test 2: Cacao product (with agroverse logo)")
    test_qr_generation(
        product_name="Test Cacao Product",
        farm_name="Brazilian Cacao Farm",
        state="Bahia",
        country="Brazil",
        year="2024",
        landing_page_url="https://agroverse.com/product/custom-test",
        is_cacao=True
    )
    
    # Example 3: Non-cacao product (with truesight logo)
    print("\n" + "=" * 50)
    print("📋 Test 3: Non-cacao product (with truesight logo)")
    test_qr_generation(
        product_name="Test Non-Cacao Product",
        farm_name="General Farm",
        state="California",
        country="USA",
        year="2024",
        landing_page_url="https://agroverse.com/product/non-cacao-test",
        is_cacao=False
    )
    
    # Example 4: Test with Agroverse QR codes sheet row (requires Google Sheets API)
    print("\n" + "=" * 50)
    print("📋 Test 4: Agroverse QR codes sheet row test (row 708)")
    print("Note: This requires Google Sheets API and credentials")
    print("Tests against results from qr_code_generator.gs")
    test_qr_generation(sheet_row=708)
    
    print("\n✅ All tests completed!")

if __name__ == "__main__":
    main()
