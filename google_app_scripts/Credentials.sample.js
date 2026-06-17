/**
 * Credentials.sample.js — Template for Credentials.js
 * ===================================================
 *
 * Copy this file to Credentials.js and fill in the actual values.
 * Credentials.js is gitignored — never commit real secrets.
 *
 * Usage in GAS code:
 *   const creds = getCredentials();
 *   const token = creds.TELEGRAM_API_TOKEN;
 */

function getCredentials() {
  return {
    // Telegram Bot API token (from @BotFather)
    TELEGRAM_API_TOKEN: PropertiesService.getScriptProperties().getProperty('TELEGRAM_API_TOKEN') || '',

    // GitHub Personal Access Token (contents:write scope on target repos)
    GITHUB_API_TOKEN: PropertiesService.getScriptProperties().getProperty('GITHUB_API_TOKEN') || '',

    // Telegram Chat ID for notifications
    TELEGRAM_CHAT_ID: PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID') || '',

    // Stripe API key (if project handles payments)
    STRIPE_API_KEY: PropertiesService.getScriptProperties().getProperty('STRIPE_API_KEY') || '',

    // Add project-specific credentials below
  };
}
