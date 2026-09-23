/**
 * File: google_app_scripts/sunmint_tree_planting/process_tree_planting_telegram_logs.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * Apps Script editor:
 * https://script.google.com/home/projects/1Jp8qNIBCZaRTlmOmbJoJmYnSFyXtQkUHP2Qv5uqKZpt0Ugo-e25nhASF/edit
 * 
 * Description: Google Apps Script for TrueSight DAO automation.
 */

// Load API keys and configuration settings from Credentials.gs
setApiKeys();
const creds = getCredentials();

// Tab names and constants
const telegramLogTabName = "Telegram Chat Logs";
const sunMintTabName = "SunMint Tree Planting";
const contributorsSheetId = "1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU";
const contributorsTabName = "Contributors Digital Signatures";
const TELEGRAM_CHAT_ID = '-1002190388985';

// Helper: extract filename from Photo URL line
function extractFilenameFromPhotoURL(contributionText) {
  const match = contributionText.match(/- Photo URL: .+\/([^\/]+\.(?:jpg|jpeg|png|gif))$/m);
  return match ? match[1] : null;
}

// Helper: extract Species
function extractSpecies(contributionText) {
  const match = contributionText.match(/- Species: (.+)$/m);
  return match ? match[1].trim() : 'Unknown';
}

// Helper: extract Cost
function extractCost(contributionText) {
  const match = contributionText.match(/- Cost: (.+)$/m);
  return match ? match[1].trim() : 'N/A';
}

// Helper: extract Planting Time
function extractPlantingTime(contributionText) {
  const match = contributionText.match(/- Planting Time: (.+)$/m);
  return match ? match[1].trim() : 'N/A';
}

// Helper: extract Plot ID (optional — associates the tree with a SunMint plot, e.g. CR-PA-P2).
// Returns '' when the submission omits "- Plot ID:", so existing callers are unaffected.
function extractPlotId(contributionText) {
  const match = contributionText.match(/- Plot ID: (.+)$/m);
  return match ? match[1].trim() : '';
}

// Send Telegram notification
function sendTreePlantingNotification(rowData, treePlantingRowNumber) {
  Logger.log("Sending tree planting notification");
  const token = creds.TELEGRAM_API_TOKEN;
  if (!token) {
    Logger.log(`sendTreePlantingNotification: Error: TELEGRAM_API_TOKEN not set`);
    return;
  }

  const apiUrl = `https://api.telegram.org/bot${token}/sendMessage`;
  const outputSheetLink = `https://www.agroverse.shop/trees-planted`;

  const messageText = `🌳 New Tree Planting Event Recorded\n\n` +
    `Tree Planting Row: ${treePlantingRowNumber}\n` +
    `Telegram Update ID: ${rowData[0]}\n` +
    `Chatroom ID: ${rowData[1]}\n` +
    `Chatroom Name: ${rowData[2]}\n` +
    `Message ID: ${rowData[3]}\n` +
    `Contributor Handle: ${rowData[4]}\n` +
    `Contributor Name: ${rowData[9]}\n` +
    `Photo URL: ${rowData[8]}\n` +
    `Location: ${rowData[10]}, ${rowData[11]}\n` +
    `Species: ${rowData[13]}\n` +
    `Cost: ${rowData[14]}\n` +
    `Planting Time: ${rowData[15]}\n\n` +
    `Review here: ${outputSheetLink}`;

  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text: messageText,
    parse_mode: "HTML"
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    Logger.log(`Sending notification to chat ${TELEGRAM_CHAT_ID}`);
    const response = UrlFetchApp.fetch(apiUrl, options);
    const status = response.getResponseCode();
    if (status === 200) {
      Logger.log(`Notification sent successfully.`);
    } else {
      Logger.log(`Failed to send notification. Status: ${status}, Response: ${response.getContentText()}`);
    }
  } catch (e) {
    Logger.log(`Error sending Telegram notification: ${e.message}`);
  }
}

