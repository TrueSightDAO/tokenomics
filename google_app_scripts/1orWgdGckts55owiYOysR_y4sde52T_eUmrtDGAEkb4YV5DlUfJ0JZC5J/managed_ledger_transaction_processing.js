/**
 * managed_ledger_transaction_processing.js
 * [MANAGED LEDGER TRANSACTION EVENT] -- derivation engine + commit path.
 *
 * Spec: agentic_ai_context/conventions/CHOCOLATE_BAR_PRODUCTION_ACCOUNTING.md 9-11
 *       agentic_ai_context/conventions/INTER_LEDGER_HOLDINGS.md
 *
 * Governor direction (Gary Teh, 2026-10-27):
 *   "Don't bother directly editing the ledgers. Focus on implementing the
 *    underlying business logic for the GAS and then get that deployed first."
 *   "...all I need to do is indicate to you the assets and their original ledger
 *    and destination ledger and you can just call this event and then the
 *    ledgers will automatically update."
 *
 * PRINCIPLE: the caller declares INTENT; this file DERIVES every row, price and
 * entity. Callers never hand-build rows -- every defect in this area was a
 * derivation bug.
 *
 * Kept SEPARATE from capital_injection_processing.js, which is untouched.
 */

var MLTE_EVENT_MARKER = '[MANAGED LEDGER TRANSACTION EVENT]';
var MLTE_SHEET = 'Managed Ledger Transactions';
var CURRENCIES_SHEET = 'Currencies';
var LEDGER_TRANSACTIONS_SHEET = 'Transactions';

// /treasury matches BOTH: data[i][0]==="TrueSight DAO" && data[i][2]==="USD"
// (tdg_wix_dashboard.js). Any other entity string makes a stake INVISIBLE.
var DEFAULT_EQUITY_ENTITY = 'TrueSight DAO';
var USD_CURRENCY_KEY = 'USD';
var ALLOWED_TRANSACTION_TYPES = ['injection', 'movement', 'retirement'];

// Types whose rows may be written to LIVE ledgers. 'retirement' is deliberately
// excluded -- derived + tested, but the write is gated (see processNewClaimRetirements).
// Flipping this array is the entire go-live change.
var COMMITTABLE_TRANSACTION_TYPES = ['injection', 'movement'];

var ASSETS_CATEGORY = 'Assets';
var EQUITY_CATEGORY = 'Equity';

var TX_COLS = { DATE: 0, DESC: 1, ENTITY: 2, AMOUNT: 3, CURRENCY: 4, CATEGORY: 5 };
var TX_WIDTH = 6;

var MLTE_COL = {
  UPDATE_ID: 0, MESSAGE_ID: 1, LOG_MESSAGE: 2, REPORTER: 3,
  SRC_NAME: 4, SRC_URL: 5, DST_NAME: 6, DST_URL: 7, TYPE: 8,
  ASSETS: 9, ASSETS_ENTITY: 10, EQUITY_ENTITY: 11, VALUE_USD: 12,
  DATE: 13, DESCRIPTION: 14, STATUS: 15, LEDGER_LINES: 16
};

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/**
 * Reads the global Currencies catalog from the Main ledger. Currencies lives
 * ONCE on Main; every AGL IMPORTRANGEs it, so keys are a GLOBAL namespace and a
 * cross-ledger collision is structural.
 */
function loadCurrencyPrices_() {
  var ss = SpreadsheetApp.openByUrl(CONTRIBUTORS_SHEET_URL);
  var sheet = ss.getSheetByName(CURRENCIES_SHEET);
  if (!sheet) throw new Error('Currencies tab not found on the Main ledger');
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) throw new Error('Currencies tab is empty');
  var values = sheet.getRange(1, 1, lastRow, 2).getValues();
  var prices = {};
  for (var i = 0; i < values.length; i++) {
    var key = values[i][0] === null || values[i][0] === undefined ? '' : String(values[i][0]).trim();
    if (!key) continue;
    var raw = values[i][1];
    var num = typeof raw === 'number'
      ? raw
      : parseFloat(String(raw === null || raw === undefined ? '' : raw).replace(/[^0-9.\-]/g, ''));
    if (isFinite(num)) prices[key] = num;
  }
  return prices;
}

