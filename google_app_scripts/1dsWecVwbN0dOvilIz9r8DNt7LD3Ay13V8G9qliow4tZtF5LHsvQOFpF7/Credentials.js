/**
 * Credentials.js - 1dsWec (sales processing / Parse Telegram ChatLogs)
 * TRACKED IN GIT since 2026-09-13 - safe to commit: it contains NO secrets.
 *
 * NOTE (2026-08-21 incident): a clasp push from a folder without this file deleted it
 * from the live project, breaking every function (ReferenceError: setApiKeys is not
 * defined). Script Properties (Project Settings > Script Properties) were NEVER touched
 * by the push - they are separate storage. setApiKeys() below is a no-op for any
 * property already set, so it will NOT overwrite the real live values.
 *
 * This file is now committed (via a .gitignore negation for this path only) so a
 * future clasp push can never again delete it from the live project.
 *
 * Usage in GAS code:
 *   setApiKeys();
 *   const creds = getCredentials();
 *   const token = creds.TELEGRAM_API_TOKEN;
 */

function setApiKeys() {
  var props = PropertiesService.getScriptProperties();

  // xAI (Grok) API key - used for XAI_API_KEY in Parse Telegram ChatLogs.js.
  if (!props.getProperty('XAI_API_KEY')) {
    props.setProperty('XAI_API_KEY', 'REPLACE_ME');
  }

  // Telegram Bot API token (from @BotFather) - used to send sale notifications
  // and resolve Telegram files. Confirmed already set in Script Properties -
  // this line is a no-op fallback.
  if (!props.getProperty('TELEGRAM_API_TOKEN')) {
    props.setProperty('TELEGRAM_API_TOKEN', 'REPLACE_ME');
  }

  // Telegram & Sales Google Sheet ID - holds "Telegram Chat Logs" + "QR Code Sales".
  if (!props.getProperty('SHEET_ID')) {
    props.setProperty('SHEET_ID', '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ');
  }
}

function getCredentials() {
  var props = PropertiesService.getScriptProperties();
  return {
    XAI_API_KEY: props.getProperty('XAI_API_KEY') || '',
    TELEGRAM_API_TOKEN: props.getProperty('TELEGRAM_API_TOKEN') || '',
    SHEET_ID: props.getProperty('SHEET_ID') || '',
  };
}
