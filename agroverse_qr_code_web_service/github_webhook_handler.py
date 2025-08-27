#!/usr/bin/env python3
"""
GitHub Actions Webhook Handler for QR Code Generation

This script can be triggered by GitHub Actions webhooks to:
1. Generate QR code images from product data
2. Upload them to GitHub repository
3. Complete the QR code generation workflow

Usage:
- Can be triggered by repository_dispatch events
- Can be triggered by workflow_dispatch events
- Can be triggered by external webhooks
"""

import argparse
import json
import os
import sys
import requests
import subprocess
from datetime import datetime
from pathlib import Path

import qrcode
from qrcode.constants import ERROR_CORRECT_H
from PIL import Image

# Configuration
GITHUB_TOKEN = os.environ.get('GITHUB_TOKEN')
GITHUB_REPOSITORY = 'TrueSightDAO/qr_codes'
# Use current directory for temporary file storage
GITHUB_WORKSPACE = os.getcwd()

class GitHubWebhookHandler:
    def __init__(self, github_token=None):
        self.github_token = github_token or GITHUB_TOKEN
        self.workspace = GITHUB_WORKSPACE
        
    def log(self, message):
        """Log message to GitHub Actions output"""
        print(f"[{datetime.now().isoformat()}] {message}")
        sys.stdout.flush()
    
    def generate_qr_code_value(self, product_name):
        """Generate QR code value from product name and current date"""
        today = datetime.now()
        date_str = today.strftime('%Y%m%d')
        year = today.year
        
        # Create a simple hash of the product name for uniqueness
        import hashlib
        product_hash = hashlib.md5(product_name.encode()).hexdigest()[:8]
        
        return f"{year}_{date_str}_{product_hash}"
    
    def create_qr_image(self, qr_code_value, landing_page_url, output_path):
        """Create QR code image"""
        self.log(f"Creating QR code image: {qr_code_value}")
        qr = qrcode.QRCode(
            version=None,
            error_correction=ERROR_CORRECT_H,
            box_size=10,
            border=4,
        )
        qr.add_data(landing_page_url)
        qr.make(fit=True)
        
        img = qr.make_image(fill_color="black", back_color="white")
        img.save(output_path)
        self.log(f"QR code image saved to: {output_path}")
        return output_path
    
    def setup_git(self):
        """Configure git for GitHub Actions (no longer needed with API approach)"""
        self.log("Git setup not needed - using GitHub API directly")
        pass
    
    def upload_to_github(self, qr_code_value, qr_image_path, commit_message=None):
        """Upload QR code image to GitHub using API"""
        if not commit_message:
            commit_message = f"Add QR code: {qr_code_value} [skip ci]"
        
        self.log(f"Uploading QR code to GitHub: {qr_code_value}")
        
        # Verify the file exists
        if not os.path.exists(qr_image_path):
            raise FileNotFoundError(f"QR code image not found at: {qr_image_path}")
        
        # Read the file and encode to base64
        with open(qr_image_path, 'rb') as f:
            file_content = f.read()
        
        import base64
        base64_content = base64.b64encode(file_content).decode('utf-8')
        
        # GitHub API URL
        repo = GITHUB_REPOSITORY
        path = f"{qr_code_value}.png"
        api_url = f"https://api.github.com/repos/{repo}/contents/{path}"
        
        # Prepare payload
        payload = {
            "message": commit_message,
            "content": base64_content
        }
        
        # Prepare headers
        headers = {
            "Authorization": f"token {self.github_token}",
            "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/json"
        }
        
        # Make the API request
        response = requests.put(api_url, json=payload, headers=headers)
        
        if response.status_code not in [200, 201]:
            error_msg = f"Failed to upload to GitHub: {response.status_code} - {response.text}"
            self.log(f"ERROR: {error_msg}")
            raise Exception(error_msg)
        
        response_data = response.json()
        
        if not response_data.get('content'):
            raise Exception(f"Failed to upload to GitHub: {response.text}")
        
        # Return URLs
        raw_url = f"https://raw.githubusercontent.com/{repo}/main/{path}"
        commit_url = response_data['commit']['html_url']
        
        self.log(f"✅ Successfully uploaded {qr_code_value}.png to GitHub")
        self.log(f"Raw URL: {raw_url}")
        self.log(f"Commit URL: {commit_url}")
        
        return {
            'raw_url': raw_url,
            'commit_url': commit_url
        }
    
    def handle_webhook_request(self, product_name, landing_page_url=None, auto_commit=True):
        """Handle webhook request for QR code generation"""
        self.log(f"Starting QR code generation for product: {product_name}")
        
        try:
            # Step 1: Generate QR code value
            self.log("Step 1: Generating QR code value...")
            qr_code_value = self.generate_qr_code_value(product_name)
            
            # Use provided landing page URL or create a default one
            if not landing_page_url:
                landing_page_url = f"https://agroverse.com/product/{qr_code_value}"
            
            self.log(f"Generated QR code value: {qr_code_value}")
            self.log(f"Landing page: {landing_page_url}")
            
            # Step 2: Setup git
            self.log("Step 2: Setting up git...")
            self.setup_git()
            
            # Step 3: Create QR code image
            self.log("Step 3: Creating QR code image...")
            qr_image_path = os.path.join(self.workspace, f"{qr_code_value}.png")
            self.log(f"Creating QR code at path: {qr_image_path}")
            self.create_qr_image(qr_code_value, landing_page_url, qr_image_path)
            
            # Verify the file was created
            if os.path.exists(qr_image_path):
                self.log(f"✅ QR code image created successfully at: {qr_image_path}")
                self.log(f"File size: {os.path.getsize(qr_image_path)} bytes")
            else:
                raise FileNotFoundError(f"QR code image was not created at: {qr_image_path}")
            
            # Step 4: Upload to GitHub
            if auto_commit:
                self.log("Step 4: Uploading to GitHub...")
                commit_message = f"Add QR code for {product_name}: {qr_code_value} [skip ci]"
                upload_result = self.upload_to_github(qr_code_value, qr_image_path, commit_message)
            
            # Return success result
            result = {
                'success': True,
                'product_name': product_name,
                'qr_code': qr_code_value,
                'github_url': f"https://github.com/{GITHUB_REPOSITORY}/blob/main/{qr_code_value}.png",
                'local_image_path': qr_image_path,
                'landing_page': landing_page_url,
                'timestamp': datetime.now().isoformat()
            }
            
            # Add upload information if auto_commit was enabled
            if auto_commit:
                result.update({
                    'raw_url': upload_result['raw_url'],
                    'commit_url': upload_result['commit_url']
                })
            
            self.log("QR code generation completed successfully!")
            return result
            
        except Exception as e:
            error_msg = f"Error during QR code generation: {str(e)}"
            self.log(f"ERROR: {error_msg}")
            return {
                'success': False,
                'error': error_msg,
                'product_name': product_name,
                'timestamp': datetime.now().isoformat()
            }

