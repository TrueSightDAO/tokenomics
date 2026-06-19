/**
 * Telegram webhook listener + review processing for the Grok scoring GAS project.
 *
 * doPost(e) — handles Telegram bot webhooks (existing functionality, unchanged).
 * doGet(e)  — handles ?exec=processApprovalRejections for review queue processing.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Existing doPost — Telegram webhook handler (unchanged)
// ──────────────────────────────────────────────────────────────────────────────

function doPost(e) {
  try {
    const json = JSON.parse(e.postData.contents);
    
    // --- route: if this is an Edgar review callback, handle it ---
    if (json.scoringHashKey) {
      return handleReviewCallback(json);
    }
    
    // --- existing Telegram webhook handling ---
    const update_id = json.update_id;
    const message = json.message || json.channel_post || json.edited_message;
    
    if (!message) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'ignored', reason: 'no message' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    const chat_id = message.chat.id;
    const message_id = message.message_id;
    const text = message.text || message.caption || '';
    
    // Check if this is a forwarded message from the Edgar Direct group
    const isForwardedFromEdgar = message.forward_from_chat && message.forward_from_chat.id == -1002190388985;
    
    // Check if this is a direct message to the Edgar Direct group
    const isEdgarDirect = chat_id == -1002190388985;
    
    if (isForwardedFromEdgar || isEdgarDirect) {
      // Process the message for contribution events
      processTelegramChatLogs(text, chat_id, message_id, update_id);
    }
    
    return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    console.error('Error in doPost:', error);
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// New doGet — review processing trigger
// ──────────────────────────────────────────────────────────────────────────────

function doGet(e) {
  try {
    const exec = e?.parameter?.exec || '';
    
    if (exec === 'processApprovalRejections') {
      const result = processApprovalRejections();
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // Health check / ping
    return ContentService.createTextOutput(JSON.stringify({
      status: 'ok',
      project: 'tdg_scoring',
      version: '1.0.0',
      endpoints: ['processApprovalRejections']
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    console.error('Error in doGet:', error);
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Review callback handler (for POST-based Edgar callbacks — kept for backward compat)
// ──────────────────────────────────────────────────────────────────────────────

function handleReviewCallback(json) {
  try {
    const result = processApprovalRejections();
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Core: processApprovalRejections
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Scan Telegram Chat Logs for unprocessed [CONTRIBUTION REVIEW EVENT] records
 * and update the corresponding Scored Chatlogs rows.
 *
 * @return {Object} Summary of processed records.
 */
