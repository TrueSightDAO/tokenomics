# Google Apps Script Schedule Triggers Documentation

> **Last Updated:** 2025-01-XX
> 
> This document provides a consolidated reference for all scheduled triggers (time-driven triggers) configured in Google Apps Scripts for the TrueSight DAO ecosystem.

## 📋 Table of Contents

- [Overview](#overview)
- [Setup Instructions](#setup-instructions)
- [Scheduled Functions](#scheduled-functions)
  - [Sales Processing](#1-sales-processing)
  - [Inventory Movement Processing](#2-inventory-movement-processing)
  - [Expense Processing](#3-expense-processing)
  - [QR Code Update Processing](#4-qr-code-update-processing)
  - [Telegram Chat Log Processing](#5-telegram-chat-log-processing)
  - [Capital Injection Processing](#6-capital-injection-processing)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

---

## Overview

Scheduled triggers serve as **backup processing** for webhook-triggered functions. They ensure that any records missed by webhooks (due to failures, timeouts, or race conditions) are eventually processed.

**Key Principles:**
- Triggers run on a schedule (typically every 5-30 minutes)
- They process unprocessed records from "Telegram Chat Logs" sheet
- They use hash keys for deduplication to prevent duplicate processing
- They complement (not replace) webhook processing

---

## Setup Instructions

### How to Create a Time-Driven Trigger

1. **Open Google Apps Script Editor**:
   - Navigate to the relevant `.gs` file in the Apps Script editor
   - Or go to [script.google.com](https://script.google.com)

2. **Access Triggers**:
   - Click on "Triggers" (clock icon) in the left sidebar
   - Or go to: Edit → Current project's triggers

3. **Add New Trigger**:
   - Click "+ Add Trigger" button
   - Configure the trigger:
     - **Function**: Select the function name (e.g., `parseAndProcessTelegramLogs`)
     - **Event source**: Select "Time-driven"
     - **Type of time based trigger**: 
       - "Minutes timer" (for frequent processing: 5-15 minutes)
       - "Hour timer" (for less frequent processing: 1-6 hours)
       - "Day timer" (for daily processing)
     - **Time of day**: (if using day timer)
     - **Interval**: Select the interval (e.g., "Every 5 minutes", "Every hour")
   - Click "Save"

4. **Verify Trigger**:
   - The trigger should appear in the triggers list
   - Check execution logs to ensure it's running correctly

### How to Remove a Trigger

1. Go to "Triggers" in the Apps Script editor
2. Click the three dots (⋮) next to the trigger
3. Select "Delete trigger"
4. Confirm deletion

---

## Scheduled Functions

### 1. Sales Processing

**Function:** `parseTelegramChatLogs()`  
**File:** [`google_app_scripts/tdg_inventory_management/process_sales_telegram_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/process_sales_telegram_logs.gs)

**Recommended Schedule:** Every 5-15 minutes

**Purpose:** Backup processing for `[SALES EVENT]` submissions

**What It Does:**
- Reads unprocessed sales events from "Telegram Chat Logs" sheet
- Validates QR codes and sales data
- Inserts records into "QR Code Sales" sheet
- Uses hash keys for deduplication

**Webhook Alternative:**
- Webhook URL: `https://script.google.com/macros/s/AKfycbzc15gptNmn8Pm726cfeXDnBxbxZ1L31MN6bkfBH7ziiz4gxl87vJXEhAAJJhZ5uAxq/exec`
- Action: `parseTelegramChatLogs`

---

### 2. Inventory Movement Processing

**Function:** `processTelegramChatLogsToInventoryMovement()`  
**File:** [`google_app_scripts/tdg_inventory_management/process_movement_telegram_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/process_movement_telegram_logs.gs)

**Recommended Schedule:** Every 5-15 minutes

**Purpose:** Backup processing for `[INVENTORY MOVEMENT]` submissions

**What It Does:**
- Reads unprocessed inventory movement events from "Telegram Chat Logs" sheet
- Validates sender, recipient, and inventory data
- Resolves target ledger from QR code or explicit ledger name
- Inserts records into "Inventory Movement" sheet
- Updates ledger balances (offchain or managed AGL ledgers)

**Webhook Alternative:**
- Webhook URL: `https://script.google.com/macros/s/AKfycbzECOd1Y3mH7L0zU8hOC4AxQctYICX0Ws8j2-Md1dWg0k3GFGQx_4Cf7n-CM0usmSJ1/exec`
- Action: `processTelegramChatLogs`

---

### 3. Expense Processing

**Function:** `parseAndProcessTelegramLogs()`  
**File:** [`google_app_scripts/tdg_asset_management/tdg_expenses_processing.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_asset_management/tdg_expenses_processing.gs)

**Recommended Schedule:** Every 15-30 minutes

**Purpose:** Backup processing for `[DAO Inventory Expense Event]` submissions

**What It Does:**
- Reads unprocessed expense events from "Telegram Chat Logs" sheet
- **Only processes rows from the last 30 days** (based on Status Date column) to prevent timeouts
- Validates reporter via digital signature or Telegram handle
- Uploads attached files to GitHub if present
- Inserts scored expense into "Scored Expense Submissions" sheet (Column M: Target Ledger)
- Inserts expense transaction into target ledger (offchain or managed AGL ledger)
- Sends Telegram notification with expense details

**Performance Optimization:**
- **30-Day Filtering**: Automatically skips rows older than 30 days to prevent timeouts
- Processes only recent data for better performance

**Target Ledger Resolution Priority:**
1. Column M (Target Ledger) - explicitly set in expense form
2. Extracted Target Ledger from expense message
3. Ledger prefix in inventory type format `[ledger name] inventoryType`
4. Default to "offchain" transactions sheet

**Webhook Alternative:**
- Webhook URL: `https://script.google.com/macros/s/AKfycbwYBlFigSSPJKkI-F2T3dSsdLnvvBi2SCGF1z2y1k95YzA5HBrJVyMo6InTA9Fud2bOEw/exec`
- Action: `parseAndProcessTelegramLogs`

---

### 4. QR Code Update Processing

**Function:** `processQrCodeUpdatesCron()`  
**File:** [`google_app_scripts/agroverse_qr_codes/process_qr_code_updates.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/agroverse_qr_codes/process_qr_code_updates.gs)

**Recommended Schedule:** Every 5-15 minutes

**Purpose:** Backup processing for `[QR CODE UPDATE EVENT]` submissions

**What It Does:**
- Reads unprocessed QR code update events from "Telegram Chat Logs" sheet
- Updates QR code status in "Agroverse QR codes" sheet (Column D)
- Updates email address in "Agroverse QR codes" sheet (Column L)
- Updates manager name in "Agroverse QR codes" sheet (Column U) for member association

**Webhook Alternative:**
- Webhook URL: *(To be set after deployment)*
- Action: `processQrCodeUpdatesFromTelegramChatLogs`

---

### 5. Telegram Chat Log Processing

**Function:** `processTelegramChatLogs()`  
**File:** [`google_app_scripts/tdg_scoring/grok_scoring_for_telegram_and_whatsapp_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_scoring/grok_scoring_for_telegram_and_whatsapp_logs.gs)

**Recommended Schedule:** Every 1-6 hours

**Purpose:** AI scoring of general Telegram contributions

**What It Does:**
- Reads unprocessed chat logs from "Telegram Chat Logs" sheet
- Uses AI (Grok/OpenAI) to score contributions
- Assigns TDG tokens based on contribution rubric
- Inserts scored contributions into "Scored Chatlogs" sheet

**Note:** This is a more resource-intensive process, so it runs less frequently.

---

### 6. Capital Injection Processing

**Function:** `processCapitalInjectionCron()` (if exists)  
**File:** [`google_app_scripts/tdg_asset_management/capital_injection_processing.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_asset_management/capital_injection_processing.gs)

**Recommended Schedule:** Every 15-30 minutes

**Purpose:** Processing capital injection submissions

**What It Does:**
- Reads unprocessed capital injection events from "Telegram Chat Logs" sheet
- Validates reporter via digital signature
- Inserts double-entry transactions into managed AGL ledgers (Assets + Equity)
- Updates "Capital Injection" sheet with processing status

---

## Best Practices

### 1. Trigger Frequency

- **High-frequency triggers (5-15 minutes)**: For time-sensitive operations (sales, inventory movements, QR code updates)
- **Medium-frequency triggers (15-30 minutes)**: For less time-sensitive operations (expenses, capital injections)
- **Low-frequency triggers (1-6 hours)**: For resource-intensive operations (AI scoring)

### 2. Deduplication

All scheduled functions use hash keys for deduplication:
- Format: SHA-256 hash (16 characters)
- Input: `{messageId}-{contributorName}-{date}`
- Prevents duplicate processing even if triggers overlap

### 3. Error Handling

- Check execution logs regularly for errors
- Set up email notifications for trigger failures (in Apps Script settings)
- Monitor execution time to ensure triggers complete within time limits

### 4. Performance Optimization

- **Date Filtering**: Some functions (like expense processing) filter by date to process only recent data
- **Batch Processing**: Process records in batches if dealing with large datasets
- **Rate Limiting**: Be aware of API rate limits (Wix, Telegram, GitHub, etc.)

### 5. Monitoring

- Review execution logs weekly
- Check for failed executions
- Monitor execution time trends
- Verify data is being processed correctly

---

## Troubleshooting

### Trigger Not Running

1. **Check Trigger Status**:
   - Go to "Triggers" in Apps Script editor
   - Verify trigger is enabled (not paused)
   - Check if trigger has errors

2. **Check Execution Logs**:
   - Go to "Executions" in Apps Script editor
   - Look for failed executions
   - Review error messages

3. **Check Function Name**:
   - Ensure function name matches exactly (case-sensitive)
   - Verify function exists in the script file

### Timeout Errors

1. **Reduce Processing Window**:
   - Implement date filtering (e.g., last 30 days)
   - Process records in smaller batches

2. **Optimize Code**:
   - Reduce API calls
   - Cache frequently accessed data
   - Use batch operations where possible

### Duplicate Processing

1. **Check Hash Key Generation**:
   - Ensure hash keys are generated consistently
   - Verify hash key format matches between webhook and cron

2. **Check Deduplication Logic**:
   - Verify existing hash keys are checked before processing
   - Ensure hash keys are stored correctly in destination sheets

### Missing Records

1. **Check Date Filtering**:
   - Verify date filtering logic is correct
   - Ensure date format matches (YYYYMMDD)

2. **Check Pattern Matching**:
   - Verify event pattern matching (e.g., `[SALES EVENT]`, `[INVENTORY MOVEMENT]`)
   - Ensure pattern is case-insensitive if needed

---

## Related Documentation

- [API_ENDPOINTS.md](./API_ENDPOINTS.md) - Webhook endpoints and API documentation
- [SCHEMA.md](./SCHEMA.md) - Google Sheets schema documentation
- [API.md](./API.md) - Edgar API documentation

---

**Maintained by:** TrueSight DAO Development Team  
**Questions?** Check the corresponding `.gs` files for implementation details