/**
 * Resolves one currency key to its USD price, failing closed.
 * An unknown key must NEVER be treated as $0: a missing Currencies row silently
 * values at zero in /aum, corrupting the books with no error surfaced.
 */
function resolvePrice_(currencyKey, priceTable) {
  var key = String(currencyKey || '').trim();
  if (!key) throw new Error('Empty currency key');
  if (!Object.prototype.hasOwnProperty.call(priceTable, key)) {
    throw new Error('UNKNOWN_CURRENCY_KEY: "' + key + '" is not in the Currencies tab. '
      + 'Refusing to value it at $0. Check the LIVE sheet -- not '
      + 'agroverse-inventory/currencies.json, whose E-section is missing.');
  }
  return priceTable[key];
}

// ---------------------------------------------------------------------------
// Derivation engine (pure -- no I/O)
// ---------------------------------------------------------------------------

/** @private */
function buildTxRow_(decl, currencyKey, amount, category, entity) {
  return [decl.effectiveDate, decl.description, entity, amount, currencyKey, category];
}

/**
 * Derives the COMPLETE row set for both ledgers from a declaration.
 * PURE: declaration + price table in, rows out. No spreadsheet access.
 *
 * @param {Object} decl {source:{name,url}, destination:{name,url}, transactionType,
 *                       assets:[{currency,quantity}], assetsEntity, equityEntity,
 *                       claimCurrencyKey, effectiveDate, description}
 * @param {Object} priceTable key -> USD price
 * @return {Object} {transactionType, valueUsd, resolvedAssets, source, destination}
 */