// Get processed message IDs
function getProcessedMessageIds(sunMintTab) {
  const lastRow = sunMintTab.getLastRow();
  if (lastRow < 2) return [];
  const messageIds = sunMintTab.getRange(2, 4, lastRow - 1, 1).getValues().flat();
  return messageIds.filter(id => id !== "");
}

// Get processed file IDs
function getProcessedFileIds(sunMintTab) {
  const lastRow = sunMintTab.getLastRow();
  if (lastRow < 2) return [];
  const fileIds = sunMintTab.getRange(2, 8, lastRow - 1, 1).getValues().flat();
  return fileIds.filter(id => id !== "" && id !== "N/A");
}

// Get Telegram file URL
function getTelegramFileUrl(token, fileId) {
  const getFileUrl = `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`;
  const response = UrlFetchApp.fetch(getFileUrl);
  const fileData = JSON.parse(response.getContentText());
  if (!fileData.ok) throw new Error("Failed to get file path: " + fileData.description);
  const filePath = fileData.result.file_path;
  return `https://api.telegram.org/file/bot${token}/${filePath}`;
}

// Check if file exists on GitHub
function checkGitHubFileExists(token, filename) {
  const repo = "TrueSightDAO/sunmint";
  const path = `images/${filename}`;
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${path}`;

  const options = {
    method: "GET",
    headers: {
      "Authorization": `token ${token}`,
      "Accept": "application/vnd.github.v3+json"
    },
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(apiUrl, options);
  const status = response.getResponseCode();

  if (status === 200) {
    Logger.log(`File exists on GitHub: ${path}`);
    return `https://raw.githubusercontent.com/${repo}/main/${path}`;
  } else if (status === 404) {
    Logger.log(`File does not exist on GitHub: ${path}`);
    return null;
  } else {
    throw new Error(`Failed to check GitHub file: ${response.getContentText()}`);
  }
}

