# Telegram and WhatsApp Chatlog Scoring System

## Overview

This repository contains Google Apps Script (GAS) files designed to process and score chat logs from Telegram and WhatsApp, tracking contributions for a token-based reward system (TDG tokens). The scripts integrate with Google Sheets for data storage, Google Drive for file management, and external APIs (xAI and OpenAI) for scoring and analysis. The primary goal is to automate the collection, processing, and scoring of contributions from chat platforms, generating a ledger of contributor activities and issuing TDG tokens based on predefined criteria.

### Purpose
- **Import Chat Logs**: Fetch Telegram messages and process WhatsApp chat logs from text files.
- **Score Contributions**: Use AI (xAI's Grok model) to evaluate contributions and assign TDG tokens (e.g., 100 TDG per hour of effort, 1 TDG per USD spent).
- **Track and Notify**: Log data in Google Sheets and send Telegram notifications to contributors.
- **Prevent Duplicates**: Use hashing to ensure contributions are unique and avoid reprocessing.

### Files in This Repository
1. **[`grok_scoring_for_telegram_and_whatsapp_logs.gs`](./grok_scoring_for_telegram_and_whatsapp_logs.gs)**  
   - **Purpose**: Main script for processing and scoring chat logs from both Telegram and WhatsApp.
   - **Features**:
     - Fetches Telegram logs from a Google Sheet and WhatsApp logs from `.txt` files in Google Drive.
     - Uses xAI’s Grok API to score contributions and assign TDG tokens.
     - Manages intermediate processing sheets, tracks file status, and sends Telegram notifications.
     - Integrates with multiple Google Sheets for input, output, and status tracking.
   - **Key Functions**:
     - `processTelegramChatLogs()`: Processes Telegram logs.
     - `processWhatsappChatlogs()`: Handles WhatsApp `.txt` files.
     - `checkTdgIssued()`: Scores contributions via Grok API.
     - `sendTelegramNotification()`: Notifies contributors.

2. **[`importer_telegram_chatlogs_to_google_sheet.gs`](./importer_telegram_chatlogs_to_google_sheet.gs)**  
   - **Purpose**: Imports Telegram chat logs directly from the Telegram API into a Google Sheet.
   - **Features**:
     - Pulls updates from Telegram using the Bot API.
     - Logs messages with metadata (chat ID, contributor, timestamp) into a Google Sheet.
     - Sends acknowledgment messages to Telegram chats.
   - **Key Functions**:
     - `processTelegramLogs()`: Fetches and logs Telegram messages.
     - `addTabulationEntry()`: Adds entries to the Google Sheet.
     - `sendMessageToTelegram()`: Sends thank-you messages.

---

## Prerequisites

- **Google Account**: Required for Google Apps Script, Sheets, and Drive access.
- **Telegram Bot**: Create a bot via [BotFather](https://t.me/BotFather) to get a `TELEGRAM_API_TOKEN`.
- **API Keys**:
  - `XAI_API_KEY`: For xAI’s Grok API (used in scoring).
  - `OPENAI_API_KEY`: For OpenAI API (used for equinox/solstice dates in [`grok_scoring_for_telegram_and_whatsapp_logs.gs`](./grok_scoring_for_telegram_and_whatsapp_logs.gs)).
- **Google Sheets**: Set up sheets as described in the configuration section.
- **Google Drive**: Folders for WhatsApp chat logs and intermediate files.

---

## Setup Instructions

### 1. Clone the Repository
Clone this repository to your local machine or directly copy the `.gs` files into a Google Apps Script project.

```bash
git clone <repository-url>