function deriveTransactionRows_(decl, priceTable) {
  if (!decl) throw new Error('No declaration supplied');

  var type = String(decl.transactionType || '').trim().toLowerCase();
  if (ALLOWED_TRANSACTION_TYPES.indexOf(type) === -1) {
    throw new Error('Unknown Transaction Type "' + decl.transactionType + '". Allowed: '
      + ALLOWED_TRANSACTION_TYPES.join(', '));
  }
  if (!decl.source || !decl.source.url) throw new Error('Source Ledger URL is required');
  if (!decl.destination || !decl.destination.url) throw new Error('Destination Ledger URL is required');
  if (!decl.effectiveDate) throw new Error('Effective Date is required');
  if (!decl.description) throw new Error('Description is required');

  var assetsEntity = String(decl.assetsEntity || '').trim();
  if (!assetsEntity) {
    throw new Error('Assets Entity is required -- it must be the HUMAN CUSTODIAN on every '
      + 'Assets leg (INTER_LEDGER_HOLDINGS.md 3.4).');
  }

  var equityEntity = String(decl.equityEntity || DEFAULT_EQUITY_ENTITY).trim();
  if (equityEntity !== DEFAULT_EQUITY_ENTITY) {
    throw new Error('Equity Entity must be exactly "' + DEFAULT_EQUITY_ENTITY + '", got "'
      + equityEntity + '". /treasury matches colA==="TrueSight DAO" && colC==="USD"; any '
      + 'other string makes the stake INVISIBLE to the equity tracker.');
  }
  if (assetsEntity === equityEntity) {
    throw new Error('Assets entity and Equity entity are identical ("' + assetsEntity + '"). '
      + 'INTER_LEDGER_HOLDINGS.md 3.4: NEVER the same name on both legs -- Assets carries the '
      + 'custodian, Equity carries the financier.');
  }

  var assets = decl.assets || [];
  if (!assets.length) throw new Error('At least one Asset line is required');

  var valueUsd = 0;
  var resolved = [];
  for (var i = 0; i < assets.length; i++) {
    var key = String(assets[i].currency || '').trim();
    var qty = assets[i].quantity;
    if (typeof qty !== 'number' || !isFinite(qty) || qty === 0) {
      throw new Error('Asset "' + key + '" has an invalid quantity: ' + assets[i].quantity);
    }
    if (qty < 0) {
      throw new Error('Asset "' + key + '" has a negative quantity. Direction is implied by '
        + 'source -> destination; quantities are always positive.');
    }
    var price = resolvePrice_(key, priceTable);
    var lineValue = qty * price;
    valueUsd += lineValue;
    resolved.push({ currency: key, quantity: qty, price: price, value: lineValue });
  }

  // Round once, to 6dp, BEFORE the value reaches a ledger row. Float
  // accumulation gives 24.980000000000004 for 40x0.0705 + 40x0.554; writing
  // that to a ledger is noise, and it would also make the balance assertion
  // depend on floating-point ordering rather than arithmetic.
  valueUsd = Math.round(valueUsd * 1000000) / 1000000;

  var sourceRows = [];
  var destRows = [];
  var a;

  if (type === 'injection') {
    for (a = 0; a < resolved.length; a++) {
      sourceRows.push(buildTxRow_(decl, resolved[a].currency, -resolved[a].quantity, ASSETS_CATEGORY, assetsEntity));
      destRows.push(buildTxRow_(decl, resolved[a].currency, resolved[a].quantity, ASSETS_CATEGORY, assetsEntity));
    }
    var claimKey = String(decl.claimCurrencyKey || '').trim();
    if (!claimKey) {
      throw new Error('injection requires claimCurrencyKey -- the origin MUST book its claim '
        + '(CHOCOLATE_BAR_PRODUCTION_ACCOUNTING.md 9.1 row 2). Without it the origin\'s assets are '
        + 'reduced with no counterpart and the ledger is UNBALANCED.');
    }
    assertClaimPricedOne_(claimKey, priceTable);
    sourceRows.push(buildTxRow_(decl, claimKey, valueUsd, ASSETS_CATEGORY, assetsEntity));
    destRows.push(buildTxRow_(decl, USD_CURRENCY_KEY, valueUsd, EQUITY_CATEGORY, equityEntity));

  } else if (type === 'movement') {
    // AGL -> AGL under a common financier. No claim exists, so the reciprocal
    // asset+equity pair is what keeps BOTH ledgers balanced.
    for (a = 0; a < resolved.length; a++) {
      sourceRows.push(buildTxRow_(decl, resolved[a].currency, -resolved[a].quantity, ASSETS_CATEGORY, assetsEntity));
      destRows.push(buildTxRow_(decl, resolved[a].currency, resolved[a].quantity, ASSETS_CATEGORY, assetsEntity));
    }
    sourceRows.push(buildTxRow_(decl, USD_CURRENCY_KEY, -valueUsd, EQUITY_CATEGORY, equityEntity));
    destRows.push(buildTxRow_(decl, USD_CURRENCY_KEY, valueUsd, EQUITY_CATEGORY, equityEntity));

  } else {
    // retirement: exact mirror of injection; unwinds the claim.
    var retireKey = String(decl.claimCurrencyKey || '').trim();
    if (!retireKey) throw new Error('retirement requires claimCurrencyKey -- nothing to retire without one');
    assertClaimPricedOne_(retireKey, priceTable);
    sourceRows.push(buildTxRow_(decl, retireKey, -valueUsd, ASSETS_CATEGORY, assetsEntity));
    destRows.push(buildTxRow_(decl, USD_CURRENCY_KEY, -valueUsd, EQUITY_CATEGORY, equityEntity));
    for (a = 0; a < resolved.length; a++) {
      sourceRows.push(buildTxRow_(decl, resolved[a].currency, resolved[a].quantity, ASSETS_CATEGORY, assetsEntity));
      destRows.push(buildTxRow_(decl, resolved[a].currency, -resolved[a].quantity, ASSETS_CATEGORY, assetsEntity));
    }
  }

  var result = {
    transactionType: type,
    valueUsd: valueUsd,
    resolvedAssets: resolved,
    source: { name: decl.source.name, url: decl.source.url, rows: sourceRows },
    destination: { name: decl.destination.name, url: decl.destination.url, rows: destRows }
  };
  assertLedgerBalances_(result, priceTable);
  return result;
}

/** @private */
function assertClaimPricedOne_(claimKey, priceTable) {
  var price = resolvePrice_(claimKey, priceTable);
  if (price !== 1) {
    throw new Error('Claim key "' + claimKey + '" is priced at ' + price + ', not 1. A claim '
      + 'instrument must be priced 1 so quantity === USD value; any other price silently breaks '
      + 'the balance the moment the catalog price is edited.');
  }
}

