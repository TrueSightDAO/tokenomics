# Agroverse QR Code Web Service

A comprehensive QR code generation system for the Agroverse ecosystem, providing multiple deployment options and integration methods.

## 🚀 **Overview**

This service generates QR codes from product information stored in Google Sheets and deploys them to GitHub repositories. It supports both local execution and GitHub Actions webhook-based automation.

## 📁 **Project Structure**

```
agroverse_qr_code_web_service/
├── README.md                           # This file - Complete documentation
├── requirements.txt                    # Python dependencies
├── .gitignore                          # Git ignore rules (excludes sensitive files)

├── github_webhook_handler.py           # GitHub Actions webhook handler
├── webhook_client.py                   # Webhook client for external triggers
├── test_qr_generation.py               # Test script for local QR generation
├── run_test.sh                         # Shell script to run tests with virtual environment
├── local_config_template.py            # Template for local configuration
├── local_config.py                     # Local config (not in git - contains tokens)

├── to_upload/                          # Directory for generated QR code images
├── agroverse_logo.jpeg                 # Logo for cacao products
├── truesight_icon.png                  # Logo for non-cacao products
└── qr_code_generator.gs                # Google App Script for Google Sheets operations

Repository Root:
├── .github/workflows/
│   └── qr-code-webhook.yml            # GitHub Actions workflow (GitHub expects this location)
```

## 🏗️ **Architecture**

### **Clean Separation of Concerns**
- **Frontend**: HTML/JavaScript interface (can be hosted anywhere)
- **Backend**: Google App Script webhook (handles Google Sheets operations)
- **QR Generation**: Python script in GitHub Actions (generates and uploads images)
- **Storage**: Google Sheets (records) + GitHub (images)

### **Key Benefits**
- **No Credentials Needed**: HTML/JS can call Google App Script directly
- **Centralized Control**: All Google Sheets operations in Google App Script
- **Simplified Python**: Only handles QR generation and GitHub storage
- **Easy Frontend**: Simple web interface for users

### **Repository Structure**
```
TrueSightDAO/tokenomics/ (Code Repository)
├── .github/workflows/
│   └── qr-code-webhook.yml            # GitHub Actions workflow
└── agroverse_qr_code_web_service/
    ├── github_webhook_handler.py      # Python webhook handler
    ├── webhook_client.py              # Python client examples
    ├── qr_code_generator.gs           # Google App Script (webhook)
    ├── html_frontend_example.html     # Example HTML/JS frontend
    ├── README.md
    └── requirements.txt

TrueSightDAO/qr_codes/ (Assets Repository)
├── README.md
├── 2025_20241215_1.png
├── 2025_20241215_2.png
└── ... (generated QR code images)
```

## 🛠️ **Setup Instructions**

### **1. Cross-Repository Setup**

This system uses two repositories:
- **Code Repository**: `TrueSightDAO/tokenomics` (contains scripts and logic)
- **Assets Repository**: `TrueSightDAO/qr_codes` (contains generated QR codes)

#### **Code Repository Setup** (`TrueSightDAO/tokenomics`):

1. **Workflow file is already in place:**
   - The `qr-code-webhook.yml` file is already in `.github/workflows/` at the repository root
   - GitHub will automatically detect and use this workflow

2. **Set up repository secrets:**
   - Go to `TrueSightDAO/tokenomics` → Settings → Secrets and variables → Actions
   - Add these secrets:
     - `GOOGLE_APP_SCRIPT_URL`: Your Google App Script deployment URL
     - `GITHUB_TOKEN`: GitHub personal access token (with repo access to both repositories)
     - `GDRIVE_KEY`: Google Sheets service account credentials JSON (entire JSON content as string)

#### **Assets Repository Setup** (`TrueSightDAO/qr_codes`):

1. **Ensure the repository exists:**
   - The `TrueSightDAO/qr_codes` repository should already exist
   - It should be public for easy QR code access

2. **Repository permissions:**
   - Ensure the GitHub token has write access to this repository

