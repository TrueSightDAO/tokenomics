/** Credentials.js -- sunmint_tree_planting. SECRET-FREE, TRACKED, PUSHED.
 *
 *  The underlying Script Properties (TELEGRAM_API_TOKEN, GITHUB_API_TOKEN, SHEET_ID)
 *  live in Project Settings -> Script properties and are never touched by a push
 *  (Script Properties are stored separately from source files). Only this accessor
 *  file had been deleted by a push before, which is why it is now tracked in git so
 *  it is always part of the pushed file set. setApiKeys() is a no-op for any property
 *  that is already set -- it will NOT overwrite a real value.
 *
 *  Usage in GAS code:
 *    setApiKeys();
 *    const creds = getCredentials();
 *    const token = creds.TELEGRAM_API_TOKEN;
 */
function setApiKeys() {
  var props = PropertiesService.getScriptProperties();

  // Telegram Bot API token (from @BotFather). Used by getTelegramFileUrl() to resolve
  // the photo a farmer attached to their [TREE PLANTING EVENT] submission.
  if (!props.getProperty('TELEGRAM_API_TOKEN')) {
    props.setProperty('TELEGRAM_API_TOKEN', 'REPLACE_ME');
  }

  // GitHub PAT -- contents:write on TrueSightDAO/sunmint. Used by uploadToGitHub().
  if (!props.getProperty('GITHUB_API_TOKEN')) {
    props.setProperty('GITHUB_API_TOKEN', 'REPLACE_ME');
  }

  // Telegram & Submissions sheet id (access is via Sheets sharing, not this id).
  if (!props.getProperty('SHEET_ID')) {
    props.setProperty('SHEET_ID', '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ');
  }
}

function getCredentials() {
  var props = PropertiesService.getScriptProperties();
  return {
    TELEGRAM_API_TOKEN: props.getProperty('TELEGRAM_API_TOKEN') || '',
    GITHUB_API_TOKEN: props.getProperty('GITHUB_API_TOKEN') || '',
    SHEET_ID: props.getProperty('SHEET_ID') || ''
  };
}
