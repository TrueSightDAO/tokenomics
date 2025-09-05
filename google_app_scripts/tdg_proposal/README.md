# TDG Proposal Management System

A comprehensive decentralized autonomous organization (DAO) proposal management system that enables community members to create, vote on, and automatically process proposals through GitHub pull requests.

## 🎯 Overview

The TDG Proposal Management System is a fully automated solution that bridges the gap between community governance and technical implementation. It allows DAO members to submit proposals through a user-friendly web interface, vote on them using digital signatures, and automatically processes the results based on voting outcomes.

## 🏗️ System Architecture

### Components

1. **Frontend DApp** - Web interface for proposal creation and voting
2. **Google Apps Script Backend** - Automated proposal processing and GitHub integration
3. **GitHub Repository** - Proposal storage and version control
4. **Google Sheets** - Data tracking and audit trail
5. **Digital Signature System** - Secure voting authentication

## 📁 Repository Structure

```
tdg_proposal/
├── proposal_manager.gs          # Main Google Apps Script for proposal management
└── README.md                    # This documentation file
```

## 🔧 Core Files

### `proposal_manager.gs`
The main Google Apps Script that handles:
- **Proposal Creation**: Creates GitHub pull requests from submitted proposals
- **Vote Processing**: Tabulates votes and manages voting comments
- **Automatic Closure**: Closes/merges PRs based on voting outcomes after expiration
- **Web API**: Provides REST endpoints for the DApp frontend
- **Data Processing**: Processes submissions from Telegram logs and DApp interfaces

**Source Code**: [https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_proposal/proposal_manager.gs](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_proposal/proposal_manager.gs)

## 🌐 DApp Frontend

The proposal management DApp is hosted at: **https://truesightdao.github.io/dapp/**

### Key Pages:
- **Create Proposal**: https://truesightdao.github.io/dapp/create_proposal.html
- **Review Proposals**: https://truesightdao.github.io/dapp/review_proposal.html
- **View Open Proposals**: https://truesightdao.github.io/dapp/view_open_proposals.html
- **Create Digital Signature**: https://truesightdao.github.io/dapp/create_signature.html
- **Verify Requests**: https://truesightdao.github.io/dapp/verify_request.html

### Source Code Location:
- **Repository**: https://github.com/TrueSightDAO/dapp
- **Main Files**: 
  - `create_proposal.html` - Proposal creation interface
  - `review_proposal.html` - Proposal review and voting interface
  - `view_open_proposals.html` - List all open proposals
  - `create_signature.html` - Digital signature creation
  - `verify_request.html` - Request verification system

## 📊 Google Sheets Integration

### Main Spreadsheet
- **Telegram Chat Logs**: https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ
- **Sheet**: "Telegram Chat Logs" - Contains all proposal submissions and votes
- **Sheet**: "Proposal Submissions" - Processed proposal data and status tracking

### Data Flow
1. Users submit proposals through DApp
2. Submissions are logged in Telegram Chat Logs
3. Google Apps Script processes submissions
4. GitHub pull requests are created automatically
5. Voting data is tracked in Proposal Submissions sheet

## 🔄 How It Works

### 1. Proposal Creation Process
```
User → DApp Interface → Digital Signature → Telegram Logs → Google Apps Script → GitHub PR
```

1. **User submits proposal** through the DApp interface
2. **Digital signature** is created and attached to the submission
3. **Submission is logged** in the Telegram Chat Logs spreadsheet
4. **Google Apps Script processes** the submission automatically
5. **GitHub pull request** is created with the proposal content
6. **Initial voting tabulation** comment is added to the PR

### 2. Voting Process
```
User → DApp Interface → Vote Submission → Digital Signature → GitHub Comments → Vote Tally
```

1. **User reviews proposal** through the DApp interface
2. **Vote is submitted** with digital signature verification
3. **Vote is posted** as a comment on the GitHub PR
4. **Voting tabulation** is updated automatically
5. **Vote counts** are tracked and displayed in real-time

### 3. Automatic Processing
```
Voting Deadline → Vote Count Check → Majority Decision → Merge/Close PR → Summary Comment
```

1. **Voting period expires** (default: 7 days)
2. **Vote counts are tallied** from GitHub comments
3. **Majority decision** is determined (YES > NO = Merge, NO > YES = Close)
4. **PR is processed** based on voting outcome
5. **Summary comment** is posted with final results

## ⚙️ Configuration

### Required Script Properties
Set these in Google Apps Script Project Settings:

```javascript
GITHUB_TOKEN          // GitHub Personal Access Token
GITHUB_OWNER          // Repository owner (e.g., "TrueSightDAO")
GITHUB_REPO           // Repository name (e.g., "proposals")
```

### Optional Script Properties
```javascript
MAIN_BRANCH           // Default: "main"
BRANCH_PREFIX         // Default: "proposal-"
FILE_EXTENSION        // Default: ".md"
VOTING_DEADLINE_DAYS  // Default: 7
MINIMUM_VOTES         // Default: 1
ENABLE_EMAIL_NOTIFICATIONS // Default: false
ADMIN_EMAIL           // Default: "admin@truesight.me"
```

## 🚀 Getting Started

### 1. Setup Google Apps Script
1. Open the `proposal_manager.gs` file in Google Apps Script
2. Set the required script properties in Project Settings
3. Deploy as a web app with appropriate permissions
4. Test the configuration using `quickSetupTest()`

### 2. Configure Daily Automation
1. Go to "Triggers" in Google Apps Script
2. Add a new trigger for `autoCloseExpiredProposals`
3. Set to run daily at your preferred time
4. Test with `testAutoCloseExpiredProposals()` first

### 3. Test the System
```javascript
// Test configuration
quickSetupTest()

// Test proposal creation
testCreateProposalOnly()

// Test voting
testSubmitVoteOnly(prNumber)

// Test auto-close (dry run)
testAutoCloseExpiredProposals()

// Run all tests
runAllTests()
```

## 🔍 API Endpoints

### Web App Endpoints
- `GET ?mode=list_open_proposals` - List all open proposals
- `GET ?mode=fetch_proposal&pr_number=X` - Get specific proposal with voting data
- `GET ?signature=XXX` - Verify digital signature

### POST Endpoints
- `POST` with `action=create_proposal` - Create new proposal
- `POST` with `action=submit_vote` - Submit vote for proposal

## 📈 Monitoring and Maintenance

### Daily Operations
- **Auto-close process** runs daily to process expired proposals
- **Email notifications** are sent for processed proposals (if enabled)
- **Vote tabulation** is updated in real-time as votes are submitted

### Logging
- All operations are logged in Google Apps Script Logger
- Detailed error messages and success confirmations
- Audit trail maintained in Google Sheets

### Troubleshooting
- Check Google Apps Script logs for errors
- Verify GitHub token permissions
- Ensure script properties are set correctly
- Test individual functions using provided test methods

## 🧪 Testing

### Available Test Functions
- `quickSetupTest()` - Validate configuration
- `testCreateProposalOnly()` - Test proposal creation
- `testSubmitVoteOnly(prNumber)` - Test voting
- `testAutoCloseExpiredProposals()` - Test auto-close (dry run)
- `runAllTests()` - Run complete test suite

### Test Data
The system includes comprehensive test data and methods for:
- Proposal creation with various content types
- Multiple vote submissions with different signatures
- Vote updates and superseding
- Comment submissions
- Error handling scenarios

## 🔐 Security Features

- **Digital Signatures**: All submissions require valid digital signatures
- **Signature Verification**: Built-in verification system prevents fraud
- **Vote Tracking**: Each signature can only vote once (latest vote supersedes previous)
- **Audit Trail**: Complete history maintained in Google Sheets
- **Rate Limiting**: Built-in delays to prevent API abuse

## 📞 Support and Documentation

### Related Documentation
- **Main Tokenomics Repository**: https://github.com/TrueSightDAO/tokenomics
- **DApp Repository**: https://github.com/TrueSightDAO/dapp
- **Google Apps Script Setup Guide**: See `GOOGLE_APPS_SCRIPT_SETUP.md` in parent directory

### Contact
For issues or questions about the proposal management system, please:
1. Check the logs in Google Apps Script
2. Review the test functions for examples
3. Verify configuration settings
4. Check GitHub repository issues

## 🎉 Features

✅ **Automated Proposal Creation** - Direct GitHub PR creation from DApp submissions  
✅ **Real-time Voting** - Live vote tabulation with digital signature verification  
✅ **Automatic Processing** - Daily auto-close of expired proposals based on voting  
✅ **Comprehensive Testing** - Full test suite with ready-to-use test methods  
✅ **Email Notifications** - Optional email reports for administrators  
✅ **Audit Trail** - Complete tracking in Google Sheets  
✅ **Error Handling** - Robust error handling with detailed logging  
✅ **Rate Limiting** - Built-in protection against API abuse  
✅ **Configuration Driven** - Flexible configuration via script properties  

---

*This system is part of the TrueSight DAO infrastructure and is designed to provide transparent, automated governance for community proposals.*
