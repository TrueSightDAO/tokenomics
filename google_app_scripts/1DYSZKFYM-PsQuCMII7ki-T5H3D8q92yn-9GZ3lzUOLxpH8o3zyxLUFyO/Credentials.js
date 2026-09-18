function getApiKey() {
  // Credentials.js -- secret-free accessor for the HelloCash project.
  // GAS scriptId 1DYSZKFYM-PsQuCMII7ki-T5H3D8q92yn-9GZ3lzUOLxpH8o3zyxLUFyO
  //
  // SECRETS LIVE IN SCRIPT PROPERTIES, NOT HERE. This file is secret-free and is
  // TRACKED + PUSHED on purpose. `clasp push` = projects.updateContent, which
  // REPLACES the project's remote file set: any file that is NOT pushed is DELETED
  // live. So the accessor must be part of the pushed set -- do NOT add this file to
  // .claspignore or .gitignore. (Before this change the live project held the
  // HelloCash JWT inline here; a push would have deleted the file outright.)
  //
  // Set value: Project Settings (gear) -> Script properties -> add
  //     HELLO_CASH_API_KEY  =  <the HelloCash API token>
  //
  // Usage (called from Code.js as `var token = getApiKey();`):
  //     var token = getApiKey();
  var sp = PropertiesService.getScriptProperties();
  // Accept name variants so a differently-named Script Property still resolves.
  var token =
    sp.getProperty('HELLO_CASH_API_KEY') ||
    sp.getProperty('HELLOCASH_API_KEY') ||
    sp.getProperty('HELLO_CASH_TOKEN') ||
    '';
  if (!token) {
    Logger.log('getApiKey: HELLO_CASH_API_KEY is not set in Script Properties.');
  }
  return token;
}
