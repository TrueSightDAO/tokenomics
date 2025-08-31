# Google Apps Script QR Code Generator Setup

This document explains how to set up the Google Apps Script (`qr_code_generator.gs`) to automatically trigger GitHub Actions for QR code generation.

## Overview

The Google Apps Script provides a web service that:
1. Searches for products in the "Currencies" Google Sheet
2. Creates QR code records in the "Agroverse QR codes" sheet
3. **Triggers GitHub Actions workflow** to generate the actual QR code image
4. Returns success/error responses

## Prerequisites

1. **Google Apps Script Access**: You need access to Google Apps Script
2. **GitHub Personal Access Token**: Token with `repo` scope to trigger workflows
3. **Google Sheets Access**: Access to the Agroverse spreadsheet

## Setup Instructions

### Step 1: Create GitHub Personal Access Token

1. Go to GitHub Settings > Developer settings > Personal access tokens > Tokens (classic)
2. Click "Generate new token (classic)"
3. Give it a name like "Google Apps Script QR Code Generator"
4. Select scopes:
   - `repo` (Full control of private repositories)
5. Click "Generate token"
6. **Copy the token** - you won't see it again!

### Step 2: Deploy Google Apps Script

1. Open [Google Apps Script](https://script.google.com/)
2. Create a new project
3. Copy the contents of `qr_code_generator.gs` into the editor
4. Save the project with a name like "QR Code Generator"

### Step 3: Configure GitHub Token

1. In Google Apps Script, go to **Project Settings** (gear icon)
2. Scroll down to **Script Properties**
3. Click **Add script property**
4. Set:
   - **Property**: `GITHUB_TOKEN`
   - **Value**: Your GitHub personal access token from Step 1
5. Click **Save**

### Step 4: Deploy as Web App

1. Click **Deploy** > **New deployment**
2. Choose **Web app**
3. Set:
   - **Execute as**: Me
   - **Who has access**: Anyone
4. Click **Deploy**
5. Copy the **Web app URL** - this is your API endpoint

### Step 5: Test the Setup

1. In Google Apps Script, run the `testGitHubToken()` function
2. Check the logs to confirm the token is configured
3. Test the webhook trigger with `testWebhookTrigger()` function

## API Usage

### GET Request (Search Products)
```
GET https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?product_name=ProductName&action=search
```

### GET Request (Generate QR Code)
```
GET https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?product_name=ProductName&action=generate
```

### POST Request (Generate QR Code)
```json
POST https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
Content-Type: application/json

{
  "product_name": "Product Name"
}
```

## Response Format

### Success Response
```json
{
  "status": "success",
  "data": {
    "action": "generate",
    "product_name": "Product Name",
    "qr_code": "2024_20241201_001",
    "row_added": 123,
    "github_url": "https://github.com/TrueSightDAO/qr_codes/blob/main/2024_20241201_001.png",
    "webhook_triggered": true,
    "webhook_message": "GitHub Actions webhook triggered successfully for row 123. Workflow will generate QR code image."
  }
}
```

### Error Response
```json
{
  "status": "error",
  "message": "Error description"
}
```

## Workflow Process

1. **API Call**: External system calls the Google Apps Script web app
2. **Product Search**: Script searches for the product in "Currencies" sheet
3. **QR Code Generation**: Creates a new row in "Agroverse QR codes" sheet
4. **GitHub Actions Trigger**: Script triggers the `qr-code-webhook.yml` workflow
5. **Image Generation**: GitHub Actions runs the Python script to generate QR code image
6. **Upload**: Image is uploaded to the `TrueSightDAO/qr_codes` repository
7. **Response**: Success/error response is returned to the caller

## GitHub Actions Workflow

The workflow (`qr-code-webhook.yml`) is triggered by `repository_dispatch` events and:

1. **Checks out** the tokenomics repository
2. **Installs** Python dependencies
3. **Runs** the `github_webhook_handler.py` script
4. **Generates** QR code image with embedded logo
5. **Uploads** image to GitHub repository
6. **Returns** results as artifacts

## Troubleshooting

### GitHub Token Issues
- **Error**: "GitHub token not configured"
- **Solution**: Check Script Properties for `GITHUB_TOKEN`

### Webhook Trigger Issues
- **Error**: "Failed to trigger webhook"
- **Solution**: Verify token has `repo` scope and repository access

### Workflow Not Running
- **Check**: GitHub Actions tab in the tokenomics repository
- **Verify**: Workflow file `qr-code-webhook.yml` exists
- **Confirm**: Repository has proper permissions

### Sheet Access Issues
- **Error**: "Required sheets not found"
- **Solution**: Verify spreadsheet URL and sheet names

## Testing Functions

Use these functions in Google Apps Script for testing:

- `testGitHubToken()` - Check if GitHub token is configured
- `testWebhookTrigger()` - Test webhook trigger for a specific row
- `testSearchProduct()` - Test product search functionality
- `testGenerateQRCode()` - Test complete QR code generation

## Security Considerations

1. **Token Security**: Keep your GitHub token secure and don't share it
2. **Access Control**: Consider restricting web app access to specific users
3. **Rate Limiting**: Be aware of GitHub API rate limits
4. **Monitoring**: Monitor GitHub Actions usage and costs

## Support

For issues or questions:
1. Check the Google Apps Script logs
2. Verify GitHub Actions workflow runs
3. Test individual components using the test functions
4. Review this documentation for common issues
