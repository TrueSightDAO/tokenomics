#!/usr/bin/env python3
"""
Script to update "Agroverse SKUs" Google Sheet with product information from agroverse.shop

This script extracts product data from agroverse_shop/js/products.js and updates
the Google Sheet directly using the Google Sheets API.
"""

import json
import re
import sys
from pathlib import Path
import gspread
from google.oauth2.service_account import Credentials

# Configuration
SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU'
SHEET_NAME = 'Agroverse SKUs'

# Path to products.js file
PRODUCTS_JS_FILE = Path('/Users/garyjob/Applications/agroverse_shop/js/products.js')

# Path to service account JSON (adjust if needed)
SERVICE_ACCOUNT_FILE = Path('/Users/garyjob/Applications/agroverse_shop/google-service-account.json')

def parse_products_js(products_js_path):
    """
    Parse products.js file and extract product data
    """
    products = {}
    
    if not products_js_path.exists():
        print(f"Error: {products_js_path} not found")
        return products
    
    with open(products_js_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Extract the PRODUCTS object using regex
    # Look for window.PRODUCTS = { ... };
    pattern = r'window\.PRODUCTS\s*=\s*({[^}]+(?:{[^}]*}[^}]*)*});'
    match = re.search(pattern, content, re.DOTALL)
    
    if not match:
        print("Error: Could not find window.PRODUCTS object in products.js")
        return products
    
    products_str = match.group(1)
    
    # Parse the JavaScript object (this is a simplified parser)
    # Extract individual product entries
    product_pattern = r"['\"]([^'\"]+)['\"]:\s*{([^}]+(?:{[^}]*}[^}]*)*)}"
    
    for product_match in re.finditer(product_pattern, products_str, re.DOTALL):
        product_id = product_match.group(1)
        product_body = product_match.group(2)
        
        product_data = {}
        
        # Extract fields
        field_patterns = {
            'productId': r"productId:\s*['\"]([^'\"]+)['\"]",
            'name': r"name:\s*['\"]([^'\"]+)['\"]",
            'price': r"price:\s*([0-9.]+)",
            'weight': r"weight:\s*([0-9.]+)",
            'image': r"image:\s*['\"]([^'\"]+)['\"]",
            'category': r"category:\s*['\"]([^'\"]+)['\"]",
            'shipment': r"shipment:\s*['\"]([^'\"]+)['\"]",
            'farm': r"farm:\s*['\"]([^'\"]+)['\"]"
        }
        
        for field, pattern in field_patterns.items():
            field_match = re.search(pattern, product_body)
            if field_match:
                value = field_match.group(1)
                if field in ['price', 'weight']:
                    try:
                        product_data[field] = float(value)
                    except ValueError:
                        product_data[field] = 0 if field == 'price' else ''
                else:
                    product_data[field] = value
        
        # Set defaults
        product_data.setdefault('productId', product_id)
        product_data.setdefault('name', '')
        product_data.setdefault('price', 0)
        product_data.setdefault('weight', '')
        product_data.setdefault('image', '')
        product_data.setdefault('category', '')
        product_data.setdefault('shipment', '')
        product_data.setdefault('farm', '')
        
        products[product_id] = product_data
    
    return products


def get_products_data():
    """
    Get products data - try parsing from JS file, fallback to hardcoded data
    """
    products = parse_products_js(PRODUCTS_JS_FILE)
    
    if not products:
        # Fallback: hardcoded product data
        print("Warning: Could not parse products.js, using hardcoded data")
        products = {
            'ceremonial-cacao-paulo-s-la-do-sitio-farm-200g': {
                'productId': 'ceremonial-cacao-paulo-s-la-do-sitio-farm-200g',
                'name': 'Ceremonial Cacao – La do Sitio Farm, Pará Brazil, 2024 (200g)',
                'price': 25.00,
                'weight': 7.05,
                'image': '/assets/images/products/la-do-sitio-farm.jpg',
                'category': 'retail',
                'shipment': 'AGL8',
                'farm': "Paulo's Farm, Pará"
            },
            'taste-of-rainforest-caramelized-cacao-beans': {
                'productId': 'taste-of-rainforest-caramelized-cacao-beans',
                'name': 'Taste of Rainforest - 200 grams Caramelized Cacao Beans',
                'price': 25.00,
                'weight': 7.05,
                'image': '/assets/images/products/taste-of-rainforest.jpeg',
                'category': 'retail',
                'shipment': 'AGL10',
                'farm': 'Capela Velha Fazenda'
            },
            'oscar-bahia-ceremonial-cacao-200g': {
                'productId': 'oscar-bahia-ceremonial-cacao-200g',
                'name': "Ceremonial Cacao – Oscar's Farm, Bahia Brazil, 2024 (200g)",
                'price': 25.00,
                'weight': 7.05,
                'image': '/assets/images/products/oscars-farm.jpeg',
                'category': 'retail',
                'shipment': 'AGL4',
                'farm': "Oscar's Farm, Bahia"
            },
            '8-ounce-organic-cacao-nibs': {
                'productId': '8-ounce-organic-cacao-nibs',
                'name': 'Amazon Rainforest Regenerative 8 Ounce Organic Cacao Nibs',
                'price': 25.00,
                'weight': 8.0,
                'image': '/assets/images/products/cacao-nibs.jpeg',
                'category': 'retail',
                'shipment': 'AGL4',
                'farm': "Oscar's Farm, Bahia"
            },
            'organic-criollo-cacao-beans-oscar-farm': {
                'productId': 'organic-criollo-cacao-beans-oscar-farm',
                'name': 'Organic Criollo Cacao Beans - Oscar\'s 100-Year Farm (per kg)',
                'price': 0,
                'weight': '',
                'image': '/assets/images/products/oscars-farm.jpeg',
                'category': 'wholesale',
                'shipment': 'AGL14',
                'farm': "Oscar's Farm, Bahia"
            },
            'organic-hybrid-cacao-beans-jesus-da-deus': {
                'productId': 'organic-hybrid-cacao-beans-jesus-da-deus',
                'name': 'Organic Hybrid Cacao Beans - Jesus Da Deus Fazenda (per kg)',
                'price': 0,
                'weight': '',
                'image': '/assets/images/products/taste-of-rainforest.jpeg',
                'category': 'wholesale',
                'shipment': 'AGL13',
                'farm': "Vivi's Jesus Do Deus Farm, Itacaré"
            },
            'organic-criollo-cacao-nibs-oscar-farm': {
                'productId': 'organic-criollo-cacao-nibs-oscar-farm',
                'name': 'Organic Criollo Cacao Nibs - Oscar\'s 100-Year Farm (per kg)',
                'price': 0,
                'weight': '',
                'image': '/assets/images/products/cacao-nibs.jpeg',
                'category': 'wholesale',
                'shipment': 'AGL4',
                'farm': "Oscar's Farm, Bahia"
            },
            'premium-organic-cacao-beans-la-do-sitio': {
                'productId': 'premium-organic-cacao-beans-la-do-sitio',
                'name': 'Premium Organic Cacao Beans - La do Sitio Farm (per kg)',
                'price': 0,
                'weight': '',
                'image': '/assets/images/products/la-do-sitio-farm.jpg',
                'category': 'wholesale',
                'shipment': 'AGL8',
                'farm': "Paulo's Farm, Pará"
            }
        }
    
    return products


def update_google_sheet():
    """
    Update the Google Sheet with product data
    Returns: worksheet object if successful, None otherwise
    """
    try:
        print(f"📊 Opening spreadsheet {SPREADSHEET_ID}...")
        
        # Authenticate
        if not SERVICE_ACCOUNT_FILE.exists():
            print(f"Error: Service account file not found at {SERVICE_ACCOUNT_FILE}")
            print("Please provide the path to your Google service account JSON file")
            return False
        
        scope = ['https://spreadsheets.google.com/feeds',
                 'https://www.googleapis.com/auth/drive']
        creds = Credentials.from_service_account_file(str(SERVICE_ACCOUNT_FILE), scopes=scope)
        client = gspread.authorize(creds)
        
        # Open spreadsheet
        spreadsheet = client.open_by_key(SPREADSHEET_ID)
        
        # Get or create sheet
        try:
            worksheet = spreadsheet.worksheet(SHEET_NAME)
            print(f"✅ Found existing sheet: {SHEET_NAME}")
        except gspread.exceptions.WorksheetNotFound:
            worksheet = spreadsheet.add_worksheet(title=SHEET_NAME, rows=100, cols=10)
            print(f"✅ Created new sheet: {SHEET_NAME}")
        
        # Get products data
        products = get_products_data()
        print(f"📦 Found {len(products)} products")
        
        # Prepare headers
        headers = [
            'Product ID',
            'Product Name',
            'Price (USD)',
            'Weight (oz)',
            'Category',
            'Shipment',
            'Farm',
            'Image Path'
        ]
        
        # Prepare data rows
        rows = [headers]
        
        for product_id, product in products.items():
            # Build full image URL
            image_path = product.get('image', '')
            if image_path and not image_path.startswith('http'):
                image_url = f"https://www.agroverse.shop{image_path}"
            else:
                image_url = image_path
            
            row = [
                product.get('productId', product_id),
                product.get('name', ''),
                product.get('price', 0),
                product.get('weight', ''),
                product.get('category', ''),
                product.get('shipment', ''),
                product.get('farm', ''),
                image_url
            ]
            rows.append(row)
        
        # Clear existing content
        worksheet.clear()
        
        # Update sheet with new data
        worksheet.update(rows, value_input_option='USER_ENTERED')
        
        # Format price column as currency
        price_col_letter = 'C'  # Column C
        price_range = f"{price_col_letter}2:{price_col_letter}{len(rows)}"
        worksheet.format(price_range, {
            'numberFormat': {
                'type': 'CURRENCY',
                'pattern': '$#,##0.00'
            }
        })
        
        # Format header row
        header_range = f"A1:{chr(64 + len(headers))}1"
        worksheet.format(header_range, {
            'textFormat': {
                'bold': True
            }
        })
        
        # Auto-resize columns (this requires the API, so we'll skip it or do it manually)
        print(f"✅ Successfully updated {len(products)} products to {SHEET_NAME} sheet")
        
        # Return worksheet for URL generation
        return worksheet
        
    except Exception as e:
        print(f"❌ Error updating Google Sheet: {e}")
        import traceback
        traceback.print_exc()
        return None


if __name__ == '__main__':
    print("=" * 50)
    print("Updating Agroverse SKUs Google Sheet")
    print("=" * 50)
    
    worksheet = update_google_sheet()
    
    if worksheet:
        print("\n✅ Done! Sheet updated successfully.")
        print(f"🔗 https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit#gid={worksheet.id}")
    else:
        print("\n❌ Failed to update sheet")
        sys.exit(1)

