/**
 * Credentials.js -- SECRET-FREE accessor. TRACKED and PUSHED on purpose.
 *
 * WHY THIS FILE EXISTS: a push had deleted this file from the project, so every
 * trigger run aborted at global scope with
 * "ReferenceError: getCredentials is not defined" before doing any work.
 *
 * Script Properties live under Project Settings and are stored separately from
 * source files, so a push never touches them. setApiKeys() only fills a property
 * that is currently EMPTY -- it will never overwrite a real value.
 *
 * Usage:
 *   setApiKeys();
 *   const creds = getCredentials();
 */
function setApiKeys() {
  var props = PropertiesService.getScriptProperties();
  var seed = {
    TELEGRAM_API_TOKEN: 'REPLACE_ME',
    GITHUB_API_TOKEN: 'REPLACE_ME',
    OPENAI_API_KEY: 'REPLACE_ME',
    XAI_API_KEY: 'REPLACE_ME',
    QUICKNODE_API_KEY: 'REPLACE_ME',
    WIX_API_KEY: 'REPLACE_ME'
  };
  Object.keys(seed).forEach(function (k) {
    if (!props.getProperty(k)) {
      props.setProperty(k, seed[k]);
    }
  });
}

function getCredentials() {
  var props = PropertiesService.getScriptProperties();
  return {
    TELEGRAM_API_TOKEN: props.getProperty('TELEGRAM_API_TOKEN') || '',
    GITHUB_API_TOKEN: props.getProperty('GITHUB_API_TOKEN') || '',
    OPENAI_API_KEY: props.getProperty('OPENAI_API_KEY') || '',
    XAI_API_KEY: props.getProperty('XAI_API_KEY') || '',
    QUICKNODE_API_KEY: props.getProperty('QUICKNODE_API_KEY') || '',
    WIX_API_KEY: props.getProperty('WIX_API_KEY') || '',
    SHEET_ID: props.getProperty('SHEET_ID') || ''
  };
}