// Upload image to GitHub and return commit URL
function uploadToGitHub(token, imageBlob, filename, contributionMade) {
  // Check if file already exists
  const existingUrl = checkGitHubFileExists(token, filename);
  if (existingUrl) {
    return null; // Return null to indicate no new commit was created
  }

  const repo = "TrueSightDAO/sunmint";
  const path = `images/${filename}`;
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${path}`;
  const base64Content = Utilities.base64Encode(imageBlob.getBytes());

  const payload = {
    message: contributionMade, // Use full contributionMade as commit message
    content: base64Content
  };

  const options = {
    method: "PUT",
    headers: {
      "Authorization": `token ${token}`,
      "Accept": "application/vnd.github.v3+json"
    },
    contentType: "application/json",
    payload: JSON.stringify(payload)
  };

  const response = UrlFetchApp.fetch(apiUrl, options);
  const responseData = JSON.parse(response.getContentText());
  if (!responseData.content || !responseData.commit) throw new Error("Failed to upload to GitHub: " + response.getContentText());

  return responseData.commit.html_url; // Return the commit URL
}

// Main processing function
function processTelegramLogs() {
  // IDEMPOTENCY HARDENING: serialize invocations. Without this, two overlapping
  // runs (auto-dispatch + a manual/cron re-fire, or a re-run while the first is
  // still appending across the 12k-row source tab) each snapshot the dedup arrays
  // at the top of processTelegramLogsLocked_() BEFORE either appends a row, both
  // pass the guard, and both appendRow() -> one DUPLICATE row per submission.
  // The money side (reconcileTreePlanting_) already had its own idempotency marker;
  // this closes the same hole for the row append itself.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    Logger.log('processTelegramLogs: another run holds the lock; skipping this invocation');
    return;
  }
  try {
    processTelegramLogsLocked_();
  } finally {
    lock.releaseLock();
  }
}

// Body of processTelegramLogs(), run under the script lock acquired above.
function processTelegramLogsLocked_() {
  const sheet = SpreadsheetApp.openById(creds.SHEET_ID);
  let telegramLogTab = sheet.getSheetByName(telegramLogTabName);
  let sunMintTab = sheet.getSheetByName(sunMintTabName);
  const contributorsSheet = SpreadsheetApp.openById(contributorsSheetId);
  const contributorsTab = contributorsSheet.getSheetByName(contributorsTabName);

  // Create tab if not exists
  if (!sunMintTab) {
    sunMintTab = sheet.insertSheet(sunMintTabName);
    sunMintTab.getRange("A1:T1").setValues([[
      "Telegram Update ID",      // A
      "Chatroom ID",             // B
      "Chatroom Name",           // C
      "Message ID",              // D
      "Contributor Handle",      // E
      "Contribution Made",       // F
      "Status Date",             // G
      "File ID",                 // H
      "Photo URL",               // I
      "Contributor Name",        // J
      "Latitude",                // K
      "Longitude",               // L
      "Status",                  // M
      "Species",                 // N
      "GitHub Commit URL",       // O
      "Cost",                    // P
      "Planting Time",           // Q
      "Linked QR Code",          // R (owned by process_tree_planting_link.js)
      "Linked At",               // S (owned by process_tree_planting_link.js)
      "Plot ID"                  // T (optional — SunMint plot association)
    ]]);
  }

  const processedFileIds = getProcessedFileIds(sunMintTab);
  const processedMessageIds = getProcessedMessageIds(sunMintTab);

  const lastRow = telegramLogTab.getLastRow();
  if (lastRow < 2) {
    Logger.log("No data in Telegram Chat Logs tab");
    return;
  }
  const dataRange = telegramLogTab.getRange(2, 1, lastRow - 1, 15).getValues();

  const contributorsLastRow = contributorsTab.getLastRow();
  const contributorsData = contributorsLastRow > 1 ? contributorsTab.getRange(2, 1, contributorsLastRow - 1, 5).getValues() : [];

  dataRange.forEach(function(row, index) {
    const contributionMade = row[6]; // Column G
    const messageId = row[3]; // Column D
    const fileIdsString = row[14]; // Column O

    if (processedMessageIds.includes(messageId)) {
      Logger.log(`Message ID already processed: ${messageId}`);
      return;
    }

    if (contributionMade && contributionMade.startsWith("[TREE PLANTING EVENT]")) {
      Logger.log(contributionMade);

      // Extract latitude, longitude, species, cost, planting time
      const lines = contributionMade.split('\n');
      const latitude = lines.find(l => l.startsWith('- Latitude: '))?.replace('- Latitude: ', '') || 'N/A';
      const longitude = lines.find(l => l.startsWith('- Longitude: '))?.replace('- Longitude: ', '') || 'N/A';
      const species = extractSpecies(contributionMade);
      const cost = extractCost(contributionMade);
      const plantingTime = extractPlantingTime(contributionMade);
      const plotId = extractPlotId(contributionMade);

      // Extract Photo URL
      const photoUrlMatch = contributionMade.match(/- Photo URL: (.+)$/m);
      const photoUrl = photoUrlMatch ? photoUrlMatch[1].trim() : 'N/A';

      // Evidence gate: a planting with no latitude, no longitude, or no photo cannot be
      // verified on the map. Mark it INVALID instead of NEW so it never enters
      // trees/index.geojson as a coordinate-less / photo-less tree.
      const rowStatus = (latitude === 'N/A' || longitude === 'N/A' || photoUrl === 'N/A')
        ? 'INVALID'
        : 'NEW';

      // Extract public signature
      const publicSignatureMatch = contributionMade.match(/My Digital Signature: ([^\n]+)/);
      const publicSignature = publicSignatureMatch ? publicSignatureMatch[1].trim() : 'N/A';

      // Match contributor name by public signature
      let contributorName = 'Unknown';
      contributorsData.forEach(function(contributorRow) {
        if (contributorRow[4] === publicSignature) {
          contributorName = contributorRow[0];
        }
      });

      // Extract filename from Photo URL or fallback to fileId.jpg
      const filenameFromPhotoURL = extractFilenameFromPhotoURL(contributionMade);

      // Process files attached or from previous row
      const fileIds = fileIdsString ? fileIdsString.split(',').map(id => id.trim()) : [];

      if (fileIds.length > 0) {
        fileIds.forEach(function(fileId) {
          if (fileId && !processedFileIds.includes(fileId)) {
            try {
              const fileNameToUse = filenameFromPhotoURL || (fileId + '.jpg');
              const fileUrl = getTelegramFileUrl(creds.TELEGRAM_API_TOKEN, fileId);
              const imageBlob = UrlFetchApp.fetch(fileUrl).getBlob();
              const commitUrl = uploadToGitHub(creds.GITHUB_API_TOKEN, imageBlob, fileNameToUse, contributionMade);

              sunMintTab.appendRow([
                row[0], // A
                row[1], // B
                row[2], // C
                row[3], // D
                row[4], // E
                contributionMade, // F
                row[11], // G
                fileId, // H
                photoUrl, // I
                contributorName, // J
                latitude, // K
                longitude, // L
                rowStatus, // M
                species, // N
                commitUrl || "N/A", // O
                cost, // P
                plantingTime, // Q
                "", // R (Linked QR Code — written by process_tree_planting_link.js)
                "", // S (Linked At — written by process_tree_planting_link.js)
                plotId // T (Plot ID — optional SunMint plot association)
              ]);

              const treePlantingRowNumber = sunMintTab.getLastRow();
              if (rowStatus === 'NEW') reconcileTreePlanting_(contributorName, treePlantingRowNumber); // PR3
              sendTreePlantingNotification([
                row[0], row[1], row[2], row[3], row[4], contributionMade, row[11], fileId,
                photoUrl, contributorName, latitude, longitude, rowStatus, species, commitUrl || "N/A",
                cost, plantingTime
              ], treePlantingRowNumber);

              // Keep the in-memory dedup sets current within THIS run: they were
              // read once at the top and never updated, so a fileId reused by a later
              // source row in the same run could slip through and append twice.
              processedMessageIds.push(row[3]);
              if (fileId !== 'N/A') processedFileIds.push(fileId);
              Logger.log(`Processed file_id: ${fileId}, filename: ${fileNameToUse}`);
            } catch (err) {
              Logger.log(`Error processing file_id ${fileId}: ${err.message}`);
            }
          } else if (fileId) {
            Logger.log(`file_id already processed: ${fileId}`);
          }
        });
      } else {
        // No files attached, check previous row or skip image upload
        try {
          let fileId = "N/A";
          let commitUrl = "N/A";
          const fileNameToUse = filenameFromPhotoURL || "N/A";

          // Check previous row for file
          if (index > 0) {
            const prevRow = dataRange[index - 1];
            const prevContributionMade = prevRow[6];
            const prevFileIdsString = prevRow[14];
            const prevFileIds = prevFileIdsString ? prevFileIdsString.split(',').map(id => id.trim()) : [];

            if (!prevContributionMade && prevFileIds.length > 0) {
              const prevFileId = prevFileIds[0];
              if (prevFileId && !processedFileIds.includes(prevFileId)) {
                try {
                  fileId = prevFileId;
                  const fileUrl = getTelegramFileUrl(creds.TELEGRAM_API_TOKEN, fileId);
                  const imageBlob = UrlFetchApp.fetch(fileUrl).getBlob();
                  commitUrl = uploadToGitHub(creds.GITHUB_API_TOKEN, imageBlob, fileNameToUse, contributionMade);
                  Logger.log(`Associated file_id from previous row: ${fileId}, filename: ${fileNameToUse}`);
                } catch (err) {
                  Logger.log(`Error processing file_id from previous row ${prevFileId}: ${err.message}`);
                }
              } else if (prevFileId) {
                Logger.log(`file_id from previous row already processed: ${prevFileId}`);
              }
            }
          }

          sunMintTab.appendRow([
            row[0], // A
            row[1], // B
            row[2], // C
            row[3], // D
            row[4], // E
            contributionMade, // F
            row[11], // G
            fileId, // H
            photoUrl, // I
            contributorName, // J
            latitude, // K
            longitude, // L
            rowStatus, // M
            species, // N
            commitUrl, // O
            cost, // P
            plantingTime, // Q
            "", // R (Linked QR Code — written by process_tree_planting_link.js)
            "", // S (Linked At — written by process_tree_planting_link.js)
            plotId // T (Plot ID — optional SunMint plot association)
          ]);

          const treePlantingRowNumber = sunMintTab.getLastRow();
          if (rowStatus === 'NEW') reconcileTreePlanting_(contributorName, treePlantingRowNumber); // PR3
          sendTreePlantingNotification([
            row[0], row[1], row[2], row[3], row[4], contributionMade, row[11], fileId,
            photoUrl, contributorName, latitude, longitude, rowStatus, species, commitUrl,
            cost, plantingTime
          ], treePlantingRowNumber);

          processedMessageIds.push(row[3]);
          if (fileId !== 'N/A') processedFileIds.push(fileId);
          Logger.log(`Processed record without file attachment: ${fileId}, filename: ${fileNameToUse}`);
        } catch (err) {
          Logger.log(`Error processing record without file attachment: ${err.message}`);
        }
      }
    }
  });
}

// =====================================================================================
// PR3 — SunMint farmer-settlement reconciliation
// =====================================================================================
// Spec: agentic_ai_context/plans/SUNMINT_FARMER_SETTLEMENT_AND_BATCH_LINK_PLAN.md §1.2.
//
// Runs on a newly-confirmed planting (Status "NEW"). Reuses the main ledger's
// `offchain transactions` tab: the three tree-planting literals are plain string line-items,
// never `Currencies` rows (tokenomics/SCHEMA.md -> Tree-Planting Ledger Literals).
//
//   Path A — the farmer has an open `Cacao Tree Purchased - Not Planted` balance (prepaid):
//            consume 1 FIFO unit -> `-1 Purchased-Not-Planted` / `+1 Planted-Unassigned`, and
//            stamp the SunMint row's `Payment Event Ref` with the consumed purchase.
//   Path B — no open balance (planted before payment): book `+1 Cacao Tree - To Be Paid For`
//            on the MAIN ledger always (§0.3).
//
// IDEMPOTENCY (envoy review, PR3 follow-up): refuses to run twice for the same SunMint row —
// keyed on a Description marker ("SunMint Tree Planting row N") written by BOTH paths — so a
// status reset to NEW, a duplicate delivery inside one run, or a manual re-run cannot double-book.
//
// SYSTEM IDENTITY (§0.7 default / §7 open item): GAS holds no signing key, so this cannot emit an
// RSA-signed event the way Edgar / edgar_client.py does. It therefore follows the codebase's existing
// pattern for a handler-produced ledger effect — a direct, idempotent append whose Description names
// the system identity and whose trigger is the farmer's own already-signed `[TREE PLANTING EVENT]`
// (cf. appendTreePlantingLedgerFulfillment_ in the sibling link handler). Promoting the match to a
// fully signed event needs a dedicated system signing identity — the one §7 item this PR leaves open.

const RECON_PURCHASED_LITERAL = 'Cacao Tree Purchased - Not Planted';
const RECON_PLANTED_UNASSIGNED_LITERAL = 'Cacao Tree Planted - Unassigned';
const RECON_TO_BE_PAID_LITERAL = 'Cacao Tree - To Be Paid For';
const RECON_OFFCHAIN_TAB = 'offchain transactions';
const RECON_OPS_SS_ID = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
const RECON_ASSET_RECEIPTS_TAB = 'Asset Receipts';
const SUNMINT_CONTRIBUTOR_NAME_COL = 9;   // Column J (0-based) — Contributor Name (§1.7 match key)
const SUNMINT_PAYMENT_EVENT_REF_COL = 20; // Column U (0-based) — Payment Event Ref (PR3)

/**
 * Reconcile one newly-confirmed planting against the farmer's open `Cacao Tree Purchased - Not
 * Planted` balance. Never throws — a ledger hiccup must not break ingestion.
 */
function reconcileTreePlanting_(contributorName, sunMintRowNumber) {
  try {
    if (!contributorName || contributorName === 'Unknown') {
      Logger.log('reconcileTreePlanting_: skipped (no verified contributor name)');
      return;
    }
    const mainSs = SpreadsheetApp.openById(contributorsSheetId);
    const offchain = mainSs.getSheetByName(RECON_OFFCHAIN_TAB);
    if (!offchain) {
      Logger.log('reconcileTreePlanting_: no "' + RECON_OFFCHAIN_TAB + '" tab');
      return;
    }

    const lastRow = offchain.getLastRow();
    const reconMarker = sunMintRowNumber ? ('SunMint Tree Planting row ' + sunMintRowNumber) : '';
    const purchases = [];   // {row} — FIFO order = sheet order
    let balanceUnits = 0;   // Σ amounts on this literal for this farmer
    let consumedUnits = 0;  // Σ |negative amounts|

    if (lastRow >= 2) {
      const data = offchain.getRange(2, 1, lastRow - 1, 5).getValues(); // A..E
      for (let i = 0; i < data.length; i++) {
        // Idempotency guard (envoy review, PR3 follow-up): if a reconciliation row already
        // names THIS SunMint row, do nothing. The upstream Message-ID dedup only protects
        // against replaying an already-appended message -- it does NOT stop a second fire for
        // the same row (status reset to NEW, a duplicate delivery inside one run since the
        // dedup arrays are read once and never mutated, or a manual re-run). Without this,
        // both paths would double-book. Keyed on a Description marker set by BOTH paths,
        // since Path B writes nothing else back to the row.
        if (reconMarker && String(data[i][1] || '').indexOf(reconMarker) !== -1) {
          Logger.log('reconcileTreePlanting_: already reconciled (' + reconMarker + '), skipping');
          return;
        }
        if (String(data[i][4] || '').trim() !== RECON_PURCHASED_LITERAL) continue; // E: Currency
        if (String(data[i][2] || '').trim() !== contributorName) continue;         // C: Fund Handler
        const amt = Number(data[i][3]);                                            // D: Amount
        if (isNaN(amt)) continue;
        balanceUnits += amt;
        if (amt > 0) purchases.push({ row: i + 2 });
        else if (amt < 0) consumedUnits += -amt;
      }
    }

    const today = new Date();
    const sunRef = sunMintRowNumber ? ('SunMint Tree Planting row ' + sunMintRowNumber) : 'SunMint';

    if (balanceUnits >= 1) {
      // Path A — consume the FIFO purchase (§1.2).
      const idx = Math.min(Math.round(consumedUnits), purchases.length - 1);
      const purchase = purchases[idx] || purchases[0] || null;
      const ref = purchase ? findPurchaseRefForOffchainRow_(purchase.row) : '';
      const desc = 'SunMint farmer settlement (system): -1 ' + RECON_PURCHASED_LITERAL +
        ' / +1 ' + RECON_PLANTED_UNASSIGNED_LITERAL + ' for ' + contributorName +
        ' — matched planting confirmation (' + sunRef + ')' +
        (ref ? ' against purchase ' + ref : '');
      appendReconRows_(offchain, [
        [today, desc, contributorName, -1, RECON_PURCHASED_LITERAL, '', 'N'],
        [today, desc, contributorName, 1, RECON_PLANTED_UNASSIGNED_LITERAL, '', 'N']
      ]);
      if (sunMintRowNumber) setPaymentEventRef_(sunMintRowNumber, ref || desc);
      Logger.log('reconcileTreePlanting_: Path A booked for ' + contributorName +
        ' (balance ' + balanceUnits + ', ref ' + (ref || 'n/a') + ')');
    } else {
      // Path B — no open balance: liability booked on MAIN always (§0.3).
      const desc = 'SunMint farmer settlement (system): +1 ' + RECON_TO_BE_PAID_LITERAL +
        ' for ' + contributorName +
        ' — planting confirmation with no open purchase balance (' + sunRef + ')';
      appendReconRows_(offchain, [
        [today, desc, contributorName, 1, RECON_TO_BE_PAID_LITERAL, '', 'N']
      ]);
      Logger.log('reconcileTreePlanting_: Path B booked for ' + contributorName);
    }
  } catch (e) {
    Logger.log('reconcileTreePlanting_ failed: ' + e.message);
  }
}

/** Append A..G rows to a ledger tab, starting one row below the last. */
function appendReconRows_(sheet, rows) {
  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, rows.length, rows[0].length).setValues(rows);
}

/** Best-effort join: offchain row number -> the `Asset Receipts` audit row's Telegram Update ID. */
function findPurchaseRefForOffchainRow_(offchainRowNumber) {
  try {
    const opsId = (creds && creds.SHEET_ID) ? creds.SHEET_ID : RECON_OPS_SS_ID;
    const audit = SpreadsheetApp.openById(opsId).getSheetByName(RECON_ASSET_RECEIPTS_TAB);
    if (!audit || audit.getLastRow() < 2) return '';
    const data = audit.getRange(2, 1, audit.getLastRow() - 1, 7).getValues();
    const target = String(offchainRowNumber).trim();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][5] || '').trim() === target) {   // F: Offchain Row
        const uid = String(data[i][0] || '').trim();       // A: Telegram Update ID
        if (uid) return '[ASSET RECEIPT EVENT] ' + uid;
      }
    }
    return '';
  } catch (e) {
    Logger.log('findPurchaseRefForOffchainRow_ failed: ' + e.message);
    return '';
  }
}

/** Write the SunMint row's `Payment Event Ref` (col U), creating the header cell once if absent. */
function setPaymentEventRef_(sunMintRowNumber, ref) {
  try {
    const sheet = SpreadsheetApp.openById(creds.SHEET_ID).getSheetByName(sunMintTabName);
    if (!sheet) return;
    const hdr = sheet.getRange(1, SUNMINT_PAYMENT_EVENT_REF_COL + 1);
    if (String(hdr.getValue() || '').trim() === '') hdr.setValue('Payment Event Ref');
    sheet.getRange(sunMintRowNumber, SUNMINT_PAYMENT_EVENT_REF_COL + 1).setValue(String(ref || ''));
  } catch (e) {
    Logger.log('setPaymentEventRef_ failed: ' + e.message);
  }
}

// ========== Governor-only read endpoint (PR3, Sunmint tree-planting -> QR linking roadmap) ==========
// agentic_ai_context/plans/SUNMINT_TREE_QR_LINKING_PLAN.md
//
// No doGet existed in this project before this addition. Column indices below mirror the
// "SunMint Tree Planting" header row written in processTelegramLogs() above.
const SUNMINT_STATUS_MESSAGE_ID_COL = 3;  // Column D (0-based) — Telegram Message ID, stable dedup key
const SUNMINT_STATUS_DATE_COL = 6;        // Column G (0-based) — Status date / planting date (YYYYMMDD)
const SUNMINT_PHOTO_URL_COL = 8;          // Column I (0-based) — Photo of Tree Planted
const SUNMINT_SUBMITTED_NAME_COL = 9;     // Column J (0-based) — Submitted Name
const SUNMINT_LATITUDE_COL = 10;          // Column K (0-based)
const SUNMINT_LONGITUDE_COL = 11;         // Column L (0-based)
const SUNMINT_STATUS_COL = 12;            // Column M (0-based) — Status ("NEW", "LINKED" from PR4 onward)
const SUNMINT_SPECIES_COL = 13;           // Column N (0-based) — Specie
const SUNMINT_PLOT_ID_COL = 19;           // Column T (0-based) — Plot ID (optional SunMint plot association)
const GOVERNOR_READ_KEY_PROPERTY = 'GOVERNOR_READ_KEY';

/**
 * Governor-only gate — same convention as qr_code_web_service.js's isAuthorizedGovernorReadRequest_.
 * This is a separate GAS project (clasp mirrors can't share code), hence the duplicated ~6 lines.
 */
function isAuthorizedGovernorReadRequest_(e) {
  const expected = PropertiesService.getScriptProperties().getProperty(GOVERNOR_READ_KEY_PROPERTY);
  if (!expected) return false;
  const provided = e && e.parameter ? e.parameter['governor_key'] : '';
  return !!provided && provided === expected;
}

/**
 * GET ?list_new=true&governor_key=... — governor-only. Returns SunMint Tree Planting submissions with
 * Status "NEW" (not yet linked to a QR code), sorted by Status date (planting date) ascending — oldest
 * unlinked submission first. Gated by GOVERNOR_READ_KEY since the response includes contributor names
 * and GPS coordinates.
 */
function doGet(e) {
  const action = e && e.parameter ? e.parameter['action'] : '';
  if (action === 'processTreePlantingTelegramLogs') {
    // dao_protocol dispatch path: process [TREE PLANTING EVENT] rows from Telegram Chat Logs
    // into the SunMint Tree Planting tab (same as the old time-driven processTelegramLogs()).
    try {
      processTelegramLogs();
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        message: '✅ Tree planting processed'
      })).setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'error',
        message: 'Tree planting processing error: ' + err.message
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  const listNew = e && e.parameter ? e.parameter['list_new'] : '';
  if (listNew !== 'true') {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: 'No valid action specified. Use ?action=processTreePlantingTelegramLogs or ?list_new=true&governor_key=...'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  if (!isAuthorizedGovernorReadRequest_(e)) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: 'Unauthorized: missing or invalid governor_key'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    const sheet = SpreadsheetApp.openById(creds.SHEET_ID);
    const sunMintTab = sheet.getSheetByName(sunMintTabName);
    if (!sunMintTab) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', items: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const lastRow = sunMintTab.getLastRow();
    if (lastRow < 2) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', items: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const data = sunMintTab.getRange(2, 1, lastRow - 1, 20).getValues();
    const items = [];
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const status = (row[SUNMINT_STATUS_COL] || '').toString().trim().toUpperCase();
      if (status !== 'NEW') continue;
      const statusDate = row[SUNMINT_STATUS_DATE_COL];
      items.push({
        telegram_message_id: row[SUNMINT_STATUS_MESSAGE_ID_COL],
        planting_date: statusDate instanceof Date ? statusDate.toISOString() : (statusDate || ''),
        photo_url: row[SUNMINT_PHOTO_URL_COL] || '',
        submitted_name: row[SUNMINT_SUBMITTED_NAME_COL] || '',
        latitude: row[SUNMINT_LATITUDE_COL] || '',
        longitude: row[SUNMINT_LONGITUDE_COL] || '',
        species: row[SUNMINT_SPECIES_COL] || '',
        plot_id: row[SUNMINT_PLOT_ID_COL] || ''
      });
    }

    // Sort by planting_date ascending (oldest unlinked submission first); blanks sort last.
    items.sort(function (a, b) {
      if (!a.planting_date && !b.planting_date) return 0;
      if (!a.planting_date) return 1;
      if (!b.planting_date) return -1;
      return a.planting_date < b.planting_date ? -1 : (a.planting_date > b.planting_date ? 1 : 0);
    });

    return ContentService.createTextOutput(JSON.stringify({ status: 'success', items: items }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    Logger.log(`doGet(list_new) error: ${err.message}`);
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}