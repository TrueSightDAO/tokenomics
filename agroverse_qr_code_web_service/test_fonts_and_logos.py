#!/usr/bin/env python3
"""
Test script to verify font and logo functionality in different environments
"""

import os
import sys
from pathlib import Path

# Add the current directory to the path so we can import the handler
sys.path.insert(0, os.path.dirname(__file__))

from github_webhook_handler import GitHubWebhookHandler

def test_font_loading():
    """Test font loading functionality"""
    print("🧪 Testing Font Loading...")
    
    handler = GitHubWebhookHandler()
    
    # Test font loading with different sizes
    test_sizes = [12, 18, 24, 32]
    
    for size in test_sizes:
        try:
            # Import the load_font function from the handler
            from PIL import ImageFont
            
            # Test the font loading logic
            system_fonts = [
                'cour.ttf',  # Courier New
                'arial.ttf',  # Arial
                'Helvetica.ttc',  # Helvetica
                '/System/Library/Fonts/Arial.ttf',  # macOS Arial
                '/System/Library/Fonts/Courier New.ttf',  # macOS Courier
                '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',  # Linux DejaVu
                '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',  # Linux Liberation
            ]
            
            font_loaded = False
            for font_path in system_fonts:
                try:
                    if os.path.exists(font_path):
                        font = ImageFont.truetype(font_path, size)
                        print(f"✅ Loaded font: {font_path} (size: {size})")
                        font_loaded = True
                        break
                except Exception as e:
                    continue
            
            if not font_loaded:
                # Fallback to default font
                try:
                    font = ImageFont.load_default()
                    print(f"✅ Loaded default font (size: {size})")
                except Exception as e:
                    print(f"❌ Failed to load any font (size: {size}): {e}")
                    
        except Exception as e:
            print(f"❌ Font loading test failed for size {size}: {e}")

def test_logo_finding():
    """Test logo file finding functionality"""
    print("\n🧪 Testing Logo File Finding...")
    
    # Test paths for logo files
    possible_cacao_logo_paths = [
        os.path.join(os.path.dirname(__file__), "agroverse_logo.jpeg"),
        os.path.join(os.path.dirname(__file__), "assets", "agroverse_logo.jpeg"),
        os.path.join(os.getcwd(), "agroverse_logo.jpeg"),
        os.path.join(os.getcwd(), "assets", "agroverse_logo.jpeg")
    ]
    
    possible_non_cacao_logo_paths = [
        os.path.join(os.path.dirname(__file__), "truesight_icon.png"),
        os.path.join(os.path.dirname(__file__), "assets", "truesight_icon.png"),
        os.path.join(os.getcwd(), "truesight_icon.png"),
        os.path.join(os.getcwd(), "assets", "truesight_icon.png")
    ]
    
    print("🔍 Checking Cacao Logo Paths:")
    for path in possible_cacao_logo_paths:
        exists = os.path.exists(path)
        print(f"   - {path} {'✅' if exists else '❌'}")
    
    print("🔍 Checking Non-Cacao Logo Paths:")
    for path in possible_non_cacao_logo_paths:
        exists = os.path.exists(path)
        print(f"   - {path} {'✅' if exists else '❌'}")

def test_qr_generation():
    """Test QR code generation with fonts and logos"""
    print("\n🧪 Testing QR Code Generation...")
    
    handler = GitHubWebhookHandler()
    
    # Test parameters
    test_params = {
        'qr_code_value': 'TEST_20250101_12345678',
        'output_path': 'test_qr_code.png',
        'farm_name': 'Test Farm',
        'state': 'Test State',
        'country': 'Test Country',
        'year': '2025',
        'is_cacao': True
    }
    
    try:
        # Test QR code generation
        result_path = handler.create_qr_image(**test_params)
        
        if os.path.exists(result_path):
            file_size = os.path.getsize(result_path)
            print(f"✅ QR code generated successfully!")
            print(f"📁 File: {result_path}")
            print(f"📊 Size: {file_size} bytes")
            
            # Clean up test file
            os.remove(result_path)
            print("🧹 Test file cleaned up")
        else:
            print(f"❌ QR code file not found: {result_path}")
            
    except Exception as e:
        print(f"❌ QR code generation failed: {e}")

def test_environment():
    """Test environment detection"""
    print("\n🧪 Testing Environment Detection...")
    
    print(f"🔧 GITHUB_ACTIONS: {os.environ.get('GITHUB_ACTIONS', 'Not set')}")
    print(f"📁 Current working directory: {os.getcwd()}")
    print(f"📁 Script directory: {os.path.dirname(__file__)}")
    print(f"🐍 Python version: {sys.version}")
    
    # Check if we're in a container/CI environment
    if os.path.exists('/.dockerenv'):
        print("🐳 Running in Docker container")
    elif os.environ.get('CI'):
        print("🤖 Running in CI environment")
    else:
        print("💻 Running in local environment")

if __name__ == "__main__":
    print("🚀 Starting Font and Logo Tests...\n")
    
    test_environment()
    test_font_loading()
    test_logo_finding()
    test_qr_generation()
    
    print("\n✅ All tests completed!")
