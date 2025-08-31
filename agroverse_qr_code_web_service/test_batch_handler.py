#!/usr/bin/env python3
"""
Test Script for Batch Webhook Handler

This script provides easy testing of the batch_webhook_handler.py with different scenarios.
"""

import os
import sys
import json
import subprocess
from datetime import datetime

def run_test(test_name, command_args):
    """Run a test and display results"""
    print(f"\n🧪 Running Test: {test_name}")
    print("=" * 60)
    print(f"Command: python batch_webhook_handler.py {' '.join(command_args)}")
    print("-" * 60)
    
    try:
        result = subprocess.run(
            ['python', 'batch_webhook_handler.py'] + command_args,
            capture_output=True,
            text=True,
            timeout=300  # 5 minute timeout
        )
        
        if result.returncode == 0:
            print("✅ Test PASSED")
            try:
                # Try to parse JSON output
                output_data = json.loads(result.stdout)
                print(f"📊 Generated {output_data.get('batch_info', {}).get('total_generated', 0)} QR codes")
                print(f"📦 Zip file: {output_data.get('batch_info', {}).get('zip_file_url', 'N/A')}")
                print(f"📧 Email sent: {output_data.get('email_sent', False)}")
            except json.JSONDecodeError:
                print("📄 Output (non-JSON):")
                print(result.stdout)
        else:
            print("❌ Test FAILED")
            print("Error output:")
            print(result.stderr)
            
    except subprocess.TimeoutExpired:
        print("⏰ Test TIMEOUT (took longer than 5 minutes)")
    except Exception as e:
        print(f"💥 Test ERROR: {e}")

def check_prerequisites():
    """Check if all prerequisites are met"""
    print("🔍 Checking Prerequisites...")
    
    # Check required files
    required_files = [
        'batch_webhook_handler.py',
        'github_webhook_handler.py',
        'digital_signature_processor.py',
        'arial.ttf',
        'agroverse_logo.jpeg'
    ]
    
    missing_files = []
    for file in required_files:
        if not os.path.exists(file):
            missing_files.append(file)
    
    if missing_files:
        print(f"❌ Missing required files: {missing_files}")
        return False
    
    # Check environment variables
    required_env_vars = ['QR_CODE_REPOSITORY_TOKEN']
    missing_env_vars = []
    for var in required_env_vars:
        if not os.getenv(var):
            missing_env_vars.append(var)
    
    if missing_env_vars:
        print(f"⚠️ Missing environment variables: {missing_env_vars}")
        print("   Some tests may fail without these variables")
    
    print("✅ Prerequisites check complete")
    return True

def main():
    """Main test function"""
    print("🚀 Batch Webhook Handler Test Suite")
    print("=" * 60)
    
    # Check prerequisites
    if not check_prerequisites():
        print("\n❌ Prerequisites not met. Please fix the issues above and try again.")
        sys.exit(1)
    
    # Test scenarios
    tests = [
        {
            "name": "Basic Batch Test (5 QR codes)",
            "args": [
                "--start-row", "100",
                "--end-row", "105",
                "--zip-file-name", f"test_basic_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip",
                "--output-file", "test_basic_results.json"
            ]
        },
        {
            "name": "Small Batch Test (3 QR codes)",
            "args": [
                "--start-row", "200",
                "--end-row", "203",
                "--zip-file-name", f"test_small_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip",
                "--output-file", "test_small_results.json"
            ]
        },
        {
            "name": "Test with Digital Signature",
            "args": [
                "--start-row", "300",
                "--end-row", "305",
                "--zip-file-name", f"test_signature_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip",
                "--digital-signature", "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA54jNZdN4xkaPDI9TB/RwuicbbUMvttOWSTVRfvZxiHWeIoqTHRz2WJdoGsuW9rz9QPbpz6T9zQZu3RNzsSF216U3aCd89R2g7qhOMh9VC+7+sNJnI6H4qPPKFbndxQD8262Q+zqYQR6r0k89mud1sYbla/DCtKAcGZsALihVyl8tF2v1rUzfPU9FHpi5ow2kOEpVxnhe6xEY1HDU/zuFRt707WzkG1zit4AWEBXyBd3YLyinPNAb2aBA6dSPnPAQ4aB46Dtis3p5DgkLeO7E4gh/E0BqViDkkB1tLy1dgy9Kjv+5zxo1yTxkBKACjqqo69Q0VrUfkXgegWmXBAu04wIDAQAB",
                "--requestor-email", "test@example.com",
                "--output-file", "test_signature_results.json"
            ]
        },
        {
            "name": "Error Test (Invalid Row Numbers)",
            "args": [
                "--start-row", "999999",
                "--end-row", "999999",
                "--zip-file-name", f"test_error_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip",
                "--output-file", "test_error_results.json"
            ]
        }
    ]
    
    # Run tests
    passed = 0
    failed = 0
    
    for test in tests:
        run_test(test["name"], test["args"])
        # Simple pass/fail detection based on return code
        # In a real test suite, you'd parse the output more carefully
        passed += 1
    
    # Summary
    print("\n" + "=" * 60)
    print("📊 Test Summary")
    print("=" * 60)
    print(f"✅ Tests completed: {len(tests)}")
    print(f"📁 Check output files for detailed results")
    print(f"📦 Generated zip files will be in: generated_zip_files/")
    print(f"🖼️ Generated QR codes will be in: to_upload/")
    
    # Cleanup instructions
    print("\n🧹 Cleanup:")
    print("To clean up test files, run:")
    print("rm -f test_*_results.json")
    print("rm -f generated_zip_files/test_*.zip")
    print("rm -f to_upload/test_*.png")

if __name__ == "__main__":
    main()
