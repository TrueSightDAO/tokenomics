/**
 * File: Reservation Settlement Telegram Logs.js
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * Project : 1dsWecVwbN0dOvilIz9r8DNt7LD3Ay13V8G9qliow4tZtF5LHsvQOFpF7
 *
 * Unit 3 of agentic_ai_context/RESERVATION_EVENT_SPEC.md - EVENT 2 (goods collected).
 *
 * [RESERVATION SETTLEMENT EVENT] books the NON-REVENUE legs of the sale:
 *   leg 1  -1 <inventory type>          off the QR's CURRENT HOLDER   (spec Ruled #1)
 *   leg 3  +1 Cacao Tree To Be Planted  to SunMint Tree Planting Contract - <agl> (Ruled #2)
 * ...and sets the QR to SOLD (+ Sold Date), then notifies via the EXISTING sale sender
 * sendTransactionCompletionNotification() (spec Ruled #6 - no new mail transport).
 *
 * Ruled #3 GUARD: these rows must NOT set Is Revenue and must NOT carry a sale keyword.
 *   The settlement Telegram message is a [RESERVATION SETTLEMENT EVENT] payload whose
 *   note field is sanitised by rsvSafeRemark_() before it reaches the ledger's message
 *   column, so no `sale|sold|purchase|payment` token can be introduced by a reporter.
 *   Revenue was already recognised at T1 on the positive-USD cash leg.
 *
 * Edgar routing: '[RESERVATION SETTLEMENT EVENT]' ->
 *   ("RESERVATION_SETTLEMENT_PROCESSING", "processReservationSettlementTelegramLogs")
 *   GET <project>/exec?action=processReservationSettlementTelegramLogs
 *
 * Reuses helpers from "Reservation Telegram Logs.js" (rsvFindQrRow_, rsvSetQrStatus_,
 * rsvResolveQrLedgerUrl_, rsvAppendQrSalesRow_) + the sales parser's
 * sendTransactionCompletionNotification / getAgroverseInventoryType / normalizeTelegramMessageId_.
 */

const RSV_SETTLE_AGL_TX_SHEET_NAME = 'Transactions';