/**
 * Asserts Assets === Equity on EACH ledger independently, IN USD.
 *
 * CRITICAL: rows must be VALUED before summing. A ledger row is
 * (amount x currency), and the mixed-unit case is the whole point of this
 * event -- an injection's origin holds "-40 envelopes" and "+24.98 USD" in the
 * SAME Assets section. Summing raw amounts yields -55.02, which is meaningless:
 * 40 envelopes are not 40 dollars. Every row is converted to USD via the live
 * price table before the identity is checked.
 *
 * This valuation step was missing in the first draft and the guard immediately
 * failed the injection test with "Assets = -55.02, Equity = 0" -- exactly the
 * derivation bug this assertion exists to catch BEFORE a row is written.
 */
function assertLedgerBalances_(derivation, priceTable) {
  ['source', 'destination'].forEach(function (side) {
    var rows = derivation[side].rows;
    var assetsTotal = 0, equityTotal = 0;
    for (var i = 0; i < rows.length; i++) {
      var amount = rows[i][TX_COLS.AMOUNT];
      var key = rows[i][TX_COLS.CURRENCY];
      var price = resolvePrice_(key, priceTable);
      var usd = amount * price;
      if (rows[i][TX_COLS.CATEGORY] === ASSETS_CATEGORY) assetsTotal += usd;
      if (rows[i][TX_COLS.CATEGORY] === EQUITY_CATEGORY) equityTotal += usd;
    }
    assetsTotal = Math.round(assetsTotal * 1000000) / 1000000;
    equityTotal = Math.round(equityTotal * 1000000) / 1000000;
    var delta = Math.round((assetsTotal - equityTotal) * 1000000) / 1000000;
    if (delta !== 0) {
      throw new Error('UNBALANCED_LEDGER: ' + side + ' ("' + derivation[side].name + '") would '
        + 'have Assets = $' + assetsTotal + ' but Equity = $' + equityTotal + ' (delta ' + delta
        + '). Refusing to write.');
    }
  });
}

// ---------------------------------------------------------------------------
// Atomic append with rollback
// ---------------------------------------------------------------------------

/**
 * Appends rows to multiple sheets, rolling back on any failure.
 * GAS has no transactions and the legs live in DIFFERENT spreadsheets, so no
 * single setValues is atomic across them. Append each leg, track what applied,
 * and on failure delete applied rows in reverse. The 2-of-4 partial write is the
 * exact failure class this event exists to eliminate.
 *
 * @param {Array} writes [{sheet, rows, label}]
 * @return {Array} applied [{sheet, startRow, count, label}]
 */
function appendRowsAtomically_(writes) {
  var applied = [];
  try {
    for (var i = 0; i < writes.length; i++) {
      var w = writes[i];
      if (!w.rows || !w.rows.length) continue;
      var startRow = w.sheet.getLastRow() + 1;
      w.sheet.getRange(startRow, 1, w.rows.length, TX_WIDTH).setValues(w.rows);
      applied.push({ sheet: w.sheet, startRow: startRow, count: w.rows.length, label: w.label });
      Logger.log('  + appended ' + w.rows.length + ' row(s) to ' + w.label + ' at row ' + startRow);
    }
    return applied;
  } catch (err) {
    Logger.log('ROLLBACK TRIGGERED: ' + err.message);
    for (var j = applied.length - 1; j >= 0; j--) {
      try {
        applied[j].sheet.deleteRows(applied[j].startRow, applied[j].count);
        Logger.log('  - rolled back ' + applied[j].count + ' row(s) from ' + applied[j].label);
      } catch (rbErr) {
        Logger.log('CRITICAL: could not roll back ' + applied[j].label + ' rows '
          + applied[j].startRow + '-' + (applied[j].startRow + applied[j].count - 1)
          + ': ' + rbErr.message + ' -- MANUAL RECONCILIATION REQUIRED');
      }
    }
    throw new Error('Atomic append failed and was rolled back: ' + err.message);
  }
}

// ---------------------------------------------------------------------------
// Declaration parsing
// ---------------------------------------------------------------------------

/**
 * Parses a [MANAGED LEDGER TRANSACTION EVENT] declaration.
 * Note what is ABSENT from the input: no USD total. Value is derived from live
 * Currencies prices, so the caller cannot mistype it and cannot disagree with
 * the catalog.
 *
 * Asset lines are repeatable, formatted `<qty> | <currency key>`.
 */
