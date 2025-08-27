#!/usr/bin/env python3
"""
GitHub Actions Webhook Handler for QR Code Generation

This script can be triggered by GitHub Actions webhooks to:
1. Call Google App Script webhook to create QR code record
2. Generate QR code images
3. Upload them to GitHub repository
4. Complete the full workflow from product name to deployed QR code

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
GOOGLE_APP_SCRIPT_URL = os.environ.get('GOOGLE_APP_SCRIPT_URL', 'YOUR_DEPLOYED_SCRIPT_URL_HERE')
GITHUB_TOKEN = os.environ.get('GITHUB_TOKEN')
GITHUB_REPOSITORY = os.environ.get('GITHUB_REPOSITORY', 'TrueSightDAO/qr_codes')
GITHUB_WORKSPACE = os.environ.get('GITHUB_WORKSPACE', 'qr_codes')

class GitHubWebhookHandler:
    def __init__(self, google_script_url=None, github_token=None):
        self.google_script_url = google_script_url or GOOGLE_APP_SCRIPT_URL
        self.github_token = github_token or GITHUB_TOKEN
        self.workspace = GITHUB_WORKSPACE
        
    def log(self, message):
        """Log message to GitHub Actions output"""
        print(f"[{datetime.now().isoformat()}] {message}")
        sys.stdout.flush()
    
    def call_google_app_script_webhook(self, product_name):
        """Call Google App Script webhook to create QR code record"""
        self.log(f"Calling Google App Script webhook for product: {product_name}")
        
        url = self.google_script_url
        payload = {
            'product_name': product_name
        }
        headers = {
            'Content-Type': 'application/json'
        }
        
        response = requests.post(url, json=payload, headers=headers)
        
        if response.status_code != 200:
            raise Exception(f"Failed to call Google App Script webhook: {response.text}")
            
        data = response.json()
        if data['status'] != 'success':
            raise Exception(f"Google App Script webhook failed: {data.get('message', 'Unknown error')}")
            
        return data['data']
    
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
        """Configure git for GitHub Actions"""
        self.log("Setting up git configuration")
        
        # Configure git user
        subprocess.run([
            "git", "config", "--global", "user.name", "GitHub Actions"
        ], check=True)
        
        subprocess.run([
            "git", "config", "--global", "user.email", "actions@github.com"
        ], check=True)
        
        # Configure git to use token for authentication
        if self.github_token:
            subprocess.run([
                "git", "remote", "set-url", "origin", 
                f"https://x-access-token:{self.github_token}@github.com/{GITHUB_REPOSITORY}.git"
            ], check=True)
    
    def commit_and_push(self, qr_code_value, commit_message=None):
        """Commit and push the QR code image to GitHub"""
        if not commit_message:
            commit_message = f"Add QR code: {qr_code_value} [skip ci]"
        
        self.log(f"Committing QR code: {qr_code_value}")
        
        # Add the file
        subprocess.run(["git", "add", f"{qr_code_value}.png"], check=True)
        
        # Commit
        subprocess.run([
            "git", "commit", "-m", commit_message
        ], check=True)
        
        # Push
        subprocess.run(["git", "push"], check=True)
        
        self.log(f"Successfully pushed {qr_code_value}.png to GitHub")
    
    def handle_webhook_request(self, product_name, auto_commit=True):
        """Handle webhook request for QR code generation"""
        self.log(f"Starting webhook QR code generation for product: {product_name}")
        
        try:
            # Step 1: Call Google App Script webhook to create QR code record
            self.log("Step 1: Calling Google App Script webhook...")
            google_result = self.call_google_app_script_webhook(product_name)
            
            qr_code_value = google_result['qr_code']
            landing_page = google_result['landing_page']
            row_added = google_result['row_added']
            
            self.log(f"Google App Script created QR code record: {qr_code_value}")
            self.log(f"Landing page: {landing_page}")
            self.log(f"Sheet row: {row_added}")
            
            # Step 2: Setup git
            self.log("Step 2: Setting up git...")
            self.setup_git()
            
            # Step 3: Create QR code image
            self.log("Step 3: Creating QR code image...")
            qr_image_path = os.path.join(self.workspace, f"{qr_code_value}.png")
            self.create_qr_image(qr_code_value, landing_page, qr_image_path)
            
            # Step 4: Commit and push to GitHub
            if auto_commit:
                self.log("Step 4: Committing and pushing to GitHub...")
                commit_message = f"Add QR code for {product_name}: {qr_code_value} [skip ci]"
                self.commit_and_push(qr_code_value, commit_message)
            
            # Return success result
            result = {
                'success': True,
                'product_name': product_name,
                'qr_code': qr_code_value,
                'github_url': google_result['github_url'],
                'local_image_path': qr_image_path,
                'row_added': row_added,
                'landing_page': landing_page,
                'timestamp': datetime.now().isoformat()
            }
            
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
    parser.add_argument("--google-script-url", help="Google App Script deployment URL")
    parser.add_argument("--github-token", help="GitHub personal access token")
    parser.add_argument("--no-commit", action="store_true", help="Don't commit to GitHub")
    parser.add_argument("--output-file", help="Output file for results (JSON)")
    
    args = parser.parse_args()
    
    # Initialize handler
    handler = GitHubWebhookHandler(
        google_script_url=args.google_script_url,
        github_token=args.github_token
    )
    
    try:
        # Handle the webhook request
        result = handler.handle_webhook_request(
            args.product_name, 
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
