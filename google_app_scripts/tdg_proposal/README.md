# TDG Proposal Management System

This folder contains Google Apps Scripts for managing proposal workflows and governance processes within the TrueSight DAO ecosystem.

## 📁 Files Overview

### Core Scripts
- **`proposal_manager.gs`** - Main web app for proposal management
  - **Deployment URL**: `https://script.google.com/macros/s/AKfycbzgNstwRX1dWo17Dxny0t1ipJ6yLX02bTD_cKRuHr5RPJPemNVTj25mFhKo4UmR5Z7BIg/exec`
  - **Purpose**: Handles proposal data retrieval, listing open proposals, and fetching specific proposal details

## 🚀 API Endpoints

### GET Endpoints

#### List Open Proposals
```
GET /exec?mode=list_open_proposals
```
Returns a list of all currently open proposals.

#### Fetch Specific Proposal
```
GET /exec?mode=fetch_proposal&pr_number=<PR_NUMBER>
```
Fetches detailed information for a specific proposal by PR number.

#### Verify Digital Signature
```
GET /exec?signature=<DIGITAL_SIGNATURE>
```
Verifies a contributor's digital signature and returns associated information.

## 📋 Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mode` | string | Yes* | Operation mode: `list_open_proposals`, `fetch_proposal` |
| `pr_number` | string | Yes** | PR number for fetching specific proposal |
| `signature` | string | Yes*** | Digital signature for verification |

*Required when using mode-based operations
**Required when mode is `fetch_proposal`
***Required for signature verification

## 🔧 Setup Instructions

1. **Create Google Apps Script Project**
   - Go to [script.google.com](https://script.google.com)
   - Create a new project
   - Copy the contents of `proposal_manager.gs`

2. **Configure Data Sources**
   - Ensure access to proposal data sheets
   - Set up proper permissions for data access

3. **Deploy as Web App**
   - Deploy as web app with appropriate permissions
   - Copy the deployment URL for integration

## 🔗 Integration

This system integrates with:
- **DApp Frontend**: Proposal management interfaces
- **Digital Signatures**: Contributor verification system
- **Google Sheets**: Proposal data storage and retrieval

## 📊 Response Formats

### Success Response
```json
{
  "status": "success",
  "data": {
    // Proposal data or list of proposals
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

## 🔒 Security Considerations

- All requests require proper authentication
- Digital signatures are validated for security
- Access to proposal data is controlled through permissions

## 📝 Usage Examples

### List Open Proposals
```javascript
const response = await fetch('https://script.google.com/macros/s/AKfycbzgNstwRX1dWo17Dxny0t1ipJ6yLX02bTD_cKRuHr5RPJPemNVTj25mFhKo4UmR5Z7BIg/exec?mode=list_open_proposals');
const data = await response.json();
```

### Fetch Specific Proposal
```javascript
const response = await fetch('https://script.google.com/macros/s/AKfycbzgNstwRX1dWo17Dxny0t1ipJ6yLX02bTD_cKRuHr5RPJPemNVTj25mFhKo4UmR5Z7BIg/exec?mode=fetch_proposal&pr_number=123');
const proposal = await response.json();
```

## 🛠️ Maintenance

- Monitor proposal data integrity
- Update proposal statuses regularly
- Ensure proper error handling for all endpoints