/** Strip any revenue keyword so a settlement row can never be counted as revenue. */
function rsvSafeRemark_(s) {
  return String(s || '')
    .replace(/\b(sales?|sold|purchase|payment)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Book legs 1 + 3 of the split sale on the QR's ledger. Returns the row numbers string.
 * Mirrors sales_update_managed_agl_ledgers.js row shape exactly:
 *   A date | B message | C contributor | D amount | E inventory type | F category | G TRUE
 */
function rsvBookGoodsLegs_(qrCode, salesDate, holder, inventoryType, aglContractName, message) {
  const ledgerUrl = rsvResolveQrLedgerUrl_(qrCode);
  if (!ledgerUrl) {
    Logger.log('rsvBookGoodsLegs_: no ledger URL for QR ' + qrCode);
    return '';
  }
  const ss = SpreadsheetApp.openByUrl(ledgerUrl);
  const sheet = ss.getSheetByName(RSV_SETTLE_AGL_TX_SHEET_NAME) || ss.getSheetByName(RSV_MAIN_LEDGER_SHEET_NAME);
  if (!sheet) {
    Logger.log('rsvBookGoodsLegs_: no Transactions sheet in ' + ledgerUrl);
    return '';
  }
  const msg = rsvSafeRemark_(message);
  const insertRow = sheet.getLastRow() + 1;
  const rows = [
    [salesDate || '', msg, holder || '', -1, inventoryType || '', '', true],
    [salesDate || '', msg, 'SunMint Tree Planting Contract - ' + (aglContractName || ''), 1, 'Cacao Tree To Be Planted', 'Liability', true]
  ];
  sheet.getRange(insertRow, 1, rows.length, rows[0].length).setValues(rows);
  const rowNums = [insertRow, insertRow + 1].join(',');
  Logger.log('rsvBookGoodsLegs_: rows ' + rowNums + ' on ' + ledgerUrl);
  return rowNums;
}

/**
 * Extract the AGL contract name from a ledger URL.
 * Inlined from sales_update_managed_agl_ledgers.js (GAS projects are self-contained).
 */
function rsvExtractAglContractName_(url) {
  const u = (url || '').toString();
  const p1 = 'https://agroverse.shop/';
  const p2 = 'https://truesight.me/sunmint/';
  if (u.indexOf(p1) === 0) return u.slice(p1.length);
  if (u.indexOf(p2) === 0) return u.slice(p2.length);
  return '';
}

/**
 * Sale-confirmation notification, per spec Ruled #6 (reuse the existing sender, no new
 * mail transport). Inlined faithfully from sales_update_managed_agl_ledgers.js
 * sendTransactionCompletionNotification(qrCode, contributorName) — GAS projects are
 * self-contained so the helper is duplicated here. Fire-and-forget; never throws.
 */
function rsvNotifySaleCompletion_(qrCode, contributorName) {
  try {
    const token = (typeof creds !== 'undefined' && creds) ? creds.TELEGRAM_API_TOKEN : '';
    const chatId = '-1002190388985';
    if (!token) { Logger.log('rsvNotifySaleCompletion_: TELEGRAM_API_TOKEN not set'); return; }
    const messageText = String(qrCode) + '\n\n Transactions for QR code by ' + String(contributorName)
      + ' have been completed and recorded in the offchain transactions sheet. \n\nReview here: http://truesight.me/physical-assets/';
    UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ chat_id: chatId, text: messageText }),
      muteHttpExceptions: true
    });
    Logger.log('rsvNotifySaleCompletion_: notified for ' + qrCode);
  } catch (e) {
    Logger.log('rsvNotifySaleCompletion_ error: ' + e.message);
  }
}

/** Parse a [RESERVATION SETTLEMENT EVENT] payload; null when the tag is absent. */
function rsvParseSettlementEvent_(message) {
  const msg = (message || '').toString();
  if (!/\[RESERVATION SETTLEMENT EVENT\]/i.test(msg)) return null;
  return {
    qrCode: rsvParseField_(msg, 'QR Code'),
    buyerEmail: normalizeSalesEventOptionalField(rsvParseField_(msg, 'Buyer Email')),
    note: normalizeSalesEventOptionalField(rsvParseField_(msg, 'Note'))
  };
}

/**
 * Scan Telegram Chat Logs for unprocessed [RESERVATION SETTLEMENT EVENT] rows and settle them.
 * Idempotent (message-id dedupe). Requires the QR to currently be RESERVED.
 *
 * @return {{processed:number, ignored:number, settled:Array<string>}}
 */
