/**
 * Google Apps Script to create an Agroverse cacao circle event in Wix
 * from a Luma event page URL.
 *
 * This script:
 * 1. Fetches the HTML of the given Luma event page.
 * 2. Calls the XAI API (Grok) to extract and enrich event details.
 * 3. Creates a new event in Wix Events pointing back to the original Luma URL.
 *
 * Requirements:
 * - Set the following Script Properties in Apps Script Project Settings:
 *     XAI_API_KEY : Your XAI (Grok) API key.
 *     WIX_API_KEY : Your Wix Events API key.
 * - Site ID is provided by getAgroverseSiteId() in this script.
 *
 * Usage:
 *   // In the Apps Script console, set your Script Properties:
 *   var scriptProperties = PropertiesService.getScriptProperties();
 *   scriptProperties.setProperty('XAI_API_KEY', '<YOUR_XAI_API_KEY>');
 *   scriptProperties.setProperty('WIX_API_KEY', '<YOUR_WIX_API_KEY>');
 *   // Then invoke:
 *   var event = populateWixEventFromLumaUrl('https://your-luma-event-page.url');
*/


/**
 * Returns the Agroverse Wix site ID.
 * @returns {string} Agroverse Wix site ID.
 */
function getAgroverseSiteId() {
  return "508217b2-8792-4ab2-b733-2784b4886a9c";
}

/**
 * Main entry point: given a Luma event URL, fetches event details via Grok
 * and creates a Wix Events listing for Agroverse's cacao circle.
 *
 * @param {string} lumaUrl - URL of the Luma event page.
 * @returns {object} - The created Wix event object.
 */
function populateWixEventFromLumaUrl(lumaUrl) {
  var html = fetchLumaEventPage(lumaUrl);
  var details = generateEventDetailsViaGrok(html, lumaUrl);
  var event = createWixEvent(details);
  return event;
}

/**
 * Fetches the HTML content of a Luma event page.
 *
 * @param {string} url
 * @returns {string} HTML content of the page.
 */
function fetchLumaEventPage(url) {
  var response = UrlFetchApp.fetch(url);
  return response.getContentText();
}

/**
 * Sends the Luma HTML to the Grok API to extract and enrich event details.
 *
 * @param {string} html - Raw HTML of the Luma event page.
 * @param {string} lumaUrl - Original event page URL.
 * @returns {object} Event details including:
 *   title, summary, description, startDateTime, endDateTime,
 *   locationName, imageUrl, registrationUrl.
 */
function generateEventDetailsViaGrok(html, lumaUrl) {
  var props = PropertiesService.getScriptProperties();
  // Fetch API key for XAI/Grok
  var apiKey = props.getProperty('XAI_API_KEY');
  if (!apiKey) throw new Error('XAI_API_KEY not set in Script Properties.');

  var prompt = [
    'You are given the HTML of a Luma event page and its URL.',
    'Generate a JSON object with keys:',
    'title, summary, description, startDateTime (ISO 8601),',
    'endDateTime (ISO 8601), locationName, imageUrl, registrationUrl.',
    'Include in the description that Agroverse will host a cacao circle,',
    'and set registrationUrl to the original event URL.',
    'HTML:',
    html
  ].join('\n\n');

  var payload = {
    model: 'grok-001',
    prompt: prompt,
    temperature: 0.7,
    max_tokens: 500
  };

  var response = UrlFetchApp.fetch('https://api.grok.ai/v1/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload)
  });

  var text = response.getContentText();
  var jsonStart = text.indexOf('{');
  if (jsonStart < 0) throw new Error('Invalid response from Grok API: ' + text);
  var jsonText = text.substring(jsonStart);
  try {
    return JSON.parse(jsonText);
  } catch (e) {
    throw new Error('Failed to parse Grok response as JSON: ' + text);
  }
}

/**
 * Creates a new event in Wix Events using the provided details.
 *
 * @param {object} details - Event details from Grok.
 * @returns {object} Created Wix event object.
 */
function createWixEvent(details) {
  var props = PropertiesService.getScriptProperties();
  var wixKey = props.getProperty('WIX_API_KEY');
  if (!wixKey) {
    throw new Error('WIX_API_KEY not set in Script Properties.');
  }
  var wixSiteId = getAgroverseSiteId();

  var payload = {
    siteId: wixSiteId,
    title: details.title,
    summary: details.summary,
    description: details.description + '\n\nRegistration: <a href="' +
                 details.registrationUrl + '">Register Here</a>',
    start: details.startDateTime,
    end: details.endDateTime,
    location: { name: details.locationName },
    media: details.imageUrl ? [{ src: details.imageUrl, type: 'IMAGE' }] : []
  };

  var response = UrlFetchApp.fetch('https://www.wixapis.com/events/v1/events', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + wixKey },
    payload: JSON.stringify(payload)
  });
  return JSON.parse(response.getContentText());
}