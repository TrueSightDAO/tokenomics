# TDG Identity Management System

<div align="center">
  <img height="150" src="https://github.com/TrueSightDAO/.github/blob/main/assets/20240612_truesight_dao_logo_square.png?raw=true" alt="TrueSight DAO Logo">
</div>

## Purpose

This folder contains scripts for managing digital identities within TrueSight DAO's ecosystem. The primary purpose is to:

1. Securely register and verify member digital signatures
2. Maintain an auditable record of cryptographic identities
3. Automate the association between Telegram handles and DAO member identities
4. Provide notification systems for identity-related events

## Key Scripts

### [`register_member_digital_signatures.gs`](./register_member_digital_signatures_telegram.gs)

**Purpose**: Processes digital signature submissions from Telegram chats and registers them in the DAO's identity system.

**Key Functions:**
- Scans Telegram chat logs for `[DIGITAL SIGNATURE EVENT]` patterns
- Extracts and validates cryptographic signatures
- Resolves Telegram handles to DAO member names
- Updates the Digital Signatures registry with:
  - Member name
  - Creation timestamp 
  - Last active timestamp
  - Status (ACTIVE/INACTIVE)
  - The digital signature itself
- Sends Telegram notifications upon successful registration

**Data Flow:**
1. Input: Telegram chat logs (Google Sheet)
2. Processing: Signature extraction + member verification
3. Output: 
   - Updated Digital Signatures registry (Google Sheet)
   - Telegram notifications

## Reference Files

The system interacts with these key Google Sheets:

1. **Source Data**:
   - `Telegram Chat Logs` (Column G contains signature events)
   