function processApprovalRejections() {
  const SPREADSHEET_ID = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
  const SHEET_NAME = 'Telegram Chat Logs';
  
  const SCORED_SPREADSHEET_ID = '1Tbj7H5ur_egQLRugdXUaSIhEYIKp0vvVv2IZ7WTLCUo';
  const SCORED_SHEET_NAME = 'Scored Chatlogs';
  
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    return { status: 'error', error: 'Telegram Chat Logs sheet not found' };
  }
  
  const scoredSs = SpreadsheetApp.openById(SCORED_SPREADSHEET_ID);
  const scoredSheet = scoredSs.getSheetByName(SCORED_SHEET_NAME);
  if (!scoredSheet) {
    return { status: 'error', error: 'Scored Chatlogs sheet not found' };
  }
  
  // Get all data from Telegram Chat Logs
  // Columns: A=update_id, B=chatroom_id, C=chatroom_name, D=message_id, E=Edgar,
  // F=empty, G=contribution_made, H=Unknown, I=empty, J=Pending, K=empty, L=date,
  // M=empty, N=empty, O=empty, P=signature_verification, Q=status_info, R=api_response,
  // S=governor_authority, T=is_sentinel, X=Review Processed, Y=Review Transaction ID
  const data = sheet.getDataRange().getValues();
  
  // Get all data from Scored Chatlogs
  // Columns: A=Timestamp, B=Contributor Name, C=Contribution Description, D=Contribution Type,
  // E=TDGs Provisioned, F=Status, G=TDGs Issued, H=Hash Key, I=Found in Contributors,
  // J=Contributor Email, K=Telegram Chat Logs Row ID, L-N=other, O=Rejection Reason
  const scoredData = scoredSheet.getDataRange().getValues();
  
  // Build a map of hash_key -> { row_index, row_data } for Scored Chatlogs
  // Hash key is in column H (index 7)
  const scoredMap = {};
  for (let i = 0; i < scoredData.length; i++) {
    const hashKey = String(scoredData[i][7] || '').trim();
    if (hashKey) {
      scoredMap[hashKey] = { index: i, data: scoredData[i] };
    }
  }
  
  let processed = 0;
  let skipped = 0;
  let errors = [];
  
  // Scan Telegram Chat Logs for unprocessed review events
  // Col G (index 6) = contribution_made (event text)
  // Col X (index 23) = Review Processed (TRUE/FALSE)
  // Col Y (index 24) = Review Transaction ID
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const contributionText = String(row[6] || '').trim();
    
    // Skip if not a CONTRIBUTION REVIEW EVENT
    if (contributionText.indexOf('[CONTRIBUTION REVIEW EVENT]') === -1) {
      continue;
    }
    
    // Skip if already processed (Col X = TRUE)
    const reviewProcessed = String(row[23] || '').trim().toUpperCase();
    if (reviewProcessed === 'TRUE') {
      continue;
    }
    
    // Parse the review event fields
    const action = extractField(contributionText, 'Action');
    const scoringHashKey = extractField(contributionText, 'Scoring Hash Key');
    const tdgIssued = extractField(contributionText, 'TDGs Issued');
    const rejectionReason = extractField(contributionText, 'Rejection Reason');
    const reviewerEmail = extractField(contributionText, 'Reviewer Email');
    const transactionId = extractField(contributionText, 'Transaction ID');
    
    if (!action || !scoringHashKey) {
      errors.push('Row ' + (i + 1) + ': Missing Action or Scoring Hash Key');
      continue;
    }
    
    // Look up the matching row in Scored Chatlogs
    const scoredMatch = scoredMap[scoringHashKey];
    if (!scoredMatch) {
      errors.push('Row ' + (i + 1) + ': No matching Scored Chatlogs row for hash key ' + scoringHashKey);
      continue;
    }
    
    const scoredRowIndex = scoredMatch.index;
    const currentStatus = String(scoredMatch.data[5] || '').trim(); // Col F = Status
    
    // --- Double-counting guard ---
    // Skip if already processed (terminal states)
    const terminalStatuses = ['Reviewed', 'Rejected', 'Transferred to Main Ledger', 'Entry Error', 'Ignored'];
    if (terminalStatuses.indexOf(currentStatus) !== -1) {
      skipped++;
      // Still mark the Telegram Chat Logs row as processed to avoid re-scanning
      sheet.getRange(i + 1, 24).setValue('TRUE');  // Col X
      if (transactionId) {
        sheet.getRange(i + 1, 25).setValue(transactionId);  // Col Y
      }
      continue;
    }
    
    // --- Apply the action ---
    const actionUpper = action.toUpperCase();
    
    if (actionUpper === 'APPROVE') {
      // Update Status to Reviewed (Col F, index 5)
      scoredSheet.getRange(scoredRowIndex + 1, 6).setValue('Reviewed');
      // Update TDGs Issued (Col G, index 6)
      scoredSheet.getRange(scoredRowIndex + 1, 7).setValue(tdgIssued || '0.00');
    } else if (actionUpper === 'REJECT') {
      // Update Status to Rejected (Col F, index 5)
      scoredSheet.getRange(scoredRowIndex + 1, 6).setValue('Rejected');
      // Update Rejection Reason (Col O, index 14)
      scoredSheet.getRange(scoredRowIndex + 1, 15).setValue(rejectionReason || '');
    } else {
      errors.push('Row ' + (i + 1) + ': Unknown action "' + action + '"');
      continue;
    }
    
    // Mark the Telegram Chat Logs row as processed
    sheet.getRange(i + 1, 24).setValue('TRUE');  // Col X
    if (transactionId) {
      sheet.getRange(i + 1, 25).setValue(transactionId);  // Col Y
    }
    
    processed++;
  }
  
  return {
    status: 'ok',
    processed: processed,
    skipped: skipped,
    errors: errors.length > 0 ? errors : undefined
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Helper: extract a field from the review event text
// ──────────────────────────────────────────────────────────────────────────────

function extractField(text, label) {
  // Pattern: "- Label: value" in the header before the -------- divider
  const header = text.split('\n--------')[0];
  const regex = new RegExp('^\\s*-\\s*' + escapeRegex(label) + '\\s*:\\s*(.+)$', 'im');
  const match = header.match(regex);
  return match ? match[1].trim() : '';
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
