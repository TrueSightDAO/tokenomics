/**
 * Credentials.sample.js — Template for Credentials.js (project: agroverse_wix_site_updates)
 * =========================================================================================
 *
 * Copy this file to Credentials.js and fill in the actual values.
 * Credentials.js is gitignored (google_app_scripts/**​/Credentials.js) — never commit real secrets.
 *
 * This GAS project (scriptId 1Y8sJ22lZuqQYS_kF_3ItMuyfiAzbJ4wRA1xGC_bGx7FPB7uLTvrUObly,
 * agroverse_wix_site_updates.js) pushes content updates to the Agroverse Wix site and reads
 * on-chain data via QuickNode. It needs the two secrets below.
 *
 * Preferred: store the real values in Script Properties (Project Settings → Script Properties)
 * so they never live in a source file at all; the getters below fall back to Script Properties.
 *
 * Usage in GAS code:
 *   const creds = getCredentials();
 *   const wix = creds.WIX_API_KEY;
 */

function getCredentials() {
  return {
    // Wix API key / access token (IST.<jwt>) — Wix headless app token for the Agroverse site.
    // Source: Wix Dashboard → Settings → Headless / API Keys (account tenant 0e2cde5f-...).
    WIX_API_KEY: PropertiesService.getScriptProperties().getProperty('WIX_API_KEY') || 'IST.REPLACE_ME',

    // QuickNode API key — RPC endpoint auth for on-chain reads.
    // Source: QuickNode dashboard → your endpoint → Security / API key.
    QUICKNODE_API_KEY: PropertiesService.getScriptProperties().getProperty('QUICKNODE_API_KEY') || 'REPLACE_ME',
  };
}
