#!/usr/bin/env python3
"""
Webhook Client for QR Code Generation

This script demonstrates how to trigger QR code generation via different methods:
1. Direct Google App Script webhook call (for HTML/JavaScript frontend)
2. GitHub Actions repository_dispatch
3. GitHub Actions workflow_dispatch
4. Issue creation with webhook

Usage examples:
- For HTML/JavaScript frontend: Use call_google_app_script_webhook()
- For automated workflows: Use trigger_repository_dispatch()
- For manual triggers: Use trigger_workflow_dispatch()
"""

import argparse
import json
import requests
import os
from datetime import datetime

class WebhookClient:
    def __init__(self, google_script_url=None, github_token=None, repository=None):
        self.google_script_url = google_script_url or os.environ.get('GOOGLE_APP_SCRIPT_URL')
        self.github_token = github_token or os.environ.get('GITHUB_TOKEN')
        self.repository = repository or 'TrueSightDAO/tokenomics'
        
    def call_google_app_script_webhook(self, product_name):
        """
        Call Google App Script webhook directly (for HTML/JavaScript frontend)
        
        This is the simplest method - just sends a POST request to the Google App Script
        with the product name. The Google App Script will:
        1. Create the QR code record in the Google Sheet
        2. Return the QR code value and other details
        
        The HTML/JavaScript frontend can then optionally call the Python script
        to generate the actual QR code image.
        """
        print(f"Calling Google App Script webhook for product: {product_name}")
        
        url = self.google_script_url
        payload = {
            'product_name': product_name
        }
        headers = {
            'Content-Type': 'application/json'
        }
        
        try:
            response = requests.post(url, json=payload, headers=headers)
            response.raise_for_status()
            
            data = response.json()
            if data['status'] == 'success':
                print("✅ QR code record created successfully!")
                print(f"QR Code: {data['data']['qr_code']}")
                print(f"GitHub URL: {data['data']['github_url']}")
                print(f"Sheet Row: {data['data']['row_added']}")
                return data['data']
            else:
                print(f"❌ Error: {data.get('message', 'Unknown error')}")
                return None
                
        except requests.exceptions.RequestException as e:
            print(f"❌ Network error: {e}")
            return None
        except json.JSONDecodeError as e:
            print(f"❌ Invalid JSON response: {e}")
            return None
    
    def trigger_repository_dispatch(self, product_name, landing_page_url=None, farm_name=None, state=None, country=None, year=None, event_type='qr-code-generation'):
        """
        Trigger GitHub Actions workflow via repository_dispatch event
        
        This method is useful for automated workflows or when you want to
        generate the QR code image as well.
        """
        if not self.github_token:
            print("❌ GitHub token required for repository_dispatch")
            return None
            
        url = f"https://api.github.com/repos/{self.repository}/dispatches"
        headers = {
            'Authorization': f'token {self.github_token}',
            'Accept': 'application/vnd.github.v3+json'
        }
        payload = {
            'event_type': event_type,
            'client_payload': {
                'product_name': product_name,
                'landing_page_url': landing_page_url,
                'farm_name': farm_name,
                'state': state,
                'country': country,
                'year': year,
                'timestamp': datetime.now().isoformat()
            }
        }
        
        try:
            response = requests.post(url, json=payload, headers=headers)
            response.raise_for_status()
            print("✅ Repository dispatch triggered successfully!")
            # GitHub repository dispatch returns 204 (no content) on success
            if response.status_code == 204:
                return {"status": "success", "message": "Repository dispatch triggered successfully"}
            else:
                return response.json()
        except requests.exceptions.RequestException as e:
            print(f"❌ Failed to trigger repository dispatch: {e}")
            return None
    
    def trigger_workflow_dispatch(self, product_name, workflow_id='qr-code-webhook.yml'):
        """
        Trigger GitHub Actions workflow manually via workflow_dispatch
        
        This method allows manual triggering of the workflow.
        """
        if not self.github_token:
            print("❌ GitHub token required for workflow_dispatch")
            return None
            
        url = f"https://api.github.com/repos/{self.repository}/actions/workflows/{workflow_id}/dispatches"
        headers = {
            'Authorization': f'token {self.github_token}',
            'Accept': 'application/vnd.github.v3+json'
        }
        payload = {
            'ref': 'main',
            'inputs': {
                'product_name': product_name
            }
        }
        
        try:
            response = requests.post(url, json=payload, headers=headers)
            response.raise_for_status()
            print("✅ Workflow dispatch triggered successfully!")
            # GitHub workflow dispatch returns 204 (no content) on success
            if response.status_code == 204:
                return {"status": "success", "message": "Workflow dispatch triggered successfully"}
            else:
                return response.json()
        except requests.exceptions.RequestException as e:
            print(f"❌ Failed to trigger workflow dispatch: {e}")
            return None
    
    def create_issue_with_webhook(self, product_name, title=None, body=None):
        """
        Create a GitHub issue to trigger the webhook
        
        This method creates an issue with a special format that the webhook
        can detect and process.
        """
        if not self.github_token:
            print("❌ GitHub token required for issue creation")
            return None
            
        if not title:
            title = f"Generate QR Code: {product_name}"
        if not body:
            body = f"""
QR Code Generation Request

**Product Name:** {product_name}
**Requested At:** {datetime.now().isoformat()}

This issue will trigger the QR code generation workflow.
            """.strip()
            
        url = f"https://api.github.com/repos/{self.repository}/issues"
        headers = {
            'Authorization': f'token {self.github_token}',
            'Accept': 'application/vnd.github.v3+json'
        }
        payload = {
            'title': title,
            'body': body
        }
        
        try:
            response = requests.post(url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            print(f"✅ Issue created successfully: {data['html_url']}")
            return data
        except requests.exceptions.RequestException as e:
            print(f"❌ Failed to create issue: {e}")
            return None
    
    def get_workflow_runs(self, workflow_id='qr-code-webhook.yml', per_page=10):
        """
        Get recent workflow runs for monitoring
        """
        if not self.github_token:
            print("❌ GitHub token required for workflow runs")
            return None
            
        url = f"https://api.github.com/repos/{self.repository}/actions/workflows/{workflow_id}/runs"
        headers = {
            'Authorization': f'token {self.github_token}',
            'Accept': 'application/vnd.github.v3+json'
        }
        params = {
            'per_page': per_page
        }
        
        try:
            response = requests.get(url, headers=headers, params=params)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            print(f"❌ Failed to get workflow runs: {e}")
            return None

def main():
    parser = argparse.ArgumentParser(description="Webhook Client for QR Code Generation")
    parser.add_argument("product_name", help="Name of the product to generate QR code for")
    parser.add_argument("--method", choices=['google', 'dispatch', 'workflow', 'issue'], 
                       default='google', help="Method to trigger QR code generation")
    parser.add_argument("--landing-page-url", help="Landing page URL for the QR code")
    parser.add_argument("--farm-name", help="Farm name for the QR code")
    parser.add_argument("--state", help="State for the QR code")
    parser.add_argument("--country", help="Country for the QR code")
    parser.add_argument("--year", help="Year for the QR code")
    parser.add_argument("--google-script-url", help="Google App Script deployment URL")
    parser.add_argument("--github-token", help="GitHub personal access token")
    parser.add_argument("--repository", help="GitHub repository (owner/repo)")
    parser.add_argument("--workflow-id", default='qr-code-webhook.yml', help="Workflow file name")
    
    args = parser.parse_args()
    
    client = WebhookClient(
        google_script_url=args.google_script_url,
        github_token=args.github_token,
        repository=args.repository
    )
    
    if args.method == 'google':
        result = client.call_google_app_script_webhook(args.product_name)
    elif args.method == 'dispatch':
        result = client.trigger_repository_dispatch(
            args.product_name,
            landing_page_url=args.landing_page_url,
            farm_name=args.farm_name,
            state=args.state,
            country=args.country,
            year=args.year
        )
    elif args.method == 'workflow':
        result = client.trigger_workflow_dispatch(args.product_name, args.workflow_id)
    elif args.method == 'issue':
        result = client.create_issue_with_webhook(args.product_name)
    
    if result:
        print("\n✅ Success!")
        print(json.dumps(result, indent=2))
    else:
        print("\n❌ Failed!")
        sys.exit(1)

if __name__ == "__main__":
    import sys
    main()