def main():
    parser = argparse.ArgumentParser(description="GitHub Actions Webhook Handler for QR Code Generation")
    parser.add_argument("product_name", help="Name of the product to generate QR code for")
    parser.add_argument("--landing-page-url", help="Landing page URL for the QR code")
    parser.add_argument("--github-token", help="GitHub personal access token")
    parser.add_argument("--no-commit", action="store_true", help="Don't commit to GitHub")
    parser.add_argument("--output-file", help="Output file for results (JSON)")
    
    args = parser.parse_args()
    
    # Initialize handler
    handler = GitHubWebhookHandler(github_token=args.github_token)
    
    try:
        # Handle the webhook request
        result = handler.handle_webhook_request(
            args.product_name,
            landing_page_url=args.landing_page_url,
            auto_commit=not args.no_commit
        )
        
        # Output results
        if args.output_file:
            with open(args.output_file, 'w') as f:
                json.dump(result, f, indent=2)
            handler.log(f"Results saved to: {args.output_file}")
        
        # Print results to stdout for GitHub Actions
        print(json.dumps(result, indent=2))
        
        # Exit with appropriate code
        if result['success']:
            sys.exit(0)
        else:
            sys.exit(1)
            
    except Exception as e:
        error_result = {
            'success': False,
            'error': str(e),
            'product_name': args.product_name,
            'timestamp': datetime.now().isoformat()
        }
        print(json.dumps(error_result, indent=2))
        sys.exit(1)

if __name__ == "__main__":
    main()