function parseManagedLedgerTransactionMessage(message) {
  if (!message || String(message).indexOf(MLTE_EVENT_MARKER) === -1) {
    throw new Error('Message does not contain ' + MLTE_EVENT_MARKER);
  }
  var decl = {
    source: { name: extractField_(message, 'Source Ledger'), url: extractField_(message, 'Source Ledger URL') },
    destination: { name: extractField_(message, 'Destination Ledger'), url: extractField_(message, 'Destination Ledger URL') },
    transactionType: extractField_(message, 'Transaction Type'),
    assets: [],
    assetsEntity: extractField_(message, 'Assets Entity'),
    equityEntity: extractField_(message, 'Equity Entity'),
    claimCurrencyKey: extractField_(message, 'Claim Currency Key'),
    effectiveDate: null,
    description: extractField_(message, 'Description'),
    digitalSignature: null,
    requestTransactionId: extractField_(message, 'Request Transaction ID')
  };

  var dateRaw = extractField_(message, 'Effective Date');
  if (dateRaw) {
    var parsed = new Date(dateRaw);
    if (!isNaN(parsed.getTime())) decl.effectiveDate = parsed;
  }

  // Split on the FIRST pipe only -- currency keys legitimately contain commas
  // and parentheses, so the key must never be re-parsed.
  var assetPattern = /-\s*Asset:\s*([^\n]+)/gi;
  var match;
  while ((match = assetPattern.exec(message)) !== null) {
    var line = match[1].trim();
    var pipeAt = line.indexOf('|');
    if (pipeAt === -1) throw new Error('Malformed Asset line (expected `<qty> | <currency key>`): ' + line);
    var qtyRaw = line.substring(0, pipeAt).trim();
    var key = line.substring(pipeAt + 1).trim();
    var qty = parseFloat(qtyRaw.replace(/,/g, ''));
    if (!isFinite(qty)) throw new Error('Malformed Asset quantity: ' + qtyRaw);
    if (!key) throw new Error('Empty currency key on Asset line');
    decl.assets.push({ currency: key, quantity: qty });
  }

  var sigMatch = message.match(/My Digital Signature:\s*([\s\S]*?)(?:\n\s*Request Transaction ID:|$)/i);
  if (sigMatch) decl.digitalSignature = sigMatch[1].trim();
  return decl;
}

/** @private */
function extractField_(message, label) {
  var escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var m = message.match(new RegExp('-\\s*' + escaped + '\\s*:\\s*([^\\n]+)', 'i'));
  return m ? m[1].trim() : null;
}

// ---------------------------------------------------------------------------
// Commit path
// ---------------------------------------------------------------------------

/**
 * Echoes a derivation before commit.
 * A bare "40 stickers" genuinely cannot distinguish $0.0581 from $0.554 -- two
 * near-identical catalog names 9.5x apart. The operator must see WHICH key
 * resolved, and at what price, before money moves.
 */
function describeDerivation_(derivation) {
  var lines = ['Transaction Type: ' + derivation.transactionType,
               'Derived value: $' + derivation.valueUsd, 'Resolved assets:'];
  for (var i = 0; i < derivation.resolvedAssets.length; i++) {
    var a = derivation.resolvedAssets[i];
    lines.push('  - ' + a.quantity + ' x "' + a.currency + '" @ $' + a.price
      + ' = $' + Math.round(a.value * 100000) / 100000);
  }
  ['source', 'destination'].forEach(function (side) {
    lines.push(side.toUpperCase() + ' (' + derivation[side].name + ') rows:');
    derivation[side].rows.forEach(function (row) {
      lines.push('  ' + row[TX_COLS.CATEGORY] + ' | ' + row[TX_COLS.CURRENCY] + ' | '
        + row[TX_COLS.AMOUNT] + ' | entity=' + row[TX_COLS.ENTITY]);
    });
  });
  return lines.join('\n');
}

/**
 * Processes NEW rows in the 'Managed Ledger Transactions' tab.
 * For each: re-derive from live prices, echo the resolved keys/prices/rows, then
 * commit atomically. Only COMMITTABLE_TRANSACTION_TYPES are ever written.
 */