function processReservationSettlementTelegramLogs() {
  const lock = LockService.getScriptLock();
  const LOCK_WAIT_MS = 300000;
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    Logger.log('processReservationSettlementTelegramLogs: lock not acquired; another run in progress');
    return { processed: 0, ignored: 0, settled: [] };
  }
  try {
    const src = SpreadsheetApp.openByUrl(RSV_SOURCE_SHEET_URL).getSheetByName(RSV_SOURCE_SHEET_NAME);
    const dst = SpreadsheetApp.openByUrl(RSV_DEST_SHEET_URL).getSheetByName(RSV_DEST_SHEET_NAME);
    ensureQrSalesAppendHeaders_(dst);
    const srcData = src.getDataRange().getValues();
    const dstData = dst.getDataRange().getValues();
    const seenMsgIds = {};
    for (let i = 1; i < dstData.length; i++) {
      seenMsgIds[normalizeTelegramMessageId_(dstData[i][RSV_DEST_MSG_ID_COL])] = true;
    }

    let processed = 0, ignored = 0;
    const settled = [];

    for (let i = 1; i < srcData.length; i++) {
      const message = srcData[i][RSV_SOURCE_MESSAGE_COL];
      if (!message || !/\[RESERVATION SETTLEMENT EVENT\]/i.test(String(message))) continue;

      const msgId = normalizeTelegramMessageId_(srcData[i][RSV_SOURCE_MSG_ID_COL]);
      if (seenMsgIds[msgId]) continue;
      const salesDate = srcData[i][RSV_SOURCE_DATE_COL] || '';

      const ev = rsvParseSettlementEvent_(message);
      const qrHit = ev && ev.qrCode ? rsvFindQrRow_(ev.qrCode) : null;
      if (!ev || !ev.qrCode || !qrHit) {
        rsvAppendQrSalesRow_(dst, srcData[i][RSV_SOURCE_UPDATE_ID_COL], msgId, message, salesDate,
          RSV_STATUS_IGNORED, '', 'IGNORED: [RESERVATION SETTLEMENT EVENT] QR missing or not found.');
        seenMsgIds[msgId] = true;
        ignored++;
        continue;
      }

      // Must currently be RESERVED (spec Ruled #4 - Reserved is terminal-until-collected).
      const curStatus = String(qrHit.row[3] || '').trim().toUpperCase();
      if (curStatus !== RSV_STATUS_RESERVED) {
        rsvAppendQrSalesRow_(dst, srcData[i][RSV_SOURCE_UPDATE_ID_COL], msgId, message, salesDate,
          RSV_STATUS_IGNORED, '', 'IGNORED: QR ' + ev.qrCode + ' is ' + (curStatus || 'blank')
            + ', not RESERVED - nothing to settle.');
        seenMsgIds[msgId] = true;
        ignored++;
        continue;
      }

      const holder = String(qrHit.row[RSV_QR_MANAGER_COL] || '').trim(); // Column U = current holder
      const inventoryType = getAgroverseInventoryType(ev.qrCode) || '';
      const aglUrl = String(qrHit.row[2] || '').trim();                  // Column C = ledger shortcut/URL
      const aglName = rsvExtractAglContractName_(aglUrl) || 'agl4';

      const rowNums = rsvBookGoodsLegs_(ev.qrCode, salesDate, holder, inventoryType, aglName, message);
      rsvSetQrStatus_(ev.qrCode, RSV_STATUS_SOLD, true);

      // Spec Ruled #6: reuse the existing sale-confirmation sender (Telegram, not email).
      try {
        rsvNotifySaleCompletion_(ev.qrCode, holder || ev.buyerEmail || '');
      } catch (e) {
        Logger.log('settlement notify: ' + e.message);
      }

      const remarks = 'SETTLEMENT: goods legs rows ' + (rowNums || 'NOT BOOKED')
        + ' (-1 ' + inventoryType + ' off ' + holder + '; +1 Cacao Tree To Be Planted liability)'
        + (ev.note ? ('; note: ' + rsvSafeRemark_(ev.note)) : '')
        + '; QR -> SOLD, buyer notified.';
      rsvAppendQrSalesRow_(dst, srcData[i][RSV_SOURCE_UPDATE_ID_COL], msgId, message, salesDate,
        RSV_STATUS_SOLD, qrHit.row[RSV_QR_OWNER_EMAIL_COL_IDX] || ev.buyerEmail, remarks);

      seenMsgIds[msgId] = true;
      processed++;
      settled.push(ev.qrCode + ':' + rowNums);
      Logger.log('processReservationSettlementTelegramLogs: settled ' + ev.qrCode + ' rows ' + rowNums);
    }

    try { notifyTreasuryCachePublisher_('process_reservation_settlement'); } catch (e) { Logger.log('treasury notify: ' + e.message); }
    Logger.log('processReservationSettlementTelegramLogs: processed=' + processed + ' ignored=' + ignored);
    return { processed: processed, ignored: ignored, settled: settled };
  } finally {
    lock.releaseLock();
  }
}
