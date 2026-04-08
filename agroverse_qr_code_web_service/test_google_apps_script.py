#!/usr/bin/env python3
"""
Test script for Google Apps Script endpoints
"""

import requests
import json

# Google Apps Script URL
GAS_URL = "https://script.google.com/macros/s/AKfycbySJ86OcVsk5gETTiJ-CY-zBZGHAQoZ8yVW-buxXMjOI9eEc3HP7AicHhtNICHoJo1z/exec"

def test_endpoint(action, params=None):
    """Test a Google Apps Script endpoint"""
    if params is None:
        params = {}
    
    params['action'] = action
    
    print(f"\n🧪 Testing {action} endpoint...")
    print(f"URL: {GAS_URL}")
    print(f"Params: {params}")
    
    try:
        response = requests.get(GAS_URL, params=params, timeout=30)
        print(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            try:
                data = response.json()
                print(f"Response: {json.dumps(data, indent=2)}")
                return data
            except json.JSONDecodeError:
                print(f"Response (not JSON): {response.text[:500]}...")
                return None
        else:
            print(f"Error Response: {response.text[:500]}...")
            return None
            
    except Exception as e:
        print(f"Request failed: {e}")
        return None

def main():
    """Test all endpoints"""
    print("🚀 Testing Google Apps Script Endpoints")
    print("=" * 50)
    
    # Test list endpoint
    list_result = test_endpoint('list')
    
    # Test search endpoint with common term
    search_result = test_endpoint('search', {'product_name': '2024'})
    
    # Test search endpoint with empty string
    search_empty_result = test_endpoint('search', {'product_name': ''})
    
    # Summary
    print("\n" + "=" * 50)
    print("📊 Test Summary")
    print("=" * 50)
    
    if list_result and list_result.get('status') == 'success':
        print("✅ List endpoint: WORKING")
        currencies = list_result.get('data', {}).get('currencies', [])
        print(f"   Found {len(currencies)} currencies")
    else:
        print("❌ List endpoint: FAILED")
    
    if search_result and search_result.get('status') == 'success':
        print("✅ Search endpoint (2024): WORKING")
        matches = search_result.get('data', {}).get('matches', [])
        print(f"   Found {len(matches)} matches")
    else:
        print("❌ Search endpoint (2024): FAILED")
    
    if search_empty_result and search_empty_result.get('status') == 'success':
        print("✅ Search endpoint (empty): WORKING")
        matches = search_empty_result.get('data', {}).get('matches', [])
        print(f"   Found {len(matches)} matches")
    else:
        print("❌ Search endpoint (empty): FAILED")

if __name__ == "__main__":
    main()