function processNewManagedLedgerTransactions() {
  var ss = SpreadsheetApp.openByUrl(TELEGRAM_LOGS_URL);
  var sheet = ss.getSheetByName(MLTE_SHEET);
  if (!sheet) {
    Logger.log('ERROR: ' + MLTE_SHEET + ' sheet not found');
    return;
  }

  var data = sheet.getDataRange().getValues();
  var priceTable = loadCurrencyPrices_();
  var processed = 0, failed = 0, blocked = 0;

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[MLTE_COL.STATUS] !== 'NEW') continue;
    var rowNumber = i + 1;
    Logger.log('\nProcessing MLTE row ' + rowNumber);

    var decl;
    try {
      var assetsDecoded = row[MLTE_COL.ASSETS];
      decl = {
        source: { name: row[MLTE_COL.SRC_NAME], url: row[MLTE_COL.SRC_URL] },
        destination: { name: row[MLTE_COL.DST_NAME], url: row[MLTE_COL.DST_URL] },
        transactionType: row[MLTE_COL.TYPE],
        assets: typeof assetsDecoded === 'string' ? JSON.parse(assetsDecoded) : assetsDecoded,
        assetsEntity: row[MLTE_COL.ASSETS_ENTITY],
        equityEntity: row[MLTE_COL.EQUITY_ENTITY] || DEFAULT_EQUITY_ENTITY,
        effectiveDate: row[MLTE_COL.DATE] || new Date(),
        description: row[MLTE_COL.DESCRIPTION]
      };
    } catch (parseErr) {
      Logger.log('  x could not read declaration: ' + parseErr.message);
      sheet.getRange(rowNumber, MLTE_COL.STATUS + 1).setValue('FAILED');
      failed++;
      continue;
    }

    var derivation;
    try {
      derivation = deriveTransactionRows_(decl, priceTable);
      Logger.log('\n' + describeDerivation_(derivation));
    } catch (deriveErr) {
      Logger.log('  x derivation refused: ' + deriveErr.message);
      sheet.getRange(rowNumber, MLTE_COL.STATUS + 1).setValue('FAILED');
      failed++;
      continue;
    }

    if (COMMITTABLE_TRANSACTION_TYPES.indexOf(derivation.transactionType) === -1) {
      Logger.log('  ! BLOCKED: "' + derivation.transactionType + '" is specified but its live '
        + 'write is gated. Derivation succeeded; nothing was written.');
      sheet.getRange(rowNumber, MLTE_COL.STATUS + 1).setValue('BLOCKED');
      blocked++;
      continue;
    }

    try {
      var srcSheet = SpreadsheetApp.openByUrl(derivation.source.url).getSheetByName(LEDGER_TRANSACTIONS_SHEET);
      var dstSheet = SpreadsheetApp.openByUrl(derivation.destination.url).getSheetByName(LEDGER_TRANSACTIONS_SHEET);
      if (!srcSheet) throw new Error(LEDGER_TRANSACTIONS_SHEET + ' sheet not found on source ledger');
      if (!dstSheet) throw new Error(LEDGER_TRANSACTIONS_SHEET + ' sheet not found on destination ledger');

      var applied = appendRowsAtomically_([
        { sheet: srcSheet, rows: derivation.source.rows, label: 'source:' + derivation.source.name },
        { sheet: dstSheet, rows: derivation.destination.rows, label: 'destination:' + derivation.destination.name }
      ]);
      var lineRefs = applied.map(function (x) {
        return x.label + '=' + x.startRow + '-' + (x.startRow + x.count - 1);
      }).join('; ');

      sheet.getRange(rowNumber, MLTE_COL.VALUE_USD + 1).setValue(derivation.valueUsd);
      sheet.getRange(rowNumber, MLTE_COL.STATUS + 1).setValue('PROCESSED');
      sheet.getRange(rowNumber, MLTE_COL.LEDGER_LINES + 1).setValue(lineRefs);
      Logger.log('  OK committed: ' + lineRefs);
      processed++;
    } catch (commitErr) {
      Logger.log('  x commit failed: ' + commitErr.message);
      sheet.getRange(rowNumber, MLTE_COL.STATUS + 1).setValue('FAILED');
      failed++;
    }
  }

  Logger.log('\nMLTE processing complete: ' + processed + ' processed, '
    + blocked + ' blocked, ' + failed + ' failed');
  if (processed > 0) notifyTreasuryCachePublisher_('managed_ledger_transaction');
}