### **2. Google App Script Setup**

1. **Create a new Google App Script project:**
   - Go to [script.google.com](https://script.google.com)
   - Create a new project
   - Copy the contents of `agroverse_qr_code_web_service/qr_code_generator.gs` into the editor

2. **Deploy as Web App:**
   - Click "Deploy" → "New deployment"
   - Choose "Web app" as the type
   - Set "Execute as" to your account
   - Set "Who has access" to "Anyone"
   - Click "Deploy"
   - Copy the deployment URL

3. **Update the secret:**
   - Set `GOOGLE_APP_SCRIPT_URL` in the tokenomics repository secrets

### **3. Python Environment Setup**

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Additional dependencies for the workflow script:**
   ```bash
   pip install requests
   ```

3. **GitHub Setup:**
   - Create a GitHub personal access token
   - Ensure you have write access to both `TrueSightDAO/tokenomics` and `TrueSightDAO/qr_codes` repositories

## 🧪 **Testing**

### **Local Testing**

You can test the QR code generation locally without triggering GitHub Actions:

#### **Method 1: Direct Test (Recommended)**
```bash
# Test with default parameters
python github_webhook_handler.py --test

# Test with custom parameters
python github_webhook_handler.py --test \
  --product-name "My Test Product" \
  --farm-name "Test Farm" \
  --state "California" \
  --country "USA" \
  --year "2024" \
  --landing-page-url "https://agroverse.com/product/test" \
  --is-cacao

# Test with Agroverse QR codes sheet row (requires Google Sheets API)
python github_webhook_handler.py --test --sheet-row 708
```

#### **Method 2: Test Script**
```bash
# Run the test script with multiple examples
python test_qr_generation.py

# Or use the convenience script (activates virtual environment automatically)
./run_test.sh
```

#### **What the Test Does:**
1. ✅ Generates a QR code with the same design as `batch_compiler.py`
2. ✅ Embeds appropriate logos (agroverse for cacao, truesight for non-cacao)
3. ✅ Creates a local image file in `to_upload/` directory
4. ✅ Uploads the image to [TrueSightDAO/qr_codes](https://github.com/TrueSightDAO/qr_codes)
5. ✅ Opens the image automatically (if supported by your OS)
6. ✅ Shows detailed results and URLs

#### **Test Output Example:**
```
🧪 Testing QR Code Generation...
📝 Product: Caramelized Cacao Kraft Pouch...
🏡 Farm: San Francisco AGL10, California, USA
📅 Year: 2024
🔗 Landing Page: https://agroverse.com/product/test

✅ Test completed successfully!
📱 QR Code: 2024_20241215_abc123
🖼️  Local Image: /path/to/2024_20241215_abc123.png
🌐 GitHub URL: https://github.com/TrueSightDAO/qr_codes/blob/main/2024_20241215_abc123.png
📎 Raw URL: https://raw.githubusercontent.com/TrueSightDAO/qr_codes/main/2024_20241215_abc123.png
🔗 Commit URL: https://github.com/TrueSightDAO/qr_codes/commit/abc123...
📊 File Size: 12345 bytes
📁 File exists locally: ✅
🖼️  Opened image with default app
```

### **Requirements for Testing:**
- Python 3.7+
- Required packages: `qrcode[pil]`, `requests`, `pillow`
- GitHub token with access to `TrueSightDAO/qr_codes` repository
- Set environment variable: `QR_CODE_REPOSITORY_TOKEN=your_github_token`

### **For Google Sheet Testing:**
- Google Sheets API: `google-api-python-client`, `google-auth-httplib2`, `google-auth-oauthlib`
- Service account credentials file: `python_scripts/agroverse_qr_code_generator/gdrive_key.json`
- Tests against "Agroverse QR codes" sheet (results from `qr_code_generator.gs`)

### **Setting up GitHub Token:**

#### **Option 1: Local Configuration File (Recommended for Development)**
```bash
# Copy the template and update with your token
cp local_config_template.py local_config.py

# Edit local_config.py with your actual GitHub token
# The file is already in .gitignore, so it won't be committed
```

#### **Option 2: Environment Variable**
```bash
# Set the environment variable for the current session
export QR_CODE_REPOSITORY_TOKEN=your_github_token_here

# Or add to your shell profile for persistence
echo 'export QR_CODE_REPOSITORY_TOKEN=your_github_token_here' >> ~/.zshrc
source ~/.zshrc
```

#### **GitHub Token Requirements:**
- **Scope:** `repo` (for both tokenomics and qr_codes repositories)
- **Get Token:** https://github.com/settings/tokens
- **Permissions:** Read/write access to both repositories

#### **Google Sheets API Setup:**
- **Service Account:** Create a Google Cloud service account with Google Sheets API access
- **Credentials File:** Download the JSON credentials file
- **For Local Development:** Place the JSON file at the path specified in `local_config.py`
- **For GitHub Actions:** Copy the entire JSON content and set it as the `GDRIVE_KEY` repository secret

### **Local Development Setup:**
```bash
# Option 1: Use existing virtual environment (recommended)
source /Users/garyjob/Applications/tokenomics/python_scripts/venv/bin/activate

# Option 2: Install dependencies locally
pip install -r requirements.txt
```

## 🎯 **Usage Methods**

### **🚀 Simplified Parameter System**

The system now supports a much simpler approach using **sheet row numbers** instead of passing multiple individual parameters:

#### **Benefits of Sheet Row Approach:**
- **🎯 Single Parameter**: Just specify the row number from the "Agroverse QR codes" sheet
- **🔄 Data Consistency**: All data comes from the same source (Google Sheet)
- **🛡️ Less Error-Prone**: No risk of mismatched parameters
- **📝 Easier Maintenance**: Changes to data only need to be made in one place
- **⚡ Faster Setup**: No need to look up individual field values
- **📁 Dynamic Upload Location**: QR codes are uploaded to the exact location specified in column K of the sheet

#### **Example Comparison:**

**Old Way (Multiple Parameters):**
```bash
python webhook_client.py --product-name "8 Ounce Package Kraft Pouch - Ilheus, Brazil 2024" \
  --farm-name "Oscar Farm" \
  --state "Bahia" \
  --country "Brazil" \
  --year "2024" \
  --landing-page-url "https://www.agroverse.shop/shipments/agl4" \
  --method dispatch
```

**New Way (Single Parameter):**
```bash
python webhook_client.py --sheet-row 708 --method dispatch
```

### **📁 Dynamic Upload Location Feature**

The system now automatically uploads QR codes to the exact location specified in **Column K** of the "Agroverse QR codes" sheet:

#### **How It Works:**
1. **Column K** contains the GitHub URL where the QR code should be uploaded
2. **URL Format**: `https://github.com/owner/repo/blob/branch/filename.png`
3. **Automatic Parsing**: The system extracts repository and file path from the URL
4. **Precise Upload**: QR codes are uploaded to the exact location specified

#### **Example:**
If Column K contains: `https://github.com/TrueSightDAO/qr_codes/blob/main/Gary_Land_20250829_GARY_TEST.png`

The system will:
- ✅ Extract repository: `TrueSightDAO/qr_codes`
- ✅ Extract path: `Gary_Land_20250829_GARY_TEST.png`
- ✅ Upload QR code to that exact location
- ✅ Return the correct raw URL: `https://raw.githubusercontent.com/TrueSightDAO/qr_codes/main/Gary_Land_20250829_GARY_TEST.png`

#### **Benefits:**
- **🎯 Precise Control**: Upload to any repository and path specified in the sheet
- **🔄 Flexible Organization**: Organize QR codes in different folders or repositories
- **📝 Centralized Management**: All upload locations managed in the Google Sheet
- **🛡️ No Hardcoding**: No need to modify code for different upload locations
- **🔄 File Override**: Automatically overrides existing files instead of creating duplicates

### **Method 1: Local Workflow**

### **Method 1: GitHub Actions Webhook (Simplified)**

Trigger via repository_dispatch event using sheet row number:

```bash
# Using sheet row (recommended - much simpler!)
python webhook_client.py --sheet-row 708 \
  --github-token YOUR_TOKEN \
  --repository TrueSightDAO/tokenomics \
  --method dispatch

# Or using individual parameters (legacy method)
python webhook_client.py --product-name "Caramelized Cacao Kraft Pouch - Alibaba:269035810001023771 + Caramelized Cacao Beans CP340993299BR San Francisco AGL10" \
  --github-token YOUR_TOKEN \
  --repository TrueSightDAO/tokenomics \
  --method dispatch \
  --google-script-url "https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec"
```

### **Method 2: Manual Workflow Dispatch**

Trigger via workflow_dispatch (manual trigger):

```bash
# Using sheet row (recommended - much simpler!)
python webhook_client.py --sheet-row 708 \
  --github-token YOUR_TOKEN \
  --repository TrueSightDAO/tokenomics \
  --method workflow

# Or using individual parameters (legacy method)
python webhook_client.py --product-name "Caramelized Cacao Kraft Pouch - Alibaba:269035810001023771 + Caramelized Cacao Beans CP340993299BR San Francisco AGL10" \
  --github-token YOUR_TOKEN \
  --repository TrueSightDAO/tokenomics \
  --method workflow \
  --google-script-url "https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec"
```

### **Method 3: Issue-Based Triggering**

Create a GitHub issue and trigger webhook:

```bash
# Using sheet row (recommended - much simpler!)
python webhook_client.py --sheet-row 708 \
  --github-token YOUR_TOKEN \
  --repository TrueSightDAO/tokenomics \
  --method issue \
  --issue-title "Generate QR Code for Row 708"

# Or using individual parameters (legacy method)
python webhook_client.py --product-name "Caramelized Cacao Kraft Pouch - Alibaba:269035810001023771 + Caramelized Cacao Beans CP340993299BR San Francisco AGL10" \
  --github-token YOUR_TOKEN \
  --repository TrueSightDAO/tokenomics \
  --method issue \
  --issue-title "Generate QR Code for Caramelized Cacao Kraft Pouch" \
  --google-script-url "https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec"
```

### **Method 4: External Webhook (cURL)**

Trigger directly via GitHub API:

```bash
# Using sheet row (recommended - much simpler!)
curl -X POST \
  -H "Authorization: token YOUR_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/TrueSightDAO/tokenomics/dispatches \
  -d '{
    "event_type": "qr-code-generation",
    "client_payload": {
      "sheet_row": 708
    }
  }'

# Or using individual parameters (legacy method)
curl -X POST \
  -H "Authorization: token YOUR_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/TrueSightDAO/tokenomics/dispatches \
  -d '{
    "event_type": "qr-code-generation",
    "client_payload": {
      "product_name": "Caramelized Cacao Kraft Pouch - Alibaba:269035810001023771 + Caramelized Cacao Beans CP340993299BR San Francisco AGL10",
      "google_script_url": "https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec"
    }
  }'
```

## 🔧 **How It Works**

### **Workflow Execution:**

1. **Webhook Triggered** → `TrueSightDAO/tokenomics` repository
2. **Code Checkout** → Clones tokenomics repository (contains scripts)
3. **Assets Checkout** → Clones qr_codes repository (for QR code storage)
4. **Script Execution** → Runs from tokenomics repository
5. **QR Code Generation** → Creates images in qr_codes repository
6. **Commit & Push** → Updates qr_codes repository with new QR codes

### **QR Code Generation Process:**

1. **Product Search** - Searches the "Currencies" sheet for matching products
2. **QR Code Generation** - Creates a new record in the "Agroverse QR codes" sheet
3. **Automated Webhook** - Google App Script automatically triggers GitHub Actions webhook
4. **Image Creation** - Generates the actual QR code image
5. **GitHub Deployment** - Commits and pushes to the repository

### **QR Code Value Format:**

```
[Year]_[YYYYMMDD]_[running_number]
```

Example: `2025_20241215_1`

- **Year**: From the product record or current year
- **YYYYMMDD**: Current date
- **running_number**: Auto-incrementing number for the same date

## 📊 **Google Sheets Structure**

### **Currencies Sheet (Source)**
- **Column A**: Product name
- **Column D**: Product image
- **Column E**: Landing page
- **Column F**: Ledger
- **Column G**: Farm name
- **Column H**: State
- **Column I**: Country
- **Column J**: Year

### **Agroverse QR codes Sheet (Destination)**
- **Column A**: QR Code value
- **Column B**: Landing page
- **Column C**: Ledger
- **Column D**: Status (MINTED)
- **Column E**: Farm name
- **Column F**: State
- **Column G**: Country
- **Column H**: Year
- **Column I**: Product name
- **Column J**: Current date (YYYYMMDD)
- **Column K**: GitHub URL
- **Column L**: Email (placeholder)
- **Column M**: (placeholder)
- **Column N**: (placeholder)
- **Column O**: (placeholder)
- **Column P**: Product image (from Currencies sheet Column D)
- **Column Q**: (placeholder)
- **Column R**: (placeholder)
- **Column S**: (placeholder)
- **Column T**: Price (default value: 25)

## 📊 **Monitoring and Results**

### **GitHub Actions Dashboard**

1. **View Workflow Runs:**
   - Go to `TrueSightDAO/tokenomics` → Actions tab
   - Click on "QR Code Generation Webhook"
   - View recent runs and their status

2. **Check Results:**
   - Click on a completed run
   - Download the "qr-code-results" artifact
   - View the JSON results file

### **Programmatic Monitoring**

List recent workflow runs:

```bash
python webhook_client.py "dummy" \
  --github-token YOUR_TOKEN \
  --repository TrueSightDAO/tokenomics \
  --list-runs
```

### **Issue Comments**

When using issue-based triggering, results are automatically posted as comments:

```
## QR Code Generation Results

✅ **Success!** QR code generated for product: `Caramelized Cacao Kraft Pouch - Alibaba:269035810001023771 + Caramelized Cacao Beans CP340993299BR San Francisco AGL10`

**QR Code:** `2025_20241215_1`
**GitHub URL:** https://github.com/TrueSightDAO/qr_codes/blob/main/2025_20241215_1.png
**Sheet Row:** 15
**Timestamp:** 2024-12-15T10:30:00
```

## 🤖 **Automated Webhook Trigger**

### **How It Works:**

When you call the Google App Script to generate a QR code, it now automatically:

1. **Creates the QR code record** in the "Agroverse QR codes" sheet
2. **Triggers GitHub Actions webhook** with the row number
3. **Generates the QR code image** via Python script
4. **Uploads to GitHub** at the specified location

### **Setup Required:**

1. **GitHub Token Configuration:**
   ```javascript
   // In Google Apps Script, go to Project Settings → Script Properties
   // Add a new property:
   // Key: GITHUB_TOKEN
   // Value: your_github_personal_access_token
   ```

2. **Token Permissions:**
   - The token needs `repo` scope to trigger workflows
   - It should have access to `TrueSightDAO/tokenomics` repository

### **Benefits:**
- **🔄 Fully Automated**: No manual intervention needed
- **⚡ Instant Trigger**: QR code image generation starts immediately
- **📊 Consistent Process**: Same workflow every time
- **🛡️ Secure**: Uses GitHub token for authentication

## 🌐 **HTML/JavaScript Frontend (Recommended)**

The easiest way to use this service is through a simple HTML/JavaScript frontend that calls the Google App Script directly.

### **1. Using the Example Frontend**

1. **Open the example file:**
   ```bash
   open agroverse_qr_code_web_service/html_frontend_example.html
   ```

2. **Update the Google App Script URL:**
   - Replace `YOUR_SCRIPT_ID` with your actual Google App Script deployment ID
   - The URL should look like: `https://script.google.com/macros/s/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/exec`

3. **Use the interface:**
   - Enter a product name or click an example
   - Click "Generate QR Code"
   - View the results

### **2. Frontend Features**

- **No Credentials Required**: Works directly with Google App Script
- **Example Products**: Click to use predefined product names
- **Local Storage**: Remembers your settings
- **Real-time Feedback**: Shows loading states and results
- **Error Handling**: Displays clear error messages

### **3. Custom Frontend Integration**

You can integrate this into your own web application:

```javascript
// Call Google App Script webhook
async function generateQRCode(productName, scriptUrl) {
    const response = await fetch(scriptUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            product_name: productName
        })
    });
    
    const result = await response.json();
    return result;
}

// Usage
const result = await generateQRCode(
    'Caramelized Cacao Kraft Pouch - Alibaba:269035810001023771 + Caramelized Cacao Beans CP340993299BR San Francisco AGL10',
    'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec'
);

// Example Response:
// {
//   "status": "success",
//   "data": {
//     "action": "generate",
//     "product_name": "Caramelized Cacao Kraft Pouch - Alibaba:269035810001023771 + Caramelized Cacao Beans CP340993299BR San Francisco AGL10",
//     "qr_code": "2025_20241215_1",
//     "row_added": 15,
//     "github_url": "https://github.com/TrueSightDAO/qr_codes/blob/main/2025_20241215_1.png",
//     "webhook_triggered": true,
//     "webhook_message": "GitHub Actions webhook triggered successfully for row 15"
//   }
// }

if (result.status === 'success') {
    console.log('QR Code:', result.data.qr_code);
    console.log('GitHub URL:', result.data.github_url);
    console.log('Webhook Triggered:', result.data.webhook_triggered);
    console.log('Webhook Message:', result.data.webhook_message);
}
```

## 🔄 **Integration Examples**

### **Method Comparison:**

| Method | What It Does | When to Use | Pros | Cons |
|--------|-------------|-------------|------|------|
| **Google** | Calls Google App Script directly | Simple testing, automated QR image generation | Fast, automated webhook trigger | Requires GitHub token setup in GAS |
| **Dispatch** | Triggers GitHub Actions workflow | Automated systems, external integrations | Full workflow (Google Sheets + QR image), automated | Requires GitHub token, slower |
| **Workflow** | Manual GitHub Actions trigger | Manual testing, one-off runs | Full workflow, manual control | Requires GitHub token, manual process |
| **Issue** | Creates GitHub issue + triggers workflow | Issue-based workflows | Trackable, commentable | Requires GitHub token, creates issues |

### **1. Direct Google App Script Call (Google Sheets Only)**

**What it does:** Creates the QR code record in Google Sheets + automatically triggers QR image generation

```bash
python webhook_client.py "Caramelized Cacao Kraft Pouch - Alibaba:269035810001023771 + Caramelized Cacao Beans CP340993299BR San Francisco AGL10" \
  --method google \
  --google-script-url "https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec"
```

**Use when:** You want the complete automated workflow (recommended for most use cases)

### **2. GitHub Actions Repository Dispatch (Full Workflow)**

**What it does:** Creates Google Sheets record + generates QR code image + uploads to GitHub

```bash
python webhook_client.py "Caramelized Cacao Kraft Pouch - Alibaba:269035810001023771 + Caramelized Cacao Beans CP340993299BR San Francisco AGL10" \
  --github-token YOUR_TOKEN \
  --repository TrueSightDAO/tokenomics \
  --method dispatch
```

**Use when:** You want the complete workflow (recommended for production)

### **3. Manual Workflow Dispatch (Full Workflow)**

**What it does:** Same as method 2, but triggered manually through GitHub UI

```bash
python webhook_client.py "Caramelized Cacao Kraft Pouch - Alibaba:269035810001023771 + Caramelized Cacao Beans CP340993299BR San Francisco AGL10" \
  --github-token YOUR_TOKEN \
  --repository TrueSightDAO/tokenomics \
  --method workflow
```

**Use when:** Manual testing or one-off QR code generation

### **Quick Decision Guide:**

**🤔 Which method should I use?**

- **"I just want to test the Google Sheets integration"** → Use **Method 1 (Google)**
- **"I want the complete QR code generation workflow"** → Use **Method 2 (Dispatch)**
- **"I want to manually trigger from GitHub UI"** → Use **Method 3 (Workflow)**
- **"I want to track requests as GitHub issues"** → Use **Method 4 (Issue)**

**📋 Simple Flow:**
1. **Method 1**: Product name → Google Sheets record + automated QR image generation
2. **Method 2**: Product name → Google Sheets record + QR image + GitHub upload (external trigger)
3. **Method 3**: Same as Method 2, but manual trigger
4. **Method 4**: Same as Method 2, but creates GitHub issue first

### **4. Slack Integration**

Create a Slack slash command that triggers QR code generation:

```python
import requests

def trigger_qr_generation(product_name, github_token):
    url = "https://api.github.com/repos/TrueSightDAO/tokenomics/dispatches"
    headers = {
        'Authorization': f'token {github_token}',
        'Accept': 'application/vnd.github.v3+json'
    }
    payload = {
        'event_type': 'qr-code-generation',
        'client_payload': {
            'product_name': product_name
        }
    }
    response = requests.post(url, headers=headers, json=payload)
    return response.status_code == 204

# Example usage:
# trigger_qr_generation("Caramelized Cacao Kraft Pouch - Alibaba:269035810001023771 + Caramelized Cacao Beans CP340993299BR San Francisco AGL10", github_token)
```

### **5. Zapier Integration**

1. **Trigger:** New form submission
2. **Action:** Webhook to GitHub API
3. **Result:** QR code generated automatically

### **6. CI/CD Pipeline Integration**

Add to your deployment pipeline:

```yaml
- name: Generate QR Code
  run: |
    python webhook_client.py "${{ env.PRODUCT_NAME }}" \
      --github-token ${{ secrets.GITHUB_TOKEN }} \
      --repository TrueSightDAO/tokenomics \
      --method dispatch
```

## 🔐 **Security Considerations**

### **Repository Access:**

1. **tokenomics Repository:**
   - Contains sensitive code and configuration
   - Should have restricted access
   - GitHub token needs read access

2. **qr_codes Repository:**
   - Contains only generated QR code images
   - Can be public for easy access
   - GitHub token needs write access

### **Token Permissions:**

The GitHub token needs these permissions:
- `repo` (full repository access to both repositories)
- `workflow` (workflow permissions)

### **Data Privacy:**
- Product information is stored in Google Sheets
- QR codes are publicly accessible on GitHub
- Ensure no sensitive data is included in QR code URLs

## 🚨 **Troubleshooting**

### **Common Issues:**

1. **Google App Script URL not working:**
   - Ensure the script is deployed as a web app
   - Check that "Who has access" is set to "Anyone"
   - Verify the deployment URL is correct

2. **GitHub authentication issues:**
   - Ensure you have a valid personal access token
   - Check repository permissions
   - Verify the repository exists and is accessible

3. **Google Sheets access issues:**
   - Ensure the script has access to the spreadsheet
   - Check that sheet names match exactly
   - Verify the spreadsheet URL is correct

4. **Permission Denied:**
   - Ensure GitHub token has access to both repositories
   - Check repository visibility settings

5. **Workflow Not Found:**
   - Verify workflow file is in `.github/workflows/` in tokenomics repository
   - Check workflow file syntax

6. **QR Codes Not Committed:**
   - Check if qr_codes repository exists and is accessible
   - Verify GitHub token has write permissions

### **Debug Commands:**

```bash
# Test repository access
curl -H "Authorization: token YOUR_TOKEN" \
  https://api.github.com/repos/TrueSightDAO/tokenomics

curl -H "Authorization: token YOUR_TOKEN" \
  https://api.github.com/repos/TrueSightDAO/qr_codes

# Test webhook trigger
python webhook_client.py "Test Product" \
  --github-token YOUR_TOKEN \
  --repository TrueSightDAO/tokenomics \
  --method dispatch

# List recent runs
python webhook_client.py "dummy" \
  --github-token YOUR_TOKEN \
  --repository TrueSightDAO/tokenomics \
  --list-runs

# Create issue with webhook
python webhook_client.py "Test Product" \
  --github-token YOUR_TOKEN \
  --repository TrueSightDAO/tokenomics \
  --method issue
```

### **Debug Mode:**

Enable debug logging by modifying the Python script:

```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

## 📈 **Benefits of This Setup**

### **✅ Advantages:**

1. **Clean Separation** - Code and assets are separate
2. **Security** - Sensitive code is protected
3. **Performance** - Each repository stays focused
4. **Scalability** - Easy to manage as system grows
5. **Access Control** - Different permissions for different purposes
6. **No Server Infrastructure** - Uses GitHub's free infrastructure
7. **Reliable** - GitHub's 99.9% uptime SLA
8. **Cost-Effective** - No additional infrastructure costs
9. **Integrable** - Easy to integrate with external systems

### **⚠️ Limitations:**

1. **GitHub Actions Limits** - 2000 minutes/month for free accounts
2. **Execution Time** - Maximum 6 hours per workflow run
3. **Rate Limits** - GitHub API rate limits apply
4. **Complexity** - Slightly more complex setup
5. **Token Management** - Need tokens with cross-repository access

## 🚀 **Deployment Options**

### **Option 1: Local Execution**
- Simple setup
- Immediate results
- Full control
- Good for development

### **Option 2: GitHub Actions Webhook**
- Scalable automation
- External integration
- No server infrastructure
- Production-ready

### **Option 3: Hybrid Approach**
- Use local for development
- Use webhooks for production
- Best of both worlds

## 🔮 **Future Enhancements**

### **Potential Improvements:**

1. **Batch Processing** - Generate multiple QR codes at once
2. **Image Customization** - Add logos and branding to QR codes
3. **Analytics** - Track QR code usage and performance
4. **Web Interface** - Create a user-friendly web interface
5. **API Rate Limiting** - Handle Google Sheets API limits
6. **Backup System** - Automatic backup of generated QR codes
7. **Scheduled Generation** - Automatic QR code generation on schedule
8. **Multi-Repository Support** - Support for multiple target repositories

### **Advanced Features:**

1. **Dynamic Upload Location** - Uploads QR codes to the exact location specified in column K of the Google Sheet
2. **Conflict Resolution** - Automatically handles duplicate QR codes by overriding existing files
3. **Webhook Signatures** - Verify webhook authenticity
4. **Retry Logic** - Automatic retry on failures
5. **Parallel Processing** - Generate multiple QR codes simultaneously
6. **Caching** - Cache frequently requested QR codes
7. **Notifications** - Slack/email notifications on completion

## 🆘 **Support**

### **Getting Help:**

1. Check the troubleshooting section above
2. Review GitHub Actions logs
3. Verify all configuration settings
4. Test with simple examples first
5. Check workflow run details
6. Verify all configuration
7. Test with known working examples

### **Common Commands:**

```bash
# Test webhook trigger
python webhook_client.py "Test Product" --github-token YOUR_TOKEN --repository TrueSightDAO/tokenomics --method dispatch

# List recent runs
python webhook_client.py "dummy" --github-token YOUR_TOKEN --repository TrueSightDAO/tokenomics --list-runs

# Create issue with webhook
python webhook_client.py "Test Product" --github-token YOUR_TOKEN --repository TrueSightDAO/tokenomics --method issue
```

## 📄 **License**

This project is part of the TrueSightDAO tokenomics ecosystem. See the main repository for licensing information.

---

This cross-repository setup provides the best balance of security, organization, and functionality for your QR code generation system.