// ---------------------------------------------------------------------------
// [INTER_LEDGER CLAIM RETIREMENT EVENT] -- logic done, LIVE WRITE GATED
// ---------------------------------------------------------------------------

/**
 * =========================================================================
 * GATED -- do not unblock without an explicit governor go-ahead.
 * =========================================================================
 *
 * Governor ruling (Gary Teh, 2026-10-27):
 *   "AGL -> Main for retired claim is a missing contract which we will need to
 *    implement later. ... Indicate in the code clearly that implementation will
 *    happen later. If this scenario occurs, we then gather enough data and do
 *    the implementation at the GAS."
 *
 * STATUS: DERIVATION is implemented -- deriveTransactionRows_ handles type
 * 'retirement' and assertLedgerBalances_ proves it balances both ledgers. What
 * is deliberately NOT implemented is the LIVE WRITE.
 *
 * The split is intentional: retirement rows are pure arithmetic and safe to
 * preview, but committing them against real ledgers before a real case has been
 * observed would be implementing on speculation. Two guards are also still
 * unbuilt and MUST land before this can commit:
 *   1. OUTSTANDING-CLAIM CEILING -- sum the claim key on the source ledger and
 *      refuse any retirement exceeding it. No negative assets, ever.
 *   2. INJECTION REFERENCE -- link each retirement to its originating injection
 *      so a claim's life is traceable end to end.
 *
 * TO GO LIVE, in this order:
 *   1. observe one real claim-retirement and record its actual shape;
 *   2. reconcile against CHOCOLATE_BAR_PRODUCTION_ACCOUNTING.md 10.2 / 10.3;
 *   3. implement the outstanding-claim ceiling;
 *   4. add 'retirement' to COMMITTABLE_TRANSACTION_TYPES;
 *   5. add the event to Edgar's catalog and to server/dispatch.py ROUTING.
 * =========================================================================
 *
 * @throws {Error} always.
 */
function processNewClaimRetirements() {
  throw new Error('NOT_IMPLEMENTED: [INTER_LEDGER CLAIM RETIREMENT EVENT] is a named but '
    + 'deliberately gated contract. Row derivation exists (deriveTransactionRows_ '
    + 'type=retirement) but the live write is blocked pending a real case and the '
    + 'outstanding-claim ceiling guard. See the block comment above and '
    + 'CHOCOLATE_BAR_PRODUCTION_ACCOUNTING.md 10.');
}

// ---------------------------------------------------------------------------
// Self-tests -- run from the GAS editor. NO side effects, NO ledger writes.
// ---------------------------------------------------------------------------

function testDeriveTransactionRows() {
  var envelope = 'Joyberg kraft cash envelope 6.5x3.2in (per piece, Amazon 111-2611520-6121033)';
  var sticker = 'Sticker Mule 4x2in custom rectangle label (per piece, order R384751187)';
  var claimKey = 'TrueSight DAO equity in AGL13';

  var priceTable = { 'USD': 1 };
  priceTable[claimKey] = 1;
  priceTable[envelope] = 0.0705;
  priceTable[sticker] = 0.554;

  var base = {
    source: { name: 'Main Ledger', url: 'https://example/SRC' },
    destination: { name: 'AGL13', url: 'https://example/DST' },
    transactionType: 'injection',
    assets: [{ currency: envelope, quantity: 40 }, { currency: sticker, quantity: 40 }],
    assetsEntity: 'Kirsten',
    equityEntity: DEFAULT_EQUITY_ENTITY,
    claimCurrencyKey: claimKey,
    effectiveDate: new Date('2026-10-27'),
    description: 'Test injection'
  };
  var expected = Math.round((40 * 0.0705 + 40 * 0.554) * 100000) / 100000;

  // 1. injection derives the four-row shape at $24.98
  var d = deriveTransactionRows_(base, priceTable);
  assertEqual_(d.valueUsd, expected, 'injection value = $24.98');
  assertEqual_(d.source.rows.length, 3, 'source = 2 assets + claim');
  assertEqual_(d.destination.rows.length, 3, 'destination = 2 assets + equity');
  assertEqual_(d.source.rows[0][TX_COLS.AMOUNT], -40, 'source asset negated');
  assertEqual_(d.destination.rows[0][TX_COLS.AMOUNT], 40, 'destination asset positive');
  assertEqual_(d.destination.rows[2][TX_COLS.ENTITY], DEFAULT_EQUITY_ENTITY, 'equity entity literal');
  assertEqual_(d.source.rows[0][TX_COLS.ENTITY], 'Kirsten', 'assets entity is custodian');
  Logger.log('PASS: both ledgers balance for injection');

  // 2. unknown currency key throws (never a silent $0)
  assertThrows_(function () {
    deriveTransactionRows_({
      source: base.source, destination: base.destination, transactionType: 'injection',
      assets: [{ currency: 'Nonexistent Sticker 9x9', quantity: 1 }], assetsEntity: 'Kirsten',
      equityEntity: DEFAULT_EQUITY_ENTITY, claimCurrencyKey: claimKey,
      effectiveDate: base.effectiveDate, description: 'x'
    }, priceTable);
  }, 'UNKNOWN_CURRENCY_KEY');

  // 3. Equity Entity other than TrueSight DAO throws (else invisible to /treasury)
  assertThrows_(function () {
    deriveTransactionRows_({
      source: base.source, destination: base.destination, transactionType: 'injection',
      assets: [{ currency: envelope, quantity: 1 }], assetsEntity: 'Kirsten',
      equityEntity: 'Main', claimCurrencyKey: claimKey,
      effectiveDate: base.effectiveDate, description: 'x'
    }, priceTable);
  }, 'Equity Entity must be exactly');

  // 4. missing claim key on injection throws (unbalanced origin)
  assertThrows_(function () {
    deriveTransactionRows_({
      source: base.source, destination: base.destination, transactionType: 'injection',
      assets: [{ currency: envelope, quantity: 1 }], assetsEntity: 'Kirsten',
      equityEntity: DEFAULT_EQUITY_ENTITY, claimCurrencyKey: null,
      effectiveDate: base.effectiveDate, description: 'x'
    }, priceTable);
  }, 'claimCurrencyKey');

  // 5. movement balances both ledgers
  var dm = deriveTransactionRows_({
    source: base.source, destination: base.destination, transactionType: 'movement',
    assets: [{ currency: envelope, quantity: 10 }], assetsEntity: 'Kirsten',
    equityEntity: DEFAULT_EQUITY_ENTITY, effectiveDate: base.effectiveDate, description: 'x'
  }, priceTable);
  assertEqual_(dm.source.rows.length, 2, 'movement source = 1 asset + 1 equity');
  Logger.log('PASS: movement balances both ledgers');

  // 6. retirement derives and balances
  var dr = deriveTransactionRows_({
    source: base.source, destination: base.destination, transactionType: 'retirement',
    assets: [{ currency: envelope, quantity: 40 }, { currency: sticker, quantity: 40 }],
    assetsEntity: 'Kirsten', equityEntity: DEFAULT_EQUITY_ENTITY,
    claimCurrencyKey: claimKey, effectiveDate: base.effectiveDate, description: 'x'
  }, priceTable);
  assertEqual_(dr.valueUsd, expected, 'retirement mirrors injection value');
  Logger.log('PASS: retirement derivation balances both ledgers');

  // 7. live retirement write stays gated; not committable
  assertThrows_(function () { processNewClaimRetirements(); }, 'NOT_IMPLEMENTED');
  assertEqual_(COMMITTABLE_TRANSACTION_TYPES.indexOf('retirement'), -1,
    'retirement not committable until ceiling guard lands');

  Logger.log('\nALL TESTS PASSED -- derivation engine safe to deploy.');
  Logger.log('Nothing was written to any ledger.');
}

/** @private */
function assertEqual_(actual, expected, label) {
  if (actual !== expected) {
    throw new Error('ASSERT FAILED [' + label + ']: expected ' + expected + ', got ' + actual);
  }
  Logger.log('PASS: ' + label + ' (' + actual + ')');
}

/** @private */
function assertThrows_(fn, expectedSubstring) {
  var threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    if (e.message.indexOf(expectedSubstring) === -1) {
      throw new Error('ASSERT FAILED: threw "' + e.message + '" but expected to contain "'
        + expectedSubstring + '"');
    }
  }
  if (!threw) throw new Error('ASSERT FAILED: expected a throw containing "' + expectedSubstring + '"');
  Logger.log('PASS: correctly threw for "' + expectedSubstring + '"');
}
